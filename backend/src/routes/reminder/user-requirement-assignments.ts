import { Router } from "express";
import { supabase } from "../../config/supabase";

const router = Router();

/**
 * GET /user-requirement-assignments
 * 自分が作成した要件（created_by = 自分）に紐づく適用状態を返す。
 * Query: user_requirement_ids (optional, comma), user_ids (optional, comma).
 * 返却: { assignments: { user_id, user_requirement_id, is_currently_assigned }[] }
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const requirementIds = req.query.user_requirement_ids as string | undefined;
    const userIds = req.query.user_ids as string | undefined;

    const { data: myRequirementIds } = await supabase
      .from("user_requirements")
      .select("id")
      .eq("created_by", userId);

    const ids = (myRequirementIds ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return res.json({ assignments: [] });
    }

    let assignmentsQuery = supabase
      .from("user_requirement_assignments")
      .select("user_id, user_requirement_id, is_currently_assigned")
      .is("deleted_at", null)
      .in("user_requirement_id", ids);

    if (requirementIds) {
      const reqIds = requirementIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (reqIds.length) assignmentsQuery = assignmentsQuery.in("user_requirement_id", reqIds);
    }
    if (userIds) {
      const uIds = userIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (uIds.length) assignmentsQuery = assignmentsQuery.in("user_id", uIds);
    }

    const { data: rows, error } = await assignmentsQuery;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      assignments: (rows ?? []).map((r) => ({
        user_id: r.user_id,
        user_requirement_id: r.user_requirement_id,
        is_currently_assigned: r.is_currently_assigned,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /user-requirement-assignments
 * Body: { user_id, user_requirement_id, is_currently_assigned: boolean }
 * 指定 (user_id, user_requirement_id) の is_currently_assigned を更新。
 * 要件は created_by = 自分 のもののみ操作可能。
 * レコードが無い場合（Add）は INSERT する（バックフィル未実施時のため）。
 */
router.patch("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { user_id, user_requirement_id, is_currently_assigned } = req.body;

    if (
      typeof user_id !== "string" ||
      typeof user_requirement_id !== "string" ||
      typeof is_currently_assigned !== "boolean"
    ) {
      return res.status(400).json({
        error: "user_id (string), user_requirement_id (string), is_currently_assigned (boolean) are required",
      });
    }

    const { data: requirement, error: reqError } = await supabase
      .from("user_requirements")
      .select("id")
      .eq("id", user_requirement_id)
      .eq("created_by", userId)
      .single();

    if (reqError || !requirement) {
      return res.status(404).json({ error: "Requirement not found or access denied" });
    }

    const { data: existing } = await supabase
      .from("user_requirement_assignments")
      .select("id")
      .eq("user_id", user_id)
      .eq("user_requirement_id", user_requirement_id)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from("user_requirement_assignments")
        .update({ is_currently_assigned })
        .eq("user_id", user_id)
        .eq("user_requirement_id", user_requirement_id);

      if (updateError) {
        return res.status(400).json({ error: updateError.message });
      }
    } else {
      if (!is_currently_assigned) {
        return res.json({ ok: true });
      }
      const { error: insertError } = await supabase.from("user_requirement_assignments").insert({
        user_id,
        user_requirement_id,
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
