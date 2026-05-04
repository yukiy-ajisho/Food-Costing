import {
  isAuthorized,
  type AuthorizationCall,
  type AuthorizationAnswer,
  type PolicySet,
  type Entities,
  type EntityUid,
  type Context as CedarContext,
  type Schema,
  type CedarValueJson,
} from "@cedar-policy/cedar-wasm/nodejs";
import * as fs from "fs";
import * as path from "path";
import { supabase } from "../../config/supabase";
import type { ResourceShare } from "../../types/database";
import {
  filterResourceSharesForPrincipal,
  getResourceShares,
  isExcluded,
  isShared,
  getAllowedActions,
} from "../resource-shares";

let unifiedPolicySetText: string | null = null;
let unifiedSchemaText: string | Record<string, unknown> | null = null;

/**
 * Unified Cedar authorizer を初期化（unified/schema.json と unified/policies.cedar を読み込む）
 */
export function initializeUnifiedAuthorizer(): void {
  try {
    const schemaPath = path.join(__dirname, "schema.json");
    const policiesPath = path.join(__dirname, "policies.cedar");
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    unifiedSchemaText = JSON.parse(schemaContent);
    unifiedPolicySetText = fs.readFileSync(policiesPath, "utf-8");
    console.log("Unified Cedar Authorizer initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Unified Cedar Authorizer:", error);
    throw error;
  }
}

/** Company スコープ Action（計画書 2.1） */
export const UnifiedCompanyAction = {
  manage_members: "company::manage_members",
  manage_invitations: "company::manage_invitations",
  list_tenants: "company::list_tenants",
  create_tenant: "company::create_tenant",
  /** Team ページ: 会社ロールのみでテナントのメンバー・招待・名称などを扱う */
  manage_tenant_team: "company::manage_tenant_team",
} as const;

/** Tenant スコープ Action（計画書 2.2） */
export const UnifiedTenantAction = {
  list_resources: "tenant::list_resources",
  read_resource: "tenant::read_resource",
  create_item: "tenant::create_item",
  update_item: "tenant::update_item",
  delete_item: "tenant::delete_item",
  create_recipe: "tenant::create_recipe",
  update_recipe: "tenant::update_recipe",
  delete_recipe: "tenant::delete_recipe",
  manage_settings: "tenant::manage_settings",
  manage_tenant: "tenant::manage_tenant",
  manage_members: "tenant::manage_members",
} as const;

type LegacyCrudAction = "read" | "create" | "update" | "delete";

function mapTenantActionToLegacyCrud(actionId: string): LegacyCrudAction {
  switch (actionId) {
    case UnifiedTenantAction.read_resource:
    case UnifiedTenantAction.list_resources:
      return "read";
    case UnifiedTenantAction.create_item:
    case UnifiedTenantAction.create_recipe:
      return "create";
    case UnifiedTenantAction.update_item:
    case UnifiedTenantAction.update_recipe:
      return "update";
    case UnifiedTenantAction.delete_item:
    case UnifiedTenantAction.delete_recipe:
      return "delete";
    // manage_settings は resource_shares と無関係なので任意
    default:
      return "read";
  }
}

function normalizeTenantRoleForShares(tenantRole: string | undefined): string {
  // director は shares の target_type=role では admin と同等扱い
  if (!tenantRole) return "";
  return tenantRole === "director" ? "admin" : tenantRole;
}

function normalizeTenantRoleForPolicy(
  tenantRole: string | undefined,
): string | undefined {
  if (!tenantRole) return undefined;
  // company 経由で見えている会社オフィサーは、tenant 認可では director 相当として扱う
  if (tenantRole === "company") return "director";
  return tenantRole;
}

/** 統一認可のリソース入力 */
export type UnifiedResource =
  | { type: "Company"; id: string }
  | { type: "Tenant"; id: string; company_id?: string }
  | {
      type: "CostResource";
      id: string;
      resourceType: string;
      tenant_id: string;
      owner_tenant_id?: string;
      item_kind?: string;
      user_id?: string;
      responsible_user_id?: string;
    };

