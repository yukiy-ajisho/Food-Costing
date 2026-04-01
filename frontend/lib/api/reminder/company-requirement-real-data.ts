/**
 * Company requirement real data API
 */

import { apiRequest } from "@/lib/api";

export interface CompanyRequirementRealDataRow {
  id: string;
  company_requirement_id: string;
  group_key: number;
  type_id: string;
  value: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CompanyRealDataRowPayload {
  company_requirement_id: string;
  group_key: number;
  type_id: string;
  value?: string | null;
}

export const companyRequirementRealDataAPI = {
  getByRequirementIds: (companyRequirementIds: string[]) => {
    if (companyRequirementIds.length === 0) return Promise.resolve([]);
    const params = new URLSearchParams();
    params.set("company_requirement_ids", companyRequirementIds.join(","));
    return apiRequest<CompanyRequirementRealDataRow[]>(
      `/company-requirement-real-data?${params.toString()}`
    );
  },

  saveRows: (rows: CompanyRealDataRowPayload[]) =>
    apiRequest<{ ok: boolean }>("/company-requirement-real-data", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  getDocuments: (companyRequirementId: string, groupKey?: number | null) => {
    const params = new URLSearchParams();
    params.set("company_requirement_id", companyRequirementId);
    if (groupKey != null && !Number.isNaN(groupKey)) params.set("group_key", String(groupKey));
    return apiRequest<{ pay_date: string | null; key: string; file_name: string; group_key?: number }[]>(
      `/company-requirement-real-data/documents?${params.toString()}`
    );
  },

  deleteDocument: (key: string) =>
    apiRequest<{ ok: boolean }>(
      `/company-requirement-real-data/document?key=${encodeURIComponent(key)}`,
      { method: "DELETE" }
    ),

  uploadDocument: (companyRequirementId: string, groupKey: number, file: File) => {
    const form = new FormData();
    form.append("company_requirement_id", companyRequirementId);
    form.append("group_key", String(groupKey));
    form.append("file", file);
    return apiRequest<{ ok: boolean }>("/company-requirement-real-data/document", {
      method: "POST",
      body: form,
    });
  },

  getDocumentUrl: (key: string) =>
    apiRequest<{ url: string }>(
      `/company-requirement-real-data/document-url?key=${encodeURIComponent(key)}`
    ),

  saveRecordPayment: (rows: CompanyRealDataRowPayload[], file?: File | null) => {
    if (!file) {
      return companyRequirementRealDataAPI.saveRows(rows);
    }
    const form = new FormData();
    form.append("rows", JSON.stringify(rows));
    form.append("file", file);
    return apiRequest<{ ok: boolean }>(
      "/company-requirement-real-data/record-payment",
      {
        method: "POST",
        body: form,
      }
    );
  },
};
