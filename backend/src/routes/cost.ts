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

    const costPerGram = await calculateCost(id, req.user!.id);

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

    // PostgreSQL関数を呼び出し
    const { data, error } = await supabase.rpc("calculate_item_costs", {
      p_user_id: req.user!.id,
      p_item_ids: item_ids.length > 0 ? item_ids : null,
    });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    if (!data || !Array.isArray(data)) {
      throw new Error("Invalid response from database function");
    }

    // 結果をオブジェクトに変換
    const costs: Record<string, number> = {};
    for (const row of data) {
      costs[row.item_id] = parseFloat(row.cost_per_gram) || 0;
    }

    res.json({ costs });
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
    // PostgreSQL関数を呼び出し（user_idをパラメータとして渡す）
    const { data, error } = await supabase.rpc(
      "calculate_item_costs_with_breakdown",
      { p_user_id: req.user!.id }
    );

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    if (!data || !Array.isArray(data)) {
      throw new Error("Invalid response from database function");
    }

    // 結果をitem_idをキーとするオブジェクトに変換
    const costs: Record<
      string,
      {
        food_cost_per_gram: number;
        labor_cost_per_gram: number;
        total_cost_per_gram: number;
      }
    > = {};

    for (const row of data) {
      costs[row.out_item_id] = {
        food_cost_per_gram: parseFloat(row.out_food_cost_per_gram) || 0,
        labor_cost_per_gram: parseFloat(row.out_labor_cost_per_gram) || 0,
        total_cost_per_gram: parseFloat(row.out_total_cost_per_gram) || 0,
      };
    }

    res.json({ costs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
