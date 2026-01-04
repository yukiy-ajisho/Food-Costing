import { Request } from "express";
import { PostgrestQueryBuilder } from "@supabase/postgrest-js";

/**
 * テナントフィルタリング用のヘルパー関数
 * 選択されたテナントIDでクエリをフィルタリング
 *
 * @param query - Supabaseのクエリビルダー
 * @param req - Expressのリクエストオブジェクト
 * @param columnName - テナントIDカラム名（デフォルト: "tenant_id"）
 * @returns フィルタリングされたクエリビルダー
 */
export function withTenantFilter<T>(
  query: PostgrestQueryBuilder<T>,
  req: Request,
  columnName: string = "tenant_id"
): PostgrestQueryBuilder<T> {
  const selectedTenantId =
    req.user?.selected_tenant_id || req.user?.tenant_ids[0];

  if (!selectedTenantId) {
    throw new Error("No tenant ID available for filtering");
  }

  return query.eq(columnName, selectedTenantId);
}

