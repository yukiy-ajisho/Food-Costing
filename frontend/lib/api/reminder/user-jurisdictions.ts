/**
 * Employee Requirements: user_jurisdictions（人×管轄）
 */

import { apiRequest } from "@/lib/api";

export interface UserJurisdictionRow {
  company_id: string;
  user_id: string;
  jurisdiction_id: string;
  created_at?: string;
}

export const userJurisdictionsAPI = {
  list: (companyId: string) =>
    apiRequest<UserJurisdictionRow[]>(
      `/user-jurisdictions?company_id=${encodeURIComponent(companyId)}`,
    ),

  link: (body: {
    company_id: string;
    user_id: string;
    jurisdiction_id: string;
  }) =>
    apiRequest<UserJurisdictionRow>("/user-jurisdictions", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  unlink: (params: {
    company_id: string;
    user_id: string;
    jurisdiction_id: string;
  }) => {
    const q = new URLSearchParams({
      company_id: params.company_id,
      user_id: params.user_id,
      jurisdiction_id: params.jurisdiction_id,
    });
    return apiRequest<{ ok: boolean }>(`/user-jurisdictions?${q.toString()}`, {
      method: "DELETE",
    });
  },
};
