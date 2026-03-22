import { Request, Response, NextFunction } from "express";
import {
  authorizeUnified,
  type UnifiedResource,
} from "../authz/unified/authorize";

/**
 * Unified Cedar authorization middleware (tenant/company unified).
 * Phase 3 では tenant scope のみ置き換える想定。
 */
export function unifiedAuthorizationMiddleware(
  action: string,
  getResource: (req: Request) => Promise<UnifiedResource | null>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const resource = await getResource(req);
      if (!resource) {
        // getResource() が作れない場合、ほとんどは tenant コンテキスト不備や
        // テナント/権限フィルタで意図的にリソースが見えなくなっているケース。
        // 「権限がない=403」で統一する。
        return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
      }

      // tenant scoped resources に必要な Principal 属性を渡す
      const currentTenantId =
        req.user.selected_tenant_id || req.user.tenant_ids[0];
      if (!currentTenantId) {
        return res.status(403).json({ error: "No tenant associated" });
      }

      const tenantRole = req.user.roles.get(currentTenantId);
      if (!tenantRole) {
        return res.status(403).json({ error: "No role assigned for this tenant" });
      }

      const isAllowed = await authorizeUnified(
        req.user.id,
        action,
        resource,
        undefined,
        { tenantId: currentTenantId, tenantRole }
      );

      if (!isAllowed) {
        return res
          .status(403)
          .json({ error: "Forbidden: Insufficient permissions" });
      }

      next();
    } catch (error) {
      console.error("Unified authorization middleware error:", error);
      return res.status(500).json({ error: "Authorization check failed" });
    }
  };
}

