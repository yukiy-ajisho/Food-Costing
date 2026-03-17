-- =========================================================
-- Company Requirements（会社向け要件）
-- Tenant requirements と同じ構成。テーブルは共有せず company 用に新規作成。
-- =========================================================

-- 1. enum: 値の型（tenant と同じ）
CREATE TYPE public.company_requirement_data_type AS ENUM (
  'date',
  'int',
  'text'
);

-- 2. company_requirements
CREATE TABLE public.company_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_requirements IS '会社向け要件。最初からこの会社の要件として作成する';

CREATE INDEX idx_company_requirements_company_id ON public.company_requirements(company_id);

-- 3. company_requirement_value_types（マスタ）
CREATE TABLE public.company_requirement_value_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  data_type public.company_requirement_data_type NOT NULL
);

COMMENT ON TABLE public.company_requirement_value_types IS 'Due date / Bill date / Pay date / Validity duration / Document などの種類定義';

-- シード: tenant と同じ種類（UI の type 名参照に合わせる）
INSERT INTO public.company_requirement_value_types (id, name, data_type) VALUES
  (gen_random_uuid(), 'Due date', 'date'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Bill date', 'date'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Pay date', 'date'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Validity duration (years)', 'int'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Validity duration (months)', 'int'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Validity duration (days)', 'int'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Estimated specific due date', 'date'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Estimated specific bill date', 'date'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Estimated due date based on validity duration', 'date'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Estimated bill date based on validity duration', 'date'::public.company_requirement_data_type),
  (gen_random_uuid(), 'Document', 'text'::public.company_requirement_data_type);

-- 4. company_requirement_real_data
CREATE TABLE public.company_requirement_real_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_requirement_id uuid NOT NULL REFERENCES public.company_requirements(id) ON DELETE CASCADE,
  group_key integer NOT NULL,
  type_id uuid NOT NULL REFERENCES public.company_requirement_value_types(id) ON DELETE RESTRICT,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_requirement_real_data IS '要件ごとの実データ。group_key で同じ組の行をまとめる';

CREATE INDEX idx_company_requirement_real_data_company_requirement_id ON public.company_requirement_real_data(company_requirement_id);
CREATE INDEX idx_company_requirement_real_data_group_key ON public.company_requirement_real_data(company_requirement_id, group_key);

-- 5. company_document_metadata（会社要件の Document 用）
CREATE TABLE public.company_document_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  real_data_id uuid NOT NULL UNIQUE REFERENCES public.company_requirement_real_data(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_document_metadata IS '会社要件の Document アップロードのメタデータ。実体のパスは company_requirement_real_data.value に格納';

GRANT ALL ON TABLE public.company_requirements TO anon;
GRANT ALL ON TABLE public.company_requirements TO authenticated;
GRANT ALL ON TABLE public.company_requirements TO service_role;
GRANT ALL ON TABLE public.company_requirement_value_types TO anon;
GRANT ALL ON TABLE public.company_requirement_value_types TO authenticated;
GRANT ALL ON TABLE public.company_requirement_value_types TO service_role;
GRANT ALL ON TABLE public.company_requirement_real_data TO anon;
GRANT ALL ON TABLE public.company_requirement_real_data TO authenticated;
GRANT ALL ON TABLE public.company_requirement_real_data TO service_role;
GRANT ALL ON TABLE public.company_document_metadata TO anon;
GRANT ALL ON TABLE public.company_document_metadata TO authenticated;
GRANT ALL ON TABLE public.company_document_metadata TO service_role;
