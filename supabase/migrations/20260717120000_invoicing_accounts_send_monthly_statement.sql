-- Per billing account: opt-in for automated monthly statement email after close.

ALTER TABLE public.invoicing_accounts
  ADD COLUMN IF NOT EXISTS send_monthly_statement boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoicing_accounts.send_monthly_statement IS
  'When true, hourly close job sends monthly statement PDF/email for this account after period close. Default false.';
