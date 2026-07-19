-- Remove temporary lat/lng compatibility overloads so PostgREST uniquely
-- resolves the clean no-geo signatures used by current clients.
-- Keeps public.start_workday(bigint) and
-- public.start_customer_visit(bigint, text, bigint).

DROP FUNCTION IF EXISTS public.start_workday(DOUBLE PRECISION, DOUBLE PRECISION, BIGINT);
DROP FUNCTION IF EXISTS public.start_customer_visit(
  BIGINT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  BOOLEAN,
  TEXT,
  TEXT,
  BIGINT
);
