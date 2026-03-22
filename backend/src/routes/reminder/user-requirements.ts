import { Router } from "express";
import { supabase } from "../../config/supabase";
import { UserRequirement } from "../../types/database";
import {
  getAuthorizedTenantIds,
  getAuthorizedCompanyAdminDirectorCreatorUserIds,
  isUserRequirementAccessibleByCompany,
  hasAnyCompanyAccess,
} from "./authorization-helpers";

const router = Router();

/**
 * GET /user-requirements
 * company_admin / company_director が操作可能な要件定義一覧を取得
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const creatorUserIds = await getAuthorizedCompanyAdminDirectorCreatorUserIds(userId);
    if (creatorUserIds.length === 0) {
      return res.json([]);
    }

    const { data, error } = await supabase
      .from("user_requirements")
      .select("*")
      .in("created_by", creatorUserIds)
      .order("title", { ascending: true });

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
 * GET /user-requirements/:id
 * 要件定義を1件取得（company_admin / company_director が操作可能なもの）
 */
router.get("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data, error } = await supabase
      .from("user_requirements")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    const ok = await isUserRequirementAccessibleByCompany(
      userId,
      data.created_by
    );
    if (!ok) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /user-requirements
 * 要件定義を作成（created_by に現在ユーザーを設定）
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }

    const body: Partial<UserRequirement> = req.body;

    if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const firstDueDate = body.first_due_date ?? null;
    if (firstDueDate !== null) {
      const n = Number(firstDueDate);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({
          error: "first_due_date must be null or a positive integer (1 or greater)",
        });
      }
    }

    const firstDueOnDate = body.first_due_on_date ?? null;
    if (firstDueOnDate !== null) {
      const s = String(firstDueOnDate).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return res.status(400).json({
          error: "first_due_on_date must be null or a date string YYYY-MM-DD",
        });
      }
    }

    const validityPeriodUnit = body.validity_period_unit ?? null;
    if (validityPeriodUnit !== null && !["years", "months", "days"].includes(validityPeriodUnit)) {
      return res.status(400).json({
        error: "validity_period_unit must be null or one of: years, months, days",
      });
    }

    const row = {
      title: body.title.trim(),
      validity_period: body.validity_period ?? null,
      validity_period_unit: validityPeriodUnit,
      first_due_date: firstDueDate === null ? null : Number(firstDueDate),
      first_due_on_date: firstDueOnDate === null ? null : String(firstDueOnDate).trim(),
      renewal_advance_days: body.renewal_advance_days ?? null,
      expiry_rule: body.expiry_rule ?? null,
      created_by: userId,
    };

    const { data, error } = await supabase
      .from("user_requirements")
      .insert([row])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // 設計: 新規要件作成後、作成者（自分）が admin である全テナントのメンバーに 1 行ずつ user_requirement_assignments を挿入
    const authorizedTenantIds = await getAuthorizedTenantIds(userId);
    if (authorizedTenantIds.length === 0) {
      res.status(201).json(data);
      return;
    }

    const { data: profilesInAdminTenants } = await supabase
      .from("profiles")
      .select("user_id")
      .in("tenant_id", authorizedTenantIds);

    const memberUserIds = [...new Set((profilesInAdminTenants ?? []).map((p) => p.user_id))];
    if (memberUserIds.length > 0) {
      const assignmentRows = memberUserIds.map((user_id) => ({
        user_id,
        user_requirement_id: data.id,
        is_currently_assigned: true,
        deleted_at: null,
      }));
      await supabase.from("user_requirement_assignments").insert(assignmentRows);
    }

    res.status(201).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /user-requirements/:id
 * 要件定義を更新（company_admin / company_director が操作可能なもの）
 */
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { id } = req.params;
    const body: Partial<UserRequirement> = req.body;

    const { data: existing } = await supabase
      .from("user_requirements")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    // existing の時点で created_by は取れていないので、改めて取得して判定する
    const { data: requirementRow } = await supabase
      .from("user_requirements")
      .select("created_by")
      .eq("id", id)
      .single();

    const ok = await isUserRequirementAccessibleByCompany(
      userId,
      requirementRow?.created_by ?? null
    );
    if (!ok) {
      return res.status(403).json({ error: "Access denied" });
    }

    const updates: Partial<UserRequirement> = {
      title: body.title !== undefined ? String(body.title).trim() : undefined,
      validity_period: body.validity_period !== undefined ? body.validity_period : undefined,
      validity_period_unit: body.validity_period_unit !== undefined ? body.validity_period_unit : undefined,
      first_due_date: body.first_due_date !== undefined ? body.first_due_date : undefined,
      first_due_on_date: body.first_due_on_date !== undefined ? body.first_due_on_date : undefined,
      renewal_advance_days: body.renewal_advance_days !== undefined ? body.renewal_advance_days : undefined,
      expiry_rule: body.expiry_rule !== undefined ? body.expiry_rule : undefined,
      updated_at: new Date().toISOString(),
    };

    if (updates.title !== undefined && !updates.title) {
      return res.status(400).json({ error: "title cannot be empty" });
    }

    if (updates.first_due_date !== undefined) {
      const v = updates.first_due_date;
      if (v !== null) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) {
          return res.status(400).json({
            error: "first_due_date must be null or a positive integer (1 or greater)",
          });
        }
        updates.first_due_date = n;
      }
    }

    if (updates.first_due_on_date !== undefined) {
      const v = updates.first_due_on_date;
      if (v !== null) {
        const s = String(v).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          return res.status(400).json({
            error: "first_due_on_date must be null or a date string YYYY-MM-DD",
          });
        }
        updates.first_due_on_date = s;
      }
    }

    if (updates.validity_period_unit !== undefined && updates.validity_period_unit !== null) {
      if (!["years", "months", "days"].includes(updates.validity_period_unit)) {
        return res.status(400).json({
          error: "validity_period_unit must be null or one of: years, months, days",
        });
      }
    }

    const { data, error } = await supabase
      .from("user_requirements")
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
 * DELETE /user-requirements/:id
 * 要件定義を削除（company_admin / company_director が操作可能なもの）
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { id } = req.params;

    const { data: existing } = await supabase
      .from("user_requirements")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    const { data: requirementRow } = await supabase
      .from("user_requirements")
      .select("created_by")
      .eq("id", id)
      .single();

    const ok = await isUserRequirementAccessibleByCompany(
      userId,
      requirementRow?.created_by ?? null
    );
    if (!ok) {
      return res.status(403).json({ error: "Access denied" });
    }

    // 設計: 削除前に user_requirement_assignments の該当全行の deleted_at を設定
    const now = new Date().toISOString();
    await supabase
      .from("user_requirement_assignments")
      .update({ deleted_at: now })
      .eq("user_requirement_id", id);

    const { error } = await supabase.from("user_requirements").delete().eq("id", id);

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
