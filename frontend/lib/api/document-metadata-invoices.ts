/**
 * Invoice documents (document_metadata_invoices + R2)
 */

import { apiRequest } from "@/lib/api";

export interface DocumentMetadataInvoiceRow {
  id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  value: string;
  file_name: string;
  content_type?: string | null;
  size_bytes?: number | null;
  invoice_date: string | null;
  total_amount: number | null;
  created_at?: string;
}

export const documentMetadataInvoicesAPI = {
  /** PDF を R2 にアップロードして DB に INSERT し、生成された id を返す */
  uploadDocument: (params: {
    vendorId: string;
    invoiceDate: string;
    totalAmount: number;
    file: File;
  }) => {
    const form = new FormData();
    form.append("vendor_id", params.vendorId);
    form.append("invoice_date", params.invoiceDate);
    form.append("total_amount", String(params.totalAmount));
    form.append("file", params.file);
    return apiRequest<{ ok: boolean; id: string }>(
      "/document-metadata-invoices/document",
      { method: "POST", body: form }
    );
  },

  /** R2 の presigned GET URL を取得 */
  getDocumentUrl: (key: string) =>
    apiRequest<{ url: string }>(
      `/document-metadata-invoices/document-url?key=${encodeURIComponent(key)}`
    ),

  /** テナントの invoice 一覧を invoice_date 降順で取得 */
  list: () =>
    apiRequest<DocumentMetadataInvoiceRow[]>("/document-metadata-invoices"),
};
