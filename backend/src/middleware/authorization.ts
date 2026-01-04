import { Request, Response, NextFunction } from "express";
import {
  authorizeAsync,
  type Principal,
  type Resource,
} from "../authz/authorize";

/**
 * 認可ミドルウェア
 * Cedarを使用してアクセス制御を実行
 *
 * @param action - アクション（read, create, update, delete）
 * @param getResource - リソース情報を取得する関数（非同期）
 */
export function authorizationMiddleware(
  action: string,
  getResource: (req: Request) => Promise<Resource | null>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ユーザー情報が存在しない場合は認証エラー
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // リソース情報を取得
      const resource = await getResource(req);
      if (!resource) {
        return res.status(404).json({ error: "Resource not found" });
      }

      // 現在のテナントIDを取得（選択されたテナントID、または最初のテナント）
      const currentTenantId =
        req.user.selected_tenant_id || req.user.tenant_ids[0];
      if (!currentTenantId) {
        return res.status(403).json({ error: "No tenant associated" });
      }

      // 現在のテナントでのロールを取得
      const role = req.user.roles.get(currentTenantId);
      if (!role) {
        return res
          .status(403)
          .json({ error: "No role assigned for this tenant" });
      }

      // Principalを作成
      const principal: Principal = {
        id: req.user.id,
        tenant_id: currentTenantId,
        role: role as "admin" | "manager" | "staff",
      };

      // デバッグログ: 認可チェック前の情報
      console.log(
        `[AUTHZ MIDDLEWARE] Authorization check: user_id=${principal.id}, role=${principal.role}, tenant_id=${principal.tenant_id}, action=${action}, resource_type=${resource.resource_type}, resource_id=${resource.id}`
      );

      // 認可チェックを実行（resource_sharesを考慮）
      const isAllowed = await authorizeAsync(principal, action, resource);

      // デバッグログ: 認可結果
      console.log(
        `[AUTHZ MIDDLEWARE] Authorization result: ${
          isAllowed ? "ALLOWED" : "DENIED"
        } for user_id=${principal.id}, role=${
          principal.role
        }, action=${action}, resource_id=${resource.id}`
      );

      if (!isAllowed) {
        return res
          .status(403)
          .json({ error: "Forbidden: Insufficient permissions" });
      }

      // 認可成功、次のミドルウェアへ
      next();
    } catch (error) {
      console.error("Authorization middleware error:", error);
      return res.status(500).json({ error: "Authorization check failed" });
    }
  };
}
