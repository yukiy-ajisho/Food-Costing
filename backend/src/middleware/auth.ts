import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

// ExpressのRequest型を拡張してuser情報を追加
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
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

    // リクエストオブジェクトにユーザー情報を追加
    req.user = {
      id: user.id,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
