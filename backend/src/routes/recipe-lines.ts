import { Router } from "express";
import { supabase } from "../config/supabase";
import { RecipeLine, Item } from "../types/database";
import { checkCycle } from "../services/cycle-detection";

const router = Router();

/**
 * POST /recipe-lines
 * レシピラインを作成
 */
router.post("/", async (req, res) => {
  try {
    const line: Partial<RecipeLine> = req.body;

    // バリデーション
    if (!line.parent_item_id || !line.line_type) {
      return res.status(400).json({
        error: "parent_item_id and line_type are required",
      });
    }

    if (line.line_type === "ingredient") {
      if (!line.child_item_id || !line.quantity || !line.unit) {
        return res.status(400).json({
          error: "ingredient line requires child_item_id, quantity, and unit",
        });
      }
    } else if (line.line_type === "labor") {
      if (!line.minutes || line.minutes <= 0) {
        return res.status(400).json({
          error: "labor line requires minutes > 0",
        });
      }
    }

    // 循環参照チェック（ingredient lineの場合）
    if (line.line_type === "ingredient" && line.child_item_id) {
      // Itemsを取得（すべてのアイテムを取得して、既存データとの整合性を確保）
      const { data: allItems } = await supabase.from("items").select("*");

      // マップを作成
      const itemsMap = new Map<string, Item>();
      allItems?.forEach((i) => itemsMap.set(i.id, i));

      // すべてのレシピラインを取得（既存データとの整合性を確保）
      const { data: allRecipeLines } = await supabase
        .from("recipe_lines")
        .select("*")
        .eq("line_type", "ingredient");

      // 新しいレシピラインを含むマップを作成
      const recipeLinesMap = new Map<string, RecipeLine[]>();
      allRecipeLines?.forEach((rl) => {
        const existing = recipeLinesMap.get(rl.parent_item_id) || [];
        existing.push(rl);
        recipeLinesMap.set(rl.parent_item_id, existing);
      });

      // 新しいレシピラインを追加
      const newRecipeLine: RecipeLine = {
        id: "", // 一時的なID
        parent_item_id: line.parent_item_id!,
        line_type: line.line_type as "ingredient" | "labor",
        child_item_id: line.child_item_id,
        quantity: line.quantity || null,
        unit: line.unit || null,
        labor_role: null,
        minutes: null,
      };
      const existing = recipeLinesMap.get(line.parent_item_id!) || [];
      existing.push(newRecipeLine);
      recipeLinesMap.set(line.parent_item_id!, existing);

      // 循環参照をチェック（既存データも含めてチェック）
      try {
        await checkCycle(
          line.parent_item_id!,
          new Set(),
          itemsMap,
          recipeLinesMap,
          []
        );
      } catch (cycleError: unknown) {
        const message =
          cycleError instanceof Error ? cycleError.message : String(cycleError);
        return res.status(400).json({
          error: message,
        });
      }
    }

    const { data, error } = await supabase
      .from("recipe_lines")
      .insert([line])
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
 * PUT /recipe-lines/:id
 * レシピラインを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const line: Partial<RecipeLine> = req.body;
    const { id } = req.params;

    // 既存のレシピラインを取得
    const { data: existingLine } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("id", id)
      .single();

    if (!existingLine) {
      return res.status(404).json({ error: "Recipe line not found" });
    }

    // 循環参照チェック（ingredient lineの場合、child_item_idが変更される場合）
    if (
      line.line_type === "ingredient" &&
      line.child_item_id &&
      line.child_item_id !== existingLine.child_item_id
    ) {
      // Itemsを取得（すべてのアイテムを取得して、既存データとの整合性を確保）
      const { data: allItems } = await supabase.from("items").select("*");

      // マップを作成
      const itemsMap = new Map<string, Item>();
      allItems?.forEach((i) => itemsMap.set(i.id, i));

      // すべてのレシピラインを取得（既存データとの整合性を確保）
      const { data: allRecipeLines } = await supabase
        .from("recipe_lines")
        .select("*")
        .eq("line_type", "ingredient");

      // 更新後のレシピラインを含むマップを作成
      const recipeLinesMap = new Map<string, RecipeLine[]>();
      allRecipeLines?.forEach((rl) => {
        if (rl.id === id) {
          // 更新後のレシピライン
          const updated = { ...rl, ...line };
          const existing = recipeLinesMap.get(rl.parent_item_id) || [];
          existing.push(updated);
          recipeLinesMap.set(rl.parent_item_id, existing);
        } else {
          const existing = recipeLinesMap.get(rl.parent_item_id) || [];
          existing.push(rl);
          recipeLinesMap.set(rl.parent_item_id, existing);
        }
      });

      // 循環参照をチェック（既存データも含めてチェック）
      try {
        await checkCycle(
          existingLine.parent_item_id,
          new Set(),
          itemsMap,
          recipeLinesMap,
          []
        );
      } catch (cycleError: unknown) {
        const message =
          cycleError instanceof Error ? cycleError.message : String(cycleError);
        return res.status(400).json({
          error: message,
        });
      }
    }

    const { data, error } = await supabase
      .from("recipe_lines")
      .update(line)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /recipe-lines/:id
 * レシピラインを削除
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("recipe_lines")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /recipe-lines/batch
 * レシピラインを一括で作成/更新/削除
 */
router.post("/batch", async (req, res) => {
  try {
    const { creates, updates, deletes } = req.body;

    // バリデーション
    if (
      !Array.isArray(creates) ||
      !Array.isArray(updates) ||
      !Array.isArray(deletes)
    ) {
      return res.status(400).json({
        error: "creates, updates, and deletes must be arrays",
      });
    }

    // すべてのアイテムとレシピラインを取得（循環参照チェック用）
    const { data: allItems } = await supabase.from("items").select("*");
    const itemsMap = new Map<string, Item>();
    allItems?.forEach((i) => itemsMap.set(i.id, i));

    // 循環参照チェック用: ingredientのみ取得
    const { data: ingredientRecipeLines } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("line_type", "ingredient");

    // 更新対象を探す用: すべてのレシピライン（ingredientとlaborの両方）を取得
    const { data: allRecipeLines } = await supabase
      .from("recipe_lines")
      .select("*");

    // 既存のレシピラインのマップを作成（循環参照チェック用）
    const recipeLinesMap = new Map<string, RecipeLine[]>();
    ingredientRecipeLines?.forEach((rl) => {
      const existing = recipeLinesMap.get(rl.parent_item_id) || [];
      existing.push(rl);
      recipeLinesMap.set(rl.parent_item_id, existing);
    });

    // 更新されるレシピラインのIDを取得
    const updateIds = new Set(updates.map((u: { id: string }) => u.id));
    const deleteIds = new Set(deletes);

    // 変更後のレシピラインのマップを作成（循環参照チェック用）
    const updatedRecipeLinesMap = new Map<string, RecipeLine[]>();

    // 既存のレシピラインをコピー（削除・更新されるものを除外）
    ingredientRecipeLines?.forEach((rl) => {
      if (!updateIds.has(rl.id) && !deleteIds.has(rl.id)) {
        const existing = updatedRecipeLinesMap.get(rl.parent_item_id) || [];
        existing.push(rl);
        updatedRecipeLinesMap.set(rl.parent_item_id, existing);
      }
    });

    // 更新されたレシピラインを追加
    for (const update of updates) {
      const { id, ...lineData } = update;
      // すべてのレシピライン（ingredientとlaborの両方）から探す
      const existingLine = allRecipeLines?.find((rl) => rl.id === id);
      if (!existingLine) {
        return res.status(404).json({
          error: `Recipe line with id ${id} not found`,
        });
      }
      const updatedLine: RecipeLine = {
        ...existingLine,
        ...lineData,
      };
      const existing =
        updatedRecipeLinesMap.get(updatedLine.parent_item_id) || [];
      existing.push(updatedLine);
      updatedRecipeLinesMap.set(updatedLine.parent_item_id, existing);
    }

    // 新規作成されるレシピラインを追加
    for (const create of creates) {
      const newRecipeLine: RecipeLine = {
        id: "", // 一時的なID
        parent_item_id: create.parent_item_id,
        line_type: create.line_type as "ingredient" | "labor",
        child_item_id: create.child_item_id || null,
        quantity: create.quantity || null,
        unit: create.unit || null,
        specific_child: create.specific_child || null,
        labor_role: create.labor_role || null,
        minutes: create.minutes || null,
        created_at: undefined,
        updated_at: undefined,
      };
      const existing =
        updatedRecipeLinesMap.get(newRecipeLine.parent_item_id) || [];
      existing.push(newRecipeLine);
      updatedRecipeLinesMap.set(newRecipeLine.parent_item_id, existing);
    }

    // バリデーション（各レシピライン）
    for (const create of creates) {
      if (!create.parent_item_id || !create.line_type) {
        return res.status(400).json({
          error: "parent_item_id and line_type are required for all creates",
        });
      }
      if (create.line_type === "ingredient") {
        if (!create.child_item_id || !create.quantity || !create.unit) {
          return res.status(400).json({
            error: "ingredient line requires child_item_id, quantity, and unit",
          });
        }
      } else if (create.line_type === "labor") {
        if (!create.minutes || create.minutes <= 0) {
          return res.status(400).json({
            error: "labor line requires minutes > 0",
          });
        }
      }
    }

    for (const update of updates) {
      if (update.line_type === "ingredient") {
        if (!update.child_item_id || !update.quantity || !update.unit) {
          return res.status(400).json({
            error: "ingredient line requires child_item_id, quantity, and unit",
          });
        }
      } else if (update.line_type === "labor") {
        if (!update.minutes || update.minutes <= 0) {
          return res.status(400).json({
            error: "labor line requires minutes > 0",
          });
        }
      }
    }

    // 循環参照チェック（ingredient lineの場合）
    // 変更が影響する親アイテムのIDを収集
    const affectedParentIds = new Set<string>();
    creates.forEach((c: Partial<RecipeLine>) => {
      if (c.line_type === "ingredient" && c.parent_item_id) {
        affectedParentIds.add(c.parent_item_id);
      }
    });
    updates.forEach((u: Partial<RecipeLine>) => {
      const existingLine = allRecipeLines?.find((rl) => rl.id === u.id);
      if (existingLine && existingLine.line_type === "ingredient") {
        affectedParentIds.add(existingLine.parent_item_id);
      }
    });

    // 各影響を受ける親アイテムについて循環参照をチェック
    console.log(
      `[CYCLE DETECTION] Starting cycle detection for ${affectedParentIds.size} affected parent items:`,
      Array.from(affectedParentIds)
    );
    for (const parentId of affectedParentIds) {
      const parentItem = itemsMap.get(parentId);
      const parentItemName = parentItem?.name || parentId;
      console.log(
        `[CYCLE DETECTION] Checking parent item: ${parentItemName} (${parentId})`
      );
      try {
        await checkCycle(
          parentId,
          new Set(),
          itemsMap,
          updatedRecipeLinesMap,
          []
        );
        console.log(
          `[CYCLE DETECTION] ✅ No cycle detected for parent item: ${parentItemName} (${parentId})`
        );
      } catch (cycleError: unknown) {
        const message =
          cycleError instanceof Error ? cycleError.message : String(cycleError);
        console.error(
          `[CYCLE DETECTION] ❌ Cycle detected for parent item: ${parentItemName} (${parentId}): ${message}`
        );
        return res.status(400).json({
          error: message,
        });
      }
    }
    console.log(
      `[CYCLE DETECTION] ✅ All ${affectedParentIds.size} parent items passed cycle detection`
    );

    // データベース操作を実行（削除 → 更新 → 作成の順序）
    const results: {
      created: RecipeLine[];
      updated: RecipeLine[];
      deleted: string[];
    } = {
      created: [],
      updated: [],
      deleted: [],
    };

    // 削除
    if (deletes.length > 0) {
      const { error: deleteError } = await supabase
        .from("recipe_lines")
        .delete()
        .in("id", deletes);

      if (deleteError) {
        return res.status(400).json({ error: deleteError.message });
      }
      results.deleted = deletes;
    }

    // 更新
    if (updates.length > 0) {
      for (const update of updates) {
        const { id, ...lineData } = update;
        const { data, error: updateError } = await supabase
          .from("recipe_lines")
          .update(lineData)
          .eq("id", id)
          .select()
          .single();

        if (updateError) {
          return res.status(400).json({ error: updateError.message });
        }
        if (data) {
          results.updated.push(data);
        }
      }
    }

    // 作成
    if (creates.length > 0) {
      const { data: createdData, error: createError } = await supabase
        .from("recipe_lines")
        .insert(creates)
        .select();

      if (createError) {
        return res.status(400).json({ error: createError.message });
      }
      if (createdData) {
        results.created = createdData;
      }
    }

    res.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