/** 統一認可のコンテキスト（request 固有のみ。role は Principal に載せる） */
export interface UnifiedContext {
  is_owner?: boolean;
  is_shared?: boolean;
  is_cross_tenant_shared?: boolean;
}

/** authorizeUnified のオプション */
export interface UnifiedAuthorizeOptions {
  tenantId?: string;
  tenantRole?: string;
  /**
   * 同一 HTTP リクエスト内で resource_shares をまとめて取得したときに渡す。
   * 値は DB の生行（プリンシパル未フィルタ）。各 CostResource 判定時に
   * filterResourceSharesForPrincipal を適用する。
   * 渡す場合は、評価しうる resource.id それぞれについてキーを持つ Map を推奨（欠けた id は getResourceShares にフォールバック）。
   */
  prefetchedRawSharesByResourceId?: Map<string, ResourceShare[]>;
}

/**
 * CostResource 判定用: バッチ取得済みならメモリ上でフィルタ、否则 1 件クエリ。
 */
async function resolveResourceSharesForPrincipal(
  resourceType: string,
  resourceId: string,
  principalTenantId: string,
  principalRole: string,
  principalId: string,
  prefetched: Map<string, ResourceShare[]> | undefined,
): Promise<ResourceShare[]> {
  if (prefetched !== undefined && prefetched.has(resourceId)) {
    const raw = prefetched.get(resourceId)!;
    return filterResourceSharesForPrincipal(
      raw,
      principalTenantId,
      principalRole,
      principalId,
    );
  }
  return getResourceShares(
    resourceType,
    resourceId,
    principalTenantId,
    principalRole,
    principalId,
  );
}

/**
 * cross_tenant_item_shares を参照して、principalTenantId が itemId を閲覧できるか確認する。
 * target_type='company' かつ同じ company_id、または target_type='tenant' かつ自分のテナントID が
 * 対象で allowed_actions に 'read' が含まれる場合に true を返す。
 */
async function isCrossTenantSharedForPrincipal(
  itemId: string,
  itemTenantId: string,
  principalTenantId: string,
): Promise<boolean> {
  // 自分のテナントのアイテムは cross-tenant ではない
  if (itemTenantId === principalTenantId) return false;

  // 2つのテナントが同じ company に属しているか確認
  const { data: companyLinks } = await supabase
    .from("company_tenants")
    .select("company_id, tenant_id")
    .in("tenant_id", [itemTenantId, principalTenantId]);

  if (!companyLinks || companyLinks.length < 2) return false;

  const ownerCompanyIds = companyLinks
    .filter((r) => r.tenant_id === itemTenantId)
    .map((r) => r.company_id);
  const viewerCompanyIds = companyLinks
    .filter((r) => r.tenant_id === principalTenantId)
    .map((r) => r.company_id);

  // 共通の company_id を探す
  const sharedCompanyId = ownerCompanyIds.find((id) =>
    viewerCompanyIds.includes(id),
  );
  if (!sharedCompanyId) return false;

  // cross_tenant_item_shares を確認
  const { data: shares } = await supabase
    .from("cross_tenant_item_shares")
    .select("allowed_actions")
    .eq("item_id", itemId)
    .eq("company_id", sharedCompanyId)
    .or(
      `and(target_type.eq.company,target_id.eq.${sharedCompanyId}),and(target_type.eq.tenant,target_id.eq.${principalTenantId})`,
    );

  if (!shares || shares.length === 0) return false;

  // allowed_actions に 'read' が含まれるレコードが 1 つでもあれば OK
  return shares.some(
    (s) =>
      Array.isArray(s.allowed_actions) && s.allowed_actions.includes("read"),
  );
}

/**
 * company_members から当該ユーザーの当該会社のロールを取得する。
 */
