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

export default router;
