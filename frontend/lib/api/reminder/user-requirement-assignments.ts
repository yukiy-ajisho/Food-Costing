/**
 * Employee Requirements: user_requirement_assignments API
 * 適用状態の取得・更新（Add / Remove）
 */

import { apiRequest } from "@/lib/api";

export interface AssignmentRow {
  user_id: string;
  user_requirement_id: string;
  is_currently_assigned: boolean;
}

export const userRequirementAssignmentsAPI = {
  /** 自分が作成した要件に紐づく適用状態一覧を取得 */
  getAssignments: (params?: {
    user_requirement_ids?: string[];
    user_ids?: string[];
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.user_requirement_ids?.length)
      searchParams.set(
        "user_requirement_ids",
        params.user_requirement_ids.join(",")
      );
    if (params?.user_ids?.length)
      searchParams.set("user_ids", params.user_ids.join(","));
    const qs = searchParams.toString();
    return apiRequest<{ assignments: AssignmentRow[] }>(
      `/user-requirement-assignments${qs ? `?${qs}` : ""}`
    );
  },

  /** 適用状態を更新（Remove = false, Add = true） */
  patchAssignment: (payload: {
    user_id: string;
    user_requirement_id: string;
    is_currently_assigned: boolean;
  }) =>
    apiRequest<{ ok: boolean }>("/user-requirement-assignments", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
};
