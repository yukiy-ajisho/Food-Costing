import { supabase } from "../config/supabase";

/** company 配下テナントの profiles にいる user_id（一意） */
export async function getEmployeePoolUserIdsForCompany(
  companyId: string
): Promise<string[]> {
  const { data: links, error: le } = await supabase
    .from("company_tenants")
    .select("tenant_id")
    .eq("company_id", companyId);
  if (le || !links?.length) return [];
  const tenantIds = [...new Set(links.map((l) => l.tenant_id))];
  const { data: profs, error: pe } = await supabase
    .from("profiles")
    .select("user_id")
    .in("tenant_id", tenantIds);
  if (pe || !profs) return [];
  return [...new Set(profs.map((p) => p.user_id))];
}

/**
 * 要件に対し、プールかつ管轄一致のユーザに assignment を付与し、
 * プール内で管轄外になったユーザは is_currently_assigned を false にする。
 */
export async function syncAssignmentsForRequirement(
  companyId: string,
  requirementId: string
): Promise<void> {
  const { data: req, error: re } = await supabase
    .from("user_requirements")
    .select("id, jurisdiction_id, company_id")
    .eq("id", requirementId)
    .maybeSingle();
  if (re || !req || req.company_id !== companyId) return;

  const pool = await getEmployeePoolUserIdsForCompany(companyId);
  const poolSet = new Set(pool);

  const { data: ujRows } = await supabase
    .from("user_jurisdictions")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("jurisdiction_id", req.jurisdiction_id);

  const withJur = new Set((ujRows ?? []).map((r) => r.user_id));
  const eligible = pool.filter((uid) => withJur.has(uid));
  const eligibleSet = new Set(eligible);

  for (const uid of eligible) {
    const { error } = await supabase.from("user_requirement_assignments").upsert(
      {
        user_id: uid,
        user_requirement_id: requirementId,
        is_currently_assigned: true,
        deleted_at: null,
      },
      { onConflict: "user_id,user_requirement_id" }
    );
    if (error) throw new Error(error.message);
  }

  const { data: assignedRows } = await supabase
    .from("user_requirement_assignments")
    .select("user_id")
    .eq("user_requirement_id", requirementId);

  for (const row of assignedRows ?? []) {
    const uid = row.user_id;
    if (!poolSet.has(uid)) continue;
    if (!eligibleSet.has(uid)) {
      const { error } = await supabase
        .from("user_requirement_assignments")
        .update({ is_currently_assigned: false })
        .eq("user_requirement_id", requirementId)
        .eq("user_id", uid);
      if (error) throw new Error(error.message);
    }
  }
}

/** ユーザに管轄を付与したあと、その管轄の全要件へ割当を付ける */
export async function syncAssignmentsForUserJurisdictionLink(
  companyId: string,
  userId: string,
  jurisdictionId: string
): Promise<void> {
  const pool = await getEmployeePoolUserIdsForCompany(companyId);
  if (!pool.includes(userId)) return;

  const { data: reqs } = await supabase
    .from("user_requirements")
    .select("id")
    .eq("company_id", companyId)
    .eq("jurisdiction_id", jurisdictionId);

  for (const r of reqs ?? []) {
    const { error } = await supabase.from("user_requirement_assignments").upsert(
      {
        user_id: userId,
        user_requirement_id: r.id,
        is_currently_assigned: true,
        deleted_at: null,
      },
      { onConflict: "user_id,user_requirement_id" }
    );
    if (error) throw new Error(error.message);
  }
}

/** 管轄リンク削除後、その管轄の要件の割当を当該ユーザだけ外す */
export async function syncAssignmentsAfterUserJurisdictionRemoved(
  companyId: string,
  userId: string,
  jurisdictionId: string
): Promise<void> {
  const { data: reqs } = await supabase
    .from("user_requirements")
    .select("id")
    .eq("company_id", companyId)
    .eq("jurisdiction_id", jurisdictionId);

  for (const r of reqs ?? []) {
    const { error } = await supabase
      .from("user_requirement_assignments")
      .update({ is_currently_assigned: false })
      .eq("user_requirement_id", r.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}
