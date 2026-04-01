import {
  isAuthorized,
  type AuthorizationCall,
  type AuthorizationAnswer,
  type PolicySet,
  type Entities,
  type EntityUid,
  type Context as CedarContext,
  type Schema,
} from "@cedar-policy/cedar-wasm/nodejs";
import * as fs from "fs";
import * as path from "path";
import { supabase } from "../../config/supabase";

let teamPolicySetText: string | null = null;
let teamSchemaText: string | Record<string, unknown> | null = null;

/**
 * Team Cedar authorizer を初期化（team/schema.json と team/policies.cedar を読み込む）
 */
export function initializeTeamAuthorizer(): void {
  try {
    const schemaPath = path.join(__dirname, "schema.json");
    const policiesPath = path.join(__dirname, "policies.cedar");
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    teamSchemaText = JSON.parse(schemaContent);
    teamPolicySetText = fs.readFileSync(policiesPath, "utf-8");
    console.log("Team Cedar Authorizer initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Team Cedar Authorizer:", error);
    throw error;
  }
}

/** Team で許可する Action ID（計画書 3.3 に準拠） */
export const TeamAction = {
  read: "company::read",
  manage_members: "company::manage_members",
  manage_invitations: "company::manage_invitations",
  list_tenants: "company::list_tenants",
  create_tenant: "company::create_tenant",
} as const;

/**
 * company_members を参照し、当該ユーザーの当該会社でのロールを取得する。
 * 存在しないか company_admin / company_director 以外の場合は null。
 */
async function getCompanyRole(
  userId: string,
  companyId: string
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
 * Team（Company スコープ）の認可チェック。
 * company_members からロールを取得し、Cedar に渡して判定する。
 *
 * @param userId - 認可対象ユーザー ID
 * @param companyId - 対象会社 ID
 * @param action - Team 用 Action ID（TeamAction のいずれか）
 * @returns 許可なら true、拒否なら false
 */
export async function authorizeTeam(
  userId: string,
  companyId: string,
  action: string
): Promise<boolean> {
  if (!teamPolicySetText || !teamSchemaText) {
    console.error(
      "Team Authorizer not initialized. Call initializeTeamAuthorizer() first."
    );
    return false;
  }

  try {
    const role = await getCompanyRole(userId, companyId);

    const principalUid: EntityUid = { type: "User", id: userId };
    const actionUid: EntityUid = { type: "Action", id: action };
    const resourceUid: EntityUid = { type: "Company", id: companyId };

    const entities: Entities = [
      {
        uid: principalUid,
        attrs: { id: userId },
        parents: [],
      },
      {
        uid: resourceUid,
        attrs: { id: companyId },
        parents: [],
      },
    ];

    const contextAttrs: CedarContext = role ? { role } : {};

    const authCall: AuthorizationCall = {
      principal: principalUid,
      action: actionUid,
      resource: resourceUid,
      context: contextAttrs,
      schema: teamSchemaText as Schema,
      validateRequest: true,
      policies: { staticPolicies: teamPolicySetText } as PolicySet,
      entities,
    };

    const answer: AuthorizationAnswer = isAuthorized(authCall);

    if (answer.type === "failure") {
      console.error("Team authorization check failed:", answer.errors);
      return false;
    }

    return answer.response.decision === "allow";
  } catch (error) {
    console.error("Team authorization check failed:", error);
    return false;
  }
}
