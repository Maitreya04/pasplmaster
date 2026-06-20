-- Follow-up: Sachin Rathod (id 89) was created after 137 ran. Retire by exact name.

UPDATE public.work_claims wc
SET
  status = 'released',
  released_at = COALESCE(wc.released_at, now())
FROM public.users u
WHERE wc.claimed_by_user_id = u.id
  AND wc.status = 'active'
  AND u.full_name IN ('Sachin Rathod', 'Pankaj');

UPDATE public.users
SET
  is_active = false,
  invite_code = NULL,
  invite_code_expires_at = NULL,
  station_label = NULL
WHERE full_name IN ('Sachin Rathod', 'Pankaj');

UPDATE public.users
SET
  role = 'billing',
  station_label = 'Station 5',
  is_active = true,
  stock_location_code = 'main_store'
WHERE full_name = 'Sachin Rathore';
