-- Move invoicing_accounts and delivery_sites from tenant scope to company scope.

-- ---------------------------------------------------------------------------
-- invoicing_accounts: tenant_id → company_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoicing_accounts
  ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.invoicing_accounts ia
SET company_id = ct.company_id
FROM public.company_tenants ct
WHERE ct.tenant_id = ia.tenant_id;

ALTER TABLE public.invoicing_accounts
  ALTER COLUMN company_id SET NOT NULL;

CREATE TEMP TABLE _invoicing_account_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY company_id, company_name
      ORDER BY created_at ASC, id ASC
    ) AS survivor_id
  FROM public.invoicing_accounts
)
SELECT id AS old_id, survivor_id AS new_id
FROM ranked
WHERE id <> survivor_id;

UPDATE public.delivery_sites ds
SET account_id = m.new_id
FROM _invoicing_account_merge m
WHERE ds.account_id = m.old_id;

UPDATE public.payments p
SET account_id = m.new_id
FROM _invoicing_account_merge m
WHERE p.account_id = m.old_id;

DELETE FROM public.invoicing_accounts ia
USING _invoicing_account_merge m
WHERE ia.id = m.old_id;

ALTER TABLE public.invoicing_accounts
  DROP CONSTRAINT IF EXISTS invoicing_accounts_tenant_company_unique;

DROP INDEX IF EXISTS idx_invoicing_accounts_tenant_id;

ALTER TABLE public.invoicing_accounts
  DROP CONSTRAINT IF EXISTS invoicing_accounts_tenant_id_fkey;

DROP POLICY IF EXISTS invoicing_accounts_tenant_access ON public.invoicing_accounts;

ALTER TABLE public.invoicing_accounts
  DROP COLUMN tenant_id;

ALTER TABLE public.invoicing_accounts
  ADD CONSTRAINT invoicing_accounts_company_company_name_unique
  UNIQUE (company_id, company_name);

CREATE INDEX idx_invoicing_accounts_company_id
  ON public.invoicing_accounts (company_id);

COMMENT ON TABLE public.invoicing_accounts IS
  'Invoicing: customer billing account (company-scoped). Unrelated to buyer app companies.';

COMMENT ON COLUMN public.invoicing_accounts.company_id IS
  'Seller company that owns this billing account.';

-- ---------------------------------------------------------------------------
-- delivery_sites: tenant_id → company_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.delivery_sites
  ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.delivery_sites ds
SET company_id = ia.company_id
FROM public.invoicing_accounts ia
WHERE ia.id = ds.account_id;

ALTER TABLE public.delivery_sites
  ALTER COLUMN company_id SET NOT NULL;

-- Resolve rare duplicate site names under the same account after account merge.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, account_id, name
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.delivery_sites
)
UPDATE public.delivery_sites ds
SET name = ds.name || ' (' || r.rn || ')'
FROM ranked r
WHERE ds.id = r.id
  AND r.rn > 1;

ALTER TABLE public.delivery_sites
  DROP CONSTRAINT IF EXISTS delivery_sites_tenant_account_name_unique;

DROP INDEX IF EXISTS idx_delivery_sites_tenant_id;

ALTER TABLE public.delivery_sites
  DROP CONSTRAINT IF EXISTS delivery_sites_tenant_id_fkey;

DROP POLICY IF EXISTS delivery_sites_tenant_access ON public.delivery_sites;

ALTER TABLE public.delivery_sites
  DROP COLUMN tenant_id;

ALTER TABLE public.delivery_sites
  ADD CONSTRAINT delivery_sites_company_account_name_unique
  UNIQUE (company_id, account_id, name);

CREATE INDEX idx_delivery_sites_company_id
  ON public.delivery_sites (company_id);

COMMENT ON TABLE public.delivery_sites IS
  'Invoicing: delivery site master (company-scoped).';

COMMENT ON COLUMN public.delivery_sites.company_id IS
  'Seller company that owns this delivery site.';

-- ---------------------------------------------------------------------------
-- RLS (same pattern as payments)
-- ---------------------------------------------------------------------------

CREATE POLICY invoicing_accounts_company_access ON public.invoicing_accounts
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

CREATE POLICY delivery_sites_company_access ON public.delivery_sites
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
