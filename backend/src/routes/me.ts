import { Router } from "express";
import { authMiddleware } from "../middleware/auth";

const router = Router();

/**
 * GET /me
 * 現在のユーザー情報を取得
 */
router.get("/", authMiddleware({ allowNoProfiles: true }), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    res.json({
      id: req.user.id,
      email: req.user.email,
      tenant_ids: req.user.tenant_ids,
      selected_tenant_id: req.user.selected_tenant_id,
      is_system_admin: req.user.is_system_admin,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /me] Unexpected error:", error);
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

export default router;

