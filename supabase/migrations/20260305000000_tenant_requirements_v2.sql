-- =========================================================
-- Tenant Requirements v2（新データ構造）
-- 設計: docs/tenant_requirements_design_v2.txt
-- 旧: tenant_requirements, mapping_tenant_requirements, tenant_requirement_assignments を廃止し、
--      tenant_requirements（tenant_id 紐づき）, tenant_requirement_value_types, tenant_requirement_real_data に置き換える。
-- =========================================================

-- 1. トリガー削除
DROP TRIGGER IF EXISTS after_profiles_insert_assign_tenant_requirements ON public.profiles;

-- 2. 旧テーブル削除（FK の依存順）
DROP TABLE IF EXISTS public.tenant_requirement_assignments;
DROP TABLE IF EXISTS public.mapping_tenant_requirements;
DROP TABLE IF EXISTS public.tenant_requirements;

-- 3. enum: 期限ルール（現状 rolling のみ）
CREATE TYPE public.tenant_requirement_expiry_rule AS ENUM ('rolling');

-- 4. tenant_requirements（テナント紐づき・適用の概念なし）
CREATE TABLE public.tenant_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expiry_rule public.tenant_requirement_expiry_rule NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_requirements IS 'テナント向け要件。最初からこのテナントの要件として作成する（適用の概念なし）';
COMMENT ON COLUMN public.tenant_requirements.expiry_rule IS '期限ルール。enum。現状 rolling のみ';

CREATE INDEX idx_tenant_requirements_tenant_id ON public.tenant_requirements(tenant_id);

-- 5. tenant_requirement_value_types（値の種類マスタ）
CREATE TABLE public.tenant_requirement_value_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

COMMENT ON TABLE public.tenant_requirement_value_types IS 'Due date / Bill date / Pay date / Validity duration などの種類定義';

-- シード: Due date, Bill date, Pay date, Validity duration
INSERT INTO public.tenant_requirement_value_types (id, name) VALUES
  (gen_random_uuid(), 'Due date'),
  (gen_random_uuid(), 'Bill date'),
  (gen_random_uuid(), 'Pay date'),
  (gen_random_uuid(), 'Validity duration');

-- 6. tenant_requirement_real_data（実データ・group_key で組管理）
CREATE TABLE public.tenant_requirement_real_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_requirement_id uuid NOT NULL REFERENCES public.tenant_requirements(id) ON DELETE CASCADE,
  group_key integer NOT NULL,
  type_id uuid NOT NULL REFERENCES public.tenant_requirement_value_types(id) ON DELETE RESTRICT,
  data_type text NULL,
  value text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_requirement_real_data IS '要件ごとの実データ。group_key で同じ組の行をまとめる（例: 1年目・2年目）';
COMMENT ON COLUMN public.tenant_requirement_real_data.group_key IS '組の識別。1, 2, 3...';
COMMENT ON COLUMN public.tenant_requirement_real_data.data_type IS 'date, number, string など value の解釈用';
COMMENT ON COLUMN public.tenant_requirement_real_data.value IS '実際の値（例: 2024-06-01, 2）';

CREATE INDEX idx_tenant_requirement_real_data_tenant_requirement_id ON public.tenant_requirement_real_data(tenant_requirement_id);
CREATE INDEX idx_tenant_requirement_real_data_group_key ON public.tenant_requirement_real_data(tenant_requirement_id, group_key);

-- 7. Grants
GRANT ALL ON TABLE public.tenant_requirements TO anon;
GRANT ALL ON TABLE public.tenant_requirements TO authenticated;
GRANT ALL ON TABLE public.tenant_requirements TO service_role;
GRANT ALL ON TABLE public.tenant_requirement_value_types TO anon;
GRANT ALL ON TABLE public.tenant_requirement_value_types TO authenticated;
GRANT ALL ON TABLE public.tenant_requirement_value_types TO service_role;
GRANT ALL ON TABLE public.tenant_requirement_real_data TO anon;
GRANT ALL ON TABLE public.tenant_requirement_real_data TO authenticated;
GRANT ALL ON TABLE public.tenant_requirement_real_data TO service_role;
