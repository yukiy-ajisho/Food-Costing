import { Router } from "express";
import { supabase } from "../../config/supabase";
import { assertCompanyOfficerManageMembers } from "./authorization-helpers";

const router = Router();

/**
 * GET /jurisdictions?company_id=
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
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const { data, error } = await supabase
      .from("jurisdictions")
      .select("id, company_id, name, created_by, created_at, updated_at")
      .eq("company_id", companyId)
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /jurisdictions
 * Body: { company_id, name }
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const companyId = (req.body?.company_id as string | undefined)?.trim();
    const name = (req.body?.name as string | undefined)?.trim();
    if (!companyId || !name) {
      return res.status(400).json({ error: "company_id and name are required" });
    }
    try {
      await assertCompanyOfficerManageMembers(userId, companyId);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const { data, error } = await supabase
      .from("jurisdictions")
      .insert({
        company_id: companyId,
        name,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      if (
        error.message.includes("duplicate key") ||
        error.code === "23505"
      ) {
        return res.status(409).json({ error: "A jurisdiction with this name already exists" });
      }
      return res.status(400).json({ error: error.message });
    }
    res.status(201).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /jurisdictions/:id
 * Body: { name }
 */
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id?.trim();
    const name = (req.body?.name as string | undefined)?.trim();
    if (!id) return res.status(400).json({ error: "id required" });
    if (!name) return res.status(400).json({ error: "name is required" });

    const { data: row, error: fe } = await supabase
      .from("jurisdictions")
      .select("id, company_id")
      .eq("id", id)
      .maybeSingle();
    if (fe || !row) return res.status(404).json({ error: "Not found" });

    try {
      await assertCompanyOfficerManageMembers(userId, row.company_id);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const { data, error } = await supabase
      .from("jurisdictions")
      .update({ name })
      .eq("id", id)
      .select("id, company_id, name, created_by, created_at, updated_at")
      .single();
    if (error) {
      if (
        error.message.includes("duplicate key") ||
        error.code === "23505"
      ) {
        return res
          .status(409)
          .json({ error: "A jurisdiction with this name already exists" });
      }
      return res.status(400).json({ error: error.message });
    }
    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /jurisdictions/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: "id required" });

    const { data: row, error: fe } = await supabase
      .from("jurisdictions")
      .select("id, company_id")
      .eq("id", id)
      .maybeSingle();

    if (fe || !row) return res.status(404).json({ error: "Not found" });

    try {
      await assertCompanyOfficerManageMembers(userId, row.company_id);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const { error } = await supabase.from("jurisdictions").delete().eq("id", id);
    if (error) {
      if (error.code === "23503") {
        return res.status(409).json({
          error: "Cannot delete: requirements or user links still reference this jurisdiction",
        });
      }
      return res.status(400).json({ error: error.message });
    }
    res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
