-- ============================================================
-- document_metadata_invoices: invoice_date / total_amount を NULL 許容に
-- モバイルは写真のみ先行アップロードし、日付・金額は PC の Import / OCR で確定する
-- created_at は行 INSERT 時刻のまま（変更なし）
-- CHECK (total_amount > 0) は PostgreSQL の仕様上 NULL を通すためそのまま
-- ============================================================

ALTER TABLE public.document_metadata_invoices
  ALTER COLUMN invoice_date DROP NOT NULL;

ALTER TABLE public.document_metadata_invoices
  ALTER COLUMN total_amount DROP NOT NULL;
