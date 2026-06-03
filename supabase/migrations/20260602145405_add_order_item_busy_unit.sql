-- Sales-selected unit for Busy paste. This is metadata only:
-- qty_requested remains the typed count and is not converted through pack defs.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sales_unit TEXT NOT NULL DEFAULT 'pcs';

ALTER TABLE public.order_items
  ALTER COLUMN sales_unit SET DEFAULT 'pcs';

UPDATE public.order_items
SET sales_unit = 'pcs'
WHERE sales_unit IS NULL
   OR sales_unit NOT IN ('pcs', 'kit', 'set');

ALTER TABLE public.order_items
  ALTER COLUMN sales_unit SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_sales_unit_check'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_sales_unit_check
      CHECK (sales_unit IN ('pcs', 'kit', 'set'));
  END IF;
END $$;

COMMENT ON COLUMN public.order_items.sales_unit IS
  'Sales-selected unit copied to Busy paste (pcs/kit/set). Quantity remains the typed count; no EA conversion.';

DO $$
BEGIN
  IF to_regprocedure('public.submit_sales_order_without_sales_unit(jsonb)') IS NULL THEN
    ALTER FUNCTION public.submit_sales_order(jsonb)
      RENAME TO submit_sales_order_without_sales_unit;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.submit_sales_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_order_id BIGINT;
  r RECORD;
  v_sales_unit TEXT;
BEGIN
  v_result := public.submit_sales_order_without_sales_unit(p_payload);

  IF COALESCE((v_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_order_id := NULLIF(v_result->>'order_id', '')::BIGINT;
  IF v_order_id IS NULL OR p_payload IS NULL OR p_payload->'lines' IS NULL THEN
    RETURN v_result;
  END IF;

  FOR r IN
    SELECT elem, ordinality AS cart_pos
    FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY AS t(elem, ordinality)
  LOOP
    v_sales_unit := lower(trim(coalesce(r.elem->>'sales_unit', 'pcs')));
    IF v_sales_unit NOT IN ('pcs', 'kit', 'set') THEN
      v_sales_unit := 'pcs';
    END IF;

    UPDATE public.order_items oi
    SET sales_unit = v_sales_unit
    WHERE oi.order_id = v_order_id
      AND oi.bill_line_no = r.cart_pos
      AND oi.item_id = (r.elem->>'item_id')::BIGINT;
  END LOOP;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'submit_failed',
      'detail', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.submit_sales_order(jsonb) IS
  'Sales checkout wrapper: preserves existing stock/PO allocation and stamps sales_unit metadata on created order_items.';

GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO service_role;
