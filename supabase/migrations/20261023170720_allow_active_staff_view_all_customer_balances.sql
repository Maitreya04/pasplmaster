-- Customer balances are shared across the active staff.  The previous
-- salesperson-to-customer ownership rule remains relevant for assignment and
-- reporting, but must not prevent a signed-in staff member from viewing a
-- customer's balance, aged receivables, or ledger.
--
-- This does not broaden raw-table privileges. The app balance screens use the
-- bounded, read-only receivables RPCs.

CREATE OR REPLACE FUNCTION public.receivables_can_view_customer(p_customer_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_customer_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.auth_id = auth.uid()
        AND u.is_active = true
    );
$$;

COMMENT ON FUNCTION public.receivables_can_view_customer(BIGINT) IS
  'Returns true when the caller is an active authenticated staff member and the customer exists; balances are shared across staff.';

-- Receivables functions are SECURITY DEFINER because they read ERP-synced
-- finance tables. Keep their API surface limited to authenticated staff.
REVOKE ALL ON FUNCTION public.receivables_can_view_customer(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_collection_snapshot(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_payment_signal(BIGINT, INTEGER, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.receivables_can_view_customer(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_collection_snapshot(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_payment_signal(BIGINT, INTEGER, INTEGER) TO authenticated, service_role;
