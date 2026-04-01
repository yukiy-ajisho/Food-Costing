import { Router, type Request } from "express";
import {
  calculateCost,
  // calculateCosts, // PostgreSQL関数を使用するため、不要
  // calculateCostsForAllChanges, // 差分更新はコメントアウト
  clearCostCache,
} from "../services/cost";
import { supabase } from "../config/supabase";
import {
  authorizeUnified,
  UnifiedTenantAction,
  type UnifiedResource,
} from "../authz/unified/authorize";

const router = Router();

async function authorizeReadItemTenantId(
  req: Request,
  itemId: string
): Promise<{ tenantId: string } | null> {
  const { data: item, error } = await supabase
    .from("items")
    .select("id, tenant_id, item_kind, user_id, responsible_user_id")
    .eq("id", itemId)
    .in("tenant_id", req.user!.tenant_ids)
    .maybeSingle();

  if (error || !item) return null;

  const tenantId = item.tenant_id;
  const tenantRole = req.user!.roles.get(tenantId);
  if (!tenantRole) return null;

  const resource: UnifiedResource = {
    type: "CostResource",
    id: item.id,
    resourceType: "item",
    tenant_id: tenantId,
    owner_tenant_id: tenantId,
    item_kind: item.item_kind,
    user_id: item.user_id,
    responsible_user_id: item.responsible_user_id,
  };

  const allowed = await authorizeUnified(
    req.user!.id,
    UnifiedTenantAction.read_resource,
    resource,
    undefined,
    { tenantId, tenantRole }
  );

  if (!allowed) return null;
  return { tenantId };
}

/**
 * GET /items/:id/cost
 * アイテムのコストを計算（詳細な内訳付き）
 */
