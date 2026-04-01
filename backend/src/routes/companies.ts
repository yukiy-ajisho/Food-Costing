import { Router } from "express";
import { randomUUID } from "crypto";
import { supabase } from "../config/supabase";
import { authMiddleware } from "../middleware/auth";
import { sendCompanyInvitationEmail } from "../services/email";
import { authorizeUnified, UnifiedCompanyAction } from "../authz/unified/authorize";

const router = Router();

/**
 * POST /companies
 * 会社を作成し、作成者を company_admin で company_members に追加する。
 * 認証済みユーザーであれば誰でも可能（1ユーザー1会社などはアプリ側で制御）。
 */
router.post(
  "/",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const { company_name } = req.body;

      if (!company_name || typeof company_name !== "string") {
        return res.status(400).json({ error: "company_name is required" });
      }

      const name = company_name.trim();
      if (name.length === 0) {
        return res.status(400).json({ error: "company_name cannot be empty" });
      }

      const { data: company, error: companyError } = await supabase
        .from("companies")
        .insert([{ company_name: name }])
        .select()
        .single();

      if (companyError || !company) {
        return res.status(500).json({
          error: companyError?.message ?? "Failed to create company",
        });
      }

      const { error: memberError } = await supabase.from("company_members").insert([
        {
          company_id: company.id,
          user_id: req.user!.id,
          role: "company_admin",
        },
      ]);

      if (memberError) {
        await supabase.from("companies").delete().eq("id", company.id);
        return res.status(500).json({
          error: memberError.message ?? "Failed to add company admin",
        });
      }

      res.status(201).json({
        ...company,
        role: "company_admin",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /companies
 * 自分が company_members にいる会社一覧を返す。
 */
router.get("/", authMiddleware({ allowNoProfiles: true }), async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from("company_members")
      .select("company_id, role, companies(*)")
      .eq("user_id", req.user!.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!rows || rows.length === 0) {
      return res.json({ companies: [] });
    }

    const companies = rows
      .filter((r) => r.companies != null)
      .map((r) => ({
        ...((r.companies as unknown) as Record<string, unknown>),
        role: r.role,
      }));

    res.json({ companies });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /companies/:id/members
 * その会社のメンバー一覧（company_admin / company_director）。認可: 当該会社の admin/director。
 */
router.get(
  "/:id/members",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const companyId = req.params.id;
      if (!companyId) {
        return res.status(400).json({ error: "company id is required" });
      }

      const allowed = await authorizeUnified(
        req.user!.id,
        UnifiedCompanyAction.manage_members,
        { type: "Company", id: companyId }
      );
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this company" });
      }

      const { data: rows, error } = await supabase
        .from("company_members")
        .select("user_id, role")
        .eq("company_id", companyId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      if (!rows || rows.length === 0) {
        return res.json({ members: [] });
      }

      const members = await Promise.all(
        rows.map(async (r) => {
          const { data: authUser } = await supabase.auth.admin.getUserById(
            r.user_id
          );
          return {
            user_id: r.user_id,
            role: r.role,
            email: authUser?.user?.email ?? null,
            display_name:
              authUser?.user?.user_metadata?.full_name ||
              authUser?.user?.user_metadata?.name ||
              authUser?.user?.email ||
              null,
          };
        })
      );

      res.json({ members });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /companies/:id/invitations
 * その会社の招待一覧。認可: 当該会社の admin/director。
 */
router.get(
  "/:id/invitations",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const companyId = req.params.id;
      if (!companyId) {
        return res.status(400).json({ error: "company id is required" });
      }

      const allowed = await authorizeUnified(
        req.user!.id,
        UnifiedCompanyAction.manage_invitations,
        { type: "Company", id: companyId }
      );
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this company" });
      }

      const status = req.query.status as string | undefined;

      let query = supabase
        .from("company_invitations")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (status) {
        query = query.eq("status", status);
      }

      const { data: invitations, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json({ invitations: invitations ?? [] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /companies/:id/invitations
 * 会社に director として招待。Body: { email: string }。認可: 当該会社の admin/director。
 */
router.post(
  "/:id/invitations",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const companyId = req.params.id;
      if (!companyId) {
        return res.status(400).json({ error: "company id is required" });
      }

      const allowed = await authorizeUnified(
        req.user!.id,
        UnifiedCompanyAction.manage_invitations,
        { type: "Company", id: companyId }
      );
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this company" });
      }

      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "email is required" });
      }

      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail) {
        return res.status(400).json({ error: "email is required" });
      }

      const { data: existing } = await supabase
        .from("company_invitations")
        .select("id")
        .eq("email", trimmedEmail)
        .eq("company_id", companyId)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return res.status(409).json({
          error: "Invitation already exists",
          details: "There is already a pending invitation for this email",
        });
      }

      const token = randomUUID();
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: invitation, error: inviteError } = await supabase
        .from("company_invitations")
        .insert({
          email: trimmedEmail,
          company_id: companyId,
          token,
          status: "pending",
          created_by: req.user!.id,
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (inviteError) {
        return res.status(500).json({
          error: inviteError.message ?? "Failed to create invitation",
        });
      }

      const { error: allowlistErr } = await supabase.from("allowlist").insert({
        email: trimmedEmail,
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "company_invitation_created",
        source: "invitation",
        note: `Company director invitation for company ${companyId}`,
      });
      if (allowlistErr && (allowlistErr as { code?: string }).code !== "23505") {
        // log but do not fail; invitation is already created
        console.warn("[POST /companies/:id/invitations] Allowlist insert:", allowlistErr);
      }

      const { data: company } = await supabase
        .from("companies")
        .select("company_name")
        .eq("id", companyId)
        .single();

      const { data: inviterAuth } = await supabase.auth.admin.getUserById(
        req.user!.id
      );
      const inviterName =
        inviterAuth?.user?.user_metadata?.full_name ||
        inviterAuth?.user?.user_metadata?.name ||
        inviterAuth?.user?.email ||
        "A team member";

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const acceptUrl = `${frontendUrl}/join-company?token=${token}`;

      try {
        const emailId = await sendCompanyInvitationEmail({
          to: trimmedEmail,
          companyName: company?.company_name ?? "the company",
          inviterName,
          acceptUrl,
        });
        await supabase
          .from("company_invitations")
          .update({ email_id: emailId, email_status: "delivered" })
          .eq("id", invitation.id);
      } catch (mailErr) {
        await supabase
          .from("company_invitations")
          .update({ email_status: "failed" })
          .eq("id", invitation.id);
      }

      res.status(201).json({
        id: invitation.id,
        email: invitation.email,
        company_id: invitation.company_id,
        status: invitation.status,
        created_at: invitation.created_at,
        expires_at: invitation.expires_at,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * DELETE /companies/:id/invitations/:invitationId
 * 招待をキャンセル。認可: 当該会社の admin/director。
 */
router.delete(
  "/:id/invitations/:invitationId",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const companyId = req.params.id;
      const invitationId = req.params.invitationId;
      if (!companyId || !invitationId) {
        return res.status(400).json({ error: "company id and invitation id are required" });
      }

      const allowed = await authorizeUnified(
        req.user!.id,
        UnifiedCompanyAction.manage_invitations,
        { type: "Company", id: companyId }
      );
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this company" });
      }

      const { data: inv, error: fetchErr } = await supabase
        .from("company_invitations")
        .select("id, status")
        .eq("id", invitationId)
        .eq("company_id", companyId)
        .single();

      if (fetchErr || !inv) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      if (inv.status !== "pending") {
        return res.status(400).json({
          error: "Invitation cannot be canceled",
          details: `Invitation is already ${inv.status}`,
        });
      }

      const { error: updateErr } = await supabase
        .from("company_invitations")
        .update({ status: "canceled" })
        .eq("id", invitationId);

      if (updateErr) {
        return res.status(500).json({ error: updateErr.message });
      }

      res.status(200).json({ message: "Invitation canceled" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /companies/:id/tenants
 * その会社に属する tenant 一覧（company_tenants + tenants）。
 */
router.get("/:id/tenants", authMiddleware({ allowNoProfiles: true }), async (req, res) => {
  try {
    const companyId = req.params.id;
    if (!companyId) {
      return res.status(400).json({ error: "company id is required" });
    }

      const allowed = await authorizeUnified(
      req.user!.id,
        UnifiedCompanyAction.list_tenants,
        { type: "Company", id: companyId }
    );
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this company" });
    }

    const { data: links, error: linkError } = await supabase
      .from("company_tenants")
      .select("tenant_id")
      .eq("company_id", companyId);

    if (linkError) {
      return res.status(500).json({ error: linkError.message });
    }

    if (!links || links.length === 0) {
      return res.json({ tenants: [] });
    }

    const tenantIds = links.map((l) => l.tenant_id);
    const { data: tenants, error: tenantsError } = await supabase
      .from("tenants")
      .select("*")
      .in("id", tenantIds);

    if (tenantsError) {
      return res.status(500).json({ error: tenantsError.message });
    }

    res.json({ tenants: tenants ?? [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /companies/:id/tenants
 * その会社に属する tenant を新規作成する。
 * Body: { name, type } (tenant の name と type)。作成者を profiles に admin で追加し、company_tenants に追加する。
 */
router.post(
  "/:id/tenants",
  authMiddleware({ allowNoProfiles: true }),
  async (req, res) => {
    try {
      const companyId = req.params.id;
      if (!companyId) {
        return res.status(400).json({ error: "company id is required" });
      }

      const allowed = await authorizeUnified(
        req.user!.id,
        UnifiedCompanyAction.create_tenant,
        { type: "Company", id: companyId }
      );
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this company" });
      }

      const { name, type } = req.body;

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

      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .insert([{ name, type }])
        .select()
        .single();

      if (tenantError || !tenant) {
        return res.status(500).json({
          error: tenantError?.message ?? "Failed to create tenant",
        });
      }

      const { error: profileError } = await supabase.from("profiles").insert([
        {
          user_id: req.user!.id,
          tenant_id: tenant.id,
          role: "admin",
        },
      ]);

      if (profileError) {
        await supabase.from("tenants").delete().eq("id", tenant.id);
        return res.status(500).json({
          error: profileError.message ?? "Failed to create profile",
        });
      }

      const { error: ctError } = await supabase.from("company_tenants").insert([
        { company_id: companyId, tenant_id: tenant.id },
      ]);

      if (ctError) {
        await supabase
          .from("profiles")
          .delete()
          .eq("user_id", req.user!.id)
          .eq("tenant_id", tenant.id);
        await supabase.from("tenants").delete().eq("id", tenant.id);
        return res.status(500).json({
          error: ctError.message ?? "Failed to link tenant to company",
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

export default router;
