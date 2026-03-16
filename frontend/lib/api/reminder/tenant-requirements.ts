/**
 * Tenant Requirements v2: tenant_requirements API
 * 設計: docs/tenant_requirements_design_v2.txt
 */

import { apiRequest } from "@/lib/api";

interface TenantRequirementRow {
  id: string;
  title: string;
  tenant_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface TenantRequirement {
  id: string;
  title: string;
  tenantId: string;
}

function rowToRequirement(row: TenantRequirementRow): TenantRequirement {
  return {
    id: row.id,
    title: row.title,
    tenantId: row.tenant_id,
  };
}

export interface TenantRequirementPayload {
  title: string;
  tenant_id: string;
}

export const tenantRequirementsAPI = {
  /** 自分が admin のテナントに属する要件一覧。tenant_id 指定でそのテナントのみ */
  getAll: (tenantId?: string | null) => {
    const params = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
    return apiRequest<TenantRequirementRow[]>(`/tenant-requirements${params}`).then(
      (rows) => rows.map(rowToRequirement)
    );
  },

  getById: (id: string) =>
    apiRequest<TenantRequirementRow>(`/tenant-requirements/${id}`).then(
      rowToRequirement
    ),

  create: (payload: TenantRequirementPayload) =>
    apiRequest<TenantRequirementRow>("/tenant-requirements", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(rowToRequirement),

  update: (id: string, payload: Partial<TenantRequirementPayload>) =>
    apiRequest<TenantRequirementRow>(`/tenant-requirements/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }).then(rowToRequirement),

  delete: (id: string) =>
    apiRequest<void>(`/tenant-requirements/${id}`, {
      method: "DELETE",
    }),
};