async function getCompanyRole(
  userId: string,
  companyId: string,
): Promise<string | null> {
  const { data: member, error } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .in("role", ["company_admin", "company_director"])
    .maybeSingle();

  if (error || !member) return null;
  return member.role;
}

/**
 * テナントの profiles が無い場合でも、親会社で manage_members（Cedar）が通るなら
 * そのテナントを「一覧に載せる」ために list_resources を許可する。
 */
async function canListTenantViaCompanyManageMembers(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data: link, error } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !link?.company_id) return false;
  return authorizeUnified(userId, UnifiedCompanyAction.manage_members, {
    type: "Company",
    id: link.company_id,
  });
}

/**
 * profiles から当該ユーザーの当該テナントのロールを取得する。
 */
async function getTenantRole(
  userId: string,
  tenantId: string,
): Promise<string | null> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !profile) return null;
  return profile.role;
}

/**
 * 統一認可: 1つの authorize 入口。
 * 入力正規化: company スコープは company_members から company_role、
 * tenant スコープは profiles から tenant_role / tenant_id を取得し Principal に載せる。
 *
 * @param userId - 認可対象ユーザー ID
 * @param action - Action ID（company::* または tenant::*）
 * @param resource - Company / Tenant / CostResource のいずれか
 * @param context - リクエスト固有のみ（is_owner, is_shared 等）。role は渡さない
 * @param options - 呼び出し元が既に持っている場合は tenantId/tenantRole / バッチ shares を渡す（省略時は DB 取得）
 */
