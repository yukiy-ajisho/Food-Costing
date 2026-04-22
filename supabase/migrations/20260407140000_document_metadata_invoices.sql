-- ============================================================
-- document_metadata_invoices テーブル作成
-- price_events.invoice_id FK 追加
-- ============================================================

CREATE TABLE IF NOT EXISTS public.document_metadata_invoices (
  id           uuid    DEFAULT gen_random_uuid() NOT NULL,
  tenant_id    uuid    NOT NULL,
  vendor_id    uuid    NOT NULL,
  value        text    NOT NULL,
  file_name    text    NOT NULL,
  content_type text,
  size_bytes   bigint,
  invoice_date date    NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  created_at   timestamptz DEFAULT now() NOT NULL,
  created_by   uuid    NOT NULL,
  CONSTRAINT document_metadata_invoices_pkey PRIMARY KEY (id),
  CONSTRAINT document_metadata_invoices_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT document_metadata_invoices_vendor_id_fkey
    FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT,
  CONSTRAINT document_metadata_invoices_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT document_metadata_invoices_total_amount_positive
    CHECK (total_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_document_metadata_invoices_tenant
  ON public.document_metadata_invoices (tenant_id);

CREATE INDEX IF NOT EXISTS idx_document_metadata_invoices_vendor
  ON public.document_metadata_invoices (vendor_id);

CREATE INDEX IF NOT EXISTS idx_document_metadata_invoices_invoice_date
  ON public.document_metadata_invoices (tenant_id, invoice_date DESC);

-- RLS
ALTER TABLE public.document_metadata_invoices ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.document_metadata_invoices TO anon;
GRANT ALL ON TABLE public.document_metadata_invoices TO authenticated;
GRANT ALL ON TABLE public.document_metadata_invoices TO service_role;

-- price_events.invoice_id に FK を追加
-- (すでに存在する列; 既存行の invoice_id は NULL のため ON DELETE SET NULL は安全)
ALTER TABLE public.price_events
  ADD CONSTRAINT price_events_invoice_id_fkey
    FOREIGN KEY (invoice_id)
    REFERENCES public.document_metadata_invoices(id)
    ON DELETE SET NULL;
