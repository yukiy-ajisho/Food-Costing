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
import {
  getResourceShares,
  isExcluded,
  isShared,
  getAllowedActions,
} from "./resource-shares";

// Cedar PolicySetとSchemaのキャッシュ
let policySetText: string | null = null;
let schemaText: string | Record<string, unknown> | null = null;

/**
 * Cedar Authorizerを初期化
 * schema.jsonとpolicies.cedarを読み込んでキャッシュ
 */
export function initializeAuthorizer(): void {
  try {
    const schemaPath = path.join(__dirname, "schema.json");
    const policiesPath = path.join(__dirname, "policies.cedar");

    // schema.jsonをJSONオブジェクトとして読み込む（Cedar WASMライブラリがJSON形式を期待）
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    schemaText = JSON.parse(schemaContent);
    policySetText = fs.readFileSync(policiesPath, "utf-8");

    console.log("Cedar Authorizer initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Cedar Authorizer:", error);
    throw error;
  }
}

/**
 * Principal（ユーザー）の型定義
 */
export interface Principal {
  id: string;
  tenant_id: string;
  role: "admin" | "manager" | "staff";
}

/**
 * Resource（リソース）の型定義
 */
export interface Resource {
  id: string;
  resource_type: string;
  owner_tenant_id: string;
  is_virtual?: boolean;
  item_kind?: "raw" | "prepped"; // itemリソースの場合のみ
  user_id?: string; // リソースの作成者（user_idで判断するため）
  responsible_user_id?: string | null; // 責任者のユーザーID（アクセス権を変更できるManager）
}

/**
 * Context（状況）の型定義（必要に応じて拡張可能）
 */
export interface AuthContext {
  [key: string]: unknown;
  is_owner?: boolean; // Managerが自分で作ったリソースの場合
  is_shared?: boolean; // 共有されているリソースの場合
}

/**
 * 認可チェックを実行
 * @param principal - ユーザー情報
 * @param action - アクション（read, create, update, delete）
 * @param resource - リソース情報
 * @param context - コンテキスト（オプション）
 * @param checkResourceShares - resource_sharesテーブルをチェックするか（デフォルト: true）
 * @returns true if allowed, false if denied
 */
