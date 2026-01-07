import { Router } from "express";
import { supabase } from "../config/supabase";
import { authMiddleware } from "../middleware/auth";

const router = Router();

/**
 * POST /access-requests
 * 新規ユーザーがアクセス申請を送信（認証不要）
 */
router.post("/", async (req, res) => {
  try {
    const { email, name } = req.body;

    // バリデーション
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "email is required" });
    }

    // メールアドレス形式チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // スパムチェック: 24時間に3回以上申請
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { data: existingRequest } = await supabase
      .from("allowlist")
      .select("request_count, last_requested_at, status")
      .eq("email", email)
      .maybeSingle();

    if (existingRequest && existingRequest.last_requested_at) {
      const lastRequested = new Date(existingRequest.last_requested_at);
      if (
        lastRequested > twentyFourHoursAgo &&
        existingRequest.request_count >= 3
      ) {
        return res.status(429).json({
          error: "Too many requests",
          details: "Please wait 24 hours before requesting again",
        });
      }
    }

    // allowlistに挿入または更新
    const { error } = await supabase
      .from("allowlist")
      .upsert(
        {
          email,
          status: existingRequest?.status || "pending",
          request_count: (existingRequest?.request_count || 0) + 1,
          last_requested_at: new Date().toISOString(),
          note: name ? `Name: ${name}` : null,
        },
        {
          onConflict: "email",
        }
      );

    if (error) {
      console.error("[POST /access-requests] Error:", error);
      return res.status(500).json({
        error: "Failed to submit request",
        details: error.message,
      });
    }

    console.log("[POST /access-requests] Request submitted:", email);
    res.status(200).json({
      message: "Access request submitted successfully. We'll review it soon.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /access-requests] Unexpected error:", error);
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

/**
 * GET /access-requests
 * アクセス申請一覧を取得（System Adminのみ）
 */
router.get("/", authMiddleware(), async (req, res) => {
  try {
    // System Admin チェック
    if (!req.user || req.user.email !== process.env.SYSTEM_ADMIN_EMAIL) {
      return res.status(403).json({ error: "System Admin access required" });
    }

    const { status } = req.query;

    let query = supabase
      .from("allowlist")
      .select("*")
      .order("created_at", { ascending: false });

    if (status && typeof status === "string") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[GET /access-requests] Error:", error);
      return res.status(500).json({
        error: "Failed to fetch requests",
        details: error.message,
      });
    }

    res.json({ requests: data || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /access-requests] Unexpected error:", error);
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

/**
 * PUT /access-requests/:id/approve
 * アクセス申請を承認（System Adminのみ）
 */
router.put("/:id/approve", authMiddleware(), async (req, res) => {
  try {
    // System Admin チェック
    if (!req.user || req.user.email !== process.env.SYSTEM_ADMIN_EMAIL) {
      return res.status(403).json({ error: "System Admin access required" });
    }

    const { id } = req.params;

    const { data, error } = await supabase
      .from("allowlist")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: req.user.email,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[PUT /access-requests/:id/approve] Error:", error);
      return res.status(500).json({
        error: "Failed to approve request",
        details: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({ error: "Request not found" });
    }

    console.log("[PUT /access-requests/:id/approve] Approved:", data.email);
    res.json({ message: "Request approved", request: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PUT /access-requests/:id/approve] Unexpected error:", error);
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

/**
 * PUT /access-requests/:id/reject
 * アクセス申請を拒否（System Adminのみ）
 */
router.put("/:id/reject", authMiddleware(), async (req, res) => {
  try {
    // System Admin チェック
    if (!req.user || req.user.email !== process.env.SYSTEM_ADMIN_EMAIL) {
      return res.status(403).json({ error: "System Admin access required" });
    }

    const { id } = req.params;

    const { data, error } = await supabase
      .from("allowlist")
      .update({
        status: "rejected",
        approved_by: req.user.email,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[PUT /access-requests/:id/reject] Error:", error);
      return res.status(500).json({
        error: "Failed to reject request",
        details: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({ error: "Request not found" });
    }

    console.log("[PUT /access-requests/:id/reject] Rejected:", data.email);
    res.json({ message: "Request rejected", request: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PUT /access-requests/:id/reject] Unexpected error:", error);
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

/**
 * DELETE /access-requests/:id
 * アクセス申請を削除（System Adminのみ）
 */
router.delete("/:id", authMiddleware(), async (req, res) => {
  try {
    // System Admin チェック
    if (!req.user || req.user.email !== process.env.SYSTEM_ADMIN_EMAIL) {
      return res.status(403).json({ error: "System Admin access required" });
    }

    const { id } = req.params;

    const { error } = await supabase.from("allowlist").delete().eq("id", id);

    if (error) {
      console.error("[DELETE /access-requests/:id] Error:", error);
      return res.status(500).json({
        error: "Failed to delete request",
        details: error.message,
      });
    }

    console.log("[DELETE /access-requests/:id] Deleted:", id);
    res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DELETE /access-requests/:id] Unexpected error:", error);
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

export default router;

