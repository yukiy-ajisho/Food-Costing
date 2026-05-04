/**
 * Unified document inbox (document_inbox + Document Box)
 */

import { apiRequest } from "@/lib/api";

export type DocumentBoxRow =
  {
    kind: "inbox";
    id: string;
    file_name: string;
    value: string;
    content_type: string | null;
    created_at: string;
    sent_by_name: string | null;
    document_type: string | null;
  };

export const DOCUMENT_INBOX_TYPE_VALUES = [
  "invoice",
  "company_requirement",
  "tenant_requirement",
  "employee_requirement",
] as const;

export type DocumentInboxDocumentType =
  (typeof DOCUMENT_INBOX_TYPE_VALUES)[number];

export const documentInboxAPI = {
  forDocumentBox: () =>
    apiRequest<DocumentBoxRow[]>("/document-inbox/for-document-box"),

  getDocumentUrl: (key: string) =>
    apiRequest<{ url: string }>(
      `/document-inbox/document-url?key=${encodeURIComponent(key)}`
    ),

  classify: (id: string, documentType: DocumentInboxDocumentType) =>
    apiRequest<{ ok: boolean }>(
      `/document-inbox/${encodeURIComponent(id)}/classify`,
      {
        method: "PATCH",
        body: JSON.stringify({ document_type: documentType }),
      }
    ),

  createInvoiceMetadata: (
    inboxId: string,
    body: { vendor_id: string; invoice_date: string; total_amount: number }
  ) =>
    apiRequest<{ invoice_id: string }>(
      `/document-inbox/${encodeURIComponent(inboxId)}/create-invoice-metadata`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  markReviewed: (inboxId: string) =>
    apiRequest<{ ok: boolean }>(
      `/document-inbox/${encodeURIComponent(inboxId)}/mark-reviewed`,
      { method: "POST" }
    ),

  remove: (inboxId: string) =>
    apiRequest<{ ok: boolean }>(`/document-inbox/${encodeURIComponent(inboxId)}`, {
      method: "DELETE",
    }),
};
