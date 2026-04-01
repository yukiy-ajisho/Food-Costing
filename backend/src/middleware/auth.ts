import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../config/supabase";
import { getAuthorizedTenantIds } from "../routes/reminder/authorization-helpers";

async function userHasCompanyAdminOrDirectorOnTenant(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const { data: link, error } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !link?.company_id) return false;
  const { data: member } = await supabase
    .from("company_members")
    .select("id")
    .eq("company_id", link.company_id)
    .eq("user_id", userId)
    .in("role", ["company_admin", "company_director"])
    .maybeSingle();
  return !!member;
}

// ExpressのRequest型を拡張してuser情報を追加
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string; // ユーザーのメールアドレス
        tenant_ids: string[]; // ユーザーが属するすべてのテナントID
        roles: Map<string, string>; // tenant_id -> role のマッピング（Phase 2: RBAC用）
        selected_tenant_id?: string; // 選択されたテナントID（テナント切り替えフィルター用）
        is_system_admin: boolean; // System Admin識別
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

/**
 * 認証ミドルウェアのオプション
 */
interface AuthMiddlewareOptions {
  /**
   * profilesがない場合でも許可するかどうか
   * trueの場合、profilesがないユーザーでも認証を通す（例: 招待受け入れ時）
   * デフォルト: false
   */
  allowNoProfiles?: boolean;
  /**
   * X-Tenant-ID が profiles に無くても、company_admin / company_director で
   * company_tenants 経由に紐づくテナントなら選択テナントとして受け入れる（Team ページ用）
   */
  allowCompanyLinkedTenantHeader?: boolean;
}

/**
 * 認証ミドルウェア
 * Authorizationヘッダーからトークンを取得し、Supabaseで検証
 *
 * @param options - ミドルウェアのオプション
 * @returns Expressミドルウェア関数
 */
export function authMiddleware(
  options: AuthMiddlewareOptions = {}
): (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response> {
  const {
    allowNoProfiles = false,
    allowCompanyLinkedTenantHeader = false,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Authorizationヘッダーからトークンを取得
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7); // "Bearer "を除去

    // Supabaseクライアントを作成（ANON_KEYを使用してトークンを検証）
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Server configuration error" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // トークンを検証してユーザー情報を取得
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // ユーザーが属するすべてのテナントIDとロールを取得（Phase 2: RBAC用）
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", user.id);

    if (profilesError) {
      console.error("Failed to fetch user profiles:", profilesError);
      return res.status(500).json({
        error: "Failed to fetch user tenant information",
      });
    }

    // テナントIDの配列を取得（profiles）
    const tenantIds: string[] = [...(profiles?.map((p) => p.tenant_id) || [])];

    // tenant_id -> role のマッピング（profiles のテナントロール）
    const rolesMap = new Map<string, string>();
    profiles?.forEach((p) => {
      rolesMap.set(p.tenant_id, p.role);
    });

    // company_admin / company_director: company_tenants 経由のテナントも利用可能にする
    // （profiles が無い会社オフィサーも License 等で X-Tenant-ID / 一覧が使えるようにする）
    try {
      const companyTenantIds = await getAuthorizedTenantIds(user.id);
      for (const tid of companyTenantIds) {
        if (!rolesMap.has(tid)) {
          rolesMap.set(tid, "company");
          if (!tenantIds.includes(tid)) {
            tenantIds.push(tid);
          }
        }
      }
    } catch (e) {
      console.error("Failed to merge company-linked tenants in auth:", e);
    }

    // profiles も会社経由テナントも無い場合
    if (tenantIds.length === 0 && !allowNoProfiles) {
      return res.status(403).json({
        error: "User does not belong to any tenant. Please contact administrator.",
      });
    }

      // X-Tenant-IDヘッダーから選択されたテナントIDを取得
      const selectedTenantIdHeader = req.headers["x-tenant-id"] as string | undefined;
      let selectedTenantId: string | undefined = undefined;

      if (selectedTenantIdHeader) {
        if (tenantIds.includes(selectedTenantIdHeader)) {
          selectedTenantId = selectedTenantIdHeader;
        } else if (allowCompanyLinkedTenantHeader) {
          const companyLinked = await userHasCompanyAdminOrDirectorOnTenant(
            user.id,
            selectedTenantIdHeader
          );
          if (companyLinked) {
            selectedTenantId = selectedTenantIdHeader;
          } else if (allowNoProfiles && tenantIds.length === 0) {
            selectedTenantId = selectedTenantIdHeader;
          } else if (tenantIds.length > 0) {
            return res.status(403).json({
              error: "User does not belong to the specified tenant",
            });
          }
        } else if (allowNoProfiles && tenantIds.length === 0) {
          selectedTenantId = selectedTenantIdHeader;
        } else if (tenantIds.length > 0) {
          return res.status(403).json({
            error: "User does not belong to the specified tenant",
          });
        }
      }

    // System Adminチェック
    const isSystemAdmin =
      !!user.email &&
      !!process.env.SYSTEM_ADMIN_EMAIL &&
      user.email === process.env.SYSTEM_ADMIN_EMAIL;

    // リクエストオブジェクトにユーザー情報を追加
    req.user = {
      id: user.id,
      email: user.email || "",
      tenant_ids: tenantIds,
      roles: rolesMap, // Phase 2: RBAC用
      selected_tenant_id: selectedTenantId, // テナント切り替えフィルター用
      is_system_admin: isSystemAdmin,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
  };
}
