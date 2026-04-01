import { Request, Response, NextFunction } from "express";
import {
  authorizeTeamTenantAccess,
  type TeamTenantAuthMode,
} from "../authz/unified/authorize";

export type TeamTenantIdSource = "body_first" | "header_first";

/**
 * Team ページ用: 会社ロール（company_admin / company_director）またはテナントロールで認可。
 */
export function teamTenantAuthorizationMiddleware(
  mode: TeamTenantAuthMode,
  opts?: { tenantIdSource?: TeamTenantIdSource }
) {
  const tenantIdSource = opts?.tenantIdSource ?? "header_first";

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      let tenantId: string | undefined;
      if (tenantIdSource === "body_first") {
        tenantId =
          (typeof req.body?.tenant_id === "string" && req.body.tenant_id) ||
          req.user.selected_tenant_id ||
          req.user.tenant_ids[0];
      } else {
        tenantId =
          req.user.selected_tenant_id ||
          req.user.tenant_ids[0] ||
          (typeof req.body?.tenant_id === "string" ? req.body.tenant_id : undefined);
      }

      if (!tenantId) {
        return res.status(400).json({
          error: "Tenant context required",
          details:
            "Send X-Tenant-ID or include tenant_id in the request body where applicable",
        });
      }

      const result = await authorizeTeamTenantAccess(
        req.user.id,
        tenantId,
        mode,
        req.user.roles
      );

      if (!result.allowed) {
        return res
          .status(403)
          .json({ error: "Forbidden: Insufficient permissions" });
      }

      next();
    } catch (error) {
      console.error("teamTenantAuthorizationMiddleware error:", error);
      return res.status(500).json({ error: "Authorization check failed" });
    }
  };
}
