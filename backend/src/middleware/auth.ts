import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

// ExpressのRequest型を拡張してuser情報を追加
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        tenant_ids: string[]; // ユーザーが属するすべてのテナントID
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

    // ユーザーが属するすべてのテナントIDを取得
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user.id);

    if (profilesError) {
      console.error("Failed to fetch user profiles:", profilesError);
      return res.status(500).json({
        error: "Failed to fetch user tenant information",
      });
    }

    // テナントIDの配列を取得
    const tenantIds = profiles?.map((p) => p.tenant_id) || [];

    if (tenantIds.length === 0) {
      return res.status(403).json({
        error: "User does not belong to any tenant. Please contact administrator.",
      });
    }

    // リクエストオブジェクトにユーザー情報を追加
    req.user = {
      id: user.id,
      tenant_ids: tenantIds,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
