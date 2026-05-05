/**
 * Employee Requirements: jurisdictions（会社スコープの管轄ラベル）
 */

import { apiRequest } from "@/lib/api";

export interface JurisdictionRow {
  id: string;
  company_id: string;
  name: string;
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
}

export const jurisdictionsAPI = {
  list: (companyId: string) =>
    apiRequest<JurisdictionRow[]>(
      `/jurisdictions?company_id=${encodeURIComponent(companyId)}`,
    ),

  create: (body: { company_id: string; name: string }) =>
    apiRequest<JurisdictionRow>("/jurisdictions", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name: string }) =>
    apiRequest<JurisdictionRow>(`/jurisdictions/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  delete: (id: string) =>
    apiRequest<void>(`/jurisdictions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
