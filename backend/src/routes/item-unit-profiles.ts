import { Router } from "express";
import { supabase } from "../config/supabase";
import { ItemUnitProfile } from "../types/database";
import {
  authorizeUnified,
  UnifiedTenantAction,
  type UnifiedResource,
} from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import { getUnifiedTenantResource } from "../middleware/unified-resource-helpers";

const router = Router();

/**
 * GET /item-unit-profiles
 * 全単位プロファイルを取得
 */
router.get(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.list_resources,
    getUnifiedTenantResource
  ),
  async (req, res) => {
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
  }
);

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

    if (!data) {
      return res.status(404).json({ error: "Item unit profile not found" });
    }

    const tenantId = data.tenant_id;
    const tenantRole = req.user!.roles.get(tenantId);
    if (!tenantRole) return res.status(403).json({ error: "Forbidden" });

    const resource: UnifiedResource = {
      type: "CostResource",
      id: data.id,
      resourceType: "item_unit_profile",
      tenant_id: tenantId,
      owner_tenant_id: tenantId,
    };

    const allowed = await authorizeUnified(
      req.user!.id,
      UnifiedTenantAction.read_resource,
      resource,
      undefined,
      { tenantId, tenantRole }
    );

    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
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
router.post(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.create_item,
    getUnifiedTenantResource
  ),
  async (req, res) => {
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

    // tenant_idを自動設定（選択されたテナントID、または最初のテナント）
    const selectedTenantId =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    const profileWithTenantId = {
      ...profile,
      tenant_id: selectedTenantId,
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
  }
);

/**
 * PUT /item-unit-profiles/:id
 * 単位プロファイルを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const profile: Partial<ItemUnitProfile> = req.body;
    const { id } = req.params;

    const { data: existing, error: existingError } = await supabase
      .from("item_unit_profiles")
      .select("id, tenant_id")
      .eq("id", id)
      .in("tenant_id", req.user!.tenant_ids)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ error: "Item unit profile not found" });
    }

    const tenantId = existing.tenant_id;
    const tenantRole = req.user!.roles.get(tenantId);
    if (!tenantRole) return res.status(403).json({ error: "Forbidden" });

    const resource: UnifiedResource = {
      type: "CostResource",
      id: existing.id,
      resourceType: "item_unit_profile",
      tenant_id: tenantId,
      owner_tenant_id: tenantId,
    };

    const allowed = await authorizeUnified(
      req.user!.id,
      UnifiedTenantAction.update_item,
      resource,
      undefined,
      { tenantId, tenantRole }
    );

    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
    }

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
      .eq("tenant_id", tenantId)
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
    const { data: existing, error: existingError } = await supabase
      .from("item_unit_profiles")
      .select("id, tenant_id")
      .eq("id", req.params.id)
      .in("tenant_id", req.user!.tenant_ids)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ error: "Item unit profile not found" });
    }

    const tenantId = existing.tenant_id;
    const tenantRole = req.user!.roles.get(tenantId);
    if (!tenantRole) return res.status(403).json({ error: "Forbidden" });

    const resource: UnifiedResource = {
      type: "CostResource",
      id: existing.id,
      resourceType: "item_unit_profile",
      tenant_id: tenantId,
      owner_tenant_id: tenantId,
    };

    const allowed = await authorizeUnified(
      req.user!.id,
      UnifiedTenantAction.delete_item,
      resource,
      undefined,
      { tenantId, tenantRole }
    );

    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
    }

    const { error } = await supabase
      .from("item_unit_profiles")
      .delete()
      .eq("id", req.params.id)
      .eq("tenant_id", tenantId);

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
