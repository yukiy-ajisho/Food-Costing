import { Router } from "express";
import { supabase } from "../config/supabase";
import { ItemUnitProfile } from "../types/database";

const router = Router();

/**
 * POST /item-unit-profiles
 * 単位プロファイルを作成
 */
router.post("/", async (req, res) => {
  try {
    const profile: Partial<ItemUnitProfile> = req.body;

    // バリデーション
    if (
      !profile.item_id ||
      !profile.source_unit ||
      !profile.grams_per_source_unit
    ) {
      return res.status(400).json({
        error: "item_id, source_unit, and grams_per_source_unit are required",
      });
    }

    if (profile.grams_per_source_unit <= 0) {
      return res.status(400).json({
        error: "grams_per_source_unit must be greater than 0",
      });
    }

    // user_idを自動設定
    const profileWithUserId = {
      ...profile,
      user_id: req.user!.id,
    };

    const { data, error } = await supabase
      .from("item_unit_profiles")
      .insert([profileWithUserId])
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
 * PUT /item-unit-profiles/:id
 * 単位プロファイルを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const profile: Partial<ItemUnitProfile> = req.body;
    const { id } = req.params;

    // user_idを更新から除外（セキュリティのため）
    const { user_id, ...profileWithoutUserId } = profile;
    const { data, error } = await supabase
      .from("item_unit_profiles")
      .update(profileWithoutUserId)
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Item unit profile not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /item-unit-profiles/:id
 * 単位プロファイルを削除
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("item_unit_profiles")
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
