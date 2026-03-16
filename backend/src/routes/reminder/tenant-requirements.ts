import { Router } from "express";
import { supabase } from "../../config/supabase";
import { TenantRequirement } from "../../types/database";

const router = Router();

/**
 * GET /tenant-requirements/admin-tenants
 * 現在のユーザーが admin であるテナント一覧（Status タブの Select tenant 用）
 */
router.get("/admin-tenants", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data: profiles, error: profError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "admin");

    if (profError) {
      return res.status(500).json({ error: profError.message });
    }

    const tenantIds = [...new Set((profiles ?? []).map((p) => p.tenant_id))];
    if (tenantIds.length === 0) {
      return res.json({ tenants: [] });
    }

    const { data: tenants, error: tenError } = await supabase
      .from("tenants")
      .select("id, name, type")
      .in("id", tenantIds)
      .order("name", { ascending: true });

    if (tenError) {
      return res.status(500).json({ error: tenError.message });
    }

    res.json({ tenants: tenants ?? [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /tenant-requirements
 * Query: tenant_id (optional).自分が admin であるテナントに属する要件一覧。
 * tenant_id 指定時はそのテナントの要件のみ。
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const tenantId = req.query.tenant_id as string | undefined;

    const { data: profiles } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "admin");

    const adminTenantIds = [...new Set((profiles ?? []).map((p) => p.tenant_id))];
    if (adminTenantIds.length === 0) {
      return res.json([]);
    }

    let query = supabase
      .from("tenant_requirements")
      .select("*")
      .in("tenant_id", adminTenantIds)
      .order("title", { ascending: true });

    if (tenantId && tenantId.trim()) {
      if (!adminTenantIds.includes(tenantId.trim())) {
        return res.status(403).json({ error: "Access denied to this tenant" });
      }
      query = query.eq("tenant_id", tenantId.trim());
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data ?? []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /tenant-requirements/:id
 * 要件1件取得。自分が admin であるテナントの要件のみ。
 */
router.get("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data: profiles } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "admin");
    const adminTenantIds = [...new Set((profiles ?? []).map((p) => p.tenant_id))];

    const { data, error } = await supabase
      .from("tenant_requirements")
      .select("*")
      .eq("id", req.params.id)
      .in("tenant_id", adminTenantIds)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /tenant-requirements
 * Body: title, tenant_id.自分が admin であるテナントにのみ作成可能。
 */
router.post("/", async (req, res) => {
  try {
    const body: Partial<TenantRequirement> & { tenant_id?: string } = req.body;

    if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (!body.tenant_id || typeof body.tenant_id !== "string" || !body.tenant_id.trim()) {
      return res.status(400).json({ error: "tenant_id is required" });
    }

    const userId = req.user!.id;
    const { data: profiles } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "admin");
    const adminTenantIds = [...new Set((profiles ?? []).map((p) => p.tenant_id))];
    if (!adminTenantIds.includes(body.tenant_id.trim())) {
      return res.status(403).json({ error: "Access denied to this tenant" });
    }

    const row = {
      title: body.title.trim(),
      tenant_id: body.tenant_id.trim(),
    };

    const { data, error } = await supabase
      .from("tenant_requirements")
      .insert([row])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /tenant-requirements/:id
 * 要件更新。自分が admin であるテナントの要件のみ。
 */
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const body: Partial<TenantRequirement> = req.body;

    const { data: profiles } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "admin");
    const adminTenantIds = [...new Set((profiles ?? []).map((p) => p.tenant_id))];

    const { data: existing } = await supabase
      .from("tenant_requirements")
      .select("id")
      .eq("id", id)
      .in("tenant_id", adminTenantIds)
      .single();

    if (!existing) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) return res.status(400).json({ error: "title cannot be empty" });
      updates.title = t;
    }

    const { data, error } = await supabase
      .from("tenant_requirements")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /tenant-requirements/:id
 * 要件削除。real_data は ON DELETE CASCADE で削除される。
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const { data: profiles } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "admin");
    const adminTenantIds = [...new Set((profiles ?? []).map((p) => p.tenant_id))];

    const { data: existing } = await supabase
      .from("tenant_requirements")
      .select("id")
      .eq("id", id)
      .in("tenant_id", adminTenantIds)
      .single();

    if (!existing) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    const { error } = await supabase.from("tenant_requirements").delete().eq("id", id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
