-- Payment Received: company × invoicing account ledger entries (no order linkage).

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.invoicing_accounts(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  type text NOT NULL DEFAULT 'payment' CHECK (type IN ('payment', 'adjustment')),
  note text,
  payment_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_payments_company_account
  ON public.payments (company_id, account_id);

CREATE INDEX idx_payments_company_created_at
  ON public.payments (company_id, created_at DESC);

CREATE INDEX idx_payments_account_id
  ON public.payments (account_id);

COMMENT ON TABLE public.payments IS
  'Payment Received: seller company records payment against customer billing account.';

COMMENT ON COLUMN public.payments.company_id IS
  'Seller company that received and recorded the payment.';

COMMENT ON COLUMN public.payments.account_id IS
  'Customer billing account (invoicing_accounts).';

COMMENT ON COLUMN public.payments.payment_date IS
  'Optional date money was received (may differ from created_at).';

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_company_access ON public.payments;
CREATE POLICY payments_company_access ON public.payments
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

GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;
