import { Router } from "express";
import { supabase } from "../config/supabase";
import { BaseItem } from "../types/database";

const router = Router();

/**
 * GET /base-items
 * 全Base Itemsを取得
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("base_items")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /base-items/:id
 * Base ItemをIDで取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("base_items")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /base-items
 * Base Itemを作成
 */
router.post("/", async (req, res) => {
  try {
    const baseItem: Partial<BaseItem> = req.body;

    // バリデーション
    if (!baseItem.name) {
      return res.status(400).json({ error: "name is required" });
    }

    const { data, error } = await supabase
      .from("base_items")
      .insert([baseItem])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /base-items/:id
 * Base Itemを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const baseItem: Partial<BaseItem> = req.body;
    const { id } = req.params;

    const { data, error } = await supabase
      .from("base_items")
      .update(baseItem)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /base-items/:id
 * Base Itemを削除
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("base_items")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
