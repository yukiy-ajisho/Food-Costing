-- Monthly closing balance snapshots (company × invoicing account).

CREATE TABLE public.closing_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.invoicing_accounts(id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  closing_balance numeric NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT closing_balance_company_account_period_unique
    UNIQUE (company_id, account_id, period)
);

CREATE INDEX idx_closing_balance_company_account
  ON public.closing_balance (company_id, account_id);

CREATE INDEX idx_closing_balance_company_period
  ON public.closing_balance (company_id, period DESC);

COMMENT ON TABLE public.closing_balance IS
  'Month-end balance snapshot per seller company and customer billing account.';

COMMENT ON COLUMN public.closing_balance.period IS
  'Closed month (YYYY-MM). Orders/payments in this month are locked.';

COMMENT ON COLUMN public.closing_balance.closing_balance IS
  'Accounts receivable balance at end of period (orders minus payments through period end).';

ALTER TABLE public.closing_balance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS closing_balance_company_access ON public.closing_balance;
CREATE POLICY closing_balance_company_access ON public.closing_balance
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

GRANT ALL ON TABLE public.closing_balance TO anon;
GRANT ALL ON TABLE public.closing_balance TO authenticated;
GRANT ALL ON TABLE public.closing_balance TO service_role;
