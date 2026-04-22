-- ============================================================
-- document_inbox: 統合ドキュメント一次受け（Table A）
-- 計画: docs/unified_document_inbox_plan_20260415.txt
-- ============================================================

CREATE TYPE public.document_inbox_document_type AS ENUM (
  'invoice',
  'company_requirement',
  'tenant_requirement',
  'employee_requirement'
);

CREATE TABLE public.document_inbox (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  value text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  document_type public.document_inbox_document_type,
  classified_at timestamptz,
  classified_by uuid,
  reviewed_at timestamptz,
  reviewed_by uuid,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT document_inbox_pkey PRIMARY KEY (id),
  CONSTRAINT document_inbox_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT document_inbox_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT document_inbox_classified_by_fkey
    FOREIGN KEY (classified_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT document_inbox_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT document_inbox_classify_consistency CHECK (
    (document_type IS NULL AND classified_at IS NULL AND classified_by IS NULL)
    OR (
      document_type IS NOT NULL
      AND classified_at IS NOT NULL
      AND classified_by IS NOT NULL
    )
  ),
  CONSTRAINT document_inbox_reviewed_requires_classify CHECK (
    reviewed_at IS NULL
    OR (
      document_type IS NOT NULL
      AND reviewed_by IS NOT NULL
    )
  )
);

CREATE INDEX idx_document_inbox_tenant_created  ON public.document_inbox (tenant_id, created_at DESC);

CREATE INDEX idx_document_inbox_tenant_unreviewed
  ON public.document_inbox (tenant_id)
  WHERE reviewed_at IS NULL;

COMMENT ON TABLE public.document_inbox IS '一次受け inbox。仕分け後に invoice / requirement 系へ連携する。';

CREATE OR REPLACE FUNCTION public.set_document_inbox_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_inbox_updated_at
  BEFORE UPDATE ON public.document_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.set_document_inbox_updated_at();

ALTER TABLE public.document_inbox ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.document_inbox TO anon;
GRANT ALL ON TABLE public.document_inbox TO authenticated;
GRANT ALL ON TABLE public.document_inbox TO service_role;
