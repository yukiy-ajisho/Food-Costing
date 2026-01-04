import { Router } from "express";
import { supabase } from "../config/supabase";
import { BaseItem } from "../types/database";
import { authorizationMiddleware } from "../middleware/authorization";
import {
  getBaseItemResource,
  getCreateResource,
  getCollectionResource,
} from "../middleware/resource-helpers";

const router = Router();

/**
 * GET /base-items
 * 全Base Itemsを取得
 */
router.get(
  "/",
  authorizationMiddleware("read", (req) =>
    getCollectionResource(req, "base_item")
  ),
  async (req, res) => {
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
router.get(
  "/:id",
  authorizationMiddleware("read", getBaseItemResource),
  async (req, res) => {
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
router.post(
  "/",
  authorizationMiddleware("create", (req) => getCreateResource(req, "base_item")),
  async (req, res) => {
  try {
    const baseItem: Partial<BaseItem> = req.body;

    // バリデーション
    if (!baseItem.name) {
      return res.status(400).json({ error: "name is required" });
    }

    // tenant_idを自動設定
    const baseItemWithTenantId = {
      ...baseItem,
      // tenant_idは自動設定されないため、最初のテナントIDを使用（Phase 2で改善予定）
      tenant_id: req.user!.tenant_ids[0],
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
router.put(
  "/:id",
  authorizationMiddleware("update", getBaseItemResource),
  async (req, res) => {
  try {
    const baseItem: Partial<BaseItem> = req.body;
    const { id } = req.params;

    // user_idとtenant_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user_id: _user_id, tenant_id: _tenant_id, id: _id, ...baseItemWithoutIds } = baseItem;
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

    if (!data) {
      return res.status(404).json({ error: "Base item not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /base-items/:id/deprecate
 * Base Itemをdeprecatedにする
 */
router.patch("/:id/deprecate", async (req, res) => {
  try {
    const { deprecateBaseItem } = await import("../services/deprecation");
    // 複数テナント対応: 最初のテナントIDを使用（Phase 2で改善予定）
    const result = await deprecateBaseItem(req.params.id, req.user!.tenant_ids);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: "Base item deprecated successfully" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /base-items/:id/vendor-products
 * Base ItemにマッピングされているVirtual Vendor Productsを取得
 */
router.get("/:id/vendor-products", async (req, res) => {
  try {
    const { id } = req.params;

    // product_mappings経由でvirtual_vendor_productsを取得
    const { data: vendorProducts, error } = await supabase
      .from("product_mappings")
      .select(
        `
        virtual_product_id,
        virtual_vendor_products (
          id,
          vendor_id,
          product_name,
          brand_name,
          purchase_unit,
          purchase_quantity,
          purchase_cost,
          deprecated,
          tenant_id,
          created_at,
          updated_at
        )
      `
      )
      .eq("base_item_id", id)
      .in("tenant_id", req.user!.tenant_ids);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // ネストされた構造をフラット化
    const products = vendorProducts
      ?.map((mapping: { virtual_vendor_products: unknown }) => mapping.virtual_vendor_products)
      .filter((p: unknown) => p !== null) || [];

    res.json(products);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /base-items/:id
 * Base Itemを削除（物理削除は危険なので非推奨、deprecateを使用してください）
 */
router.delete(
  "/:id",
  authorizationMiddleware("delete", getBaseItemResource),
  async (req, res) => {
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
