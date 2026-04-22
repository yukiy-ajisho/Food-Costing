-- document_metadata_invoices: approved_at を廃止
ALTER TABLE public.document_metadata_invoices
  DROP COLUMN IF EXISTS approved_at;
