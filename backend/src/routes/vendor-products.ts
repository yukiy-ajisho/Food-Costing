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
import { utcMidnightIsoFromYyyyMmDd } from "../utils/invoiceEffectiveTimestamp";

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
    const vendorProduct: Partial<VendorProduct> & {
      base_item_id?: string;
      initial_price_event_source?: "manual" | "invoice";
      invoice_date?: string;
      invoice_id?: string | null;
      initial_case_purchased?: number | null;
      initial_unit_purchased?: number | null;
    } = req.body;

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

    const rawCaseUnit = vendorProduct.case_unit;
    const caseUnit =
      rawCaseUnit !== undefined && rawCaseUnit !== null
        ? Number(rawCaseUnit)
        : null;
    if (caseUnit !== null && (!Number.isInteger(caseUnit) || caseUnit <= 0)) {
      return res
        .status(400)
        .json({ error: "case_unit must be a positive integer" });
    }

    const insertRow = {
      vendor_id: vendorProduct.vendor_id,
      product_name: vendorProduct.product_name ?? null,
      brand_name: vendorProduct.brand_name ?? null,
      purchase_unit: vendorProduct.purchase_unit,
      purchase_quantity: qty,
      current_price: currentPrice,
      case_unit: caseUnit,
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

    const initialSource =
      vendorProduct.initial_price_event_source === "invoice"
        ? "invoice"
        : "manual";

    const initialInvoiceId =
      typeof vendorProduct.invoice_id === "string" &&
      vendorProduct.invoice_id.trim() !== ""
        ? vendorProduct.invoice_id.trim()
        : null;

    // VVP の case_unit を initial price event の case_unit として引き継ぐ
    const peRow: Record<string, unknown> = {
      tenant_id: selectedTenantId,
      virtual_vendor_product_id: newVendorProduct.id,
      price: currentPrice,
      source_type: initialSource,
      user_id: req.user!.id,
      invoice_id: initialInvoiceId,
      case_unit: caseUnit,
      case_purchased: vendorProduct.initial_case_purchased ?? null,
      unit_purchased: vendorProduct.initial_unit_purchased ?? (caseUnit == null ? 1 : null),
    };

    if (initialSource === "invoice") {
      const raw = vendorProduct.invoice_date;
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const iso = utcMidnightIsoFromYyyyMmDd(raw);
        if (!iso) {
          await supabase
            .from("virtual_vendor_products")
            .delete()
            .eq("id", newVendorProduct.id);
          return res
            .status(400)
            .json({ error: "invoice_date must be YYYY-MM-DD" });
        }
        peRow.created_at = iso;
      }
    }

    const { error: peError } = await supabase.from("price_events").insert([
      peRow,
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
 * POST /vendor-products/bulk/manual-prices
 * Record manual prices atomically (all-or-nothing)
 */
router.post(
  "/bulk/manual-prices",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.create_item,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      const operations = req.body?.operations;

      if (!Array.isArray(operations) || operations.length === 0) {
        return res.status(400).json({ error: "operations must be a non-empty array" });
      }

      const { data, error } = await supabase.rpc("record_manual_prices_atomic", {
        p_tenant_id: selectedTenantId,
        p_user_id: req.user!.id,
        p_operations: operations,
      });

      if (error) {
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

      const changedVendorProductIds: string[] =
        Array.isArray(data) && data.length > 0 && data[0]?.changed_vendor_product_ids
          ? data[0].changed_vendor_product_ids
          : [];

      return res.status(201).json({
        changed_vendor_product_ids: changedVendorProductIds,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
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
