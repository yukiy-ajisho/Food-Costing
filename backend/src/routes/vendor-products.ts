import { Router } from "express";
import { supabase } from "../config/supabase";
import { VendorProduct } from "../types/database";
import { authorizationMiddleware } from "../middleware/authorization";
import {
  getVendorProductResource,
  getCreateResource,
  getCollectionResource,
} from "../middleware/resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";

const router = Router();

/**
 * GET /vendor-products
 * 全vendor productsを取得
 */
router.get(
  "/",
  authorizationMiddleware("read", (req) =>
    getCollectionResource(req, "vendor_product")
  ),
  async (req, res) => {
    try {
      let query = supabase.from("virtual_vendor_products").select("*");

      query = withTenantFilter(query, req);

      const { data, error } = await query.order("product_name");

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /vendor-products/:id
 * vendor product詳細を取得
 */
router.get(
  "/:id",
  authorizationMiddleware("read", getVendorProductResource),
  async (req, res) => {
    try {
      let query = supabase
        .from("virtual_vendor_products")
        .select("*")
        .eq("id", req.params.id);

      query = withTenantFilter(query, req);

      const { data, error } = await query.single();

      if (error) {
        return res.status(404).json({ error: error.message });
      }

      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /vendor-products
 * vendor productを作成
 * 注意: itemsレコードはBase ItemsタブでBase Itemを作成したときに既に作成されている
 */
router.post(
  "/",
  authorizationMiddleware("create", (req) =>
    getCreateResource(req, "vendor_product")
  ),
  async (req, res) => {
    try {
      const vendorProduct: Partial<VendorProduct> = req.body;

      // バリデーション（base_item_idは不要 - マッピングは別途作成）
      if (
        !vendorProduct.vendor_id ||
        !vendorProduct.purchase_unit ||
        !vendorProduct.purchase_quantity ||
        !vendorProduct.purchase_cost
      ) {
        return res.status(400).json({
          error:
            "vendor_id, purchase_unit, purchase_quantity, and purchase_cost are required",
        });
      }

      // tenant_idとuser_idを自動設定（選択されたテナントID、または最初のテナント）
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      const vendorProductWithTenantId = {
        ...vendorProduct,
        tenant_id: selectedTenantId,
        user_id: req.user!.id, // 作成者を記録
      };

      // base_item_idを削除（Phase 1b: マッピングは別途作成）
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { base_item_id: _base_item_id, ...vendorProductWithoutBaseItemId } =
        vendorProductWithTenantId as typeof vendorProductWithTenantId & {
          base_item_id?: string;
        };

      // virtual_vendor_productsを作成
      const { data: newVendorProduct, error: vpError } = await supabase
        .from("virtual_vendor_products")
        .insert([vendorProductWithoutBaseItemId])
        .select()
        .single();

      if (vpError) {
        // unique constraint違反の場合、より分かりやすいメッセージに変換
        if (
          vpError.code === "23505" ||
          vpError.message.includes("duplicate key") ||
          vpError.message.includes("unique constraint")
        ) {
          return res.status(400).json({
            error:
              "A vendor product with the same item, supplier, and product name already exists for your account.",
          });
        }
        return res.status(400).json({ error: vpError.message });
      }

      // 自動undeprecateをチェック
      const { autoUndeprecateAfterVendorProductCreation } =
        await import("../services/deprecation");
      const undeprecateResult = await autoUndeprecateAfterVendorProductCreation(
        newVendorProduct.id,
        req.user!.tenant_ids
      );

      if (undeprecateResult.undeprecatedItems?.length) {
        console.log(
          `[AUTO UNDEPRECATE] ${undeprecateResult.undeprecatedItems.length} items undeprecated after vendor product creation`
        );
      }

      res.status(201).json(newVendorProduct);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PUT /vendor-products/:id
 * vendor productを更新
 */
router.put(
  "/:id",
  authorizationMiddleware("update", getVendorProductResource),
  async (req, res) => {
    try {
      const vendorProduct: Partial<VendorProduct> = req.body;
      const { id } = req.params;

      // user_id、tenant_id、base_item_idを更新から除外（セキュリティのため、base_item_idはproduct_mappingsで管理）
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {
        user_id: _user_id,
        tenant_id: _tenant_id,
        id: _id,
        base_item_id: _base_item_id,
        ...vendorProductWithoutIds
      } = vendorProduct as typeof vendorProduct & { base_item_id?: string };

      let query = supabase
        .from("virtual_vendor_products")
        .update(vendorProductWithoutIds)
        .eq("id", id);

      query = withTenantFilter(query, req);

      const { data, error } = await query.select().single();

      if (error) {
        // unique constraint違反の場合、より分かりやすいメッセージに変換
        if (
          error.code === "23505" ||
          error.message.includes("duplicate key") ||
          error.message.includes("unique constraint")
        ) {
          return res.status(400).json({
            error:
              "A vendor product with the same item, supplier, and product name already exists for your account.",
          });
        }
        return res.status(400).json({ error: error.message });
      }

      if (!data) {
        return res.status(404).json({ error: "Vendor product not found" });
      }

      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PATCH /vendor-products/:id/deprecate
 * Vendor Productをdeprecatedにする
 */
router.patch("/:id/deprecate", async (req, res) => {
  try {
    const { deprecateVendorProduct } = await import("../services/deprecation");
    const result = await deprecateVendorProduct(
      req.params.id,
      req.user!.tenant_ids
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      message: "Vendor product deprecated successfully",
      affectedItems: result.affectedItems,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /vendor-products/:id
 * vendor productを削除（物理削除は危険なので非推奨、deprecateを使用してください）
 */
router.delete(
  "/:id",
  authorizationMiddleware("delete", getVendorProductResource),
  async (req, res) => {
    try {
      let query = supabase
        .from("virtual_vendor_products")
        .delete()
        .eq("id", req.params.id);

      query = withTenantFilter(query, req);

      const { error } = await query;

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.status(204).send();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
