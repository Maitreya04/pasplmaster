-- Stamp sales_unit by checkout line position (bill_line_no), not item_id alone.

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
      AND oi.bill_line_no = r.cart_pos;
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
  'Sales checkout wrapper: preserves stock/PO allocation and stamps sales_unit per checkout line (bill_line_no).';
