import { Router } from "express";
import { supabase } from "../config/supabase";
import { Item, RecipeLine, BaseItem, VendorProduct } from "../types/database";
import { convertToGrams } from "../services/units";
import { MASS_UNIT_CONVERSIONS } from "../constants/units";
import { checkCycle } from "../services/cycle-detection";
import { authorizationMiddleware } from "../middleware/authorization";
import {
  getItemResource,
  getCreateResource,
  getCollectionResource,
} from "../middleware/resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";

const router = Router();

/**
 * GET /items
 * 全アイテムを取得（フィルター対応）
 * Query params: item_kind, is_menu_item
 */
router.get(
  "/",
  authorizationMiddleware("read", (req) => getCollectionResource(req, "item")),
  async (req, res) => {
    try {
      let query = supabase.from("items").select("*");
      query = withTenantFilter(query, req);

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

      // Managerの場合、Prepped Itemsに対してフィルタリングを適用
      const currentTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      const role = req.user!.roles.get(currentTenantId);

      if (role === "manager" && data) {
        // Prepped Itemsのみをフィルタリング
        const preppedItems = data.filter(
          (item) => item.item_kind === "prepped"
        );
        const otherItems = data.filter((item) => item.item_kind !== "prepped");

        // 自分が作ったPrepped Items（user_idまたはresponsible_user_idが自分）
        const ownPreppedItems = preppedItems.filter(
          (item) =>
            item.user_id === req.user!.id ||
            item.responsible_user_id === req.user!.id
        );

        // 自分が作ったものではないPrepped Items
        const otherPreppedItems = preppedItems.filter(
          (item) =>
            item.user_id !== req.user!.id &&
            item.responsible_user_id !== req.user!.id
        );

        // resource_sharesから共有されているPrepped Itemsを一括取得（パフォーマンス最適化）
        if (otherPreppedItems.length > 0) {
          const otherPreppedItemIds = otherPreppedItems.map((item) => item.id);

          // 一括でresource_sharesを取得
          const { data: shares } = await supabase
            .from("resource_shares")
            .select("*")
            .eq("resource_type", "item")
            .in("resource_id", otherPreppedItemIds)
            .eq("is_exclusion", false); // permitのみ

          // 共有されているPrepped ItemsのIDを取得
          const sharedItemIds: string[] = [];
          if (shares && shares.length > 0) {
            for (const share of shares) {
              // プリンシパルに適用される共有情報をチェック
              let isApplicable = false;
              if (share.target_id) {
                if (share.target_type === "tenant") {
                  isApplicable = share.target_id === currentTenantId;
                } else if (share.target_type === "role") {
                  isApplicable = share.target_id === role;
                } else if (share.target_type === "user") {
                  isApplicable = share.target_id === req.user!.id;
                }
              }

              if (isApplicable) {
                // allowed_actionsにreadが含まれているかチェック
                // hide状態（allowed_actionsが空）の場合は、responsible_user_idのユーザー以外は表示されない
                const allowedActions = share.allowed_actions || [];
                if (
                  allowedActions.length > 0 &&
                  allowedActions.includes("read")
                ) {
                  sharedItemIds.push(share.resource_id);
                }
              }
            }
          }

          // 共有されているPrepped Itemsを取得
          const sharedPreppedItems = otherPreppedItems.filter((item) =>
            sharedItemIds.includes(item.id)
          );

          // 自分が作ったもの + 共有されているものを結合
          const filteredPreppedItems = [
            ...ownPreppedItems,
            ...sharedPreppedItems,
          ];

          // 他のアイテム（Raw Itemsなど）と結合
          const filteredData = [...otherItems, ...filteredPreppedItems];

          return res.json(filteredData);
        } else {
          // 自分が作ったPrepped Itemsのみ
          const filteredData = [...otherItems, ...ownPreppedItems];
          return res.json(filteredData);
        }
      }

      // Adminまたはその他のロールの場合、全データを返す
      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /items/:id
 * アイテム詳細を取得
 */
router.get(
  "/:id",
  authorizationMiddleware("read", getItemResource),
  async (req, res) => {
    try {
      let query = supabase.from("items").select("*").eq("id", req.params.id);
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
 * POST /items
 * アイテムを作成
 */
router.post(
  "/",
  authorizationMiddleware("create", (req) => getCreateResource(req, "item")),
  async (req, res) => {
    try {
      const item: Partial<Item> = req.body;

      // バリデーション
      if (!item.name || !item.item_kind) {
        return res.status(400).json({
          error: "name and item_kind are required",
        });
      }

      // tenant_idを自動設定（選択されたテナントID、または最初のテナント）
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      // responsible_user_idを自動設定（デフォルトはuser_id、つまり作成者）
      const itemWithTenantId = {
        ...item,
        tenant_id: selectedTenantId,
        user_id: req.user!.id, // 作成者を記録
        responsible_user_id: item.responsible_user_id || req.user!.id, // デフォルトは作成者
      };

      const { data, error } = await supabase
        .from("items")
        .insert([itemWithTenantId])
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // Prepped Itemでresponsible_user_idが設定されている場合、resource_sharesレコードを自動作成（hide状態）
      if (data.item_kind === "prepped" && data.responsible_user_id) {
        const hideShare = {
          resource_type: "item",
          resource_id: data.id,
          owner_tenant_id: selectedTenantId,
          target_type: "role" as const,
          target_id: "manager",
          allowed_actions: [] as string[], // hide状態 = allowed_actionsが空
          is_exclusion: false,
          show_history_to_shared: false,
        };

        const { error: shareError } = await supabase
          .from("resource_shares")
          .insert([hideShare]);

        if (shareError) {
          console.error("Failed to create resource share:", shareError);
          // エラーが発生してもアイテム作成は成功とする（ロールバックはしない）
        }
      }

      res.status(201).json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PUT /items/:id
 * アイテムを更新
 */
router.put(
  "/:id",
  authorizationMiddleware("update", getItemResource),
  async (req, res) => {
    try {
      const item: Partial<Item> = req.body;
      const { id } = req.params;

      // 既存のアイテムを取得（Yieldバリデーションと循環参照チェックの両方で使用）
      let existingItemQuery = supabase.from("items").select("*").eq("id", id);
      existingItemQuery = withTenantFilter(existingItemQuery, req);
      const { data: existingItem } = await existingItemQuery.single();

      // responsible_user_idの変更権限チェック（Adminのみ許可）
      if (
        item.responsible_user_id !== undefined &&
        existingItem &&
        item.responsible_user_id !== existingItem.responsible_user_id
      ) {
        const currentTenantId =
          req.user!.selected_tenant_id || req.user!.tenant_ids[0];
        const role = req.user!.roles.get(currentTenantId);
        if (role !== "admin") {
          return res.status(403).json({
            error: "Only admins can change responsible_user_id",
          });
        }
      }

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
              let recipeLinesQuery = supabase
                .from("recipe_lines")
                .select("*")
                .eq("parent_item_id", id)
                .eq("line_type", "ingredient");
              recipeLinesQuery = withTenantFilter(recipeLinesQuery, req);
              const { data: recipeLines } = await recipeLinesQuery;

              if (recipeLines && recipeLines.length > 0) {
                // Base Itemsを取得
                let baseItemsQuery = supabase.from("base_items").select("*");
                baseItemsQuery = withTenantFilter(baseItemsQuery, req);
                const { data: baseItems } = await baseItemsQuery;

                // Itemsを取得
                let allItemsQuery = supabase.from("items").select("*");
                allItemsQuery = withTenantFilter(allItemsQuery, req);
                const { data: allItems } = await allItemsQuery;

                // Virtual Vendor Productsを取得
                let vendorProductsQuery = supabase
                  .from("virtual_vendor_products")
                  .select("*");
                vendorProductsQuery = withTenantFilter(
                  vendorProductsQuery,
                  req
                );
                const { data: vendorProducts } = await vendorProductsQuery;

                // マップを作成
                const baseItemsMap = new Map<string, BaseItem>();
                baseItems?.forEach((b) => baseItemsMap.set(b.id, b));

                const itemsMap = new Map<string, Item>();
                allItems?.forEach((i) => itemsMap.set(i.id, i));

                const vendorProductsMap = new Map<string, VendorProduct>();
                vendorProducts?.forEach((vp) =>
                  vendorProductsMap.set(vp.id, vp)
                );

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
        let recipeLinesQuery = supabase
          .from("recipe_lines")
          .select("*")
          .eq("parent_item_id", id)
          .eq("line_type", "ingredient");
        recipeLinesQuery = withTenantFilter(recipeLinesQuery, req);
        const { data: recipeLines } = await recipeLinesQuery;

        if (recipeLines && recipeLines.length > 0) {
          // Itemsを取得（すべてのアイテムを取得して、既存データとの整合性を確保）
          let allItemsQuery = supabase.from("items").select("*");
          allItemsQuery = withTenantFilter(allItemsQuery, req);
          const { data: allItems } = await allItemsQuery;

          // マップを作成
          const itemsMap = new Map<string, Item>();
          allItems?.forEach((i) => itemsMap.set(i.id, i));

          // Recipe Linesのマップを作成（すべてのレシピラインを取得）
          let allRecipeLinesQuery = supabase
            .from("recipe_lines")
            .select("*")
            .eq("line_type", "ingredient");
          allRecipeLinesQuery = withTenantFilter(allRecipeLinesQuery, req);
          const { data: allRecipeLines } = await allRecipeLinesQuery;

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
      let updateQuery = supabase
        .from("items")
        .update(itemWithoutIds)
        .eq("id", id);
      updateQuery = withTenantFilter(updateQuery, req);
      const { data, error } = await updateQuery.select().single();

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
  }
);

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
router.delete(
  "/:id",
  authorizationMiddleware("delete", getItemResource),
  async (req, res) => {
    try {
      let deleteQuery = supabase.from("items").delete().eq("id", req.params.id);
      deleteQuery = withTenantFilter(deleteQuery, req);
      const { error } = await deleteQuery;

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
