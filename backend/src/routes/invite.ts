import { Router } from "express";
import { randomUUID } from "crypto";
import { supabase } from "../config/supabase";
import { authMiddleware } from "../middleware/auth";
import { authorizeTeamTenantAccess } from "../authz/unified/authorize";
import { teamTenantAuthorizationMiddleware } from "../middleware/team-tenant-authorization";
import { sendInvitationEmail } from "../services/email";

const router = Router();

/**
 * POST /invite
 * 招待を作成してメールを送信
 * Body: { email: string, role: "manager" | "staff", tenant_id: string }
 * 認可: tenant::manage_members（Cedar）または親会社の company_admin / company_director（company::manage_tenant_team）
 */
router.post(
  "/",
  authMiddleware({
    allowNoProfiles: true,
    allowCompanyLinkedTenantHeader: true,
  }),
  async (req, res) => {
    try {
      const { email, role, tenant_id } = req.body;
      const userId = req.user!.id;

      // バリデーション
      if (!email || !role || !tenant_id) {
        return res.status(400).json({
          error: "Missing required fields",
          details: "Email, role, and tenant_id are required",
        });
      }

      // ロールのバリデーション
      if (!["manager", "staff"].includes(role)) {
        return res.status(400).json({
          error: "Invalid role",
          details: "Role must be 'manager' or 'staff'",
        });
      }

      const authz = await authorizeTeamTenantAccess(
        userId,
        tenant_id,
        "manage_members",
        req.user!.roles
      );
      if (!authz.allowed) {
        return res.status(403).json({
          error: "Forbidden",
          details: "Insufficient permissions to invite to this tenant",
        });
      }

      // テナント情報を取得
      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenant_id)
        .single();

      if (tenantError || !tenant) {
        return res.status(404).json({
          error: "Not found",
          details: "Tenant not found",
        });
      }

      // 招待者の名前を取得（auth.usersから）
      const { data: inviterAuthUser } =
        await supabase.auth.admin.getUserById(userId);

      // ユーザー情報が取得できない場合はデフォルト名を使用
      const inviterName =
        inviterAuthUser?.user?.user_metadata?.full_name ||
        inviterAuthUser?.user?.user_metadata?.name ||
        inviterAuthUser?.user?.email ||
        "Admin";

      // 既存のpending招待をチェック
      const { data: existingInvitation } = await supabase
        .from("invitations")
        .select("id, status")
        .eq("email", email)
        .eq("tenant_id", tenant_id)
        .eq("status", "pending")
        .maybeSingle();

      if (existingInvitation) {
        return res.status(409).json({
          error: "Invitation already exists",
          details:
            "There is already a pending invitation for this email and tenant",
        });
      }

      // トークンを生成
      const token = randomUUID();
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString(); // 7日後

      // 招待を作成
      const { data: invitation, error: inviteError } = await supabase
        .from("invitations")
        .insert({
          email,
          role,
          tenant_id,
          token,
          status: "pending",
          created_by: userId,
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (inviteError) {
        console.error("[POST /invite] Error creating invitation:", inviteError);
        return res.status(500).json({
          error: "Failed to create invitation",
          details: inviteError.message,
        });
      }

      // allowlistに追加（新規ユーザーがAuth Hookを通過できるように）
      const { error: allowlistError } = await supabase
        .from("allowlist")
        .insert({
          email,
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: "invitation_created",
          source: "invitation",
          note: `Invited to tenant ${tenant_id} by ${inviterName}`,
        });

      // 既に存在する場合（UNIQUE制約エラー）は無視
      if (allowlistError && allowlistError.code !== "23505") {
        console.error(
          "[POST /invite] Warning: Failed to add to allowlist:",
          allowlistError
        );
        // エラーを返さない（招待は作成済み）
      } else if (!allowlistError) {
        console.log("[POST /invite] Added to allowlist:", email);
      }

      // メールを送信
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const acceptUrl = `${frontendUrl}/join?token=${token}`;

      try {
        // メール送信してemail_idを取得
        const emailId = await sendInvitationEmail({
          to: email,
          tenantName: tenant.name,
          inviterName,
          role,
          acceptUrl,
        });

        // email_idをinvitationsテーブルに保存
        const { error: updateError } = await supabase
          .from("invitations")
          .update({ email_id: emailId })
          .eq("id", invitation.id);

        if (updateError) {
          console.error(
            "[POST /invite] Error updating invitation with email_id:",
            updateError
          );
          // email_idの保存失敗は警告のみ（メール送信は成功している）
        }

        console.log(
          "[POST /invite] Invitation created and email sent successfully:",
          invitation.id,
          "email_id:",
          emailId
        );
      } catch (emailError) {
        console.error("[POST /invite] Error sending email:", emailError);
        // メール送信失敗時は、invitationのemail_statusを更新
        await supabase
          .from("invitations")
          .update({ email_status: "failed" })
          .eq("id", invitation.id);
        // エラーを返さない（invitationは作成済み）
      }

      res.status(201).json({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        tenant_id: invitation.tenant_id,
        status: invitation.status,
        created_at: invitation.created_at,
        expires_at: invitation.expires_at,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[POST /invite] Unexpected error:", error);
      res
        .status(500)
        .json({ error: "Internal server error", details: message });
    }
  }
);

/**
 * GET /invite/verify/:token
 * トークンを検証して招待情報を返す（認証不要）
 * 認可: 不要（公開エンドポイント）
 */
router.get("/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    // 招待情報を取得
    const { data: invitation, error: inviteError } = await supabase
      .from("invitations")
      .select(
        "id, email, role, tenant_id, status, expires_at, tenants:tenant_id(name)"
      )
      .eq("token", token)
      .single();

    if (inviteError || !invitation) {
      return res.status(404).json({ error: "Invalid invitation token" });
    }

    // ステータスチェック
    if (invitation.status !== "pending") {
      return res.status(410).json({
        error: "Invitation not available",
        details: `Invitation is ${invitation.status}`,
      });
    }

    // 有効期限チェック
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);
    if (now > expiresAt) {
      // ステータスをexpiredに更新
      await supabase
        .from("invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);

      return res.status(410).json({
        error: "Invitation expired",
        details: "This invitation has expired",
      });
    }

    // 招待情報を返す
    res.status(200).json({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      tenant_id: invitation.tenant_id,
      tenant_name: (invitation.tenants as any)?.name || null,
      status: invitation.status,
      expires_at: invitation.expires_at,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /invite/verify] Unexpected error:", error);
    res.status(500).json({ error: "Server error", details: message });
  }
});

/**
 * GET /invite
 * 招待一覧を取得（manage_members 相当の権限が必要）
 * 認可: authorizeTeamTenantAccess(manage_members)。X-Tenant-ID でテナントを指定（profiles 無しの会社ロール可）
 */
router.get(
  "/",
  authMiddleware({
    allowNoProfiles: true,
    allowCompanyLinkedTenantHeader: true,
  }),
  teamTenantAuthorizationMiddleware("manage_members", {
    tenantIdSource: "body_first",
  }),
  async (req, res) => {
    try {
      const tenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!tenantId) {
        return res.status(400).json({
          error: "Tenant context required",
          details: "Send X-Tenant-ID header for the tenant to list invitations",
        });
      }

      const { data: invitations, error } = await supabase
        .from("invitations")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[GET /invite] Error fetching invitations:", error);
        return res.status(500).json({
          error: "Failed to fetch invitations",
          details: error.message,
        });
      }

      res.status(200).json({ invitations: invitations || [] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[GET /invite] Unexpected error:", error);
      res
        .status(500)
        .json({ error: "Internal server error", details: message });
    }
  }
);

/**
 * POST /invite/accept
 * 招待を承認してテナントに追加
 * Body: { token: string, first_name?: string, last_name?: string }
 * 認可: 認証済みユーザー（メールアドレス一致チェック）
 */
router.post(
  "/accept",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const { token } = req.body;
      const userId = req.user!.id;

      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      // 招待情報を取得
      const { data: invitation, error: inviteError } = await supabase
        .from("invitations")
        .select("id, email, role, tenant_id, status, expires_at")
        .eq("token", token)
        .single();

      if (inviteError || !invitation) {
        return res.status(404).json({ error: "Invalid invitation token" });
      }

      // ステータスチェック
      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: "Invalid invitation status",
          details: `Invitation is already ${invitation.status}`,
        });
      }

      // 有効期限チェック
      const now = new Date();
      const expiresAt = new Date(invitation.expires_at);
      if (now > expiresAt) {
        await supabase
          .from("invitations")
          .update({ status: "expired" })
          .eq("id", invitation.id);

        return res.status(410).json({
          error: "Invitation expired",
          details: "This invitation has expired",
        });
      }

      // ログインユーザーのメールアドレスを取得（auth.usersから）
      const { data: authUser, error: authError } =
        await supabase.auth.admin.getUserById(userId);

      if (authError || !authUser?.user) {
        return res.status(404).json({
          error: "User not found",
          details: "Failed to retrieve user information",
        });
      }

      const userEmail = authUser.user.email;
      if (!userEmail || userEmail !== invitation.email) {
        return res.status(403).json({
          error: "Forbidden",
          details:
            "The email address of your account does not match the invitation",
        });
      }

      // 既存のプロフィールをチェック
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("user_id", userId)
        .eq("tenant_id", invitation.tenant_id)
        .maybeSingle();

      if (existingProfile) {
        // 既にメンバーの場合、invitationのstatusを更新して終了
        await supabase
          .from("invitations")
          .update({ status: "accepted" })
          .eq("id", invitation.id);

        return res.status(200).json({
          message: "You are already a member of this tenant",
          tenant_id: invitation.tenant_id,
          role: existingProfile.role,
        });
      }

      // プロフィールを作成（テナントに追加）
      const { error: profileError } = await supabase.from("profiles").insert({
        user_id: userId,
        tenant_id: invitation.tenant_id,
        role: invitation.role,
      });

      if (profileError) {
        console.error(
          "[POST /invite/accept] Error creating profile:",
          profileError
        );
        return res.status(500).json({
          error: "Failed to add member to tenant",
          details: profileError.message,
        });
      }

      // invitationのstatusを更新
      const { error: updateError } = await supabase
        .from("invitations")
        .update({ status: "accepted" })
        .eq("id", invitation.id);

      if (updateError) {
        console.error(
          "[POST /invite/accept] Error updating invitation status:",
          updateError
        );
        // エラーを返さない（プロフィールは作成済み）
      }

      // allowlistに追加（なければ）
      const { error: allowlistError } = await supabase
        .from("allowlist")
        .insert({
          email: invitation.email,
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: "invitation_accept",
          note: `Accepted invitation from tenant ${invitation.tenant_id}`,
        });

      // 既に存在する場合（UNIQUE制約エラー）は無視
      if (allowlistError && allowlistError.code !== "23505") {
        console.error(
          "[POST /invite/accept] Warning: Failed to add to allowlist:",
          allowlistError
        );
        // エラーを返さない（プロフィールは作成済み）
      } else if (!allowlistError) {
        console.log(
          "[POST /invite/accept] Added to allowlist:",
          invitation.email
        );
      }

      console.log("[POST /invite/accept] Invitation accepted successfully");
      res.status(200).json({
        message: "Invitation accepted successfully",
        tenant_id: invitation.tenant_id,
        role: invitation.role,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[POST /invite/accept] Unexpected error:", error);
      res
        .status(500)
        .json({ error: "Internal server error", details: message });
    }
  }
);

