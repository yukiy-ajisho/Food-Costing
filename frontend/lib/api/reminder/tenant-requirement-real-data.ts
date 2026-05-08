/**
 * Tenant Requirements v2: tenant_requirement_real_data API
 */

import { apiRequest } from "@/lib/api";

export interface TenantRequirementRealDataRow {
  id: string;
  tenant_requirement_id: string;
  group_key: number;
  type_id: string;
  value: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RealDataRowPayload {
  tenant_requirement_id: string;
  group_key: number;
  type_id: string;
  value?: string | null;
}

export interface TenantRequirementInboxPick {
  id: string;
  file_name: string;
  created_at: string;
  tenant_id: string;
}

export const tenantRequirementRealDataAPI = {
  getByRequirementIds: (tenantRequirementIds: string[]) => {
    if (tenantRequirementIds.length === 0) return Promise.resolve([]);
    const params = new URLSearchParams();
    params.set("tenant_requirement_ids", tenantRequirementIds.join(","));
    return apiRequest<TenantRequirementRealDataRow[]>(
      `/tenant-requirement-real-data?${params.toString()}`
    );
  },

  saveRows: (rows: RealDataRowPayload[]) =>
    apiRequest<{ ok: boolean }>("/tenant-requirement-real-data", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  /** List documents for a requirement, optionally filtered by group_key. Sorted by pay_date. */
  getDocuments: (tenantRequirementId: string, groupKey?: number | null) => {
    const params = new URLSearchParams();
    params.set("tenant_requirement_id", tenantRequirementId);
    if (groupKey != null && !Number.isNaN(groupKey)) params.set("group_key", String(groupKey));
    return apiRequest<{ pay_date: string | null; key: string; file_name: string; group_key?: number }[]>(
      `/tenant-requirement-real-data/documents?${params.toString()}`
    );
  },

  /** Delete a document by R2 key (detail modal Edit). */
  deleteDocument: (key: string) =>
    apiRequest<{ ok: boolean }>(
      `/tenant-requirement-real-data/document?key=${encodeURIComponent(key)}`,
      { method: "DELETE" }
    ),

  deleteGroup: (tenantRequirementId: string, groupKey: number) => {
    const params = new URLSearchParams();
    params.set("tenant_requirement_id", tenantRequirementId);
    params.set("group_key", String(groupKey));
    return apiRequest<{ ok: boolean }>(
      `/tenant-requirement-real-data/group?${params.toString()}`,
      { method: "DELETE" }
    );
  },

  /** Upload a document for a requirement+group (detail modal). Replaces if one exists for that group. */
  uploadDocument: (tenantRequirementId: string, groupKey: number, file: File) => {
    const form = new FormData();
    form.append("tenant_requirement_id", tenantRequirementId);
    form.append("group_key", String(groupKey));
    form.append("file", file);
    return apiRequest<{ ok: boolean }>("/tenant-requirement-real-data/document", {
      method: "POST",
      body: form,
    });
  },

  getInboxPicks: (tenantId: string) => {
    const params = new URLSearchParams();
    params.set("tenant_id", tenantId);
    return apiRequest<TenantRequirementInboxPick[]>(
      `/tenant-requirement-real-data/inbox-picks?${params.toString()}`
    );
  },

  uploadDocumentFromInbox: (
    tenantRequirementId: string,
    groupKey: number,
    documentInboxId: string,
  ) => {
    const form = new FormData();
    form.append("tenant_requirement_id", tenantRequirementId);
    form.append("group_key", String(groupKey));
    form.append("document_inbox_id", documentInboxId);
    return apiRequest<{ ok: boolean }>("/tenant-requirement-real-data/document", {
      method: "POST",
      body: form,
    });
  },

  /** Get presigned URL for an R2 document key; open in new tab with this URL */
  getDocumentUrl: (key: string) =>
    apiRequest<{ url: string }>(
      `/tenant-requirement-real-data/document-url?key=${encodeURIComponent(key)}`
    ),

  /** Record payment with optional file: multipart to /tenant-requirement-real-data/record-payment */
  saveRecordPayment: (rows: RealDataRowPayload[], file?: File | null) => {
    if (!file) {
      return tenantRequirementRealDataAPI.saveRows(rows);
    }
    const form = new FormData();
    form.append("rows", JSON.stringify(rows));
    form.append("file", file);
    return apiRequest<{ ok: boolean }>(
      "/tenant-requirement-real-data/record-payment",
      {
        method: "POST",
        body: form,
      }
    );
  },
};
