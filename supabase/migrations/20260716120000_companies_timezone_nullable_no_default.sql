-- Invoicing timezone: stop silent America/Los_Angeles default.
-- NULL = invoicing not configured (orders, payments, balance, cron close gated in backend).
-- Existing rows keep their current value; only future INSERTs without timezone become NULL.

ALTER TABLE public.companies
  ALTER COLUMN timezone DROP DEFAULT;

ALTER TABLE public.companies
  ALTER COLUMN timezone DROP NOT NULL;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_timezone_nonempty_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_timezone_nonempty_check
  CHECK (timezone IS NULL OR btrim(timezone) <> '');

COMMENT ON COLUMN public.companies.timezone IS
  'IANA timezone for invoicing (close month, calendar lock). NULL until set at company create or Team edit.';
