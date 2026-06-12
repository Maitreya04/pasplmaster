-- Normalize warehouse branches (Indore / Jabalpur).

CREATE TABLE IF NOT EXISTS public.branches (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.branches (code, name, display_name)
VALUES
  ('main_store', 'Indore', 'Indore / Main Store'),
  ('jabalpur', 'Jabalpur', 'Jabalpur')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    is_active = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_branch_fk'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_branch_fk
      FOREIGN KEY (stock_location_code) REFERENCES public.branches(code);
  END IF;
END;
$$;

GRANT SELECT ON public.branches TO anon, authenticated, service_role;
