-- Auto-assign the next eligible picking order to a picker (urgent first, then newest approved).
-- Mirrors client pickQuantityTarget / isPickQueueEligible logic.

CREATE OR REPLACE FUNCTION public.order_item_pick_quantity_target(
  p_qty_requested integer,
  p_qty_shippable integer,
  p_qty_po integer,
  p_qty_approved integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0,
    CASE
      WHEN p_qty_approved IS NOT NULL THEN
        LEAST(
          GREATEST(0, p_qty_approved),
          CASE
            WHEN p_qty_shippable IS NOT NULL THEN GREATEST(0, p_qty_shippable)
            WHEN p_qty_po IS NOT NULL THEN
              GREATEST(0, COALESCE(p_qty_requested, 0) - GREATEST(0, p_qty_po))
            ELSE GREATEST(0, COALESCE(p_qty_requested, 0))
          END
        )
      ELSE
        CASE
          WHEN p_qty_shippable IS NOT NULL THEN GREATEST(0, p_qty_shippable)
          WHEN p_qty_po IS NOT NULL THEN
            GREATEST(0, COALESCE(p_qty_requested, 0) - GREATEST(0, p_qty_po))
          ELSE GREATEST(0, COALESCE(p_qty_requested, 0))
        END
    END
  )::integer;
$$;

CREATE OR REPLACE FUNCTION public.order_has_pickable_lines(p_order_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND public.order_item_pick_quantity_target(
        oi.qty_requested,
        oi.qty_shippable,
        oi.qty_po,
        oi.qty_approved
      ) > 0
  );
$$;

CREATE OR REPLACE FUNCTION public.assign_next_picking_order(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_claim_id bigint;
  v_order_id bigint;
  v_existing_claim record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id');
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  -- Resume an in-progress pick for this picker.
  SELECT wc.id, wc.order_id
  INTO v_existing_claim
  FROM public.work_claims wc
  WHERE wc.claimed_by_user_id = p_user_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
  ORDER BY wc.claimed_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_existing_claim.order_id,
      'claim_id', v_existing_claim.id,
      'resumed', true
    );
  END IF;

  -- Return abandoned picks to the pool.
  PERFORM public.expire_stale_claims();

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.workflow_status = 'approved'
    AND o.fulfillment_path IS DISTINCT FROM 'direct_bill'
    AND o.stock_location_code IS DISTINCT FROM 'jabalpur'
    AND public.order_has_pickable_lines(o.id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'picking'
        AND wc.status = 'active'
    )
  ORDER BY
    (o.priority = 'urgent') DESC,
    o.approved_at DESC NULLS LAST,
    o.id DESC
  LIMIT 1
  FOR UPDATE OF o SKIP LOCKED;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'queue_empty');
  END IF;

  INSERT INTO public.work_claims (order_id, stage, claimed_by_user_id)
  VALUES (v_order_id, 'picking', p_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage)
  VALUES (v_order_id, 'picking_claimed', p_user_id, 'picking');

  UPDATE public.orders
  SET workflow_status = 'picking',
      picker_name = v_user_name,
      picked_at = COALESCE(picked_at, now())
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'claim_id', v_claim_id,
    'resumed', false
  );
END;
$$;

COMMENT ON FUNCTION public.assign_next_picking_order(bigint) IS
  'Atomically assign the next warehouse pick order to a picker (urgent first, newest approved). Resumes active claim if present.';

GRANT EXECUTE ON FUNCTION public.assign_next_picking_order(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_has_pickable_lines(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_item_pick_quantity_target(integer, integer, integer, integer) TO authenticated;
