import { Request } from "express";
import { supabase } from "../config/supabase";
import { Resource } from "../authz/authorize";
import { withTenantFilter } from "./tenant-filter";

/**
 * リソース取得ヘルパー関数
 * 各ルートで使用するリソース取得関数を生成
 */

/**
 * Itemリソースを取得
 */
export async function getItemResource(req: Request): Promise<Resource | null> {
  const { id } = req.params;
  if (!id) {
    return null;
  }

  let query = supabase
    .from("items")
    .select("id, tenant_id, item_kind, user_id, responsible_user_id")
    .eq("id", id);
  query = withTenantFilter(query, req);
  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    resource_type: "item",
    owner_tenant_id: data.tenant_id,
    item_kind: data.item_kind as "raw" | "prepped",
    user_id: data.user_id,
    responsible_user_id: data.responsible_user_id,
  };
}

/**
 * Base Itemリソースを取得
 */
export async function getBaseItemResource(
  req: Request
): Promise<Resource | null> {
  const { id } = req.params;
  if (!id) {
    return null;
  }

  let query = supabase.from("base_items").select("id, tenant_id").eq("id", id);
  query = withTenantFilter(query, req);
  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    resource_type: "base_item",
    owner_tenant_id: data.tenant_id,
  };
}

/**
 * Vendor Productリソースを取得
 */
export async function getVendorProductResource(
  req: Request
): Promise<Resource | null> {
  const { id } = req.params;
  if (!id) {
    return null;
  }

  let query = supabase
    .from("virtual_vendor_products")
    .select("id, tenant_id")
    .eq("id", id);
  query = withTenantFilter(query, req);
  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    resource_type: "vendor_product",
    owner_tenant_id: data.tenant_id,
  };
}

/**
 * Recipe Lineリソースを取得
 */
export async function getRecipeLineResource(
  req: Request
): Promise<Resource | null> {
  const { id } = req.params;
  if (!id) {
    return null;
  }

  let query = supabase
    .from("recipe_lines")
    .select("id, tenant_id")
    .eq("id", id);
  query = withTenantFilter(query, req);
  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    resource_type: "recipe_line",
    owner_tenant_id: data.tenant_id,
  };
}

/**
 * 作成時のリソース取得（tenant_idからリソースを作成）
 * 注意: 実際のリソースはまだ作成されていないため、tenant_idからリソース情報を構築
 */
export async function getCreateResource(
  req: Request,
  resourceType: string
): Promise<Resource | null> {
  // 作成時は、リソースIDがまだ存在しないため、
  // 現在のテナントIDからリソース情報を構築
  const currentTenantId =
    req.user!.selected_tenant_id || req.user!.tenant_ids[0];
  if (!currentTenantId) {
    return null;
  }

  // 一時的なリソースIDを生成（実際のリソースIDは作成後に決定される）
  // ただし、認可チェックではowner_tenant_idのみを使用するため、これで問題ない
  return {
    id: `temp-${resourceType}-${currentTenantId}`,
    resource_type: resourceType,
    owner_tenant_id: currentTenantId,
  };
}

/**
 * 一覧取得時のコレクションレベル認可チェック用リソース取得
 * リソースタイプベースの認可チェック（入口チェック）に使用
 */
export async function getCollectionResource(
  req: Request,
  resourceType: string
): Promise<Resource | null> {
  // 一覧取得時は、リソースIDが存在しないため、
  // 現在のテナントIDからリソース情報を構築
  const currentTenantId =
    req.user!.selected_tenant_id || req.user!.tenant_ids[0];
  if (!currentTenantId) {
    return null;
  }

  // コレクションレベルの認可チェック用リソース
  // リソースタイプベースの認可チェックに使用
  return {
    id: `collection-${resourceType}-${currentTenantId}`,
    resource_type: resourceType,
    owner_tenant_id: currentTenantId,
  };
}
