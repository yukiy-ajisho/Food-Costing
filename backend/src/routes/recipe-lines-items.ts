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
      .eq("user_id", req.user!.id)
      .order("created_at");

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
 * POST /items/recipes
 * 複数アイテムのレシピを一度に取得（最適化版）
 * Request body: { item_ids: string[] }
 * Response: { recipes: { [itemId: string]: RecipeLine[] } }
 */
router.post("/items/recipes", async (req, res) => {
  try {
    const { item_ids } = req.body;

    if (!Array.isArray(item_ids)) {
      return res.status(400).json({
        error: "item_ids must be an array of strings",
      });
    }

    if (item_ids.length === 0) {
      return res.json({ recipes: {} });
    }

    // 複数のアイテムIDのレシピを一度に取得
    const { data, error } = await supabase
      .from("recipe_lines")
      .select("*")
      .in("parent_item_id", item_ids)
      .eq("user_id", req.user!.id)
      .order("parent_item_id")
      .order("created_at");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // アイテムIDごとにグループ化
    const recipes: Record<string, RecipeLine[]> = {};
    if (data) {
      for (const line of data) {
        const itemId = line.parent_item_id;
        if (!recipes[itemId]) {
          recipes[itemId] = [];
        }
        recipes[itemId].push(line);
      }
    }

    // リクエストされたすべてのアイテムIDに対して空配列を設定（レシピがない場合）
    for (const itemId of item_ids) {
      if (!recipes[itemId]) {
        recipes[itemId] = [];
      }
    }

    res.json({ recipes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
