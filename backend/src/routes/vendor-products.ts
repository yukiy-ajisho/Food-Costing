import { Router } from "express";
import { supabase } from "../config/supabase";
import { VendorProduct, Item } from "../types/database";

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
      .order("product_name");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    // vendor_productsを作成
    const { data: newVendorProduct, error: vpError } = await supabase
      .from("vendor_products")
      .insert([vendorProduct])
      .select()
      .single();

    if (vpError) {
      return res.status(400).json({ error: vpError.message });
    }

    res.status(201).json(newVendorProduct);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    const { data, error } = await supabase
      .from("vendor_products")
      .update(vendorProduct)
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
 * DELETE /vendor-products/:id
 * vendor productを削除（CASCADEでitemsも削除される）
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("vendor_products")
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
