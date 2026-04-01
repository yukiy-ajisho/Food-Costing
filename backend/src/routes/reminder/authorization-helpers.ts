import { supabase } from "../../config/supabase";
import {
  authorizeUnified,
  UnifiedCompanyAction,
} from "../../authz/unified/authorize";

export async function getAuthorizedCompanyIds(userId: string): Promise<string[]> {
  const { data: members, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId);

  if (error || !members) return [];

  const candidateIds = [...new Set(members.map((m) => m.company_id))];
  const allowed: string[] = [];

  for (const companyId of candidateIds) {
    const ok = await authorizeUnified(
      userId,
      UnifiedCompanyAction.manage_members,
      { type: "Company", id: companyId }
    );
    if (ok) allowed.push(companyId);
  }

  return allowed;
}

export async function hasAnyCompanyAccess(userId: string): Promise<boolean> {
  const companyIds = await getAuthorizedCompanyIds(userId);
  return companyIds.length > 0;
}

export async function getAuthorizedTenantIds(userId: string): Promise<string[]> {
  const companyIds = await getAuthorizedCompanyIds(userId);
  if (companyIds.length === 0) return [];

  const { data: links, error } = await supabase
    .from("company_tenants")
    .select("tenant_id")
    .in("company_id", companyIds);

  if (error || !links) return [];
  return [...new Set(links.map((l) => l.tenant_id))];
}

/** 単一会社に紐づく tenant_id 一覧（ヘッダー company コンテキスト用） */
export async function getTenantIdsForCompany(companyId: string): Promise<string[]> {
  const { data: links, error } = await supabase
    .from("company_tenants")
    .select("tenant_id")
    .eq("company_id", companyId);

  if (error || !links) return [];
  return [...new Set(links.map((l) => l.tenant_id))];
}

const COMPANY_ADMIN_DIRECTOR_ROLES = ["company_admin", "company_director"] as const;

/**
 * company_admin / company_director であり、かつ Cedar で当該会社の manage_members が許可されること。
 * Employee requirements / jurisdictions の会社スコープ操作の入口。
 */
export async function assertCompanyOfficerManageMembers(
  requestUserId: string,
  companyId: string
): Promise<void> {
  const { data: row, error } = await supabase
    .from("company_members")
    .select("role")
    .eq("user_id", requestUserId)
    .eq("company_id", companyId)
    .in("role", [...COMPANY_ADMIN_DIRECTOR_ROLES])
    .maybeSingle();

  if (error || !row) {
    throw Object.assign(new Error("Access denied"), { status: 403 });
  }

  const ok = await authorizeUnified(
    requestUserId,
    UnifiedCompanyAction.manage_members,
    { type: "Company", id: companyId }
  );
  if (!ok) {
    throw Object.assign(new Error("Access denied"), { status: 403 });
  }
}

/**
 * Company admin/director が作成した employee requirements（user_requirements）の
 * created_by 対象 user_id 群を返す。
 */
export async function getAuthorizedCompanyAdminDirectorCreatorUserIds(
  requestUserId: string
): Promise<string[]> {
  const authorizedCompanyIds = await getAuthorizedCompanyIds(requestUserId);
  if (authorizedCompanyIds.length === 0) return [];

  const { data, error } = await supabase
    .from("company_members")
    .select("user_id")
    .in("company_id", authorizedCompanyIds)
    .in("role", COMPANY_ADMIN_DIRECTOR_ROLES);

  if (error || !data) return [];
  return [...new Set(data.map((m) => m.user_id))];
}

/**
 * userId が company_admin/company_director として所属する company_id 群を返す。
 * （user_requirements.created_by の company スコープ導出に使う）
 */
export async function getCompanyAdminDirectorCompanyIdsForUser(
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .in("role", COMPANY_ADMIN_DIRECTOR_ROLES);

  if (error || !data) return [];
  return [...new Set(data.map((r) => r.company_id))];
}

/**
 * profiles + company_tenants を辿って、対象 userId が所属している company_id 群を返す。
 */
export async function getCompanyIdsForUserViaProfiles(userId: string): Promise<string[]> {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userId);

  if (error || !profiles) return [];
  const tenantIds = [...new Set((profiles ?? []).map((p) => p.tenant_id))];
  if (tenantIds.length === 0) return [];

  const { data: links, error: linksError } = await supabase
    .from("company_tenants")
    .select("company_id")
    .in("tenant_id", tenantIds);

  if (linksError || !links) return [];
  return [...new Set(links.map((l) => l.company_id))];
}

/**
 * user_requirements.created_by を起点に、requestUserId がその要件を操作可能か判断する。
 */
export async function isUserRequirementAccessibleByCompany(
  requestUserId: string,
  createdByUserId: string | null
): Promise<boolean> {
  if (!createdByUserId) return false;

  const authorizedCompanyIds = await getAuthorizedCompanyIds(requestUserId);
  if (authorizedCompanyIds.length === 0) return false;

  const creatorCompanyIds = await getCompanyAdminDirectorCompanyIdsForUser(createdByUserId);
  if (creatorCompanyIds.length === 0) return false;

  return creatorCompanyIds.some((cid) => authorizedCompanyIds.includes(cid));
}

/** user_requirements.company_id が、requestUserId の manage_members 対象会社に含まれるか */
export async function isUserRequirementAccessibleByRequirementCompany(
  requestUserId: string,
  requirementCompanyId: string | null
): Promise<boolean> {
  if (!requirementCompanyId) return false;
  const authorizedCompanyIds = await getAuthorizedCompanyIds(requestUserId);
  return authorizedCompanyIds.includes(requirementCompanyId);
}

