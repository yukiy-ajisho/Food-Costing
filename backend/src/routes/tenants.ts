import { Router } from "express";
import { supabase } from "../config/supabase";
import { authMiddleware } from "../middleware/auth";

const router = Router();

/**
 * POST /tenants — 廃止
 * テナント作成は Company 経由のみ。POST /companies/:id/tenants を使用すること。
 */
router.post(
  "/",
  authMiddleware({ allowNoProfiles: true }),
  (_req, res) => {
    res.status(410).json({
      error: "Tenant creation via POST /tenants is deprecated. Use POST /companies/:id/tenants to create a tenant under a company.",
    });
  },
);

/**
 * GET /tenants
 * ユーザーが属するテナント一覧を取得。所属 Company がある場合は company_id, company_name を付与する。
 */
router.get("/", authMiddleware({ allowNoProfiles: true }), async (req, res) => {
  try {
    // ユーザーが属するテナント一覧を取得（profiles と tenants を 1 回のクエリで取得）
    const { data: profilesWithTenants, error } = await supabase
      .from("profiles")
      .select("tenant_id, role, tenants(*)")
      .eq("user_id", req.user!.id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!profilesWithTenants || profilesWithTenants.length === 0) {
      return res.json({ tenants: [] });
    }

    // 各 profile の tenants を展開し、role を付与
    const tenantsWithRole = profilesWithTenants
      .filter((p) => p.tenants != null)
      .map((p) => ({
        ...(p.tenants as unknown as Record<string, unknown>),
        role: p.role,
      }));

    const tenantIds = tenantsWithRole.map((t) => (t as Record<string, unknown>).id as string);
    if (tenantIds.length === 0) {
      return res.json({ tenants: [] });
    }

    // company_tenants から tenant_id -> company_id を取得
    const { data: links } = await supabase
      .from("company_tenants")
      .select("tenant_id, company_id")
      .in("tenant_id", tenantIds);

    const companyIds = [...new Set((links ?? []).map((l) => l.company_id))];
    const companyIdToName: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await supabase
        .from("companies")
        .select("id, company_name")
        .in("id", companyIds);
      (companies ?? []).forEach((c) => {
        companyIdToName[c.id] = c.company_name;
      });
    }

    const tenantIdToCompany: Record<string, { company_id: string; company_name: string }> = {};
    (links ?? []).forEach((l) => {
      tenantIdToCompany[l.tenant_id] = {
        company_id: l.company_id,
        company_name: companyIdToName[l.company_id] ?? "",
      };
    });

    const tenantsWithCompany = tenantsWithRole.map((t) => {
      const tid = (t as Record<string, unknown>).id as string;
      const company = tenantIdToCompany[tid];
      return {
        ...t,
        company_id: company?.company_id ?? null,
        company_name: company?.company_name ?? null,
      };
    });

    res.json({ tenants: tenantsWithCompany });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /tenants/:id
 * テナント情報を取得
 */
router.get("/:id", authMiddleware(), async (req, res) => {
  try {
    // ユーザーがそのテナントに属しているか確認
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", req.user!.id)
      .eq("tenant_id", req.params.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({
        error: "User does not belong to this tenant",
      });
    }

    // テナント情報を取得
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (tenantError || !tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    res.json({
      ...tenant,
      role: profile.role,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /tenants/:id/members
 * テナントのメンバー一覧を取得
 */
router.get("/:id/members", authMiddleware(), async (req, res) => {
  try {
    // ユーザーがそのテナントに属しているか確認
    const { data: userProfile, error: userProfileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", req.user!.id)
      .eq("tenant_id", req.params.id)
      .single();

    if (userProfileError || !userProfile) {
      return res.status(403).json({
        error: "User does not belong to this tenant",
      });
    }

    // テナントのメンバー一覧を取得
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, role, created_at")
      .eq("tenant_id", req.params.id)
      .order("created_at", { ascending: true });

    if (profilesError) {
      return res.status(500).json({ error: profilesError.message });
    }

    // 各メンバーのauth.users情報を取得
    const members = await Promise.all(
      profiles.map(async (profile) => {
        // auth.usersからユーザー情報を取得（Service role keyを使用）
        const { data: authUser, error: authError } =
          await supabase.auth.admin.getUserById(profile.user_id);

        // ユーザー情報が取得できない場合は、基本情報のみ返す
        if (authError || !authUser?.user) {
          return {
            user_id: profile.user_id,
            role: profile.role,
            member_since: profile.created_at,
            name: undefined,
            email: undefined,
          };
        }

        // user_metadataから名前を取得（full_name, nameの順で確認）
        const name =
          authUser.user.user_metadata?.full_name ||
          authUser.user.user_metadata?.name ||
          undefined;

        // メールアドレスを取得
        const email = authUser.user.email || undefined;

        return {
          user_id: profile.user_id,
          role: profile.role,
          member_since: profile.created_at,
          name,
          email,
        };
      }),
    );

    res.json({ members });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /tenants/:id
 * テナント名を更新（テナントに属しているユーザーであれば誰でも可能）
 */
router.put("/:id", authMiddleware(), async (req, res) => {
  try {
    // ユーザーがそのテナントに属しているか確認
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", req.user!.id)
      .eq("tenant_id", req.params.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({
        error: "User does not belong to this tenant",
      });
    }

    const { name } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }

    // テナント名を更新
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .update({ name })
      .eq("id", req.params.id)
      .select()
      .single();

    if (tenantError || !tenant) {
      return res
        .status(500)
        .json({ error: tenantError?.message || "Failed to update tenant" });
    }

    res.json(tenant);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /tenants/:id/members/:userId/role
 * メンバーの役割を変更（テナントに属しているユーザーであれば誰でも可能）
 */
router.put("/:id/members/:userId/role", authMiddleware(), async (req, res) => {
  try {
    // ユーザーがそのテナントに属しているか確認
    const { data: userProfile, error: userProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", req.user!.id)
      .eq("tenant_id", req.params.id)
      .single();

    if (userProfileError || !userProfile) {
      return res.status(403).json({
        error: "User does not belong to this tenant",
      });
    }

    const { role } = req.body;

    if (!role || !["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({
        error: "role must be one of: admin, manager, staff",
      });
    }

    // メンバーの役割を更新
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({ role })
      .eq("user_id", req.params.userId)
      .eq("tenant_id", req.params.id)
      .select()
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        error: "Member not found in this tenant",
      });
    }

    res.json(profile);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /tenants/:id/members/:userId
 * メンバーをテナントから削除（テナントに属しているユーザーであれば誰でも可能）
 */
router.delete("/:id/members/:userId", authMiddleware(), async (req, res) => {
  try {
    // ユーザーがそのテナントに属しているか確認
    const { data: userProfile, error: userProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", req.user!.id)
      .eq("tenant_id", req.params.id)
      .single();

    if (userProfileError || !userProfile) {
      return res.status(403).json({
        error: "User does not belong to this tenant",
      });
    }

    // 自分自身を削除しようとしている場合はエラー
    if (req.params.userId === req.user!.id) {
      return res.status(400).json({
        error: "Cannot remove yourself from the tenant",
      });
    }

    // メンバーを削除
    const { error: deleteError } = await supabase
      .from("profiles")
      .delete()
      .eq("user_id", req.params.userId)
      .eq("tenant_id", req.params.id);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