export async function authorize(
  principal: Principal,
  action: string,
  resource: Resource,
  context?: AuthContext,
  checkResourceShares: boolean = true
): Promise<boolean> {
  if (!policySetText || !schemaText) {
    console.error(
      "Authorizer not initialized. Call initializeAuthorizer() first."
    );
    // セキュリティのため、初期化されていない場合は拒否
    return false;
  }

  try {
    // デバッグログ: Adminの場合の認可チェック
    if (principal.role === "admin") {
      console.log(
        `[AUTHZ DEBUG] Admin authorization check: action=${action}, resource_type=${resource.resource_type}, resource_id=${resource.id}`
      );
    }
    // コレクションリソース（collection-で始まるID）または一時リソース（temp-で始まるID）の場合はresource_sharesチェックをスキップ
    const isCollectionResource = resource.id.startsWith("collection-");
    const isTemporaryResource = resource.id.startsWith("temp-");
    const shouldSkipResourceSharesCheck =
      isCollectionResource || isTemporaryResource;

    // Managerの場合、Prepped Itemsに対して特別な制限を適用
    if (principal.role === "manager" && resource.resource_type === "item") {
      // item_kindがpreppedの場合のみ制限を適用
      if (resource.item_kind === "prepped") {
        // 自分が作ったものかチェック
        if (resource.user_id && resource.user_id === principal.id) {
          // 自分が作ったもの → フルアクセス許可
          context = context || {};
          context.is_owner = true;
        } else if (
          resource.responsible_user_id &&
          resource.responsible_user_id === principal.id
        ) {
          // responsible_user_idが自分 → フルアクセス許可（hide状態でも見れる）
          context = context || {};
          context.is_owner = true;
        } else {
          // コレクションリソースまたは一時リソースの場合はresource_sharesチェックをスキップ
          if (!shouldSkipResourceSharesCheck) {
          // 自分が作ったものではない → resource_sharesをチェック
          const shares = await getResourceShares(
            resource.resource_type,
            resource.id,
            principal.tenant_id,
            principal.role,
            principal.id
          );

          // 除外（FORBID）チェック: is_exclusion = TRUEの場合は即座に拒否
          if (isExcluded(shares)) {
            return false;
          }

          // 共有されているかチェック
          if (isShared(shares)) {
            // 許可されたアクションを取得
            const allowedActions = getAllowedActions(shares);
              // hide状態（allowed_actionsが空）の場合は、responsible_user_idのユーザー以外はアクセスできない
              if (allowedActions.length === 0) {
                // hide状態 → 拒否（responsible_user_idのユーザーは上記で処理済み）
                return false;
              }
            // リクエストのactionが許可されているかチェック
            if (!allowedActions.includes(action)) {
              return false; // 許可されていないaction
            }
            // 共有情報をContextに追加（Cedarポリシーで使用）
            context = context || {};
            context.is_shared = true;
          } else {
            // 共有されていない → 拒否
            return false;
            }
          }
        }
      }
      // item_kindがrawまたはその他のリソースタイプの場合は制限なし（通常の認可チェックに進む）
    } else {
      // Adminまたはその他のリソースタイプの場合、通常のresource_sharesチェック
      // ただし、コレクションリソースまたは一時リソースの場合はスキップ
      if (checkResourceShares && !shouldSkipResourceSharesCheck) {
        const shares = await getResourceShares(
          resource.resource_type,
          resource.id,
          principal.tenant_id,
          principal.role,
          principal.id
        );

        // 除外（FORBID）チェック: is_exclusion = TRUEの場合は即座に拒否
        if (isExcluded(shares)) {
          return false;
        }

        // 共有情報をContextに追加（Cedarポリシーで使用）
        context = context || {};
        context.is_shared = isShared(shares);
      }
    }
    // PrincipalをCedar形式に変換
    const principalUid: EntityUid = {
      type: "User",
      id: principal.id,
    };

    // ActionをCedar形式に変換
    const actionUid: EntityUid = {
      type: "Action",
      id: action,
    };

    // ResourceをCedar形式に変換
    const resourceUid: EntityUid = {
      type: "Resource",
      id: resource.id,
    };

    // Entitiesを作成（PrincipalとResourceの属性を含む）
    const entities: Entities = [
      {
        uid: principalUid,
        attrs: {
          id: principal.id,
          tenant_id: principal.tenant_id,
          role: principal.role,
        },
        parents: [],
      },
      {
        uid: resourceUid,
        attrs: {
          id: resource.id,
          resource_type: resource.resource_type,
          owner_tenant_id: resource.owner_tenant_id,
          ...(resource.is_virtual !== undefined && {
            is_virtual: resource.is_virtual,
          }),
          ...(resource.item_kind !== undefined && {
            item_kind: resource.item_kind,
          }),
          // Cedarはnullを許可しないため、user_idがnullでない場合のみ追加
          // responsible_user_idはCedarスキーマに定義されていないため、エンティティ属性には含めない
          // （authorize.tsのロジックで使用されるが、Cedarポリシーでは使用されない）
          ...(resource.user_id !== undefined &&
            resource.user_id !== null && {
            user_id: resource.user_id,
          }),
        },
        parents: [],
      },
    ];

    // PolicySetを作成
    const policySet: PolicySet = {
      staticPolicies: policySetText,
    };

    // ContextをCedar形式に変換（空のオブジェクトでもOK）
    const contextAttrs: CedarContext = (context || {}) as CedarContext;

    // AuthorizationCallを作成
    const authCall: AuthorizationCall = {
      principal: principalUid,
      action: actionUid,
      resource: resourceUid,
      context: contextAttrs,
      schema: schemaText as Schema,
      validateRequest: true, // セキュリティのため、検証を有効化
      policies: policySet,
      entities: entities,
    };

    // 認可判定を実行
    const answer: AuthorizationAnswer = isAuthorized(authCall);

    if (answer.type === "failure") {
      console.error("Authorization check failed:", answer.errors);
      // エラー時はセキュリティのため拒否
      return false;
    }

    // decisionが"allow"ならtrue、それ以外（"deny"）ならfalse
    const isAllowed = answer.response.decision === "allow";

    // デバッグログ: Adminの場合の認可結果
    if (principal.role === "admin") {
      console.log(
        `[AUTHZ DEBUG] Admin authorization result: ${
          isAllowed ? "ALLOWED" : "DENIED"
        } for action=${action}, resource_type=${
          resource.resource_type
        }, resource_id=${resource.id}`
      );
    }

    return isAllowed;
  } catch (error) {
    console.error("Authorization check failed:", error);
    // エラー時はセキュリティのため拒否
    return false;
  }
}

/**
 * 認可チェック（同期版、後方互換性のため残す）
 * @deprecated 非同期版のauthorizeAsyncを使用してください
 */
export function authorizeSync(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _principal: Principal,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _action: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _resource: Resource,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context?: AuthContext
): boolean {
  // 同期版は非推奨。非同期版を使用することを推奨
  throw new Error("authorizeSync is deprecated. Use authorizeAsync instead.");
}

/**
 * 認可チェック（非同期版）
 */
export async function authorizeAsync(
  principal: Principal,
  action: string,
  resource: Resource,
  context?: AuthContext,
  checkResourceShares: boolean = true
): Promise<boolean> {
  return authorize(principal, action, resource, context, checkResourceShares);
}
