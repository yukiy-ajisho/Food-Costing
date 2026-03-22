import { Router } from "express";
import { supabase } from "../../config/supabase";
import { getAuthorizedTenantIds } from "./authorization-helpers";

const router = Router();

/**
 * GET /reminder-members
 * 自分が admin である店舗（テナント）に所属する人一覧を返す。
 * Employee Requirements の Status タブで「人」リストに使う。
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;

    const authorizedTenantIds = await getAuthorizedTenantIds(userId);
    if (authorizedTenantIds.length === 0) {
      return res.json({ members: [] });
    }

    // それらのテナントに所属する全プロフィール（user_id の重複あり）
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id")
      .in("tenant_id", authorizedTenantIds);

    if (profilesError) {
      return res.status(500).json({ error: profilesError.message });
    }

    const uniqueUserIds = [...new Set((profiles ?? []).map((p) => p.user_id))];
    if (uniqueUserIds.length === 0) {
      return res.json({ members: [] });
    }

    const { data: usersRows, error: usersError } = await supabase
      .from("users")
      .select("id, hire_date, display_name")
      .in("id", uniqueUserIds);

    if (usersError) {
      return res.status(500).json({ error: usersError.message });
    }

    const userMap = new Map(
      (usersRows ?? []).map((r) => [
        r.id,
        {
          user_id: r.id,
          name: r.display_name ?? undefined,
          email: undefined,
          hire_date: r.hire_date ?? null,
        },
      ]),
    );
    const members = uniqueUserIds.map(
      (uid) =>
        userMap.get(uid) ?? {
          user_id: uid,
          name: undefined,
          email: undefined,
          hire_date: null,
        },
    );

    res.json({ members });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
