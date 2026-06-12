-- Link public.users to Supabase Auth + invite-code onboarding columns.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_auth_id
  ON public.users(auth_id)
  WHERE auth_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_phone
  ON public.users(phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_invite_code
  ON public.users(invite_code)
  WHERE invite_code IS NOT NULL;

COMMENT ON COLUMN public.users.auth_id IS 'Supabase Auth user id; set when staff activates phone+PIN login.';
COMMENT ON COLUMN public.users.phone IS '10-digit mobile number used as login username.';
COMMENT ON COLUMN public.users.invite_code IS 'One-time onboarding code (NAME-XXXX) for staff self-activation.';

-- Resolve app user id from JWT session.
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_branch()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT stock_location_code FROM public.users WHERE auth_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE auth_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_legacy_anon_session()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_branch() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_legacy_anon_session() TO anon, authenticated, service_role;
