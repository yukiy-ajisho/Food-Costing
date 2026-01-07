import { Router } from "express";
import { supabase } from "../config/supabase";
import { authMiddleware } from "../middleware/auth";

const router = Router();

/**
 * POST /tenants
 * 新しいテナントを作成（認証済みユーザーであれば誰でも可能）
 */
router.post(
  "/",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const { name, type } = req.body;

      // バリデーション
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name is required" });
      }

      if (name.length < 5 || name.length > 50) {
        return res.status(400).json({
          error: "name must be between 5 and 50 characters",
        });
      }

      if (!type || typeof type !== "string") {
        return res.status(400).json({ error: "type is required" });
      }

      if (!["restaurant", "vendor"].includes(type)) {
        return res.status(400).json({
          error: "type must be one of: restaurant, vendor",
        });
      }

      // テナントを作成
      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .insert([{ name, type }])
        .select()
        .single();

      if (tenantError || !tenant) {
        return res.status(500).json({
          error: tenantError?.message || "Failed to create tenant",
        });
      }

      // 作成者をadminロールでprofilesに追加
      const { error: profileError } = await supabase.from("profiles").insert([
        {
          user_id: req.user!.id,
          tenant_id: tenant.id,
          role: "admin",
        },
      ]);

      if (profileError) {
        // プロファイル作成に失敗した場合、テナントを削除してロールバック
        await supabase.from("tenants").delete().eq("id", tenant.id);
        return res.status(500).json({
          error: profileError.message || "Failed to create profile",
        });
      }

      res.status(201).json({
        ...tenant,
        role: "admin",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /tenants
 * ユーザーが属するテナント一覧を取得
 */
router.get("/", authMiddleware({ allowNoProfiles: true }), async (req, res) => {
  try {
    // ユーザーが属するテナント一覧を取得
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", req.user!.id);

    if (profilesError) {
      return res.status(500).json({ error: profilesError.message });
    }

    if (!profiles || profiles.length === 0) {
      return res.json({ tenants: [] });
    }

    // テナントIDのリストを取得
    const tenantIds = profiles.map((p) => p.tenant_id);

    // テナント情報を取得
    const { data: tenants, error: tenantsError } = await supabase
      .from("tenants")
      .select("*")
      .in("id", tenantIds);

    if (tenantsError) {
      return res.status(500).json({ error: tenantsError.message });
    }

    // 各テナントにユーザーの役割を追加
    const tenantsWithRole = (tenants || []).map((tenant) => {
      const profile = profiles.find((p) => p.tenant_id === tenant.id);
      return {
        ...tenant,
        role: profile?.role || null,
      };
    });

    res.json({ tenants: tenantsWithRole });
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
      })
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
