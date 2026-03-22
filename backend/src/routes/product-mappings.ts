import { Router, type Request } from "express";
import { supabase } from "../config/supabase";
import { ProductMapping } from "../types/database";
import { UnifiedTenantAction } from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import { getUnifiedTenantResource } from "../middleware/unified-resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";
import { type UnifiedResource } from "../authz/unified/authorize";

const router = Router();

async function getUnifiedProductMappingResource(
  req: Request
): Promise<UnifiedResource | null> {
  const { id } = req.params;
  if (!id) return null;

  let query = supabase
    .from("product_mappings")
    .select("id, tenant_id")
    .eq("id", id);
  query = withTenantFilter(query, req);

  const { data, error } = await query.single();
  if (error || !data) return null;

  const tenantId = data.tenant_id;
  return {
    type: "CostResource",
    id: data.id,
    resourceType: "product_mapping",
    tenant_id: tenantId,
    owner_tenant_id: tenantId,
  };
}

/**
 * GET /product-mappings
 * 全Product Mappingsを取得（オプション: base_item_idまたはvirtual_product_idでフィルタ）
 */
router.get(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.list_resources,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      let query = supabase.from("product_mappings").select("*");

      query = withTenantFilter(query, req);

      // フィルター
      if (req.query.base_item_id) {
        query = query.eq("base_item_id", req.query.base_item_id as string);
      }
      if (req.query.virtual_product_id) {
        query = query.eq(
          "virtual_product_id",
          req.query.virtual_product_id as string
        );
      }

      const { data, error } = await query.order("created_at", {
        ascending: false,
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json(data || []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /product-mappings/:id
 * Product Mapping詳細を取得
 */
router.get(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.read_resource,
    getUnifiedProductMappingResource
  ),
  async (req, res) => {
  try {
    let query = supabase
      .from("product_mappings")
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
});

/**
 * POST /product-mappings
 * Product Mappingを作成
 */
router.post(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.create_item,
    getUnifiedTenantResource
  ),
  async (req, res) => {
  try {
    const mapping: Partial<ProductMapping> = req.body;

    // バリデーション
    if (!mapping.base_item_id || !mapping.virtual_product_id) {
      return res.status(400).json({
        error: "base_item_id and virtual_product_id are required",
      });
    }

    // tenant_idを自動設定（選択されたテナントID、または最初のテナント）
    const selectedTenantId =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    const mappingWithTenantId = {
      ...mapping,
      tenant_id: selectedTenantId,
    };

    const { data, error } = await supabase
      .from("product_mappings")
      .insert([mappingWithTenantId])
      .select()
      .single();

    if (error) {
      // unique constraint違反の場合、より分かりやすいメッセージに変換
      if (
        error.code === "23505" ||
        error.message.includes("duplicate key") ||
        error.message.includes("unique constraint")
      ) {
        return res.status(400).json({
          error:
            "A mapping between this base item and virtual product already exists for your tenant.",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
  }
);

/**
 * DELETE /product-mappings/:id
 * Product Mappingを削除
 */
router.delete(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.delete_item,
    getUnifiedProductMappingResource
  ),
  async (req, res) => {
  try {
    let query = supabase
      .from("product_mappings")
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
