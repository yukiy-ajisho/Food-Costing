-- ============================================================
-- document_metadata_invoices: approved_at 追加 + vendor_id nullable 化
-- ============================================================

-- 1. approved_at 列を追加（NULL = 未承認、値あり = 承認済み）
ALTER TABLE public.document_metadata_invoices
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- 2. 既存行は全て Web Import 由来（= 承認済み）なので created_at で埋める
UPDATE public.document_metadata_invoices
  SET approved_at = created_at
  WHERE approved_at IS NULL;

-- 3. vendor_id の NOT NULL 制約を外す
--    モバイルからのアップロード時点では仕入先未確定のため NULL を許容する
ALTER TABLE public.document_metadata_invoices
  ALTER COLUMN vendor_id DROP NOT NULL;