/**
 * GET /invite/verify-company/:token
 * 会社招待トークンを検証（公開）。返却: company_id, company_name, email, expires_at など。
 */
router.get("/verify-company/:token", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const { data: invitation, error: inviteError } = await supabase
      .from("company_invitations")
      .select("id, email, company_id, status, expires_at")
      .eq("token", token)
      .single();

    if (inviteError || !invitation) {
      return res.status(404).json({ error: "Invalid invitation token" });
    }

    if (invitation.status !== "pending") {
      return res.status(410).json({
        error: "Invitation not available",
        details: `Invitation is ${invitation.status}`,
      });
    }

    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);
    if (now > expiresAt) {
      await supabase
        .from("company_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      return res.status(410).json({
        error: "Invitation expired",
        details: "This invitation has expired",
      });
    }

    const { data: company } = await supabase
      .from("companies")
      .select("company_name")
      .eq("id", invitation.company_id)
      .single();

    res.status(200).json({
      id: invitation.id,
      email: invitation.email,
      company_id: invitation.company_id,
      company_name: (company as { company_name?: string } | null)?.company_name ?? null,
      status: invitation.status,
      expires_at: invitation.expires_at,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /invite/verify-company] Unexpected error:", error);
    res.status(500).json({ error: "Server error", details: message });
  }
});

