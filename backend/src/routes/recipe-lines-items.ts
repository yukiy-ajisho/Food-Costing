import { Router } from "express";
import { supabase } from "../config/supabase";
import { RecipeLine } from "../types/database";
import { getResourceSharesRawBatch } from "../authz/resource-shares";
import {
  authorizeUnified,
  UnifiedTenantAction,
  type UnifiedResource,
} from "../authz/unified/authorize";

const router = Router();

/**
 * POST /items/recipes の authorizeUnified 同時実行上限。
 * 無制限 Promise.all は避け、Cedar / イベントループへの負荷を抑える。
 */
const RECIPE_BATCH_READ_AUTH_CONCURRENCY = 16;

/**
 * 同時実行数を上限とした map。入力順と結果配列の添字が対応する。
 */
async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  if (n === 0) {
    return results;
  }
  const limit = Math.max(1, Math.min(concurrency, n));
  let nextIndex = 0;

  const worker = async () => {
    for (;;) {
      const i = nextIndex++;
      if (i >= n) {
        return;
      }
      results[i] = await mapper(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * GET /items/:id/recipe
 * アイテムのレシピを取得
 */
router.get("/items/:id/recipe", async (req, res) => {
  try {
    const userId = req.user!.id;
    const tenantIds = req.user!.tenant_ids;
    const itemId = req.params.id;

    const { data: item, error: itemError } = await supabase
      .from("items")
      .select("id, tenant_id, item_kind, user_id, responsible_user_id")
      .eq("id", itemId)
      .in("tenant_id", tenantIds)
      .maybeSingle();

    if (itemError || !item) {
      return res.status(404).json({ error: "Item not found" });
    }

    const tenantId = item.tenant_id;
    const tenantRole = req.user!.roles.get(tenantId);
    if (!tenantRole) {
      return res.status(403).json({ error: "Forbidden" });
    }

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
      userId,
      UnifiedTenantAction.read_resource,
      resource,
      undefined,
      { tenantId, tenantRole }
    );

    if (!allowed) {
      return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
    }

    const { data, error } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("parent_item_id", itemId)
      .eq("tenant_id", tenantId)
      .order("created_at");

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
 * POST /items/recipes
 * 複数アイテムのレシピを一度に取得（最適化版）
 * Request body: { item_ids: string[] }
 * Response: { recipes: { [itemId: string]: RecipeLine[] } }
 */
router.post("/items/recipes", async (req, res) => {
  try {
    const userId = req.user!.id;
    const tenantIds = req.user!.tenant_ids;
    const { item_ids } = req.body;

    if (!Array.isArray(item_ids)) {
      return res.status(400).json({
        error: "item_ids must be an array of strings",
      });
    }

    if (item_ids.length === 0) {
      return res.json({ recipes: {} });
    }

    // authorization: 各 itemId が read_resource できるか判定し、許可された item だけ recipe_lines を取得する
    const { data: items, error: itemsError } = await supabase
      .from("items")
      .select("id, tenant_id, item_kind, user_id, responsible_user_id")
      .in("id", item_ids)
      .in("tenant_id", tenantIds);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const itemsById = new Map<string, any>();
    (items ?? []).forEach((it: any) => itemsById.set(it.id, it));

    // resource_shares を item 単位の N クエリにせず 1 回で取得（authorizeUnified 内でテナント/ロールごとにフィルタ）
    const itemIdsForShareBatch = Array.from(itemsById.keys());
    const prefetchedRawSharesByResourceId =
      await getResourceSharesRawBatch("item", itemIdsForShareBatch);

    // 重複 item_id は 1 回だけ authorize（順序は item_ids 先頭からの初出）
    const uniqueAuthItemIds: string[] = [];
    const seenForAuth = new Set<string>();
    for (const itemId of item_ids) {
      const item = itemsById.get(itemId);
      if (!item) continue;
      const tenantRole = req.user!.roles.get(item.tenant_id);
      if (!tenantRole) continue;
      if (seenForAuth.has(itemId)) continue;
      seenForAuth.add(itemId);
      uniqueAuthItemIds.push(itemId);
    }

    const allowedFlags = await mapWithConcurrencyLimit(
      uniqueAuthItemIds,
      RECIPE_BATCH_READ_AUTH_CONCURRENCY,
      async (authItemId) => {
        const item = itemsById.get(authItemId)!;
        const tenantId = item.tenant_id;
        const tenantRole = req.user!.roles.get(tenantId)!;

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

        return authorizeUnified(
          userId,
          UnifiedTenantAction.read_resource,
          resource,
          undefined,
          {
            tenantId,
            tenantRole,
            prefetchedRawSharesByResourceId,
          }
        );
      }
    );

    const readAuthByItemId = new Map<string, boolean>();
    uniqueAuthItemIds.forEach((id, i) => {
      readAuthByItemId.set(id, allowedFlags[i]);
    });

    const allowedItemIds: string[] = [];
    for (const itemId of item_ids) {
      const item = itemsById.get(itemId);
      if (!item) continue;
      const tenantRole = req.user!.roles.get(item.tenant_id);
      if (!tenantRole) continue;
      if (readAuthByItemId.get(itemId) === true) {
        allowedItemIds.push(itemId);
      }
    }

    // アイテムIDごとにグループ化（denied の itemId も空配列を返す）
    const recipes: Record<string, RecipeLine[]> = {};
    for (const itemId of item_ids) {
      recipes[itemId] = [];
    }

    if (allowedItemIds.length > 0) {
      const { data: lines, error: linesError } = await supabase
        .from("recipe_lines")
        .select("*")
        .in("parent_item_id", allowedItemIds)
        .in("tenant_id", tenantIds)
        .order("parent_item_id")
        .order("created_at");

      if (linesError) {
        return res.status(500).json({ error: linesError.message });
      }

      for (const line of lines ?? []) {
        recipes[line.parent_item_id].push(line);
      }
    }

    res.json({ recipes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