export async function authorizeUnified(
  userId: string,
  action: string,
  resource: UnifiedResource,
  context?: UnifiedContext,
  options?: UnifiedAuthorizeOptions,
): Promise<boolean> {
  if (!unifiedPolicySetText || !unifiedSchemaText) {
    console.error(
      "Unified Authorizer not initialized. Call initializeUnifiedAuthorizer() first.",
    );
    return false;
  }

  const isCompanyScope = action.startsWith("company::");
  const isTenantScope = action.startsWith("tenant::");
  if (!isCompanyScope && !isTenantScope) {
    console.error("Unified authorize: unknown action scope:", action);
    return false;
  }

  try {
    const principalAttrs: Record<string, CedarValueJson> = { id: userId };

    if (isCompanyScope) {
      const isManageTenantTeam =
        action === UnifiedCompanyAction.manage_tenant_team;

      if (isManageTenantTeam) {
        if (resource.type !== "Tenant") {
          console.error(
            "Unified authorize: manage_tenant_team requires Tenant resource",
          );
          return false;
        }
        let companyId = resource.company_id;
        if (!companyId) {
          const { data, error } = await supabase
            .from("company_tenants")
            .select("company_id")
            .eq("tenant_id", resource.id)
            .maybeSingle();
          if (error || !data?.company_id) {
            console.error(
              "Unified authorize: failed to resolve company_id for tenant (team)",
              error,
            );
            return false;
          }
          companyId = data.company_id;
        }
        const companyRole = await getCompanyRole(userId, companyId);
        if (!companyRole) {
          return false;
        }
        principalAttrs.company_role = companyRole;
      } else {
        if (resource.type !== "Company") {
          console.error(
            "Unified authorize: company action requires Company resource",
          );
          return false;
        }
        const companyRole = await getCompanyRole(userId, resource.id);
        if (companyRole) principalAttrs.company_role = companyRole;
      }
    } else {
      const tenantId =
        options?.tenantId ??
        (resource.type === "Tenant"
          ? resource.id
          : resource.type === "CostResource"
            ? resource.tenant_id
            : undefined);
      if (!tenantId) {
        console.error("Unified authorize: tenant scope requires tenant_id");
        return false;
      }
      const tenantRoleRaw =
        options?.tenantRole ?? (await getTenantRole(userId, tenantId));
      const tenantRole = normalizeTenantRoleForPolicy(tenantRoleRaw);

      // profiles が無くても会社オフィサーなら Tenant コンテナの list_resources のみ許可
      if (
        action === UnifiedTenantAction.list_resources &&
        resource.type === "Tenant" &&
        !tenantRole
      ) {
        const viaCompany = await canListTenantViaCompanyManageMembers(
          userId,
          tenantId,
        );
        return viaCompany;
      }

      if (tenantRole) {
        principalAttrs.tenant_role = tenantRole;
        principalAttrs.tenant_id = tenantId;
      }
    }

    const principalUid: EntityUid = { type: "Principal", id: userId };
    const actionUid: EntityUid = { type: "Action", id: action };

    const entities: Entities = [
      {
        uid: principalUid,
        attrs: principalAttrs,
        parents: [],
      },
    ];

    let resourceUid: EntityUid;
    let resourceAttrs: Record<string, CedarValueJson>;

    if (resource.type === "Company") {
      resourceUid = { type: "Company", id: resource.id };
      resourceAttrs = { id: resource.id };
    } else if (resource.type === "Tenant") {
      resourceUid = { type: "Tenant", id: resource.id };
      // company_id はスキーマ上 optional。現行ポリシーは resource.company_id を参照しないため、
      // 提供されている場合のみエンティティに含める（DB 問い合わせは行わない）。
      resourceAttrs = resource.company_id
        ? { id: resource.id, company_id: resource.company_id }
        : { id: resource.id };
    } else {
      resourceUid = { type: "CostResource", id: resource.id };
      resourceAttrs = {
        id: resource.id,
        type: resource.resourceType,
        tenant_id: resource.tenant_id,
        ...(resource.owner_tenant_id != null && {
          owner_tenant_id: resource.owner_tenant_id,
        }),
        ...(resource.item_kind != null && { item_kind: resource.item_kind }),
        ...(resource.user_id != null && { user_id: resource.user_id }),
      };
    }

    entities.push({
      uid: resourceUid,
      attrs: resourceAttrs,
      parents: [],
    });

    let contextAttrs: CedarContext;

    if (isTenantScope) {
      // tenant スコープのアクションによっては schema 上 context を持たない。
      // その場合は空 record を渡して validation failure を防ぐ。
      const hasTenantContext =
        action === UnifiedTenantAction.list_resources ||
        action === UnifiedTenantAction.read_resource ||
        action.startsWith("tenant::update_") ||
        action.startsWith("tenant::delete_");

      if (!hasTenantContext) {
        contextAttrs = {} as CedarContext;
      } else {
        // tenant スコープは resource_shares を TS 側で解釈し、判定に必要な派生結果だけ context に入れる
        const computed: UnifiedContext = {
          is_owner: context?.is_owner ?? false,
          is_shared: context?.is_shared ?? false,
        };

        if (resource.type === "CostResource") {
          const tenantRole = principalAttrs.tenant_role as string | undefined;
          const tenantId = principalAttrs.tenant_id as string | undefined;
          if (!tenantRole || !tenantId) return false;

          const legacyCrud = mapTenantActionToLegacyCrud(action);
          const sharesRole = normalizeTenantRoleForShares(tenantRole);

          // cross-tenant アクセス判定（アイテムのテナントが自分のテナントと異なる場合）
          // intra-tenant の manager/shared チェックとは独立して処理し、Cedar に直接渡す。
          if (
            resource.resourceType === "item" &&
            resource.item_kind === "prepped" &&
            resource.tenant_id !== tenantId
          ) {
            const isCrossShared = await isCrossTenantSharedForPrincipal(
              resource.id,
              resource.tenant_id,
              tenantId,
            );
            // cross-tenant アクセスは read のみ・共有設定が必要
            if (!isCrossShared || legacyCrud !== "read") return false;
            computed.is_cross_tenant_shared = true;
            // intra-tenant チェック（is_owner / is_shared）はスキップして Cedar へ
            contextAttrs = computed as CedarContext;
          } else if (
            tenantRole === "manager" &&
            resource.resourceType === "item" &&
            resource.item_kind === "prepped"
          ) {
            // manager: prepped items は responsible_user_id が自分、または shared かつ allowed_actions に CRUD が含まれる場合のみ
            const isOwner = resource.responsible_user_id === userId;

            if (isOwner) {
              computed.is_owner = true;
            } else {
              const shares = await resolveResourceSharesForPrincipal(
                resource.resourceType,
                resource.id,
                tenantId,
                sharesRole,
                userId,
                options?.prefetchedRawSharesByResourceId,
              );

              if (isExcluded(shares)) return false;

              if (isShared(shares)) {
                const allowedActions = getAllowedActions(shares);
                // hide-state: allowed_actions が空の場合は deny（既存 getAllowedActions 実装に追従）
                if (allowedActions.length === 0) return false;
                if (!allowedActions.includes(legacyCrud)) return false;
                computed.is_shared = true;
              } else {
                return false;
              }
            }
          } else if (
            // manager: raw items は既存挙動に合わせ resource_shares を見ない
            tenantRole === "manager" &&
            resource.resourceType === "item" &&
            resource.item_kind !== "prepped"
          ) {
            // no-op
          } else {
            const shares = await resolveResourceSharesForPrincipal(
              resource.resourceType,
              resource.id,
              tenantId,
              sharesRole,
              userId,
              options?.prefetchedRawSharesByResourceId,
            );

            if (isExcluded(shares)) return false;
            computed.is_shared = isShared(shares);
          }
        }

        contextAttrs = computed as CedarContext;
      }
    } else {
      contextAttrs = (context ?? {}) as CedarContext;
    }

    const authCall: AuthorizationCall = {
      principal: principalUid,
      action: actionUid,
      resource: resourceUid,
      context: contextAttrs,
      schema: unifiedSchemaText as Schema,
      validateRequest: true,
      policies: { staticPolicies: unifiedPolicySetText } as PolicySet,
      entities,
    };

    const answer: AuthorizationAnswer = isAuthorized(authCall);

    if (answer.type === "failure") {
      console.error("Unified authorization check failed:", answer.errors);
      return false;
    }

    return answer.response.decision === "allow";
  } catch (error) {
    console.error("Unified authorization check failed:", error);
    return false;
  }
}

