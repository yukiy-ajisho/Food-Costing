import { Router } from "express";
import { supabase } from "../config/supabase";

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

export default router;
