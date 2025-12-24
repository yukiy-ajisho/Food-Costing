import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

// ExpressのRequest型を拡張してuser情報を追加
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        tenant_id: string | null; // GET /tenantsの場合はnullになる可能性がある
        role: "admin" | "manager" | "staff" | null; // GET /tenantsの場合はnullになる可能性がある
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

/**
 * 認証ミドルウェア
 * Authorizationヘッダーからトークンを取得し、Supabaseで検証
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
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

    // リクエストヘッダーからtenant_idを取得
    const tenantId = req.headers["x-tenant-id"] as string | undefined;

    // GET /tenants エンドポイントではX-Tenant-IDをオプショナルにする
    // req.originalUrlからクエリパラメータを除去してパス部分のみを取得
    const pathWithoutQuery = req.originalUrl.split("?")[0];
    const isTenantsListEndpoint =
      req.method === "GET" && pathWithoutQuery === "/tenants";

    if (!tenantId && !isTenantsListEndpoint) {
      return res.status(400).json({
        error: "X-Tenant-ID header is required",
      });
    }

    // X-Tenant-IDが指定されている場合、ユーザーがそのテナントに属しているか確認
    if (tenantId) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .eq("tenant_id", tenantId)
        .single();

      if (profileError || !profile) {
        console.error(
          "Profile not found for user:",
          user.id,
          "tenant:",
          tenantId,
          profileError
        );
        return res.status(403).json({
          error:
            "User does not belong to this tenant or profile not found. Please contact administrator.",
        });
      }

      // リクエストオブジェクトにユーザー情報を追加
      req.user = {
        id: user.id,
        tenant_id: tenantId,
        role: profile.role as "admin" | "manager" | "staff",
      };
    } else {
      // GET /tenants の場合、tenant_idとroleはnullにする
      req.user = {
        id: user.id,
        tenant_id: null,
        role: null,
      };
    }

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
