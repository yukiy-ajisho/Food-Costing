import { Router } from "express";
import { calculateCost, clearCostCache } from "../services/cost";

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
    const message =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
    res.status(400).json({
      error: error.message,
    });
  }
});

export default router;
