import { Router } from "express";
import { supabase } from "../../config/supabase";
import {
  assertCompanyOfficerManageMembers,
  getTenantIdsForCompany,
} from "./authorization-helpers";

const router = Router();

/**
 * GET /reminder-members?company_id=...&tenant_id=（任意）
 * 選択中会社に紐づくテナントの profiles メンバー一覧（user_id 一意）。
 * tenant_id 指定時はそのテナントの profiles のみ（会社配下であること必須）。
 * company_admin / company_director + Cedar manage_members 必須。
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const companyId = (req.query.company_id as string | undefined)?.trim();
    if (!companyId) {
      return res.status(400).json({ error: "company_id is required" });
    }

    try {
      await assertCompanyOfficerManageMembers(userId, companyId);
    } catch (e: unknown) {
      const st = (e as Error & { status?: number }).status;
      if (st === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const tenantIds = await getTenantIdsForCompany(companyId);
    if (tenantIds.length === 0) {
      return res.json({ members: [] });
    }

    const tenantIdFilter = (req.query.tenant_id as string | undefined)?.trim();
    if (tenantIdFilter && !tenantIds.includes(tenantIdFilter)) {
      return res
        .status(400)
        .json({ error: "tenant_id is not linked to this company" });
    }

    const { data: profiles, error: profilesError } = tenantIdFilter
      ? await supabase
          .from("profiles")
          .select("user_id")
          .eq("tenant_id", tenantIdFilter)
      : await supabase
          .from("profiles")
          .select("user_id")
          .in("tenant_id", tenantIds);

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
