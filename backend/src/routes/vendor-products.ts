import { Router } from "express";
import { supabase } from "../config/supabase";
import { VendorProduct } from "../types/database";

const router = Router();

/**
 * GET /vendor-products
 * 全vendor productsを取得
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("product_name");

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
 * GET /vendor-products/:id
 * vendor product詳細を取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
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
 * POST /vendor-products
 * vendor productを作成
 * 注意: itemsレコードはBase ItemsタブでBase Itemを作成したときに既に作成されている
 */
router.post("/", async (req, res) => {
  try {
    const vendorProduct: Partial<VendorProduct> = req.body;

    // バリデーション
    if (
      !vendorProduct.base_item_id ||
      !vendorProduct.vendor_id ||
      !vendorProduct.purchase_unit ||
      !vendorProduct.purchase_quantity ||
      !vendorProduct.purchase_cost
    ) {
      return res.status(400).json({
        error:
          "base_item_id, vendor_id, purchase_unit, purchase_quantity, and purchase_cost are required",
      });
    }

    // user_idを自動設定
    const vendorProductWithUserId = {
      ...vendorProduct,
      user_id: req.user!.id,
    };

    // vendor_productsを作成
    const { data: newVendorProduct, error: vpError } = await supabase
      .from("vendor_products")
      .insert([vendorProductWithUserId])
      .select()
      .single();

    if (vpError) {
      return res.status(400).json({ error: vpError.message });
    }

    // 自動undeprecateをチェック
    const { autoUndeprecateAfterVendorProductCreation } = await import(
      "../services/deprecation"
    );
    const undeprecateResult = await autoUndeprecateAfterVendorProductCreation(
      newVendorProduct.id,
      req.user!.id
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
});

/**
 * PUT /vendor-products/:id
 * vendor productを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const vendorProduct: Partial<VendorProduct> = req.body;
    const { id } = req.params;

    // user_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user_id: _user_id, ...vendorProductWithoutUserId } = vendorProduct;
    const { data, error } = await supabase
      .from("vendor_products")
      .update(vendorProductWithoutUserId)
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .select()
      .single();

    if (error) {
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
});

/**
 * PATCH /vendor-products/:id/deprecate
 * Vendor Productをdeprecatedにする
 */
router.patch("/:id/deprecate", async (req, res) => {
  try {
    const { deprecateVendorProduct } = await import("../services/deprecation");
    const result = await deprecateVendorProduct(req.params.id, req.user!.id);

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
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("vendor_products")
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
