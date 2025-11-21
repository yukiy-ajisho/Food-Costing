import { Router } from "express";
import { supabase } from "../config/supabase";
import { LaborRole } from "../types/database";

const router = Router();

/**
 * GET /labor-roles
 * 全役職を取得
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("labor_roles")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("name");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /labor-roles/:id
 * 役職詳細を取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("labor_roles")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .single();

    if (error) {
      return res.status(404).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /labor-roles
 * 役職を作成
 */
router.post("/", async (req, res) => {
  try {
    const role: Partial<LaborRole> = req.body;

    // バリデーション
    if (!role.name || !role.hourly_wage) {
      return res.status(400).json({
        error: "name and hourly_wage are required",
      });
    }

    if (role.hourly_wage <= 0) {
      return res.status(400).json({
        error: "hourly_wage must be greater than 0",
      });
    }

    // user_idを自動設定
    const roleWithUserId = {
      ...role,
      user_id: req.user!.id,
    };

    const { data, error } = await supabase
      .from("labor_roles")
      .insert([roleWithUserId])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /labor-roles/:id
 * 役職を更新
 */
router.put("/:id", async (req, res) => {
  try {
    const role: Partial<LaborRole> = req.body;
    const { id } = req.params;

    // user_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user_id: _user_id, ...roleWithoutUserId } = role;
    const { data, error } = await supabase
      .from("labor_roles")
      .update(roleWithoutUserId)
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Labor role not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /labor-roles/:id
 * 役職を削除
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("labor_roles")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
