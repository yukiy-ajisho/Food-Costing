import { Request } from "express";

/**
 * テナントフィルタリング用のヘルパー関数
 * 選択されたテナントIDでクエリをフィルタリング
 *
 * @param query - Supabaseのクエリビルダー
 * @param req - Expressのリクエストオブジェクト
 * @param columnName - テナントIDカラム名（デフォルト: "tenant_id"）
 * @returns フィルタリングされたクエリビルダー
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withTenantFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  req: Request,
  columnName: string = "tenant_id"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const selectedTenantId =
    req.user?.selected_tenant_id || req.user?.tenant_ids[0];

  if (!selectedTenantId) {
    throw new Error("No tenant ID available for filtering");
  }

  return query.eq(columnName, selectedTenantId);
}

/**
 * Company-scoped invoicing master data (accounts, delivery sites).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withCompanyFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  companyId: string,
  columnName: string = "company_id",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return query.eq(columnName, companyId);
}

