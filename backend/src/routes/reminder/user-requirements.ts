import { Router } from "express";
import { supabase } from "../../config/supabase";
import { UserRequirement } from "../../types/database";
import {
  assertCompanyOfficerManageMembers,
  hasAnyCompanyAccess,
} from "./authorization-helpers";
import { syncAssignmentsForRequirement } from "../../services/employee-requirement-assignment-sync";

const router = Router();

/**
 * GET /user-requirements?company_id=
 * 選択会社に属する従業員要件一覧
 */
router.get("/", async (req, res) => {
  try {
    const profileUserId = req.user!.id;
    const companyId = (req.query.company_id as string | undefined)?.trim();
    if (!companyId) {
      return res.status(400).json({ error: "company_id is required" });
    }

    try {
      await assertCompanyOfficerManageMembers(profileUserId, companyId);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const { data, error } = await supabase
      .from("user_requirements")
      .select("*")
      .eq("company_id", companyId)
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
 */
router.get("/:id", async (req, res) => {
  try {
    const profileUserId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(profileUserId);
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

    try {
      await assertCompanyOfficerManageMembers(profileUserId, data.company_id);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /user-requirements
 * Body: company_id, jurisdiction_id, title, ... 全員一括 assign は行わない。
 */
router.post("/", async (req, res) => {
  try {
    const profileUserId = req.user!.id;
    const body = req.body as Partial<UserRequirement> & {
      company_id?: string;
      jurisdiction_id?: string;
    };

    const companyId = (body.company_id as string | undefined)?.trim();
    const jurisdictionId = (body.jurisdiction_id as string | undefined)?.trim();

    if (!companyId || !jurisdictionId) {
      return res.status(400).json({
        error: "company_id and jurisdiction_id are required",
      });
    }

    try {
      await assertCompanyOfficerManageMembers(profileUserId, companyId);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const { data: jur } = await supabase
      .from("jurisdictions")
      .select("id")
      .eq("id", jurisdictionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!jur) {
      return res.status(400).json({ error: "Invalid jurisdiction for this company" });
    }

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
    if (
      validityPeriodUnit !== null &&
      !["years", "months", "days"].includes(validityPeriodUnit)
    ) {
      return res.status(400).json({
        error: "validity_period_unit must be null or one of: years, months, days",
      });
    }

    const row = {
      title: body.title.trim(),
      validity_period: body.validity_period ?? null,
      validity_period_unit: validityPeriodUnit,
      first_due_date:
        firstDueDate === null ? null : Number(firstDueDate),
      first_due_on_date:
        firstDueOnDate === null ? null : String(firstDueOnDate).trim(),
      renewal_advance_days: body.renewal_advance_days ?? null,
      expiry_rule: body.expiry_rule ?? null,
      created_by: profileUserId,
      company_id: companyId,
      jurisdiction_id: jurisdictionId,
    };

    const { data, error } = await supabase
      .from("user_requirements")
      .insert([row])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    await syncAssignmentsForRequirement(companyId, data.id);

    res.status(201).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /user-requirements/:id
 */
router.put("/:id", async (req, res) => {
  try {
    const profileUserId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(profileUserId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { id } = req.params;
    const body = req.body as Partial<UserRequirement> & {
      jurisdiction_id?: string;
    };

    const { data: existingRow } = await supabase
      .from("user_requirements")
      .select("id, company_id, jurisdiction_id")
      .eq("id", id)
      .single();

    if (!existingRow) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    try {
      await assertCompanyOfficerManageMembers(profileUserId, existingRow.company_id);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    const prevJurisdictionId = existingRow.jurisdiction_id;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) return res.status(400).json({ error: "title cannot be empty" });
      updates.title = t;
    }
    if (body.validity_period !== undefined) updates.validity_period = body.validity_period;
    if (body.validity_period_unit !== undefined) {
      const u = body.validity_period_unit;
      if (u !== null && !["years", "months", "days"].includes(u)) {
        return res.status(400).json({
          error: "validity_period_unit must be null or one of: years, months, days",
        });
      }
      updates.validity_period_unit = u;
    }
    if (body.first_due_date !== undefined) {
      const v = body.first_due_date;
      if (v !== null) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) {
          return res.status(400).json({
            error: "first_due_date must be null or a positive integer (1 or greater)",
          });
        }
        updates.first_due_date = n;
      } else {
        updates.first_due_date = null;
      }
    }
    if (body.first_due_on_date !== undefined) {
      const v = body.first_due_on_date;
      if (v !== null) {
        const s = String(v).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          return res.status(400).json({
            error: "first_due_on_date must be null or a date string YYYY-MM-DD",
          });
        }
        updates.first_due_on_date = s;
      } else {
        updates.first_due_on_date = null;
      }
    }
    if (body.renewal_advance_days !== undefined) {
      updates.renewal_advance_days = body.renewal_advance_days;
    }
    if (body.expiry_rule !== undefined) updates.expiry_rule = body.expiry_rule;

    if (body.jurisdiction_id !== undefined) {
      const jid = String(body.jurisdiction_id).trim();
      const { data: jur } = await supabase
        .from("jurisdictions")
        .select("id")
        .eq("id", jid)
        .eq("company_id", existingRow.company_id)
        .maybeSingle();
      if (!jur) {
        return res.status(400).json({ error: "Invalid jurisdiction for this company" });
      }
      updates.jurisdiction_id = jid;
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

    if (
      body.jurisdiction_id !== undefined &&
      data.jurisdiction_id !== prevJurisdictionId
    ) {
      await syncAssignmentsForRequirement(existingRow.company_id, id);
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /user-requirements/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const profileUserId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(profileUserId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { id } = req.params;

    const { data: existingRow } = await supabase
      .from("user_requirements")
      .select("id, company_id")
      .eq("id", id)
      .single();

    if (!existingRow) {
      return res.status(404).json({ error: "Requirement not found" });
    }

    try {
      await assertCompanyOfficerManageMembers(profileUserId, existingRow.company_id);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

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
