-- Phase 4: company timezone + monthly statement send log.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Los_Angeles';

COMMENT ON COLUMN public.companies.timezone IS
  'IANA timezone for invoicing calendar (close month, payment fallback dates, edit locks).';

CREATE TABLE public.monthly_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.invoicing_accounts(id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  account_company_name text NOT NULL,
  sent_to text,
  closing_balance numeric NOT NULL,
  r2_key text,
  email_id text,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_statements_company_account_period_unique
    UNIQUE (company_id, account_id, period)
);

CREATE INDEX idx_monthly_statements_company_period
  ON public.monthly_statements (company_id, period DESC);

CREATE INDEX idx_monthly_statements_account_id
  ON public.monthly_statements (account_id);

COMMENT ON TABLE public.monthly_statements IS
  'Monthly Statement send history and R2 PDF reference per company × account × period.';

COMMENT ON COLUMN public.monthly_statements.email_id IS
  'Resend message ID (not recipient address).';

COMMENT ON COLUMN public.monthly_statements.sent_to IS
  'Recipient email snapshot (invoicing_accounts.poc_email at send time).';

COMMENT ON COLUMN public.monthly_statements.account_company_name IS
  'Billing account display name snapshot (invoicing_accounts.company_name at send time).';

ALTER TABLE public.monthly_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_statements_company_access ON public.monthly_statements;
CREATE POLICY monthly_statements_company_access ON public.monthly_statements
  FOR ALL
  USING (
    company_id IN (
      SELECT cm.company_id
      FROM public.company_members cm
      WHERE cm.user_id = auth.uid()
    )
    OR company_id IN (
      SELECT ct.company_id
      FROM public.company_tenants ct
      JOIN public.profiles p ON p.tenant_id = ct.tenant_id
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin', 'director')
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT cm.company_id
      FROM public.company_members cm
      WHERE cm.user_id = auth.uid()
    )
    OR company_id IN (
      SELECT ct.company_id
      FROM public.company_tenants ct
      JOIN public.profiles p ON p.tenant_id = ct.tenant_id
      WHERE p.user_id = auth.uid()
        AND p.role IN ('admin', 'director')
    )
  );

GRANT ALL ON TABLE public.monthly_statements TO anon;
GRANT ALL ON TABLE public.monthly_statements TO authenticated;
GRANT ALL ON TABLE public.monthly_statements TO service_role;
