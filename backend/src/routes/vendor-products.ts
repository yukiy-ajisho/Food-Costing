import { Router } from "express";
import { supabase } from "../config/supabase";
import { VendorProduct } from "../types/database";
import { UnifiedTenantAction } from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import {
  getUnifiedTenantResource,
  getUnifiedVendorProductResource,
} from "../middleware/unified-resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";

const router = Router();

/**
 * GET /vendor-products
 * 全vendor productsを取得
 */
router.get(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.list_resources,
    getUnifiedTenantResource
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
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.read_resource,
    getUnifiedVendorProductResource
  ),
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
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.create_item,
    getUnifiedTenantResource
  ),
  async (req, res) => {
  try {
    const vendorProduct: Partial<VendorProduct> & { base_item_id?: string } =
      req.body;

    const currentPrice = Number(vendorProduct.current_price);
    const qty = Number(vendorProduct.purchase_quantity);
    if (
      !vendorProduct.vendor_id ||
      !vendorProduct.purchase_unit ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !Number.isFinite(currentPrice) ||
      currentPrice <= 0
    ) {
      return res.status(400).json({
        error:
          "vendor_id, purchase_unit, purchase_quantity (> 0), and current_price (> 0) are required",
      });
    }

    const selectedTenantId =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];

    const insertRow = {
      vendor_id: vendorProduct.vendor_id,
      product_name: vendorProduct.product_name ?? null,
      brand_name: vendorProduct.brand_name ?? null,
      purchase_unit: vendorProduct.purchase_unit,
      purchase_quantity: qty,
      current_price: currentPrice,
      tenant_id: selectedTenantId,
      deprecated: vendorProduct.deprecated ?? null,
    };

    const { data: newVendorProduct, error: vpError } = await supabase
      .from("virtual_vendor_products")
      .insert([insertRow])
      .select()
      .single();

    if (vpError) {
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

    const { error: peError } = await supabase.from("price_events").insert([
      {
        tenant_id: selectedTenantId,
        virtual_vendor_product_id: newVendorProduct.id,
        price: currentPrice,
        source_type: "manual",
        user_id: req.user!.id,
      },
    ]);

    if (peError) {
      await supabase
        .from("virtual_vendor_products")
        .delete()
        .eq("id", newVendorProduct.id);
      return res.status(400).json({
        error: `Vendor product rolled back: ${peError.message}`,
      });
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
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.update_item,
    getUnifiedVendorProductResource
  ),
  async (req, res) => {
  try {
    const vendorProduct = req.body as Partial<VendorProduct> & {
      base_item_id?: string;
      purchase_cost?: number;
      user_id?: string;
    };
    const { id } = req.params;

    // Price changes must go through POST /price-events/.../manual (ledger).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      user_id: _user_id,
      tenant_id: _tenant_id,
      id: _id,
      base_item_id: _base_item_id,
      current_price: _current_price,
      purchase_cost: _purchase_cost,
      ...vendorProductWithoutIds
    } = vendorProduct;

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
router.patch(
  "/:id/deprecate",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.update_item,
    getUnifiedVendorProductResource
  ),
  async (req, res) => {
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
  }
);

/**
 * DELETE /vendor-products/:id
 * vendor productを削除（物理削除は危険なので非推奨、deprecateを使用してください）
 */
router.delete(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.delete_item,
    getUnifiedVendorProductResource
  ),
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
