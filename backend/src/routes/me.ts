import { Router } from "express";
import { supabase } from "../config/supabase";
import { authMiddleware } from "../middleware/auth";

const router = Router();

/**
 * GET /me
 * 現在のユーザー情報を取得。
 * users.display_name を Auth の metadata から同期し、reminder-members で名前表示できるようにする。
 */
router.get("/", authMiddleware({ allowNoProfiles: true }), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // users.display_name を Auth から同期（reminder-members 用）。応答は待たずに実行
    supabase.auth.admin.getUserById(req.user.id).then(({ data: authUser }) => {
      const displayName =
        authUser?.user?.user_metadata?.full_name ??
        authUser?.user?.user_metadata?.name ??
        null;
      if (displayName != null) {
        void supabase
          .from("users")
          .update({
            display_name: displayName,
            updated_at: new Date().toISOString(),
          })
          .eq("id", req.user!.id);
      }
    }).catch((err) => {
      console.error("[GET /me] display_name sync failed:", err);
    });

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

