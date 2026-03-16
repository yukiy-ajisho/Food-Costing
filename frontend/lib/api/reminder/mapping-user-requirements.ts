/**
 * Employee Requirements: mapping_user_requirements API
 * 人×要件の紐付け（発行日・期限）の取得・作成
 */

import { apiRequest } from "@/lib/api";

export interface MappingUserRequirementRow {
  id: string;
  user_id: string;
  user_requirement_id: string;
  issued_date: string | null;
  specific_date: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MappingUserRequirementPayload {
  user_id: string;
  user_requirement_id: string;
  issued_date?: string | null;
  specific_date?: string | null;
}

export const mappingUserRequirementsAPI = {
  /** 指定した user_ids / user_requirement_ids の組み合わせについて、各 (user_id, user_requirement_id) の最新1件を取得 */
  getMappings: (params: {
    user_ids?: string[];
    user_requirement_ids?: string[];
  }) => {
    const searchParams = new URLSearchParams();
    if (params.user_ids?.length)
      searchParams.set("user_ids", params.user_ids.join(","));
    if (params.user_requirement_ids?.length)
      searchParams.set(
        "user_requirement_ids",
        params.user_requirement_ids.join(",")
      );
    const qs = searchParams.toString();
    return apiRequest<MappingUserRequirementRow[]>(
      `/mapping-user-requirements${qs ? `?${qs}` : ""}`
    );
  },

  /** 新規マッピングを1件作成（更新時も新規 INSERT） */
  create: (payload: MappingUserRequirementPayload) =>
    apiRequest<MappingUserRequirementRow>("/mapping-user-requirements", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
