import { Router } from "express";
import { supabase } from "../../config/supabase";
import { hasAnyCompanyAccess } from "./authorization-helpers";

const router = Router();

/**
 * GET /tenant-requirement-assignments
 * 自分が作成した要件に紐づく適用状態を返す。
 * Query: tenant_id (optional), tenant_requirement_ids (optional, comma).
 * 返却: { assignments: { tenant_id, tenant_requirement_id, is_currently_assigned }[] }
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const tenantId = req.query.tenant_id as string | undefined;
    const requirementIds = req.query.tenant_requirement_ids as string | undefined;

    const { data: myRequirementIds } = await supabase
      .from("tenant_requirements")
      .select("id")
      .eq("created_by", userId);

    const ids = (myRequirementIds ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return res.json({ assignments: [] });
    }

    let query = supabase
      .from("tenant_requirement_assignments")
      .select("tenant_id, tenant_requirement_id, is_currently_assigned")
      .is("deleted_at", null)
      .in("tenant_requirement_id", ids);

    if (tenantId) {
      const t = String(tenantId).trim();
      if (t) query = query.eq("tenant_id", t);
    }
    if (requirementIds) {
      const reqIds = requirementIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (reqIds.length) query = query.in("tenant_requirement_id", reqIds);
    }

    const { data: rows, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      assignments: (rows ?? [])
        .filter((r) => r.tenant_requirement_id != null)
        .map((r) => ({
          tenant_id: r.tenant_id,
          tenant_requirement_id: r.tenant_requirement_id as string,
          is_currently_assigned: r.is_currently_assigned,
        })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /tenant-requirement-assignments
 * Body: { tenant_id, tenant_requirement_id, is_currently_assigned: boolean }
 * 指定 (tenant_id, tenant_requirement_id) の is_currently_assigned を更新。
 * 要件は created_by = 自分 のもののみ。レコードは既に存在する前提。
 */
router.patch("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { tenant_id, tenant_requirement_id, is_currently_assigned } = req.body;

    if (
      typeof tenant_id !== "string" ||
      typeof tenant_requirement_id !== "string" ||
      typeof is_currently_assigned !== "boolean"
    ) {
      return res.status(400).json({
        error:
          "tenant_id (string), tenant_requirement_id (string), is_currently_assigned (boolean) are required",
      });
    }

    const { data: requirement, error: reqError } = await supabase
      .from("tenant_requirements")
      .select("id")
      .eq("id", tenant_requirement_id)
      .eq("created_by", userId)
      .single();

    if (reqError || !requirement) {
      return res.status(404).json({ error: "Requirement not found or access denied" });
    }

    const { data: existing } = await supabase
      .from("tenant_requirement_assignments")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("tenant_requirement_id", tenant_requirement_id)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from("tenant_requirement_assignments")
        .update({ is_currently_assigned })
        .eq("tenant_id", tenant_id)
        .eq("tenant_requirement_id", tenant_requirement_id);

      if (updateError) {
        return res.status(400).json({ error: updateError.message });
      }
    } else {
      if (!is_currently_assigned) {
        return res.json({ ok: true });
      }
      const { error: insertError } = await supabase
        .from("tenant_requirement_assignments")
        .insert({
          tenant_id,
          tenant_requirement_id,
          is_currently_assigned: true,
          deleted_at: null,
        });

      if (insertError) {
        return res.status(400).json({ error: insertError.message });
      }
    }

    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
