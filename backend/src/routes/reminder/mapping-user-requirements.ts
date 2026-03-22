import { Router } from "express";
import { supabase } from "../../config/supabase";
import { MappingUserRequirement } from "../../types/database";
import { hasAnyCompanyAccess } from "./authorization-helpers";
import {
  getAuthorizedCompanyAdminDirectorCreatorUserIds,
  getCompanyAdminDirectorCompanyIdsForUser,
  getCompanyIdsForUserViaProfiles,
  isUserRequirementAccessibleByCompany,
} from "./authorization-helpers";

const router = Router();

/**
 * GET /mapping-user-requirements
 * 指定した user_ids / user_requirement_ids の組み合わせについて、
 * 各 (user_id, user_requirement_id) の最新1件を返す。
 * 対象は company_admin / company_director が操作可能な要件に紐づくマッピングのみ。
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userIds = req.query.user_ids as string | undefined;
    const requirementIds = req.query.user_requirement_ids as string | undefined;

    const creatorUserIds = await getAuthorizedCompanyAdminDirectorCreatorUserIds(userId);
    if (creatorUserIds.length === 0) {
      return res.json([]);
    }

    // 1 クエリ: user_requirements を INNER JOIN し created_by でフィルタ（2 本のクエリをやめる）
    let query = supabase
      .from("mapping_user_requirements")
      .select(
        "id, user_id, user_requirement_id, issued_date, specific_date, created_at, updated_at, user_requirements!inner(created_by)",
      )
      .in("user_requirements.created_by", creatorUserIds)
      .order("created_at", { ascending: false });

    if (userIds) {
      const ids = userIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length) query = query.in("user_id", ids);
    }
    if (requirementIds) {
      const ids = requirementIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length) query = query.in("user_requirement_id", ids);
    }

    const { data: rows, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // 各 (user_id, user_requirement_id) の最新1件だけ残す（created_at 降順で先頭）。JOIN で付いた user_requirements はレスポンスに含めない
    const seen = new Set<string>();
    const latest: MappingUserRequirement[] = [];
    for (const row of rows ?? []) {
      const key = `${row.user_id}:${row.user_requirement_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push({
        id: row.id,
        user_id: row.user_id,
        user_requirement_id: row.user_requirement_id,
        issued_date: row.issued_date ?? null,
        specific_date: row.specific_date ?? null,
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
 * POST /mapping-user-requirements
 * 新規マッピングを1件作成（更新時も新規 INSERT で履歴を残す）。
 * user_requirement_id は company_admin / company_director が操作可能な要件のみ許可。
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body as {
      user_id?: string;
      user_requirement_id?: string;
      issued_date?: string | null;
      specific_date?: string | null;
    };

    if (!body.user_id || !body.user_requirement_id) {
      return res.status(400).json({
        error: "user_id and user_requirement_id are required",
      });
    }

    const userId = req.user!.id;
    const allowed = await hasAnyCompanyAccess(userId);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }

    const creatorUserIds = await getAuthorizedCompanyAdminDirectorCreatorUserIds(userId);
    if (creatorUserIds.length === 0) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { data: requirement, error: reqError } = await supabase
      .from("user_requirements")
      .select("id, created_by")
      .eq("id", body.user_requirement_id)
      .in("created_by", creatorUserIds)
      .single();

    if (reqError || !requirement) {
      return res.status(404).json({ error: "Requirement not found or access denied" });
    }

    const ok = await isUserRequirementAccessibleByCompany(
      userId,
      requirement.created_by ?? null
    );
    if (!ok || !requirement.created_by) {
      return res.status(403).json({ error: "Access denied" });
    }

    const createdByUserId = requirement.created_by;

    // その要件（created_by）に紐づく company スコープにいるユーザーだけが対象
    const creatorCompanyIds = await getCompanyAdminDirectorCompanyIdsForUser(
      createdByUserId
    );
    const targetCompanyIds = await getCompanyIdsForUserViaProfiles(
      body.user_id
    );
    const inScope = creatorCompanyIds.some((cid) => targetCompanyIds.includes(cid));
    if (!inScope) {
      return res.status(403).json({ error: "Access denied" });
    }

    const row = {
      user_id: body.user_id,
      user_requirement_id: body.user_requirement_id,
      issued_date: body.issued_date ?? null,
      specific_date: body.specific_date ?? null,
    };

    const { data, error } = await supabase
      .from("mapping_user_requirements")
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
