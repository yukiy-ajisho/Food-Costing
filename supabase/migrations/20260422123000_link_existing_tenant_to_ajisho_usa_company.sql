-- SQL Editor friendly (no DO block / no PLpgSQL variables).
-- 1) Create or reuse company "Ajisho USA LLC"
-- 2) Ensure user is company_admin in that company
-- 3) Link tenant to that company if tenant is not already linked elsewhere
-- NOTE: profiles.role is NOT changed (manager stays manager).

-- Ensure company exists (create if missing)
WITH existing_company AS (
  SELECT c.id
  FROM public.companies c
  WHERE lower(c.company_name) = lower('Ajisho USA LLC')
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1
)
INSERT INTO public.companies (company_name)
SELECT 'Ajisho USA LLC'
WHERE NOT EXISTS (SELECT 1 FROM existing_company);

-- Ensure company_members role (company_admin)
WITH company_row AS (
  SELECT c.id
  FROM public.companies c
  WHERE lower(c.company_name) = lower('Ajisho USA LLC')
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1
)
INSERT INTO public.company_members (company_id, user_id, role)
SELECT
  cr.id,
  'fb1959fd-576e-4d44-ab0e-f717377c87b3'::uuid,
  'company_admin'::public.company_member_role
FROM company_row cr
ON CONFLICT (company_id, user_id)
DO UPDATE SET role = 'company_admin'::public.company_member_role;

-- Link tenant to company, but do nothing if tenant is linked to another company.
WITH company_row AS (
  SELECT c.id
  FROM public.companies c
  WHERE lower(c.company_name) = lower('Ajisho USA LLC')
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1
)
INSERT INTO public.company_tenants (company_id, tenant_id)
SELECT
  cr.id,
  '4080b0e1-7b6c-4387-b0d0-4d3e8c328243'::uuid
FROM company_row cr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.company_tenants ct
  WHERE ct.tenant_id = '4080b0e1-7b6c-4387-b0d0-4d3e8c328243'::uuid
    AND ct.company_id <> cr.id
)
ON CONFLICT (company_id, tenant_id) DO NOTHING;

