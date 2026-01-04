import { supabase } from "../config/supabase";
import { ResourceShare } from "../types/database";

/**
 * resource_sharesテーブルから共有・除外情報を取得
 * @param resourceType - リソースタイプ（'item', 'base_item', 'vendor_product'など）
 * @param resourceId - リソースID
 * @param principalTenantId - プリンシパルのテナントID
 * @param principalRole - プリンシパルのロール
 * @param principalId - プリンシパルのユーザーID
 * @returns 共有・除外情報の配列
 */
export async function getResourceShares(
  resourceType: string,
  resourceId: string,
  principalTenantId: string,
  principalRole: string,
  principalId: string
): Promise<ResourceShare[]> {
  try {
    // resource_sharesテーブルから該当する共有・除外情報を取得
    const { data, error } = await supabase
      .from("resource_shares")
      .select("*")
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId);

    if (error) {
      console.error("Failed to fetch resource shares:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // プリンシパルに適用される共有・除外情報をフィルタリング
    const applicableShares = data.filter((share) => {
      // target_idがnullの場合はスキップ
      if (!share.target_id) {
        return false;
      }

      // target_typeが'tenant'の場合
      if (share.target_type === "tenant") {
        return share.target_id === principalTenantId;
      }

      // target_typeが'role'の場合
      if (share.target_type === "role") {
        return share.target_id === principalRole;
      }

      // target_typeが'user'の場合
      if (share.target_type === "user") {
        return share.target_id === principalId;
      }

      return false;
    });

    return applicableShares;
  } catch (error) {
    console.error("Error fetching resource shares:", error);
    return [];
  }
}

/**
 * 除外（FORBID）情報をチェック
 * @param shares - 共有・除外情報の配列
 * @returns true if excluded (FORBID), false otherwise
 */
export function isExcluded(shares: ResourceShare[]): boolean {
  // is_exclusion = TRUEの共有情報が存在する場合、除外（FORBID）
  return shares.some((share) => share.is_exclusion === true);
}

/**
 * 共有（permit）情報をチェック
 * @param shares - 共有・除外情報の配列
 * @returns true if shared (permit), false otherwise
 */
export function isShared(shares: ResourceShare[]): boolean {
  // is_exclusion = FALSEの共有情報が存在する場合、共有（permit）
  return shares.some((share) => share.is_exclusion === false);
}

/**
 * 共有情報から許可されたアクションを取得
 * @param shares - 共有・除外情報の配列
 * @returns 許可されたアクションの配列（['read'] または ['read', 'update']）
 */
export function getAllowedActions(shares: ResourceShare[]): string[] {
  // is_exclusion = FALSEの共有情報からallowed_actionsを取得
  const share = shares.find((s) => s.is_exclusion === false);
  if (share && share.allowed_actions && share.allowed_actions.length > 0) {
    return share.allowed_actions;
  }
  // デフォルトはreadのみ
  return ["read"];
}

