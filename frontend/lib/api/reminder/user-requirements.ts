/**
 * Employee Requirements: user_requirements API
 * 要件定義のCRUD（Requirements List 用）
 */

import { apiRequest } from "@/lib/api";

/** バックエンドが返すスネークケースの型 */
interface UserRequirementRow {
  id: string;
  title: string;
  company_id: string;
  jurisdiction_id: string;
  validity_period: number | null;
  validity_period_unit: string | null; // 'years' | 'months' | 'days'
  first_due_date: number | null;
  first_due_on_date: string | null; // date YYYY-MM-DD
  renewal_advance_days: number | null;
  expiry_rule: string | null;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
}

/** ページで使う型（キャメルケース + auto は expiry_rule から導出） */
export interface UserRequirement {
  id: string;
  title: string;
  companyId: string;
  jurisdictionId: string;
  auto: boolean;
  expiryRule: string;
  validityPeriod: number | null;
  validityPeriodUnit: string | null; // 'years' | 'months' | 'days'
  firstDueDate: number | null;
  firstDueOnDate: string | null; // date YYYY-MM-DD
  renewalAdvanceDays: number | null;
}

function rowToRequirement(row: UserRequirementRow): UserRequirement {
  return {
    id: row.id,
    title: row.title,
    companyId: row.company_id,
    jurisdictionId: row.jurisdiction_id,
    auto: Boolean(row.expiry_rule),
    expiryRule: row.expiry_rule ?? "",
    validityPeriod: row.validity_period,
    validityPeriodUnit: row.validity_period_unit ?? null,
    firstDueDate: row.first_due_date,
    firstDueOnDate: row.first_due_on_date ?? null,
    renewalAdvanceDays: row.renewal_advance_days,
  };
}

/** 作成・更新時に送るペイロード（スネークケースで API に送る） */
export interface UserRequirementPayload {
  title: string;
  validity_period?: number | null;
  validity_period_unit?: string | null;
  first_due_date?: number | null;
  first_due_on_date?: string | null;
  renewal_advance_days?: number | null;
  expiry_rule?: string | null;
}

export const userRequirementsAPI = {
  getAll: (companyId: string) =>
    apiRequest<UserRequirementRow[]>(
      `/user-requirements?company_id=${encodeURIComponent(companyId)}`,
    ).then((rows) => rows.map(rowToRequirement)),

  getById: (id: string) =>
    apiRequest<UserRequirementRow>(`/user-requirements/${id}`).then(
      rowToRequirement,
    ),

  create: (
    companyId: string,
    jurisdictionId: string,
    payload: UserRequirementPayload,
  ) =>
    apiRequest<UserRequirementRow>("/user-requirements", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        company_id: companyId,
        jurisdiction_id: jurisdictionId,
      }),
    }).then(rowToRequirement),

  update: (
    id: string,
    payload: UserRequirementPayload & { jurisdiction_id?: string },
  ) =>
    apiRequest<UserRequirementRow>(`/user-requirements/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }).then(rowToRequirement),

  delete: (id: string) =>
    apiRequest<void>(`/user-requirements/${id}`, {
      method: "DELETE",
    }),
};
