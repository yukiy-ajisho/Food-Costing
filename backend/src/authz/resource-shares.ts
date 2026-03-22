import { supabase } from "../config/supabase";
import { ResourceShare } from "../types/database";

/**
 * DB から取った resource_shares 行を、プリンシパルに適用されるものだけに絞る。
 * getResourceShares / バッチ取得後の in-memory 処理で同一ロジックを使う。
 */
export function filterResourceSharesForPrincipal(
  shares: ResourceShare[],
  principalTenantId: string,
  principalRole: string,
  principalId: string
): ResourceShare[] {
  return shares.filter((share) => {
    if (!share.target_id) {
      return false;
    }

    if (share.target_type === "tenant") {
      return share.target_id === principalTenantId;
    }

    if (share.target_type === "role") {
      return share.target_id === principalRole;
    }

    if (share.target_type === "user") {
      return share.target_id === principalId;
    }

    return false;
  });
}

/**
 * 複数 resource_id の resource_shares を 1 クエリで取得（プリンシパルフィルタは行わない）。
 * 呼び出し側で filterResourceSharesForPrincipal を適用すること。
 *
 * @returns resource_id -> 該当行の配列（行が無い id は空配列。入力の各ユニーク id に必ずキーがある）
 */
export async function getResourceSharesRawBatch(
  resourceType: string,
  resourceIds: string[]
): Promise<Map<string, ResourceShare[]>> {
  const map = new Map<string, ResourceShare[]>();
  const unique = [...new Set(resourceIds)];
  for (const id of unique) {
    map.set(id, []);
  }
  if (unique.length === 0) {
    return map;
  }

  try {
    const { data, error } = await supabase
      .from("resource_shares")
      .select("*")
      .eq("resource_type", resourceType)
      .in("resource_id", unique);

    if (error) {
      console.error("Failed to fetch resource shares batch:", error);
      return map;
    }

    for (const row of data ?? []) {
      const id = row.resource_id;
      const bucket = map.get(id);
      if (bucket) {
        bucket.push(row);
      }
    }

    return map;
  } catch (error) {
    console.error("Error fetching resource shares batch:", error);
    return map;
  }
}

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

    return filterResourceSharesForPrincipal(
      data,
      principalTenantId,
      principalRole,
      principalId
    );
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

