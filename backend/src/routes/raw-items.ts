import { Router } from "express";
import { supabase } from "../config/supabase";
import { RawItem } from "../types/database";

const router = Router();

/**
 * GET /raw-items
 * 全Raw Itemsを取得
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("raw_items")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /raw-items/:id
 * Raw ItemをIDで取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("raw_items")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: error.message });
    }

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /raw-items
 * Raw Itemを作成
 */
router.post("/", async (req, res) => {
  try {
    const rawItem: Partial<RawItem> = req.body;

    // バリデーション
    if (!rawItem.name) {
      return res.status(400).json({ error: "name is required" });
    }

    const { data, error } = await supabase
      .from("raw_items")
      .insert([rawItem])
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
 * PUT /raw-items/:id
 * Raw Itemを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const rawItem: Partial<RawItem> = req.body;
    const { id } = req.params;

    const { data, error } = await supabase
      .from("raw_items")
      .update(rawItem)
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
 * DELETE /raw-items/:id
 * Raw Itemを削除
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("raw_items")
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
