-- Delivery site names are unique per invoicing account (company) within a tenant.

ALTER TABLE public.delivery_sites
  DROP CONSTRAINT IF EXISTS delivery_sites_tenant_name_unique;

ALTER TABLE public.delivery_sites
  ADD CONSTRAINT delivery_sites_tenant_account_name_unique
  UNIQUE (tenant_id, account_id, name);

COMMENT ON CONSTRAINT delivery_sites_tenant_account_name_unique ON public.delivery_sites IS
  'Same site name cannot be reused under the same invoicing account within a tenant.';
