-- PASPL — Phase 2: MRP bin inventory layers, receiving putaway to layers, picker shelf + FIFO consumption.

-- ─── Optional: remaining eaches to put away after inner break ───
ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS receiving_putaway_ea_remaining INTEGER
    CHECK (receiving_putaway_ea_remaining IS NULL OR receiving_putaway_ea_remaining >= 0);

COMMENT ON COLUMN public.license_plates.receiving_putaway_ea_remaining IS
  'After break_start, eaches still to confirm into a BIN (bulk or scan-each). NULL when not in break putaway.';

CREATE TABLE IF NOT EXISTS public.bin_inventory_layers (
  id BIGSERIAL PRIMARY KEY,
  bin_id TEXT NOT NULL,
  sku_busy_code NUMERIC NOT NULL,
  qty_ea INTEGER NOT NULL CHECK (qty_ea >= 0),
  mrp_per_ea NUMERIC NOT NULL,
  lot_no TEXT,
  receiving_job_line_id BIGINT REFERENCES public.receiving_job_lines(id) ON DELETE SET NULL,
  source_license_plate_id BIGINT REFERENCES public.license_plates(id) ON DELETE SET NULL,
  fifo_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_id_snapshot BIGINT,
  item_name_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bin_inventory_layers_bin_sku
  ON public.bin_inventory_layers(bin_id, sku_busy_code);
CREATE INDEX IF NOT EXISTS idx_bin_inventory_layers_sku_fifo
  ON public.bin_inventory_layers(sku_busy_code, fifo_received_at);
CREATE INDEX IF NOT EXISTS idx_bin_inventory_layers_job_line
  ON public.bin_inventory_layers(receiving_job_line_id);

CREATE OR REPLACE FUNCTION public.set_bin_inventory_layers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bin_inventory_layers_updated_at ON public.bin_inventory_layers;
CREATE TRIGGER trg_bin_inventory_layers_updated_at
  BEFORE UPDATE ON public.bin_inventory_layers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bin_inventory_layers_updated_at();

ALTER TABLE public.bin_inventory_layers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bin_inventory_layers_authenticated_all ON public.bin_inventory_layers;
CREATE POLICY bin_inventory_layers_authenticated_all
  ON public.bin_inventory_layers FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bin_inventory_layers_anon_all ON public.bin_inventory_layers;
CREATE POLICY bin_inventory_layers_anon_all
  ON public.bin_inventory_layers FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bin_inventory_layers TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.bin_inventory_layers_id_seq TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.bin_layer_pick_events (
  id BIGSERIAL PRIMARY KEY,
  order_item_id BIGINT NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  order_item_pick_scan_id BIGINT REFERENCES public.order_item_pick_scans(id) ON DELETE SET NULL,
  bin_inventory_layer_id BIGINT NOT NULL REFERENCES public.bin_inventory_layers(id) ON DELETE CASCADE,
  qty_ea INTEGER NOT NULL CHECK (qty_ea > 0),
  mrp_per_ea NUMERIC NOT NULL,
  fifo_skipped BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  picker_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bin_layer_pick_events_order_item
  ON public.bin_layer_pick_events(order_item_id, created_at DESC);

ALTER TABLE public.bin_layer_pick_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bin_layer_pick_events_authenticated_all ON public.bin_layer_pick_events;
CREATE POLICY bin_layer_pick_events_authenticated_all
  ON public.bin_layer_pick_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bin_layer_pick_events_anon_all ON public.bin_layer_pick_events;
CREATE POLICY bin_layer_pick_events_anon_all
  ON public.bin_layer_pick_events FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.bin_layer_pick_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.bin_layer_pick_events_id_seq TO anon, authenticated;

-- ─── Normalize bin id (match WMS / rack labels) ───
CREATE OR REPLACE FUNCTION public.wms_normalize_bin_id(p_bin_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(trim(coalesce(p_bin_id, '')), '\s+', '', 'g'));
$$;

-- ─── Roll loose_ea_qty from layers; zero inner_packs for layer-driven slots ───
CREATE OR REPLACE FUNCTION public.wms_recompute_bin_inventory_rollup(
  p_bin_id TEXT,
  p_sku_busy_code NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := public.wms_normalize_bin_id(p_bin_id);
  v_sum INTEGER;
  v_item_id BIGINT;
  v_item_name TEXT;
BEGIN
  SELECT coalesce(sum(qty_ea), 0)::INTEGER
  INTO v_sum
  FROM public.bin_inventory_layers
  WHERE bin_id = v_norm AND sku_busy_code = p_sku_busy_code;

  SELECT item_id_snapshot, item_name_snapshot
  INTO v_item_id, v_item_name
  FROM public.bin_inventory_layers
  WHERE bin_id = v_norm AND sku_busy_code = p_sku_busy_code AND qty_ea > 0
  ORDER BY fifo_received_at ASC, id ASC
  LIMIT 1;

  IF v_item_id IS NULL AND v_sum = 0 THEN
    SELECT s.item_id_snapshot, s.item_name_snapshot
    INTO v_item_id, v_item_name
    FROM public.wms_item_snapshot(p_sku_busy_code) AS s
    LIMIT 1;
  END IF;

  IF v_sum <= 0 THEN
    UPDATE public.bin_inventory
    SET loose_ea_qty = 0,
        inner_packs = 0,
        item_id_snapshot = coalesce(v_item_id, item_id_snapshot),
        item_name_snapshot = coalesce(nullif(trim(v_item_name), ''), item_name_snapshot)
    WHERE bin_id = v_norm AND sku_busy_code = p_sku_busy_code;
    IF NOT FOUND THEN
      NULL;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.bin_inventory (
    bin_id,
    sku_busy_code,
    item_id_snapshot,
    item_name_snapshot,
    inner_packs,
    loose_ea_qty,
    inner_pack_qty,
    status
  )
  VALUES (
    v_norm,
    p_sku_busy_code,
    v_item_id,
    coalesce(nullif(trim(v_item_name), ''), 'SKU'),
    0,
    v_sum,
    25,
    public.wms_bin_status(0, v_sum, NULL)
  )
  ON CONFLICT (bin_id, sku_busy_code) DO UPDATE SET
    loose_ea_qty = EXCLUDED.loose_ea_qty,
    inner_packs = 0,
    item_id_snapshot = coalesce(EXCLUDED.item_id_snapshot, public.bin_inventory.item_id_snapshot),
    item_name_snapshot = coalesce(EXCLUDED.item_name_snapshot, public.bin_inventory.item_name_snapshot),
    status = public.wms_bin_status(0, EXCLUDED.loose_ea_qty, public.bin_inventory.reorder_point);
END;
$$;

GRANT EXECUTE ON FUNCTION public.wms_recompute_bin_inventory_rollup(TEXT, NUMERIC) TO anon, authenticated;

-- ─── Merge or insert layer row; then rollup bin_inventory ───
CREATE OR REPLACE FUNCTION public.wms_apply_bin_layer_delta(
  p_bin_id TEXT,
  p_sku_busy_code NUMERIC,
  p_qty_delta INTEGER,
  p_mrp_per_ea NUMERIC,
  p_lot_no TEXT,
  p_receiving_job_line_id BIGINT,
  p_source_license_plate_id BIGINT,
  p_item_id_snapshot BIGINT,
  p_item_name_snapshot TEXT,
  p_fifo_received_at TIMESTAMPTZ DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := public.wms_normalize_bin_id(p_bin_id);
  v_lot TEXT := nullif(trim(coalesce(p_lot_no, '')), '');
  v_layer_id BIGINT;
  v_existing_id BIGINT;
BEGIN
  IF p_qty_delta = 0 THEN
    RETURN NULL;
  END IF;

  IF p_qty_delta < 0 THEN
    RAISE EXCEPTION 'wms_apply_bin_layer_delta: positive deltas only (got %)', p_qty_delta;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.bin_inventory_layers
  WHERE bin_id = v_norm
    AND sku_busy_code = p_sku_busy_code
    AND mrp_per_ea = p_mrp_per_ea
    AND coalesce(lot_no, '') = coalesce(v_lot, '')
    AND receiving_job_line_id IS NOT DISTINCT FROM p_receiving_job_line_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.bin_inventory_layers
    SET qty_ea = qty_ea + p_qty_delta,
        item_id_snapshot = coalesce(p_item_id_snapshot, item_id_snapshot),
        item_name_snapshot = coalesce(nullif(trim(p_item_name_snapshot), ''), item_name_snapshot)
    WHERE id = v_existing_id
    RETURNING id INTO v_layer_id;
  ELSE
    INSERT INTO public.bin_inventory_layers (
      bin_id,
      sku_busy_code,
      qty_ea,
      mrp_per_ea,
      lot_no,
      receiving_job_line_id,
      source_license_plate_id,
      fifo_received_at,
      item_id_snapshot,
      item_name_snapshot
    ) VALUES (
      v_norm,
      p_sku_busy_code,
      p_qty_delta,
      p_mrp_per_ea,
      v_lot,
      p_receiving_job_line_id,
      p_source_license_plate_id,
      coalesce(p_fifo_received_at, now()),
      p_item_id_snapshot,
      nullif(trim(p_item_name_snapshot), '')
    )
    RETURNING id INTO v_layer_id;
  END IF;

  PERFORM public.wms_recompute_bin_inventory_rollup(v_norm, p_sku_busy_code);
  RETURN v_layer_id;
END;
$$;

-- ─── Assert MRP on job line (putaway gate) ───
CREATE OR REPLACE FUNCTION public.receiving_require_mrp_per_ea(p_job_line_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_mrp NUMERIC;
BEGIN
  SELECT mrp_per_ea INTO v_mrp
  FROM public.receiving_job_lines
  WHERE id = p_job_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'receiving_require_mrp_per_ea: line not found';
  END IF;

  IF v_mrp IS NULL THEN
    RAISE EXCEPTION 'mrp_per_ea_required_before_putaway'
      USING HINT = 'Enter MRP/ea in the Verification section before putaway.';
  END IF;

  RETURN v_mrp;
END;
$$;

-- ─── Resolve inner LPN scan (QR raw or plain lpn_code) ───
CREATE OR REPLACE FUNCTION public.receiving_resolve_lp_scan(p_lpn_raw TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lp_code TEXT;
  r_lp public.license_plates%ROWTYPE;
  r_line public.receiving_job_lines%ROWTYPE;
  r_job public.receiving_jobs%ROWTYPE;
  v_disp TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_lp_code := upper(trim(coalesce(public.extract_lpn_code(p_lpn_raw), p_lpn_raw)));

  IF v_lp_code IS NULL OR v_lp_code = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lpn_code_required');
  END IF;

  SELECT * INTO r_lp
  FROM public.license_plates
  WHERE upper(trim(lpn_code)) = v_lp_code
    AND invalidated_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_not_found');
  END IF;

  IF r_lp.receiving_job_line_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'lp_not_tied_to_receiving_job',
      'license_plate', to_jsonb(r_lp)
    );
  END IF;

  SELECT * INTO r_line FROM public.receiving_job_lines WHERE id = r_lp.receiving_job_line_id;
  SELECT * INTO r_job FROM public.receiving_jobs WHERE id = r_line.receiving_job_id;

  IF r_line.receive_mode = 'loose' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'loose_line_no_putaway');
  END IF;

  IF r_lp.pack_type <> 'inner' THEN
    v_disp := ARRAY['note_outer_lp'];
  ELSE
    IF r_lp.receiving_lp_state IN ('printed', 'received_dock') THEN
      v_disp := ARRAY['overflow', 'whole', 'break'];
    ELSIF r_lp.receiving_lp_state = 'broken' THEN
      v_disp := ARRAY['putaway_bulk', 'putaway_each'];
    ELSIF r_lp.receiving_lp_state = 'overflow' THEN
      v_disp := ARRAY[]::TEXT[];
    ELSIF r_lp.receiving_lp_state = 'sold_whole' THEN
      v_disp := ARRAY[]::TEXT[];
    ELSE
      v_disp := ARRAY['overflow', 'whole', 'break'];
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'license_plate', to_jsonb(r_lp),
    'job_line', to_jsonb(r_line),
    'job', to_jsonb(r_job),
    'allowed_dispositions', to_jsonb(v_disp),
    'mrp_required', r_line.mrp_per_ea IS NOT NULL,
    'putaway_ea_remaining', r_lp.receiving_putaway_ea_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_resolve_lp_scan(TEXT) TO anon, authenticated;

-- ─── Whole inner to BIN (one layer row, MRP from line) ───
CREATE OR REPLACE FUNCTION public.receiving_putaway_inner_whole(
  p_lp_id BIGINT,
  p_bin_id TEXT,
  p_job_id BIGINT,
  p_job_line_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lp public.license_plates%ROWTYPE;
  v_line public.receiving_job_lines%ROWTYPE;
  v_mrp NUMERIC;
  v_bin TEXT := public.wms_normalize_bin_id(p_bin_id);
  v_layer_id BIGINT;
BEGIN
  IF v_bin = '' OR v_bin LIKE 'OVF-%' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_bin');
  END IF;

  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id AND receiving_job_id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  v_mrp := public.receiving_require_mrp_per_ea(p_job_line_id);

  SELECT * INTO v_lp FROM public.license_plates WHERE id = p_lp_id AND invalidated_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_not_found');
  END IF;

  IF v_lp.receiving_job_line_id IS DISTINCT FROM p_job_line_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_line_mismatch');
  END IF;

  IF v_lp.pack_type <> 'inner' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'whole_putaway_inner_only');
  END IF;

  IF v_lp.receiving_lp_state IS NOT NULL AND v_lp.receiving_lp_state NOT IN ('printed', 'received_dock') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_state_not_eligible_for_whole', 'state', v_lp.receiving_lp_state);
  END IF;

  v_layer_id := public.wms_apply_bin_layer_delta(
    v_bin,
    v_lp.busy_code,
    v_lp.pack_qty,
    v_mrp,
    v_line.lot_no,
    p_job_line_id,
    p_lp_id,
    v_lp.item_id_snapshot,
    v_lp.item_name_snapshot,
    now()
  );

  UPDATE public.license_plates
  SET receiving_lp_state = 'sold_whole',
      status = 'depleted',
      remaining_qty = 0,
      depleted_at = coalesce(depleted_at, now()),
      receiving_putaway_ea_remaining = NULL
  WHERE id = p_lp_id;

  INSERT INTO public.receiving_scan_events (
    receiving_job_id,
    receiving_job_line_id,
    license_plate_id,
    event_type,
    bin_id,
    qty_delta,
    payload_json,
    created_by_user_id,
    created_by_name
  ) VALUES (
    p_job_id,
    p_job_line_id,
    p_lp_id,
    'bin_stock',
    v_bin,
    v_lp.pack_qty,
    jsonb_build_object(
      'disposition', 'whole_inner',
      'mode', 'bulk_confirm',
      'mrp_per_ea', v_mrp,
      'layer_id', v_layer_id
    ),
    p_user_id,
    p_user_name
  );

  RETURN jsonb_build_object(
    'success', true,
    'layer_id', v_layer_id,
    'qty_ea', v_lp.pack_qty,
    'bin_id', v_bin
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_putaway_inner_whole(BIGINT, TEXT, BIGINT, BIGINT, BIGINT, TEXT) TO anon, authenticated;

-- ─── Break inner (replace prior: track putaway remainder) ───
CREATE OR REPLACE FUNCTION public.receiving_apply_inner_break(
  p_lp_id BIGINT,
  p_job_id BIGINT,
  p_job_line_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.receiving_job_lines%ROWTYPE;
BEGIN
  PERFORM public.receiving_require_mrp_per_ea(p_job_line_id);

  IF p_job_id IS NULL OR p_job_line_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'job_and_line_required');
  END IF;

  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id AND receiving_job_id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  IF v_line.sell_unit_snapshot = 'PACK' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'sell_unit_pack_no_each_labels');
  END IF;

  UPDATE public.license_plates
  SET receiving_lp_state = 'broken',
      status = 'opened',
      opened_at = coalesce(opened_at, now()),
      remaining_qty = 0,
      receiving_putaway_ea_remaining = pack_qty
  WHERE id = p_lp_id
    AND invalidated_at IS NULL
    AND pack_type = 'inner'
    AND coalesce(receiving_job_line_id, p_job_line_id) = p_job_line_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'license_plate_not_found_or_invalidated');
  END IF;

  INSERT INTO public.receiving_scan_events (
    receiving_job_id,
    receiving_job_line_id,
    license_plate_id,
    event_type,
    created_by_user_id,
    created_by_name,
    payload_json
  ) VALUES (
    p_job_id,
    p_job_line_id,
    p_lp_id,
    'inner_break',
    p_user_id,
    p_user_name,
    jsonb_build_object('each_label_batch_ea', v_line.ea_per_inner)
  );

  RETURN jsonb_build_object('success', true, 'each_label_batch_ea', v_line.ea_per_inner);
END;
$$;

-- ─── Bulk BIN confirm after break ───
CREATE OR REPLACE FUNCTION public.receiving_putaway_to_bin_bulk(
  p_lp_id BIGINT,
  p_bin_id TEXT,
  p_qty_ea INTEGER,
  p_job_id BIGINT,
  p_job_line_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lp public.license_plates%ROWTYPE;
  v_line public.receiving_job_lines%ROWTYPE;
  v_mrp NUMERIC;
  v_bin TEXT := public.wms_normalize_bin_id(p_bin_id);
  v_layer_id BIGINT;
  v_rem INTEGER;
BEGIN
  IF p_qty_ea IS NULL OR p_qty_ea <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'qty_ea_invalid');
  END IF;

  IF v_bin = '' OR v_bin LIKE 'OVF-%' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_bin');
  END IF;

  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id AND receiving_job_id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  v_mrp := public.receiving_require_mrp_per_ea(p_job_line_id);

  SELECT * INTO v_lp FROM public.license_plates WHERE id = p_lp_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_not_found');
  END IF;

  IF v_lp.receiving_lp_state <> 'broken' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_not_broken');
  END IF;

  v_rem := coalesce(v_lp.receiving_putaway_ea_remaining, v_lp.pack_qty);
  IF p_qty_ea > v_rem THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'qty_exceeds_putaway_remaining',
      'remaining', v_rem
    );
  END IF;

  v_layer_id := public.wms_apply_bin_layer_delta(
    v_bin,
    v_lp.busy_code,
    p_qty_ea,
    v_mrp,
    v_line.lot_no,
    p_job_line_id,
    p_lp_id,
    v_lp.item_id_snapshot,
    v_lp.item_name_snapshot,
    now()
  );

  v_rem := v_rem - p_qty_ea;
  UPDATE public.license_plates
  SET receiving_putaway_ea_remaining = CASE WHEN v_rem <= 0 THEN NULL ELSE v_rem END,
      receiving_lp_state = CASE WHEN v_rem <= 0 THEN 'received_dock' ELSE 'broken' END,
      status = CASE WHEN v_rem <= 0 THEN 'depleted' ELSE status END,
      depleted_at = CASE WHEN v_rem <= 0 THEN coalesce(depleted_at, now()) ELSE depleted_at END,
      remaining_qty = 0
  WHERE id = p_lp_id;

  INSERT INTO public.receiving_scan_events (
    receiving_job_id,
    receiving_job_line_id,
    license_plate_id,
    event_type,
    bin_id,
    qty_delta,
    payload_json,
    created_by_user_id,
    created_by_name
  ) VALUES (
    p_job_id,
    p_job_line_id,
    p_lp_id,
    'bin_stock',
    v_bin,
    p_qty_ea,
    jsonb_build_object(
      'disposition', 'break_putaway',
      'mode', 'bulk_confirm',
      'mrp_per_ea', v_mrp,
      'layer_id', v_layer_id
    ),
    p_user_id,
    p_user_name
  );

  RETURN jsonb_build_object(
    'success', true,
    'layer_id', v_layer_id,
    'qty_ea', p_qty_ea,
    'bin_id', v_bin,
    'putaway_ea_remaining', v_rem
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_putaway_to_bin_bulk(BIGINT, TEXT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT) TO anon, authenticated;

-- ─── Scan-each: one ITEM/QR that resolves to this line busy code ───
CREATE OR REPLACE FUNCTION public.receiving_scan_matches_line_busy(
  p_raw TEXT,
  p_busy_code NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_json JSONB;
  v_bc NUMERIC;
  v_norm TEXT := public.normalize_pick_scan_code(p_raw);
BEGIN
  IF v_norm = public.normalize_pick_scan_code(p_busy_code::TEXT) THEN
    RETURN true;
  END IF;

  BEGIN
    v_json := p_raw::JSONB;
  EXCEPTION WHEN others THEN
    v_json := NULL;
  END;

  IF v_json IS NOT NULL THEN
    v_bc := coalesce(
      nullif(trim(v_json->>'busy_code'), '')::NUMERIC,
      nullif(trim(v_json->>'busyCode'), '')::NUMERIC
    );
    IF v_bc IS NOT NULL AND v_bc = p_busy_code THEN
      RETURN true;
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.item_barcodes b
    WHERE b.sku_busy_code::NUMERIC = p_busy_code
      AND public.normalize_pick_scan_code(b.barcode_key) = v_norm
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.receiving_putaway_to_bin_each_scan(
  p_lp_id BIGINT,
  p_bin_id TEXT,
  p_item_scan TEXT,
  p_job_id BIGINT,
  p_job_line_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lp public.license_plates%ROWTYPE;
  v_line public.receiving_job_lines%ROWTYPE;
  v_mrp NUMERIC;
  v_bin TEXT := public.wms_normalize_bin_id(p_bin_id);
  v_layer_id BIGINT;
  v_rem INTEGER;
BEGIN
  IF v_bin = '' OR v_bin LIKE 'OVF-%' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_bin');
  END IF;

  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id AND receiving_job_id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  IF not public.receiving_scan_matches_line_busy(p_item_scan, v_line.busy_code) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'item_scan_does_not_match_line');
  END IF;

  v_mrp := public.receiving_require_mrp_per_ea(p_job_line_id);

  SELECT * INTO v_lp FROM public.license_plates WHERE id = p_lp_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_not_found');
  END IF;

  IF v_lp.receiving_lp_state <> 'broken' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lp_not_broken');
  END IF;

  v_rem := coalesce(v_lp.receiving_putaway_ea_remaining, v_lp.pack_qty);
  IF v_rem < 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'putaway_already_complete');
  END IF;

  v_layer_id := public.wms_apply_bin_layer_delta(
    v_bin,
    v_lp.busy_code,
    1,
    v_mrp,
    v_line.lot_no,
    p_job_line_id,
    p_lp_id,
    v_lp.item_id_snapshot,
    v_lp.item_name_snapshot,
    now()
  );

  v_rem := v_rem - 1;
  UPDATE public.license_plates
  SET receiving_putaway_ea_remaining = CASE WHEN v_rem <= 0 THEN NULL ELSE v_rem END,
      receiving_lp_state = CASE WHEN v_rem <= 0 THEN 'received_dock' ELSE 'broken' END,
      status = CASE WHEN v_rem <= 0 THEN 'depleted' ELSE status END,
      depleted_at = CASE WHEN v_rem <= 0 THEN coalesce(depleted_at, now()) ELSE depleted_at END,
      remaining_qty = 0
  WHERE id = p_lp_id;

  INSERT INTO public.receiving_scan_events (
    receiving_job_id,
    receiving_job_line_id,
    license_plate_id,
    event_type,
    bin_id,
    qty_delta,
    payload_json,
    created_by_user_id,
    created_by_name
  ) VALUES (
    p_job_id,
    p_job_line_id,
    p_lp_id,
    'bin_stock',
    v_bin,
    1,
    jsonb_build_object(
      'disposition', 'break_putaway',
      'mode', 'scan_each',
      'mrp_per_ea', v_mrp,
      'layer_id', v_layer_id
    ),
    p_user_id,
    p_user_name
  );

  RETURN jsonb_build_object(
    'success', true,
    'layer_id', v_layer_id,
    'qty_ea', 1,
    'bin_id', v_bin,
    'putaway_ea_remaining', v_rem
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_putaway_to_bin_each_scan(BIGINT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT) TO anon, authenticated;

-- ─── Picker shelf view ───
CREATE OR REPLACE FUNCTION public.wms_get_bin_picker_shelf(
  p_bin_id TEXT,
  p_sku_busy_code NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := public.wms_normalize_bin_id(p_bin_id);
  v_total INTEGER;
  v_layers JSONB;
BEGIN
  SELECT coalesce(sum(qty_ea), 0)::INTEGER INTO v_total
  FROM public.bin_inventory_layers
  WHERE bin_id = v_norm AND sku_busy_code = p_sku_busy_code AND qty_ea > 0;

  WITH ordered AS (
    SELECT
      r.*,
      first_value(r.id) OVER (ORDER BY r.fifo_received_at ASC, r.id ASC) AS head_id
    FROM public.bin_inventory_layers r
    WHERE r.bin_id = v_norm AND r.sku_busy_code = p_sku_busy_code AND r.qty_ea > 0
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'mrp_per_ea', o.mrp_per_ea,
        'qty_ea', o.qty_ea,
        'fifo_received_at', o.fifo_received_at,
        'is_fifo_recommended', o.id = o.head_id,
        'lot_no', o.lot_no
      )
      ORDER BY o.fifo_received_at ASC, o.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_layers
  FROM ordered o;

  RETURN jsonb_build_object(
    'success', true,
    'bin_id', v_norm,
    'sku_busy_code', p_sku_busy_code,
    'total_ea', v_total,
    'layers', coalesce(v_layers, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.wms_get_bin_picker_shelf(TEXT, NUMERIC) TO anon, authenticated;

-- ─── FIFO consume (optional preferred layer + override audit) ───
CREATE OR REPLACE FUNCTION public.wms_consume_bin_layer_for_pick(
  p_order_item_id BIGINT,
  p_qty_ea INTEGER,
  p_user_id BIGINT DEFAULT NULL,
  p_preferred_layer_id BIGINT DEFAULT NULL,
  p_override_reason TEXT DEFAULT NULL,
  p_bin_id TEXT DEFAULT NULL,
  p_order_item_pick_scan_id BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oi RECORD;
  v_bin TEXT;
  v_busy NUMERIC;
  v_need INTEGER := p_qty_ea;
  v_head RECORD;
  v_pref RECORD;
  v_take INTEGER;
  v_skipped BOOLEAN := false;
  v_events JSONB := '[]'::JSONB;
BEGIN
  IF p_qty_ea IS NULL OR p_qty_ea <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'qty_invalid');
  END IF;

  SELECT
    oi.id,
    oi.item_id,
    i.busy_code::NUMERIC AS busy_num,
    oi.rack_no
  INTO v_oi
  FROM public.order_items oi
  JOIN public.items i ON i.id = oi.item_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_item_not_found');
  END IF;

  v_busy := v_oi.busy_num;
  v_bin := public.wms_normalize_bin_id(coalesce(p_bin_id, v_oi.rack_no));

  IF v_bin = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'bin_required');
  END IF;

  SELECT * INTO v_head
  FROM public.bin_inventory_layers
  WHERE bin_id = v_bin AND sku_busy_code = v_busy AND qty_ea > 0
  ORDER BY fifo_received_at ASC, id ASC
  LIMIT 1;

  IF p_preferred_layer_id IS NOT NULL THEN
    SELECT * INTO v_pref
    FROM public.bin_inventory_layers
    WHERE id = p_preferred_layer_id
      AND bin_id = v_bin
      AND sku_busy_code = v_busy
      AND qty_ea > 0;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'reason', 'preferred_layer_not_found');
    END IF;

    IF v_head.id IS DISTINCT FROM v_pref.id THEN
      IF p_override_reason IS NULL OR length(trim(p_override_reason)) < 3 THEN
        RETURN jsonb_build_object(
          'success', false,
          'reason', 'override_reason_required',
          'fifo_head_layer_id', v_head.id
        );
      END IF;
      v_skipped := true;
    END IF;
  END IF;

  IF p_preferred_layer_id IS NOT NULL AND v_pref.id IS NOT NULL THEN
    v_take := LEAST(v_need, v_pref.qty_ea);
    IF v_take > 0 THEN
      UPDATE public.bin_inventory_layers
      SET qty_ea = qty_ea - v_take
      WHERE id = v_pref.id;

      INSERT INTO public.bin_layer_pick_events (
        order_item_id,
        order_item_pick_scan_id,
        bin_inventory_layer_id,
        qty_ea,
        mrp_per_ea,
        fifo_skipped,
        override_reason,
        picker_user_id
      ) VALUES (
        p_order_item_id,
        p_order_item_pick_scan_id,
        v_pref.id,
        v_take,
        v_pref.mrp_per_ea,
        v_skipped,
        CASE WHEN v_skipped THEN trim(p_override_reason) ELSE NULL END,
        p_user_id
      );

      v_events := v_events || jsonb_build_object(
        'layer_id', v_pref.id,
        'qty_ea', v_take,
        'fifo_skipped', v_skipped
      );
      v_need := v_need - v_take;
    END IF;
  END IF;

  WHILE v_need > 0 LOOP
    SELECT * INTO v_head
    FROM public.bin_inventory_layers
    WHERE bin_id = v_bin AND sku_busy_code = v_busy AND qty_ea > 0
    ORDER BY fifo_received_at ASC, id ASC
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    v_take := LEAST(v_need, v_head.qty_ea);
    UPDATE public.bin_inventory_layers
    SET qty_ea = qty_ea - v_take
    WHERE id = v_head.id;

    INSERT INTO public.bin_layer_pick_events (
      order_item_id,
      order_item_pick_scan_id,
      bin_inventory_layer_id,
      qty_ea,
      mrp_per_ea,
      fifo_skipped,
      override_reason,
      picker_user_id
    ) VALUES (
      p_order_item_id,
      p_order_item_pick_scan_id,
      v_head.id,
      v_take,
      v_head.mrp_per_ea,
      false,
      NULL,
      p_user_id
    );

    v_events := v_events || jsonb_build_object(
      'layer_id', v_head.id,
      'qty_ea', v_take,
      'fifo_skipped', false
    );
    v_need := v_need - v_take;
  END LOOP;

  IF v_need > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_layer_stock',
      'short_by', v_need,
      'events', v_events
    );
  END IF;

  DELETE FROM public.bin_inventory_layers
  WHERE bin_id = v_bin AND sku_busy_code = v_busy AND qty_ea <= 0;

  PERFORM public.wms_recompute_bin_inventory_rollup(v_bin, v_busy);

  RETURN jsonb_build_object('success', true, 'events', v_events, 'bin_id', v_bin);
END;
$$;

GRANT EXECUTE ON FUNCTION public.wms_consume_bin_layer_for_pick(BIGINT, INTEGER, BIGINT, BIGINT, TEXT, TEXT, BIGINT) TO anon, authenticated;

COMMENT ON TABLE public.bin_inventory_layers IS 'MRP batch layers (eaches) per BIN; bin_inventory.loose_ea_qty rolls up sums for this SKU slot.';
COMMENT ON TABLE public.bin_layer_pick_events IS 'Audit of which layer batches were consumed when picking.';
