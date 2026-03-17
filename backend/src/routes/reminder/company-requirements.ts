import { Router } from "express";
import { supabase } from "../../config/supabase";
import { CompanyRequirement } from "../../types/database";

const router = Router();

/**
 * GET /company-requirements/admin-companies
 * 現在のユーザーが company_admin または company_director である会社一覧（Select company 用）
 */
router.get("/admin-companies", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data: members, error: memError } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .in("role", ["company_admin", "company_director"]);

    if (memError) {
      return res.status(500).json({ error: memError.message });
    }

    const companyIds = [...new Set((members ?? []).map((m) => m.company_id))];
    if (companyIds.length === 0) {
      return res.json({ companies: [] });
    }

    const { data: companies, error: compError } = await supabase
      .from("companies")
      .select("id, company_name")
      .in("id", companyIds)
      .order("company_name", { ascending: true });

    if (compError) {
      return res.status(500).json({ error: compError.message });
    }

    res.json({ companies: companies ?? [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /company-requirements
 * Query: company_id (optional). 自分がアクセス可能な会社に属する要件一覧。
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const companyId = req.query.company_id as string | undefined;

    const { data: members } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .in("role", ["company_admin", "company_director"]);

    const accessCompanyIds = [...new Set((members ?? []).map((m) => m.company_id))];
    if (accessCompanyIds.length === 0) {
      return res.json([]);
    }

    let query = supabase
      .from("company_requirements")
      .select("*")
      .in("company_id", accessCompanyIds)
      .order("title", { ascending: true });

    if (companyId && companyId.trim()) {
      if (!accessCompanyIds.includes(companyId.trim())) {
        return res.status(403).json({ error: "Access denied to this company" });
      }
      query = query.eq("company_id", companyId.trim());
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
 * GET /company-requirements/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data: members } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .in("role", ["company_admin", "company_director"]);
    const accessCompanyIds = [...new Set((members ?? []).map((m) => m.company_id))];

    const { data, error } = await supabase
      .from("company_requirements")
      .select("*")
      .eq("id", req.params.id)
      .in("company_id", accessCompanyIds)
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
 * POST /company-requirements
 * Body: title, company_id.
 */
router.post("/", async (req, res) => {
  try {
    const body: Partial<CompanyRequirement> & { company_id?: string } = req.body;

    if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (!body.company_id || typeof body.company_id !== "string" || !body.company_id.trim()) {
      return res.status(400).json({ error: "company_id is required" });
    }

    const userId = req.user!.id;
    const { data: members } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .in("role", ["company_admin", "company_director"]);
    const accessCompanyIds = [...new Set((members ?? []).map((m) => m.company_id))];
    if (!accessCompanyIds.includes(body.company_id.trim())) {
      return res.status(403).json({ error: "Access denied to this company" });
    }

    const row = {
      title: body.title.trim(),
      company_id: body.company_id.trim(),
    };

    const { data, error } = await supabase
      .from("company_requirements")
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
 * PUT /company-requirements/:id
 */
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const body: Partial<CompanyRequirement> = req.body;

    const { data: members } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .in("role", ["company_admin", "company_director"]);
    const accessCompanyIds = [...new Set((members ?? []).map((m) => m.company_id))];

    const { data: existing } = await supabase
      .from("company_requirements")
      .select("id")
      .eq("id", id)
      .in("company_id", accessCompanyIds)
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
      .from("company_requirements")
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
 * DELETE /company-requirements/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const { data: members } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .in("role", ["company_admin", "company_director"]);
    const accessCompanyIds = [...new Set((members ?? []).map((m) => m.company_id))];

    const { data: existing } = await supabase
      .from("company_requirements")
      .select("id")
      .eq("id", id)
      .in("company_id", accessCompanyIds)
      .single();

    if (!existing) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    const { error } = await supabase.from("company_requirements").delete().eq("id", id);

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
