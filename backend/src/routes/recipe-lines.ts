import { Router } from "express";
import { supabase } from "../config/supabase";
import { RecipeLine } from "../types/database";

const router = Router();

/**
 * GET /items/:id/recipe
 * アイテムのレシピを取得
 */
router.get("/items/:id/recipe", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("parent_item_id", req.params.id)
      .order("created_at");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /recipe-lines
 * レシピラインを作成
 */
router.post("/", async (req, res) => {
  try {
    const line: Partial<RecipeLine> = req.body;

    // バリデーション
    if (!line.parent_item_id || !line.line_type) {
      return res.status(400).json({
        error: "parent_item_id and line_type are required",
      });
    }

    if (line.line_type === "ingredient") {
      if (!line.child_item_id || !line.quantity || !line.unit) {
        return res.status(400).json({
          error: "ingredient line requires child_item_id, quantity, and unit",
        });
      }
    } else if (line.line_type === "labor") {
      if (!line.minutes || line.minutes <= 0) {
        return res.status(400).json({
          error: "labor line requires minutes > 0",
        });
      }
    }

    const { data, error } = await supabase
      .from("recipe_lines")
      .insert([line])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /recipe-lines/:id
 * レシピラインを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const line: Partial<RecipeLine> = req.body;
    const { id } = req.params;

    const { data, error } = await supabase
      .from("recipe_lines")
      .update(line)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /recipe-lines/:id
 * レシピラインを削除
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("recipe_lines")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
