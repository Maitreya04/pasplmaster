-- Inter-branch stock transfer tracking (foundation for future workflows).

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id BIGSERIAL PRIMARY KEY,
  transfer_number TEXT UNIQUE NOT NULL,
  from_branch TEXT NOT NULL REFERENCES public.branches(code),
  to_branch TEXT NOT NULL REFERENCES public.branches(code),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_dispatch', 'in_transit', 'received', 'cancelled')),
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  dispatched_at TIMESTAMPTZ,
  dispatched_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ,
  received_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_branch_pair_check CHECK (from_branch <> to_branch)
);

CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id BIGSERIAL PRIMARY KEY,
  transfer_id BIGINT NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES public.items(id) ON DELETE SET NULL,
  busy_code NUMERIC,
  item_name TEXT NOT NULL,
  qty_requested INTEGER NOT NULL CHECK (qty_requested > 0),
  qty_dispatched INTEGER CHECK (qty_dispatched IS NULL OR qty_dispatched >= 0),
  qty_received INTEGER CHECK (qty_received IS NULL OR qty_received >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status
  ON public.stock_transfers(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer
  ON public.stock_transfer_lines(transfer_id);

CREATE OR REPLACE FUNCTION public.generate_stock_transfer_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  today_prefix TEXT;
  seq INTEGER;
BEGIN
  IF NEW.transfer_number IS NOT NULL AND btrim(NEW.transfer_number) <> '' THEN
    RETURN NEW;
  END IF;

  today_prefix := 'ST-' || to_char(now(), 'YYMMDD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(transfer_number FROM '-(\d+)$') AS INTEGER)
  ), 0) + 1
  INTO seq
  FROM public.stock_transfers
  WHERE transfer_number LIKE today_prefix || '-%';

  NEW.transfer_number := today_prefix || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_transfer_number ON public.stock_transfers;
CREATE TRIGGER trg_stock_transfer_number
  BEFORE INSERT ON public.stock_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_stock_transfer_number();

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_transfers_auth_branch ON public.stock_transfers;
CREATE POLICY stock_transfers_auth_branch
  ON public.stock_transfers
  FOR ALL
  TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR from_branch = public.current_user_branch()
    OR to_branch = public.current_user_branch()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR from_branch = public.current_user_branch()
    OR to_branch = public.current_user_branch()
  );

DROP POLICY IF EXISTS stock_transfers_legacy_anon_all ON public.stock_transfers;
CREATE POLICY stock_transfers_legacy_anon_all
  ON public.stock_transfers
  FOR ALL
  TO anon
  USING (public.is_legacy_anon_session())
  WITH CHECK (public.is_legacy_anon_session());

DROP POLICY IF EXISTS stock_transfer_lines_auth_branch ON public.stock_transfer_lines;
CREATE POLICY stock_transfer_lines_auth_branch
  ON public.stock_transfer_lines
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.stock_transfers st
      WHERE st.id = transfer_id
        AND (
          public.current_user_role() = 'admin'
          OR st.from_branch = public.current_user_branch()
          OR st.to_branch = public.current_user_branch()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.stock_transfers st
      WHERE st.id = transfer_id
        AND (
          public.current_user_role() = 'admin'
          OR st.from_branch = public.current_user_branch()
          OR st.to_branch = public.current_user_branch()
        )
    )
  );

DROP POLICY IF EXISTS stock_transfer_lines_legacy_anon_all ON public.stock_transfer_lines;
CREATE POLICY stock_transfer_lines_legacy_anon_all
  ON public.stock_transfer_lines
  FOR ALL
  TO anon
  USING (public.is_legacy_anon_session())
  WITH CHECK (public.is_legacy_anon_session());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfer_lines TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_transfers_id_seq TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_transfer_lines_id_seq TO anon, authenticated, service_role;
