import { Router } from "express";
import { supabase } from "../config/supabase";
import { ItemUnitProfile } from "../types/database";

const router = Router();

/**
 * GET /item-unit-profiles
 * 全単位プロファイルを取得
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("item_unit_profiles")
      .select("*")
      .in("tenant_id", req.user!.tenant_ids)
      .order("item_id");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /item-unit-profiles/:id
 * 単位プロファイルをIDで取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("item_unit_profiles")
      .select("*")
      .eq("id", req.params.id)
      .in("tenant_id", req.user!.tenant_ids)
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

    // tenant_idを自動設定
    const profileWithTenantId = {
      ...profile,
      tenant_id: req.user!.tenant_ids[0], // Phase 2で改善予定
    };

    const { data, error } = await supabase
      .from("item_unit_profiles")
      .insert([profileWithTenantId])
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

    // user_idとtenant_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      user_id: _user_id,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      tenant_id: _tenant_id,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      id: _id,
      ...profileWithoutIds
    } = profile;
    const { data, error } = await supabase
      .from("item_unit_profiles")
      .update(profileWithoutIds)
      .eq("id", id)
      .in("tenant_id", req.user!.tenant_ids)
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
      .in("tenant_id", req.user!.tenant_ids);

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
