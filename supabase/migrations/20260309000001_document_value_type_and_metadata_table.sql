-- =========================================================
-- Document 用: value_type 追加 + document_metadata テーブル
-- - real_data.value に R2 パスを格納するための value_type「Document」を追加
-- - パス以外の詳細は document_metadata で保持
-- =========================================================

-- 1. value_types に「Document」を追加
INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Document', 'text'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Document');

-- 2. メタデータ用テーブル（real_data の id を参照。パスは real_data.value に格納）
CREATE TABLE IF NOT EXISTS public.document_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  real_data_id uuid NOT NULL UNIQUE REFERENCES public.tenant_requirement_real_data(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.document_metadata IS 'Document アップロードのメタデータ。実体のパスは tenant_requirement_real_data.value に格納';
COMMENT ON COLUMN public.document_metadata.real_data_id IS '対応する tenant_requirement_real_data の id（type = Document の行）';
COMMENT ON COLUMN public.document_metadata.file_name IS '元のファイル名';
COMMENT ON COLUMN public.document_metadata.content_type IS 'MIME type（例: application/pdf, image/jpeg）';
COMMENT ON COLUMN public.document_metadata.size_bytes IS 'ファイルサイズ（バイト）';

GRANT ALL ON TABLE public.document_metadata TO anon;
GRANT ALL ON TABLE public.document_metadata TO authenticated;
GRANT ALL ON TABLE public.document_metadata TO service_role;
