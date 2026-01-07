/**
 * NOTE: This file may be unused.
 * The same functionality is provided by base-items.ts, which is registered in the routing.
 * This file is not imported in backend/src/index.ts, so these endpoints are not accessible.
 * Consider removing this file if it's confirmed to be unused.
 */

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
      .in("tenant_id", req.user!.tenant_ids)
      .order("name", { ascending: true });

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
 * GET /base-items/:id
 * Base ItemをIDで取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("base_items")
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

    // tenant_idを自動設定（選択されたテナントID、または最初のテナント）
    const selectedTenantId =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    const baseItemWithTenantId = {
      ...baseItem,
      tenant_id: selectedTenantId,
    };

    const { data, error } = await supabase
      .from("base_items")
      .insert([baseItemWithTenantId])
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
 * PUT /base-items/:id
 * Base Itemを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const baseItem: Partial<BaseItem> = req.body;
    const { id } = req.params;

    // user_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      user_id: _user_id,
      tenant_id: _tenant_id,
      id: _id,
      ...baseItemWithoutIds
    } = baseItem;
    const { data, error } = await supabase
      .from("base_items")
      .update(baseItemWithoutIds)
      .eq("id", id)
      .in("tenant_id", req.user!.tenant_ids)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
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
