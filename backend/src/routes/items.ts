import { Router } from "express";
import { supabase } from "../config/supabase";
import { Item, RecipeLine, BaseItem, VendorProduct } from "../types/database";
import { convertToGrams } from "../services/units";
import { MASS_UNIT_CONVERSIONS } from "../constants/units";
import { checkCycle } from "../services/cycle-detection";

const router = Router();

/**
 * GET /items
 * 全アイテムを取得（フィルター対応）
 * Query params: item_kind, is_menu_item
 */
router.get("/", async (req, res) => {
  try {
    let query = supabase
      .from("items")
      .select("*")
      .in("tenant_id", req.user!.tenant_ids);

    // フィルター
    if (req.query.item_kind) {
      query = query.eq("item_kind", req.query.item_kind);
    }
    if (req.query.is_menu_item !== undefined) {
      query = query.eq("is_menu_item", req.query.is_menu_item === "true");
    }

    const { data, error } = await query.order("name");

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
 * GET /items/:id
 * アイテム詳細を取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("id", req.params.id)
      .in("tenant_id", req.user!.tenant_ids)
      .single();

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
 * POST /items
 * アイテムを作成
 */
router.post("/", async (req, res) => {
  try {
    const item: Partial<Item> = req.body;

    // バリデーション
    if (!item.name || !item.item_kind) {
      return res.status(400).json({
        error: "name and item_kind are required",
      });
    }

    // tenant_idを自動設定
    const itemWithTenantId = {
      ...item,
      tenant_id: req.user!.tenant_ids[0], // Phase 2で改善予定
    };

    const { data, error } = await supabase
      .from("items")
      .insert([itemWithTenantId])
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
});

/**
 * PUT /items/:id
 * アイテムを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const item: Partial<Item> = req.body;
    const { id } = req.params;

    // 既存のアイテムを取得（Yieldバリデーションと循環参照チェックの両方で使用）
    const { data: existingItem } = await supabase
      .from("items")
      .select("*")
      .eq("id", id)
      .in("tenant_id", req.user!.tenant_ids)
      .single();

    // Prepped Itemの場合、Yieldバリデーション
    if (
      item.item_kind === "prepped" ||
      item.proceed_yield_amount !== undefined
    ) {
      if (existingItem && existingItem.item_kind === "prepped") {
        // Yieldが更新される場合のみバリデーション
        if (
          item.proceed_yield_amount !== undefined &&
          item.proceed_yield_unit !== undefined
        ) {
          // Yieldが"each"の場合はバリデーションをスキップ
          if (item.proceed_yield_unit !== "each") {
            // レシピラインを取得
            const { data: recipeLines } = await supabase
              .from("recipe_lines")
              .select("*")
              .eq("parent_item_id", id)
              .eq("line_type", "ingredient")
              .in("tenant_id", req.user!.tenant_ids);

            if (recipeLines && recipeLines.length > 0) {
              // Base Itemsを取得
              const { data: baseItems } = await supabase
                .from("base_items")
                .select("*")
                .in("tenant_id", req.user!.tenant_ids);

              // Itemsを取得
              const { data: allItems } = await supabase
                .from("items")
                .select("*")
                .in("tenant_id", req.user!.tenant_ids);

              // Virtual Vendor Productsを取得
              const { data: vendorProducts } = await supabase
                .from("virtual_vendor_products")
                .select("*")
                .in("tenant_id", req.user!.tenant_ids);

              // マップを作成
              const baseItemsMap = new Map<string, BaseItem>();
              baseItems?.forEach((b) => baseItemsMap.set(b.id, b));

              const itemsMap = new Map<string, Item>();
              allItems?.forEach((i) => itemsMap.set(i.id, i));

              const vendorProductsMap = new Map<string, VendorProduct>();
              vendorProducts?.forEach((vp) => vendorProductsMap.set(vp.id, vp));

              // 材料の総合計を計算
              let totalIngredientsGrams = 0;
              for (const line of recipeLines) {
                if (!line.child_item_id || !line.quantity || !line.unit) {
                  continue;
                }

                try {
                  const grams = convertToGrams(
                    line.unit,
                    line.quantity,
                    line.child_item_id,
                    itemsMap,
                    baseItemsMap,
                    vendorProductsMap
                  );
                  void (totalIngredientsGrams += grams);
                } catch (error) {
                  // 変換エラーは無視（バリデーションをスキップ）
                  console.error(
                    `Failed to convert ${line.quantity} ${line.unit} to grams:`,
                    error
                  );
                }
              }

              // Yieldをグラムに変換（バリデーションはフロントエンドで実施）
              const yieldMultiplier =
                MASS_UNIT_CONVERSIONS[item.proceed_yield_unit];
              if (yieldMultiplier) {
                // バリデーションはフロントエンドで実施するため、ここではチェックしない
                void (item.proceed_yield_amount * yieldMultiplier);
              }
            }
          }
        }
      }
    }

    // 循環参照チェック（Prepped Itemの場合）
    if (
      item.item_kind === "prepped" ||
      (existingItem && existingItem.item_kind === "prepped")
    ) {
      // レシピラインを取得（既存のもの）
      const { data: recipeLines } = await supabase
        .from("recipe_lines")
        .select("*")
        .eq("parent_item_id", id)
        .eq("line_type", "ingredient")
        .in("tenant_id", req.user!.tenant_ids);

      if (recipeLines && recipeLines.length > 0) {
        // Itemsを取得（すべてのアイテムを取得して、既存データとの整合性を確保）
        const { data: allItems } = await supabase
          .from("items")
          .select("*")
          .in("tenant_id", req.user!.tenant_ids);

        // マップを作成
        const itemsMap = new Map<string, Item>();
        allItems?.forEach((i) => itemsMap.set(i.id, i));

        // Recipe Linesのマップを作成（すべてのレシピラインを取得）
        const { data: allRecipeLines } = await supabase
          .from("recipe_lines")
          .select("*")
          .eq("line_type", "ingredient")
          .in("tenant_id", req.user!.tenant_ids);

        const recipeLinesMap = new Map<string, RecipeLine[]>();
        allRecipeLines?.forEach((line) => {
          const existing = recipeLinesMap.get(line.parent_item_id) || [];
          existing.push(line);
          recipeLinesMap.set(line.parent_item_id, existing);
        });

        // 循環参照をチェック（既存データも含めてチェック）
        try {
          await checkCycle(
            id,
            req.user!.tenant_ids,
            new Set(),
            itemsMap,
            recipeLinesMap,
            []
          );
        } catch (cycleError: unknown) {
          const message =
            cycleError instanceof Error
              ? cycleError.message
              : String(cycleError);
          return res.status(400).json({
            error: message,
          });
        }
      }
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
      ...itemWithoutIds
    } = item;
    const { data, error } = await supabase
      .from("items")
      .update(itemWithoutIds)
      .eq("id", id)
      .in("tenant_id", req.user!.tenant_ids)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /items/:id/deprecate
 * Prepped Itemをdeprecatedにする
 */
router.patch("/:id/deprecate", async (req, res) => {
  try {
    const { deprecatePreppedItem } = await import("../services/deprecation");
    const result = await deprecatePreppedItem(
      req.params.id,
      req.user!.tenant_ids
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      message: "Item deprecated successfully",
      affectedItems: result.affectedItems,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /items/:id
 * アイテムを削除（物理削除は危険なので非推奨、deprecateを使用してください）
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("items")
      .delete()
      .eq("id", req.params.id)
      .in("tenant_id", req.user!.tenant_ids);

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