/**
 * POST /invite/accept-company
 * 会社招待を受け入れ、company_members に company_director で追加する。
 * Body: { token: string }。認可: 認証必須。メール一致時のみ追加。
 */
router.post(
  "/accept-company",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const { token } = req.body;
      const userId = req.user!.id;

      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      const { data: invitation, error: inviteError } = await supabase
        .from("company_invitations")
        .select("id, email, company_id, status, expires_at")
        .eq("token", token)
        .single();

      if (inviteError || !invitation) {
        return res.status(404).json({ error: "Invalid invitation token" });
      }

      if (invitation.status !== "pending") {
        return res.status(400).json({
          error: "Invalid invitation status",
          details: `Invitation is already ${invitation.status}`,
        });
      }

      const now = new Date();
      const expiresAt = new Date(invitation.expires_at);
      if (now > expiresAt) {
        await supabase
          .from("company_invitations")
          .update({ status: "expired" })
          .eq("id", invitation.id);
        return res.status(410).json({
          error: "Invitation expired",
          details: "This invitation has expired",
        });
      }

      const { data: authUser, error: authError } =
        await supabase.auth.admin.getUserById(userId);

      if (authError || !authUser?.user) {
        return res.status(404).json({
          error: "User not found",
          details: "Failed to retrieve user information",
        });
      }

      const userEmail = authUser.user.email;
      if (!userEmail || userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
        return res.status(403).json({
          error: "Forbidden",
          details:
            "The email address of your account does not match the invitation",
        });
      }

      const { data: existingMember } = await supabase
        .from("company_members")
        .select("id")
        .eq("company_id", invitation.company_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (existingMember) {
        await supabase
          .from("company_invitations")
          .update({ status: "accepted" })
          .eq("id", invitation.id);
        return res.status(200).json({
          message: "You are already a member of this company",
          company_id: invitation.company_id,
          role: "company_director",
        });
      }

      const { error: memberError } = await supabase.from("company_members").insert({
        company_id: invitation.company_id,
        user_id: userId,
        role: "company_director",
      });

      if (memberError) {
        return res.status(500).json({
          error: "Failed to add you to the company",
          details: memberError.message,
        });
      }

      await supabase
        .from("company_invitations")
        .update({ status: "accepted" })
        .eq("id", invitation.id);

      const { error: allowlistErr } = await supabase.from("allowlist").insert({
        email: invitation.email,
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "company_invitation_accept",
        source: "invitation",
        note: `Accepted company director invitation for company ${invitation.company_id}`,
      });
      if (allowlistErr && (allowlistErr as { code?: string }).code !== "23505") {
        console.warn(
          "[POST /invite/accept-company] Allowlist insert:",
          allowlistErr,
        );
      }

      res.status(200).json({
        message: "Invitation accepted successfully",
        company_id: invitation.company_id,
        role: "company_director",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[POST /invite/accept-company] Unexpected error:", error);
      res
        .status(500)
        .json({ error: "Internal server error", details: message });
    }
  }
);

export default router;