router.get("/items/:id/cost", async (req, res) => {
  try {
    const { id } = req.params;

    // キャッシュをクリア（オプション: クエリパラメータで制御可能）
    if (req.query.clear_cache === "true") {
      clearCostCache();
    }

    const auth = await authorizeReadItemTenantId(req, id);
    if (!auth) {
      return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
    }

    const costPerGram = await calculateCost(id, [auth.tenantId]);

    res.json({
      item_id: id,
      cost_per_gram: costPerGram,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /items/costs
 * 複数アイテムのコストを一度に計算（PostgreSQL関数を使用）
 * Request body: { item_ids: string[] }
 * Response: { costs: { [itemId: string]: number } }
 */
router.post("/items/costs", async (req, res) => {
  try {
    const { item_ids } = req.body;

    if (!Array.isArray(item_ids)) {
      return res.status(400).json({
        error: "item_ids must be an array of strings",
      });
    }

    if (item_ids.length === 0) {
      return res.json({ costs: {} });
    }

    const { data: items, error: itemsError } = await supabase
      .from("items")
      .select("id, tenant_id, item_kind, user_id, responsible_user_id")
      .in("id", item_ids)
      .in("tenant_id", req.user!.tenant_ids);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const itemsById = new Map<string, any>();
    (items ?? []).forEach((it: any) => itemsById.set(it.id, it));

    const allowedItemIdsByTenant = new Map<string, string[]>();
    for (const itemId of item_ids) {
      const item = itemsById.get(itemId);
      if (!item) continue;

      const tenantId = item.tenant_id;
      const tenantRole = req.user!.roles.get(tenantId);
      if (!tenantRole) continue;

      const resource: UnifiedResource = {
        type: "CostResource",
        id: item.id,
        resourceType: "item",
        tenant_id: tenantId,
        owner_tenant_id: tenantId,
        item_kind: item.item_kind,
        user_id: item.user_id,
        responsible_user_id: item.responsible_user_id,
      };

      const allowed = await authorizeUnified(
        req.user!.id,
        UnifiedTenantAction.read_resource,
        resource,
        undefined,
        { tenantId, tenantRole }
      );

      if (!allowed) continue;

      const list = allowedItemIdsByTenant.get(tenantId) ?? [];
      list.push(itemId);
      allowedItemIdsByTenant.set(tenantId, list);
    }

    const allCosts: Record<string, number> = {};
    for (const [tenantId, allowedItemIds] of allowedItemIdsByTenant.entries()) {
      const { data, error } = await supabase.rpc("calculate_item_costs", {
        p_tenant_id: tenantId,
        p_item_ids: allowedItemIds.length > 0 ? allowedItemIds : null,
      });

      if (error) {
        console.error(`Error calculating costs for tenant ${tenantId}:`, error);
        continue;
      }

      if (data && Array.isArray(data)) {
        for (const row of data) {
          if (!(row.item_id in allCosts)) {
            allCosts[row.item_id] = parseFloat(row.cost_per_gram) || 0;
          }
        }
      }
    }

    res.json({ costs: allCosts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /items/costs/differential
 * 差分更新: 変更されたアイテムとその依存関係のみコストを計算
 *
 * 【注意】このエンドポイントは現在コメントアウトされています。
 * フル計算に統一するため、このエンドポイントは使用されていません。
 * 将来的に差分更新が必要になった場合は、このエンドポイントを再実装してください。
 *
 * Request body: {
 *   changed_item_ids?: string[],
 *   changed_vendor_product_ids?: string[],
 *   changed_base_item_ids?: string[],
 *   changed_labor_role_names?: string[]
 * }
 * Response: { costs: { [itemId: string]: number } }
 */
/*
router.post("/items/costs/differential", async (req, res) => {
  try {
    const {
      changed_item_ids = [],
      changed_vendor_product_ids = [],
      changed_base_item_ids = [],
      changed_labor_role_names = [],
    } = req.body;

    if (
      !Array.isArray(changed_item_ids) ||
      !Array.isArray(changed_vendor_product_ids) ||
      !Array.isArray(changed_base_item_ids) ||
      !Array.isArray(changed_labor_role_names)
    ) {
      return res.status(400).json({
        error: "All change arrays must be arrays",
      });
    }

    // 差分更新でコストを計算
    const costsMap = await calculateCostsForAllChanges(
      changed_item_ids,
      changed_vendor_product_ids,
      changed_base_item_ids,
      changed_labor_role_names,
      req.user!.id
    );

    // Mapをオブジェクトに変換
    const costs: Record<string, number> = {};
    costsMap.forEach((cost, itemId) => {
      costs[itemId] = cost;
    });

    res.json({ costs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});
*/

/**
 * GET /items/costs/breakdown
 * 全アイテムのコスト内訳（Food Cost / Labor Cost）を取得
 * Response: {
 *   costs: {
 *     [itemId: string]: {
 *       food_cost_per_gram: number;
 *       labor_cost_per_gram: number;
 *       total_cost_per_gram: number;
 *     }
 *   }
 * }
 */
router.get("/items/costs/breakdown", async (req, res) => {
  try {
    // 現在選択されているテナントのみでRPCを1回呼び出し（X-Tenant-ID で指定、他ルートと同様）
    const tenantIdToUse =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];

    if (!tenantIdToUse) {
      return res.json({ costs: {} });
    }

    const tenantRole = req.user!.roles.get(tenantIdToUse);
    if (!tenantRole) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const allowed = await authorizeUnified(
      req.user!.id,
      UnifiedTenantAction.list_resources,
      { type: "Tenant", id: tenantIdToUse },
      undefined,
      { tenantId: tenantIdToUse, tenantRole }
    );

    if (!allowed) {
      return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
    }

    const { data, error } = await supabase.rpc(
      "calculate_item_costs_with_breakdown",
      { p_tenant_id: tenantIdToUse }
    );

    if (error) {
      console.error(
        `Error calculating breakdown for tenant ${tenantIdToUse}:`,
        error
      );
      return res.status(500).json({
        error: "Failed to calculate cost breakdown",
      });
    }

    const allCosts: Record<
      string,
      {
        food_cost_per_gram: number;
        labor_cost_per_gram: number;
        total_cost_per_gram: number;
      }
    > = {};

    if (data && Array.isArray(data)) {
      for (const row of data) {
        allCosts[row.out_item_id] = {
          food_cost_per_gram: parseFloat(row.out_food_cost_per_gram) || 0,
          labor_cost_per_gram: parseFloat(row.out_labor_cost_per_gram) || 0,
          total_cost_per_gram: parseFloat(row.out_total_cost_per_gram) || 0,
        };
      }
    }

    res.json({ costs: allCosts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /items/costs/breakdown/missing
 * 不足している cross-tenant prepped item のみ breakdown を補完取得
 * Request body: { item_ids: string[] }
 */
router.post("/items/costs/breakdown/missing", async (req, res) => {
  try {
    const tenantIdToUse =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    if (!tenantIdToUse) {
      return res.json({ costs: {} });
    }

    const tenantRole = req.user!.roles.get(tenantIdToUse);
    if (!tenantRole) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const allowed = await authorizeUnified(
      req.user!.id,
      UnifiedTenantAction.list_resources,
      { type: "Tenant", id: tenantIdToUse },
      undefined,
      { tenantId: tenantIdToUse, tenantRole }
    );
    if (!allowed) {
      return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
    }

    const { item_ids } = req.body as { item_ids?: string[] };
    if (!Array.isArray(item_ids)) {
      return res.status(400).json({ error: "item_ids must be an array of strings" });
    }
    const requestedIds = [...new Set(item_ids.filter((id) => typeof id === "string"))];
    if (requestedIds.length === 0) {
      return res.json({ costs: {} });
    }

    const { data: targetItems, error: targetItemsError } = await supabase
      .from("items")
      .select("id, tenant_id, item_kind")
      .in("id", requestedIds)
      .eq("item_kind", "prepped")
      .neq("tenant_id", tenantIdToUse);
    if (targetItemsError) {
      return res.status(500).json({ error: targetItemsError.message });
    }
    if (!targetItems || targetItems.length === 0) {
      return res.json({ costs: {} });
    }

    const { data: myTenant, error: myTenantError } = await supabase
      .from("company_tenants")
      .select("company_id")
      .eq("tenant_id", tenantIdToUse)
      .single();
    if (myTenantError || !myTenant) {
      return res.status(403).json({ error: "Access denied to this tenant" });
    }
    const companyId = myTenant.company_id;

    const ownerTenantIds = [...new Set(targetItems.map((it) => it.tenant_id))];
    const { data: shareRows, error: shareError } = await supabase
      .from("cross_tenant_item_shares")
      .select("item_id, owner_tenant_id, target_type, target_id, allowed_actions")
      .in("item_id", targetItems.map((it) => it.id))
      .in("owner_tenant_id", ownerTenantIds)
      .eq("company_id", companyId)
      .contains("allowed_actions", ["read"]);
    if (shareError) {
      return res.status(500).json({ error: shareError.message });
    }

    const accessibleItemIds = new Set<string>();
    for (const row of shareRows ?? []) {
      const matchesCompany =
        row.target_type === "company" && row.target_id === companyId;
      const matchesTenant =
        row.target_type === "tenant" && row.target_id === tenantIdToUse;
      if (matchesCompany || matchesTenant) {
        accessibleItemIds.add(row.item_id);
      }
    }

    // Hide 後は read 共有が無いが、閲覧テナントの既存 ingredient 行が参照していれば
    // 表示・コスト計算用に scoped breakdown を許可する（grandfather）。
    const pendingGrandfather = targetItems
      .filter((it) => !accessibleItemIds.has(it.id))
      .map((it) => it.id);
    if (pendingGrandfather.length > 0) {
      const { data: refLines, error: refErr } = await supabase
        .from("recipe_lines")
        .select("child_item_id")
        .eq("tenant_id", tenantIdToUse)
        .eq("line_type", "ingredient")
        .in("child_item_id", pendingGrandfather);
      if (!refErr && refLines?.length) {
        const referenced = new Set(
          refLines
            .map((r) => r.child_item_id)
            .filter((id): id is string => typeof id === "string"),
        );
        for (const id of pendingGrandfather) {
          if (referenced.has(id)) accessibleItemIds.add(id);
        }
      }
    }

    const groupedSeeds = new Map<string, string[]>();
    for (const item of targetItems) {
      if (!accessibleItemIds.has(item.id)) continue;
      const list = groupedSeeds.get(item.tenant_id) ?? [];
      list.push(item.id);
      groupedSeeds.set(item.tenant_id, list);
    }
    if (groupedSeeds.size === 0) {
      return res.json({ costs: {} });
    }

    const allCosts: Record<
      string,
      {
        food_cost_per_gram: number;
        labor_cost_per_gram: number;
        total_cost_per_gram: number;
      }
    > = {};

    for (const [ownerTenantId, seedIds] of groupedSeeds.entries()) {
      const { data, error } = await supabase.rpc(
        "calculate_item_costs_with_breakdown_scoped",
        {
          p_tenant_id: ownerTenantId,
          p_call_depth: 0,
          p_seed_item_ids: seedIds,
        }
      );
      if (error) {
        console.error(
          `Error calculating scoped breakdown for tenant ${ownerTenantId}:`,
          error
        );
        continue;
      }
      if (!data || !Array.isArray(data)) continue;

      for (const row of data) {
        if (!accessibleItemIds.has(row.out_item_id)) continue;
        if (!(row.out_item_id in allCosts)) {
          allCosts[row.out_item_id] = {
            food_cost_per_gram: parseFloat(row.out_food_cost_per_gram) || 0,
            labor_cost_per_gram: parseFloat(row.out_labor_cost_per_gram) || 0,
            total_cost_per_gram: parseFloat(row.out_total_cost_per_gram) || 0,
          };
        }
      }
    }

    res.json({ costs: allCosts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
