import { Router, type Request } from "express";
import { supabase } from "../config/supabase";
import { Vendor } from "../types/database";
import {
  UnifiedTenantAction,
  type UnifiedResource,
} from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import { getUnifiedTenantResource } from "../middleware/unified-resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";

const router = Router();

async function getUnifiedVendorResource(
  req: Request
): Promise<UnifiedResource | null> {
  const { id } = req.params;
  if (!id) return null;

  let query = supabase.from("vendors").select("id, tenant_id").eq("id", id);
  query = withTenantFilter(query, req);

  const { data, error } = await query.single();
  if (error || !data) return null;

  const tenantId = data.tenant_id;
  return {
    type: "CostResource",
    id: data.id,
    resourceType: "vendor",
    tenant_id: tenantId,
    owner_tenant_id: tenantId,
  };
}

/**
 * GET /vendors
 * 全Vendorsを取得
 */
router.get(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.list_resources,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      let query = supabase.from("vendors").select("*");

      query = withTenantFilter(query, req);

      const { data, error } = await query.order("name", { ascending: true });

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
 * GET /vendors/:id
 * VendorをIDで取得
 */
router.get(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.read_resource,
    getUnifiedVendorResource
  ),
  async (req, res) => {
  try {
    let query = supabase.from("vendors").select("*").eq("id", req.params.id);

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
 * POST /vendors
 * Vendorを作成
 */
router.post(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.create_item,
    getUnifiedTenantResource
  ),
  async (req, res) => {
  try {
    const vendor: Partial<Vendor> = req.body;

    // バリデーション
    if (!vendor.name) {
      return res.status(400).json({ error: "name is required" });
    }

    // tenant_idとuser_idを自動設定（選択されたテナントID、または最初のテナント）
    const selectedTenantId =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    const vendorWithTenantId = {
      ...vendor,
      tenant_id: selectedTenantId,
      user_id: req.user!.id, // 作成者を記録
    };

    const { data, error } = await supabase
      .from("vendors")
      .insert([vendorWithTenantId])
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
  }
);

/**
 * PUT /vendors/:id
 * Vendorを更新
 */
router.put(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.update_item,
    getUnifiedVendorResource
  ),
  async (req, res) => {
  try {
    const vendor: Partial<Vendor> = req.body;
    const { id } = req.params;

    // user_idとtenant_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      user_id: _user_id,
      tenant_id: _tenant_id,
      id: _id,
      ...vendorWithoutIds
    } = vendor;

    let query = supabase.from("vendors").update(vendorWithoutIds).eq("id", id);

    query = withTenantFilter(query, req);

    const { data, error } = await query.select().single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
  }
);

/**
 * DELETE /vendors/:id
 * Vendorを削除
 */
router.delete(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.delete_item,
    getUnifiedVendorResource
  ),
  async (req, res) => {
  try {
    let query = supabase.from("vendors").delete().eq("id", req.params.id);

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
