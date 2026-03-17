-- =========================================================
-- Company layer: companies, company_members, company_tenants
-- Company は Tenant の上位レイヤー。複数 Tenant が同一 Company に属しうる。
-- =========================================================

-- 1. companies
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.companies IS '会社マスタ。Tenant の上位レイヤー。';

CREATE INDEX idx_companies_company_name ON public.companies(company_name);

-- 2. company_members（company と user の関係＋role）
CREATE TYPE public.company_member_role AS ENUM ('company_admin', 'company_director');

CREATE TABLE public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role public.company_member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_members IS '会社メンバー。company_admin は作成者1人のみ、company_director は複数可。';
COMMENT ON COLUMN public.company_members.role IS 'company_admin: 作成者・1会社1人。company_director: 同等権限・複数可。';

CREATE UNIQUE INDEX idx_company_members_company_user ON public.company_members(company_id, user_id);
CREATE INDEX idx_company_members_company_id ON public.company_members(company_id);
CREATE INDEX idx_company_members_user_id ON public.company_members(user_id);

-- 3. company_tenants（company に属する tenant）
CREATE TABLE public.company_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_tenants IS '会社に属するテナント。1 tenant は 0 または 1 company に属する（将来制約を入れる場合はアプリ側で担保）。';

CREATE UNIQUE INDEX idx_company_tenants_company_tenant ON public.company_tenants(company_id, tenant_id);
CREATE INDEX idx_company_tenants_company_id ON public.company_tenants(company_id);
CREATE INDEX idx_company_tenants_tenant_id ON public.company_tenants(tenant_id);

-- 4. Grants
GRANT ALL ON TABLE public.companies TO anon;
GRANT ALL ON TABLE public.companies TO authenticated;
GRANT ALL ON TABLE public.companies TO service_role;
GRANT ALL ON TABLE public.company_members TO anon;
GRANT ALL ON TABLE public.company_members TO authenticated;
GRANT ALL ON TABLE public.company_members TO service_role;
GRANT ALL ON TABLE public.company_tenants TO anon;
GRANT ALL ON TABLE public.company_tenants TO authenticated;
GRANT ALL ON TABLE public.company_tenants TO service_role;