/** Team ページ用: read / テナント設定 / メンバー管理 */
export type TeamTenantAuthMode = "read" | "manage_tenant" | "manage_members";

export type TeamTenantAuthResult =
  | { allowed: true; viaCompany: boolean }
  | { allowed: false; viaCompany: false };

/**
 * Team ページ向け認可: 親会社の company_admin / company_director をテナントロールより優先。
 * それ以外は従来どおり profiles のテナントロールで Cedar 判定。
 */
export async function authorizeTeamTenantAccess(
  userId: string,
  tenantId: string,
  mode: TeamTenantAuthMode,
  rolesMap: Map<string, string>,
): Promise<TeamTenantAuthResult> {
  const resource: UnifiedResource = { type: "Tenant", id: tenantId };

  if (
    await authorizeUnified(
      userId,
      UnifiedCompanyAction.manage_tenant_team,
      resource,
    )
  ) {
    return { allowed: true, viaCompany: true };
  }

  const tenantRole = rolesMap.get(tenantId);
  if (!tenantRole) {
    return { allowed: false, viaCompany: false };
  }

  const action =
    mode === "read"
      ? UnifiedTenantAction.read_resource
      : mode === "manage_tenant"
        ? UnifiedTenantAction.manage_tenant
        : UnifiedTenantAction.manage_members;

  const ok = await authorizeUnified(userId, action, resource, undefined, {
    tenantId,
    tenantRole,
  });
  return ok
    ? { allowed: true, viaCompany: false }
    : { allowed: false, viaCompany: false };
}
