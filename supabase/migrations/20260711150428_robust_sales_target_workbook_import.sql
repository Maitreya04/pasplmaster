CREATE OR REPLACE FUNCTION public.admin_upsert_sales_targets(
  p_financial_year_label TEXT,
  p_rows JSONB,
  p_file_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
  v_fy RECORD;
  v_row JSONB;
  v_user RECORD;
  v_unmatched JSONB := '[]'::jsonb;
  v_count INTEGER := 0;
  v_batch_id BIGINT;
  v_segment_id BIGINT;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE label = p_financial_year_label;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_not_found');
  END IF;

  IF v_fy.is_locked THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_locked');
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_rows');
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_count := v_count + 1;
    SELECT id, full_name INTO v_user
    FROM public.users
    WHERE role = 'sales'
      AND is_active = true
      AND public.normalize_salesperson_key(full_name) = public.normalize_salesperson_key(v_row->>'salesperson_name')
    LIMIT 1;

    IF v_user.id IS NULL THEN
      v_unmatched := v_unmatched || jsonb_build_object(
        'salesperson_name', v_row->>'salesperson_name',
        'product_group', v_row->>'product_group',
        'annual_target_lakhs', v_row->>'annual_target_lakhs'
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_unmatched) > 0 THEN
    INSERT INTO public.sales_target_import_batches (
      financial_year_id,
      uploaded_by_user_id,
      file_name,
      row_count,
      imported_count,
      unmatched_rows,
      status
    )
    VALUES (v_fy.id, v_actor_user_id, p_file_name, v_count, 0, v_unmatched, 'blocked_unmatched')
    RETURNING id INTO v_batch_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'unmatched_salespeople',
      'batch_id', v_batch_id,
      'unmatched_rows', v_unmatched
    );
  END IF;

  INSERT INTO public.sales_target_import_batches (
    financial_year_id,
    uploaded_by_user_id,
    file_name,
    row_count,
    imported_count,
    status
  )
  VALUES (v_fy.id, v_actor_user_id, p_file_name, v_count, v_count, 'completed')
  RETURNING id INTO v_batch_id;

  -- A workbook is the source of truth for every salesperson included in it.
  -- Remove copied/manual baseline rows first so omitted categories do not linger.
  DELETE FROM public.sales_targets st
  WHERE st.financial_year_id = v_fy.id
    AND st.salesperson_user_id IN (
      SELECT DISTINCT u.id
      FROM jsonb_array_elements(p_rows) AS row_data(value)
      JOIN public.users u
        ON u.role = 'sales'
       AND u.is_active = true
       AND public.normalize_salesperson_key(u.full_name) =
           public.normalize_salesperson_key(row_data.value->>'salesperson_name')
    );

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    SELECT id, full_name INTO v_user
    FROM public.users
    WHERE role = 'sales'
      AND is_active = true
      AND public.normalize_salesperson_key(full_name) = public.normalize_salesperson_key(v_row->>'salesperson_name')
    LIMIT 1;

    SELECT id INTO v_segment_id
    FROM public.sales_segments
    WHERE normalized_name = public.normalize_sales_dimension(v_row->>'product_group')
    LIMIT 1;

    IF v_segment_id IS NULL THEN
      INSERT INTO public.sales_segments(name)
      VALUES (trim(v_row->>'product_group'))
      ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
      RETURNING id INTO v_segment_id;
    END IF;

    -- Busy stores several Lucas groups separately while the plan governs one
    -- combined Lucas target.
    IF public.normalize_sales_dimension(v_row->>'product_group') = 'lucas' THEN
      UPDATE public.sales_segment_members
      SET sales_segment_id = v_segment_id
      WHERE financial_year_id = v_fy.id
        AND normalized_source_group LIKE 'lucas%';
    END IF;

    INSERT INTO public.sales_targets (
      salesperson_name,
      salesperson_user_id,
      product_group,
      sales_segment_id,
      year,
      financial_year_id,
      annual_target_lakhs,
      category,
      source_type,
      source_file_name,
      import_batch_id,
      created_by_user_id,
      updated_by_user_id,
      updated_at
    )
    VALUES (
      v_user.full_name,
      v_user.id,
      trim(v_row->>'product_group'),
      v_segment_id,
      v_fy.label,
      v_fy.id,
      (v_row->>'annual_target_lakhs')::NUMERIC,
      NULLIF(trim(COALESCE(v_row->>'category', '')), ''),
      'import',
      p_file_name,
      v_batch_id,
      v_actor_user_id,
      v_actor_user_id,
      now()
    )
    ON CONFLICT (salesperson_user_id, product_group, financial_year_id)
    WHERE salesperson_user_id IS NOT NULL AND financial_year_id IS NOT NULL
    DO UPDATE SET
      salesperson_name = EXCLUDED.salesperson_name,
      sales_segment_id = EXCLUDED.sales_segment_id,
      year = EXCLUDED.year,
      annual_target_lakhs = EXCLUDED.annual_target_lakhs,
      category = EXCLUDED.category,
      source_type = EXCLUDED.source_type,
      source_file_name = EXCLUDED.source_file_name,
      import_batch_id = EXCLUDED.import_batch_id,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now();
  END LOOP;

  PERFORM public.log_user_security_event(
    v_actor_user_id,
    NULL,
    'sales_targets_imported',
    'info',
    jsonb_build_object('financial_year', v_fy.label, 'batch_id', v_batch_id, 'row_count', v_count)
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'financial_year_id', v_fy.id,
    'financial_year', v_fy.label,
    'processed', v_count
  );
END;
$$;


REVOKE EXECUTE ON FUNCTION public.admin_upsert_sales_targets(TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_sales_targets(TEXT, JSONB, TEXT) TO authenticated, service_role;
