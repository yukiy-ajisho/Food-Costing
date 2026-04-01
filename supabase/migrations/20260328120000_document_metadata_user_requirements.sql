-- Employee requirement documents: metadata + R2 path in one table (FK → mapping_user_requirements).

CREATE TABLE public.document_metadata_user_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_user_requirement_id uuid NOT NULL REFERENCES public.mapping_user_requirements (id) ON DELETE CASCADE,
  value text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_metadata_user_requirements_mapping
  ON public.document_metadata_user_requirements (mapping_user_requirement_id);

COMMENT ON TABLE public.document_metadata_user_requirements IS
  '従業員要件の Document。value は R2 オブジェクトキー（例: employee/{mapping_id}/{uuid}.pdf）。';

COMMENT ON COLUMN public.document_metadata_user_requirements.mapping_user_requirement_id IS
  'mapping_user_requirements.id（user_requirements マスタではない）';

GRANT ALL ON TABLE public.document_metadata_user_requirements TO anon;
GRANT ALL ON TABLE public.document_metadata_user_requirements TO authenticated;
GRANT ALL ON TABLE public.document_metadata_user_requirements TO service_role;
