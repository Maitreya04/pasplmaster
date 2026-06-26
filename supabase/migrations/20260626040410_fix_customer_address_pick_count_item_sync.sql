-- Compatibility columns for currently deployed REST clients.
--
-- The live ERP-shaped customers table uses address1/address2/address3, while
-- some app versions still select customers.address. Likewise, pick_line_count
-- is a derived order metric, but some deployed clients select it directly from
-- orders. Keep both columns populated from their source-of-truth fields.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address TEXT;

CREATE OR REPLACE FUNCTION public.customer_public_address(
  p_address TEXT,
  p_address1 TEXT,
  p_address2 TEXT,
  p_address3 TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    concat_ws(
      ', ',
      NULLIF(btrim(p_address1), ''),
      NULLIF(btrim(p_address2), ''),
      NULLIF(btrim(p_address3), '')
    ),
    ''
  );
$$;

UPDATE public.customers
SET address = COALESCE(
  NULLIF(btrim(address), ''),
  public.customer_public_address(address, address1, address2, address3)
)
WHERE address IS NULL
  OR btrim(address) = '';

CREATE OR REPLACE FUNCTION public.sync_customer_public_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NULLIF(btrim(NEW.address1), '') IS NULL
     AND NULLIF(btrim(NEW.address), '') IS NOT NULL THEN
    NEW.address1 := NEW.address;
  END IF;

  NEW.address := COALESCE(
    public.customer_public_address(NEW.address, NEW.address1, NEW.address2, NEW.address3),
    NULLIF(btrim(NEW.address), '')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_public_address ON public.customers;
CREATE TRIGGER trg_customers_public_address
  BEFORE INSERT OR UPDATE OF address, address1, address2, address3
  ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_customer_public_address();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pick_line_count INTEGER NOT NULL DEFAULT 0
  CHECK (pick_line_count >= 0);

CREATE OR REPLACE FUNCTION public.recompute_order_pick_line_count(p_order_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_split_from_id BOOLEAN;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = 'split_from_id'
  )
  INTO v_has_split_from_id;

  IF v_has_split_from_id THEN
    EXECUTE $sql$
      UPDATE public.orders o
      SET pick_line_count = sub.pick_line_count
      FROM (
        SELECT
          $1::BIGINT AS order_id,
          COUNT(*)::INTEGER AS pick_line_count
        FROM public.order_items oi
        WHERE oi.order_id = $1
          AND oi.split_from_id IS NULL
          AND (
            CASE
              WHEN oi.qty_approved IS NOT NULL THEN LEAST(
                GREATEST(COALESCE(oi.qty_approved, 0), 0),
                CASE
                  WHEN oi.qty_shippable IS NOT NULL THEN GREATEST(COALESCE(oi.qty_shippable, 0), 0)
                  WHEN oi.qty_po IS NOT NULL THEN GREATEST(0, COALESCE(oi.qty_requested, 0) - GREATEST(COALESCE(oi.qty_po, 0), 0))
                  ELSE GREATEST(COALESCE(oi.qty_requested, 0), 0)
                END
              )
              WHEN oi.qty_shippable IS NOT NULL THEN GREATEST(COALESCE(oi.qty_shippable, 0), 0)
              WHEN oi.qty_po IS NOT NULL THEN GREATEST(0, COALESCE(oi.qty_requested, 0) - GREATEST(COALESCE(oi.qty_po, 0), 0))
              ELSE GREATEST(COALESCE(oi.qty_requested, 0), 0)
            END
          ) > 0
      ) sub
      WHERE o.id = sub.order_id
    $sql$ USING p_order_id;
  ELSE
    UPDATE public.orders o
    SET pick_line_count = sub.pick_line_count
    FROM (
      SELECT
        p_order_id AS order_id,
        COUNT(*)::INTEGER AS pick_line_count
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND (
          CASE
            WHEN oi.qty_approved IS NOT NULL THEN LEAST(
              GREATEST(COALESCE(oi.qty_approved, 0), 0),
              CASE
                WHEN oi.qty_shippable IS NOT NULL THEN GREATEST(COALESCE(oi.qty_shippable, 0), 0)
                WHEN oi.qty_po IS NOT NULL THEN GREATEST(0, COALESCE(oi.qty_requested, 0) - GREATEST(COALESCE(oi.qty_po, 0), 0))
                ELSE GREATEST(COALESCE(oi.qty_requested, 0), 0)
              END
            )
            WHEN oi.qty_shippable IS NOT NULL THEN GREATEST(COALESCE(oi.qty_shippable, 0), 0)
            WHEN oi.qty_po IS NOT NULL THEN GREATEST(0, COALESCE(oi.qty_requested, 0) - GREATEST(COALESCE(oi.qty_po, 0), 0))
            ELSE GREATEST(COALESCE(oi.qty_requested, 0), 0)
          END
        ) > 0
    ) sub
    WHERE o.id = sub.order_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_pick_line_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_order_pick_line_count(OLD.order_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_order_pick_line_count(NEW.order_id);
  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    PERFORM public.recompute_order_pick_line_count(OLD.order_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_pick_line_count ON public.order_items;
CREATE TRIGGER trg_order_items_pick_line_count
  AFTER INSERT OR UPDATE OF order_id, qty_requested, qty_shippable, qty_po, qty_approved, split_from_id OR DELETE
  ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_order_pick_line_count();

DO $$
DECLARE
  order_row RECORD;
BEGIN
  FOR order_row IN SELECT id FROM public.orders LOOP
    PERFORM public.recompute_order_pick_line_count(order_row.id);
  END LOOP;
END $$;

COMMENT ON COLUMN public.customers.address IS
  'Compatibility/display address derived from address1/address2/address3; address1 remains the ERP source field.';

COMMENT ON COLUMN public.orders.pick_line_count IS
  'Compatibility derived count of pickable order_items rows; maintained from order_items.';
