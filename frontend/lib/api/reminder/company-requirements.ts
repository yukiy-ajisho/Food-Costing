/**
 * Company Requirements API
 * Same shape as tenant requirements; auth via company_members.
 */

import { apiRequest } from "@/lib/api";

interface CompanyRequirementRow {
  id: string;
  title: string;
  company_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface CompanyRequirement {
  id: string;
  title: string;
  companyId: string;
}

function rowToRequirement(row: CompanyRequirementRow): CompanyRequirement {
  return {
    id: row.id,
    title: row.title,
    companyId: row.company_id,
  };
}

export interface CompanyRequirementPayload {
  title: string;
  company_id: string;
}

export const companyRequirementsAPI = {
  /** Companies the user can access (company_admin / company_director). For Select company. */
  getAdminCompanies: () =>
    apiRequest<{ companies: { id: string; company_name: string }[] }>(
      "/company-requirements/admin-companies"
    ),

  getAll: (companyId?: string | null) => {
    const params = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
    return apiRequest<CompanyRequirementRow[]>(`/company-requirements${params}`).then(
      (rows) => rows.map(rowToRequirement)
    );
  },

  getById: (id: string) =>
    apiRequest<CompanyRequirementRow>(`/company-requirements/${id}`).then(
      rowToRequirement
    ),

  create: (payload: CompanyRequirementPayload) =>
    apiRequest<CompanyRequirementRow>("/company-requirements", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(rowToRequirement),

  update: (id: string, payload: Partial<CompanyRequirementPayload>) =>
    apiRequest<CompanyRequirementRow>(`/company-requirements/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }).then(rowToRequirement),

  delete: (id: string) =>
    apiRequest<void>(`/company-requirements/${id}`, {
      method: "DELETE",
    }),
};
