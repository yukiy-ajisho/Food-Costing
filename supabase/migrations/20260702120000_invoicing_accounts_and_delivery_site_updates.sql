-- Invoicing accounts (billing/contract master — not app companies) + delivery site linkage.
-- Wipes existing invoicing rows (no legacy data migration).

DELETE FROM public.invoice_box_invoices;
DELETE FROM public.invoice_lists;
DELETE FROM public.delivery_sites;

CREATE TABLE IF NOT EXISTS public.invoicing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  poc_phone text,
  poc_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoicing_accounts_tenant_company_unique UNIQUE (tenant_id, company_name)
);

CREATE INDEX IF NOT EXISTS idx_invoicing_accounts_tenant_id
  ON public.invoicing_accounts (tenant_id);

ALTER TABLE public.delivery_sites
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS zip text,
  ADD COLUMN IF NOT EXISTS account_id uuid;

ALTER TABLE public.delivery_sites
  DROP COLUMN IF EXISTS state_zip;

ALTER TABLE public.delivery_sites
  ALTER COLUMN account_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'delivery_sites_account_id_fkey'
      AND conrelid = 'public.delivery_sites'::regclass
  ) THEN
    ALTER TABLE public.delivery_sites
      ADD CONSTRAINT delivery_sites_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.invoicing_accounts(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_sites_account_id
  ON public.delivery_sites (account_id);

DROP TRIGGER IF EXISTS invoicing_accounts_set_updated_at ON public.invoicing_accounts;
CREATE TRIGGER invoicing_accounts_set_updated_at
  BEFORE UPDATE ON public.invoicing_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_invoicing_updated_at();

ALTER TABLE public.invoicing_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoicing_accounts_tenant_access ON public.invoicing_accounts;
CREATE POLICY invoicing_accounts_tenant_access ON public.invoicing_accounts
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

COMMENT ON TABLE public.invoicing_accounts IS 'Invoicing: billing/contract account master (unrelated to app companies).';
COMMENT ON COLUMN public.delivery_sites.account_id IS 'Parent invoicing account for this delivery site.';
