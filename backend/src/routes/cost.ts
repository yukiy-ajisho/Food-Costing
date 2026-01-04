import { Router } from "express";
import {
  calculateCost,
  // calculateCosts, // PostgreSQL関数を使用するため、不要
  // calculateCostsForAllChanges, // 差分更新はコメントアウト
  clearCostCache,
} from "../services/cost";
import { supabase } from "../config/supabase";

const router = Router();

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

    // 複数テナント対応: すべてのテナントのデータを取得
    const costPerGram = await calculateCost(id, req.user!.tenant_ids);

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

    // PostgreSQL関数を呼び出し（複数テナント対応: 各テナントで計算してマージ）
    // 注意: 現在のPostgreSQL関数は単一テナント対応のため、各テナントで個別に呼び出し
    const allCosts: Record<string, number> = {};
    for (const tenantId of req.user!.tenant_ids) {
    const { data, error } = await supabase.rpc("calculate_item_costs", {
        p_tenant_id: tenantId,
      p_item_ids: item_ids.length > 0 ? item_ids : null,
    });

    if (error) {
        console.error(`Error calculating costs for tenant ${tenantId}:`, error);
        continue;
    }

      if (data && Array.isArray(data)) {
        for (const row of data) {
          // 複数テナントで同じitem_idがある場合、最初に見つかったものを使用
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
    // PostgreSQL関数を呼び出し（複数テナント対応: 各テナントで計算してマージ）
    // 注意: 現在のPostgreSQL関数は単一テナント対応のため、各テナントで個別に呼び出し
    const allCosts: Record<
      string,
      {
        food_cost_per_gram: number;
        labor_cost_per_gram: number;
        total_cost_per_gram: number;
      }
    > = {};

    for (const tenantId of req.user!.tenant_ids) {
      const { data, error } = await supabase.rpc(
        "calculate_item_costs_with_breakdown",
        { p_tenant_id: tenantId }
      );

      if (error) {
        console.error(`Error calculating breakdown for tenant ${tenantId}:`, error);
        continue;
      }

      if (data && Array.isArray(data)) {
    for (const row of data) {
          // 複数テナントで同じitem_idがある場合、最初に見つかったものを使用
          if (!(row.out_item_id in allCosts)) {
            allCosts[row.out_item_id] = {
        food_cost_per_gram: parseFloat(row.out_food_cost_per_gram) || 0,
        labor_cost_per_gram: parseFloat(row.out_labor_cost_per_gram) || 0,
        total_cost_per_gram: parseFloat(row.out_total_cost_per_gram) || 0,
      };
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

export default router;
