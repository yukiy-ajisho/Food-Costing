import { Router } from "express";
import { supabase } from "../../config/supabase";
import { assertCompanyOfficerManageMembers } from "./authorization-helpers";
import {
  syncAssignmentsAfterUserJurisdictionRemoved,
  syncAssignmentsForUserJurisdictionLink,
} from "../../services/employee-requirement-assignment-sync";

const router = Router();

/**
 * GET /user-jurisdictions?company_id=
 * 当該会社の user_jurisdictions 全件（UI で従業員×管轄マトリクス用）
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
      .from("user_jurisdictions")
      .select("company_id, user_id, jurisdiction_id, created_at")
      .eq("company_id", companyId);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /user-jurisdictions
 * Body: { company_id, user_id, jurisdiction_id }
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const companyId = (req.body?.company_id as string | undefined)?.trim();
    const targetUserId = (req.body?.user_id as string | undefined)?.trim();
    const jurisdictionId = (req.body?.jurisdiction_id as string | undefined)?.trim();
    if (!companyId || !targetUserId || !jurisdictionId) {
      return res.status(400).json({
        error: "company_id, user_id, jurisdiction_id are required",
      });
    }
    try {
      await assertCompanyOfficerManageMembers(userId, companyId);
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

    const { data, error } = await supabase
      .from("user_jurisdictions")
      .insert({
        company_id: companyId,
        user_id: targetUserId,
        jurisdiction_id: jurisdictionId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "This user already has this jurisdiction" });
      }
      return res.status(400).json({ error: error.message });
    }

    await syncAssignmentsForUserJurisdictionLink(
      companyId,
      targetUserId,
      jurisdictionId
    );

    res.status(201).json(data);
  } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("user_jurisdictions:")) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: message });
  }
});

/**
 * DELETE /user-jurisdictions?company_id=&user_id=&jurisdiction_id=
 */
router.delete("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const companyId = (req.query.company_id as string | undefined)?.trim();
    const targetUserId = (req.query.user_id as string | undefined)?.trim();
    const jurisdictionId = (req.query.jurisdiction_id as string | undefined)?.trim();
    if (!companyId || !targetUserId || !jurisdictionId) {
      return res.status(400).json({
        error: "company_id, user_id, jurisdiction_id query params are required",
      });
    }
    try {
      await assertCompanyOfficerManageMembers(userId, companyId);
    } catch (e: unknown) {
      if ((e as Error & { status?: number }).status === 403) {
        return res.status(403).json({ error: "Access denied" });
      }
      throw e;
    }

    await syncAssignmentsAfterUserJurisdictionRemoved(
      companyId,
      targetUserId,
      jurisdictionId
    );

    const { error } = await supabase
      .from("user_jurisdictions")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .eq("jurisdiction_id", jurisdictionId);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
