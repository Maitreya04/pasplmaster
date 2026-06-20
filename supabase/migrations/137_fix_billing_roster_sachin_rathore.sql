-- Retire typo/duplicate staff rows and confirm Sachin Rathore as billing Station 5.
--
-- Safe for RPCs:
--   - Soft-deactivate only (never DELETE) — work_claims and order_events keep valid FKs.
--   - Release active claims first so billing/picking queues are not stuck on ghost users.
--   - claim_order / add_billing_line require is_active = true for new work.

-- 1) Release any active claims held by users we are retiring.
UPDATE public.work_claims wc
SET
  status = 'released',
  released_at = COALESCE(wc.released_at, now())
FROM public.users u
WHERE wc.claimed_by_user_id = u.id
  AND wc.status = 'active'
  AND (
    lower(regexp_replace(coalesce(trim(u.full_name), ''), '[^a-z0-9]+', '', 'g')) = 'sachinrathod'
    OR (
      lower(regexp_replace(coalesce(trim(u.full_name), ''), '[^a-z0-9]+', '', 'g')) = 'pankaj'
      AND u.full_name NOT ILIKE '%meena%'
    )
  );

-- 2) Deactivate typo/duplicate users (keep canonical Pankaj Meena + Sachin Rathore).
UPDATE public.users
SET
  is_active = false,
  invite_code = NULL,
  invite_code_expires_at = NULL
WHERE lower(regexp_replace(coalesce(trim(full_name), ''), '[^a-z0-9]+', '', 'g')) = 'sachinrathod'
   OR (
     lower(regexp_replace(coalesce(trim(full_name), ''), '[^a-z0-9]+', '', 'g')) = 'pankaj'
     AND full_name NOT ILIKE '%meena%'
   );

-- 3) Confirm Sachin Rathore on the billing desk roster — Station 5.
INSERT INTO public.users (full_name, role, station_label, is_active, stock_location_code)
VALUES ('Sachin Rathore', 'billing', 'Station 5', true, 'main_store')
ON CONFLICT (full_name) DO UPDATE
SET
  role = 'billing',
  station_label = 'Station 5',
  is_active = true,
  stock_location_code = 'main_store';
