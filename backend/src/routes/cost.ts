import { Router } from "express";
import {
  calculateCost,
  calculateCosts,
  clearCostCache,
} from "../services/cost";

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

    const costPerGram = await calculateCost(id);

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
 * 複数アイテムのコストを一度に計算（最適化版）
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

    // 複数アイテムのコストを一度に計算
    const costsMap = await calculateCosts(item_ids);

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

export default router;
