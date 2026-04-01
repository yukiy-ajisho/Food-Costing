import { Router } from "express";
import { supabase } from "../../config/supabase";
import { MappingTenantRequirement } from "../../types/database";
import {
  getAuthorizedTenantIds,
  hasAnyCompanyAccess,
} from "./authorization-helpers";

const router = Router();

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * GET /mapping-tenant-requirements
 * tenant_id（必須）、tenant_requirement_ids（任意）で、各 (tenant_id, tenant_requirement_id) の最新1件を返す。
 * 自分が作成した要件（created_by = 自分）に紐づくマッピングのみ。
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

    if (!tenantId || !tenantId.trim()) {
      return res.status(400).json({ error: "tenant_id is required" });
    }
    const authorizedTenantIds = await getAuthorizedTenantIds(userId);
    if (!authorizedTenantIds.includes(tenantId.trim())) {
      return res.status(403).json({ error: "Access denied to this tenant" });
    }

    const { data: myRequirementIds } = await supabase
      .from("tenant_requirements")
      .select("id")
      .eq("created_by", userId);

    const reqIds = (myRequirementIds ?? []).map((r) => r.id);
    if (reqIds.length === 0) {
      return res.json([]);
    }

    let query = supabase
      .from("mapping_tenant_requirements")
      .select("id, tenant_id, tenant_requirement_id, due_date, pay_date, notice_date, created_at, updated_at")
      .eq("tenant_id", tenantId.trim())
      .in("tenant_requirement_id", reqIds)
      .order("created_at", { ascending: false });

    if (requirementIds) {
      const ids = requirementIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length) query = query.in("tenant_requirement_id", ids);
    }

    const { data: rows, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const seen = new Set<string>();
    const latest: MappingTenantRequirement[] = [];
    for (const row of rows ?? []) {
      const key = row.tenant_requirement_id;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push({
        id: row.id,
        tenant_id: row.tenant_id,
        tenant_requirement_id: row.tenant_requirement_id,
        due_date: row.due_date ?? null,
        pay_date: row.pay_date ?? null,
        notice_date: row.notice_date ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }

    res.json(latest);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /mapping-tenant-requirements
 * 編集 = 最新1件を更新、なければ新規1行作成。
 * Body: tenant_id, tenant_requirement_id, due_date?, pay_date?, notice_date?
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body as {
      tenant_id?: string;
      tenant_requirement_id?: string;
      due_date?: string | null;
      pay_date?: string | null;
      notice_date?: string | null;
    };

    if (!body.tenant_id || !body.tenant_requirement_id) {
      return res.status(400).json({
        error: "tenant_id and tenant_requirement_id are required",
      });
    }

    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const authorizedTenantIds = await getAuthorizedTenantIds(userId);
    if (!authorizedTenantIds.includes(body.tenant_id)) {
      return res.status(403).json({ error: "Access denied to this tenant" });
    }

    const { data: requirement, error: reqError } = await supabase
      .from("tenant_requirements")
      .select("id")
      .eq("id", body.tenant_requirement_id)
      .eq("created_by", userId)
      .single();

    if (reqError || !requirement) {
      return res.status(404).json({ error: "Requirement not found or access denied" });
    }

    const dueDate = parseDate(body.due_date);
    const payDate = parseDate(body.pay_date);
    const noticeDate = parseDate(body.notice_date);

    const { data: latestRows } = await supabase
      .from("mapping_tenant_requirements")
      .select("id")
      .eq("tenant_id", body.tenant_id)
      .eq("tenant_requirement_id", body.tenant_requirement_id)
      .order("created_at", { ascending: false })
      .limit(1);

    const latest = latestRows?.[0];

    if (latest) {
      const { data, error } = await supabase
        .from("mapping_tenant_requirements")
        .update({
          due_date: dueDate,
          pay_date: payDate,
          notice_date: noticeDate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", latest.id)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }
      return res.json(data);
    }

    const row = {
      tenant_id: body.tenant_id,
      tenant_requirement_id: body.tenant_requirement_id,
      due_date: dueDate,
      pay_date: payDate,
      notice_date: noticeDate,
    };

    const { data, error } = await supabase
      .from("mapping_tenant_requirements")
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

export default router;
