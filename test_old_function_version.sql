-- =========================================================
-- Test: Old version of calculate_item_costs_with_breakdown (without p_user_id)
-- =========================================================
-- This creates a temporary version of the old function to test
-- if the issue with non-mass units (ml, etc.) exists in the old version

-- =========================================================
-- Step 1: Create the old version function with a different name
-- =========================================================
CREATE OR REPLACE FUNCTION calculate_item_costs_with_breakdown_old()
RETURNS TABLE (
  out_item_id uuid,
  out_item_name text,
  out_total_cost_per_gram numeric,
  out_food_cost_per_gram numeric,
  out_labor_cost_per_gram numeric
) AS $$
DECLARE
  v_rows_inserted integer;
  v_iteration integer := 0;
BEGIN
  -- 一時テーブル: Item単位でコストを管理
  DROP TABLE IF EXISTS temp_item_costs;
  CREATE TEMP TABLE temp_item_costs (
    item_id uuid PRIMARY KEY,
    item_name text,
    food_cost_per_gram numeric,
    labor_cost_per_gram numeric
  );

  -- ステップ1: Raw Itemsのコストを計算
  INSERT INTO temp_item_costs (item_id, item_name, food_cost_per_gram, labor_cost_per_gram)
  SELECT
    i.id,
    i.name,
    CASE
      WHEN rl.specific_child = 'lowest' OR rl.specific_child IS NULL THEN
        (SELECT MIN(
          CASE
            WHEN vp.purchase_unit = 'kg' THEN (vp.purchase_cost / (vp.purchase_quantity * 1000))
            WHEN vp.purchase_unit = 'lb' THEN (vp.purchase_cost / (vp.purchase_quantity * 453.592))
            WHEN vp.purchase_unit = 'oz' THEN (vp.purchase_cost / (vp.purchase_quantity * 28.3495))
            WHEN vp.purchase_unit = 'g' THEN (vp.purchase_cost / vp.purchase_quantity)
            WHEN vp.purchase_unit = 'each' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(i.each_grams, 0)))
            WHEN vp.purchase_unit = 'gallon' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541))
            WHEN vp.purchase_unit = 'liter' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1))
            WHEN vp.purchase_unit = 'floz' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735))
            WHEN vp.purchase_unit = 'ml' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001))
            ELSE NULL
          END
        )
        FROM vendor_products vp
        LEFT JOIN base_items bi ON vp.base_item_id = bi.id
        WHERE vp.base_item_id = i.base_item_id
          AND vp.deprecated IS NULL
          AND vp.purchase_cost > 0
          AND vp.purchase_quantity > 0)
      ELSE
        (SELECT
          CASE
            WHEN vp.purchase_unit = 'kg' THEN (vp.purchase_cost / (vp.purchase_quantity * 1000))
            WHEN vp.purchase_unit = 'lb' THEN (vp.purchase_cost / (vp.purchase_quantity * 453.592))
            WHEN vp.purchase_unit = 'oz' THEN (vp.purchase_cost / (vp.purchase_quantity * 28.3495))
            WHEN vp.purchase_unit = 'g' THEN (vp.purchase_cost / vp.purchase_quantity)
            WHEN vp.purchase_unit = 'each' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(i.each_grams, 0)))
            WHEN vp.purchase_unit = 'gallon' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541))
            WHEN vp.purchase_unit = 'liter' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1))
            WHEN vp.purchase_unit = 'floz' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735))
            WHEN vp.purchase_unit = 'ml' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001))
            ELSE NULL
          END
        FROM vendor_products vp
        LEFT JOIN base_items bi ON vp.base_item_id = bi.id
        WHERE vp.id = rl.specific_child::uuid
          AND vp.purchase_cost > 0
          AND vp.purchase_quantity > 0)
    END as food_cost_per_gram,
    0::numeric as labor_cost_per_gram
  FROM items i
  LEFT JOIN recipe_lines rl ON i.id = rl.child_item_id AND rl.line_type = 'ingredient'
  LEFT JOIN base_items bi ON i.base_item_id = bi.id
  WHERE i.item_kind = 'raw'
  GROUP BY i.id, i.name, i.each_grams, i.base_item_id, bi.specific_weight, rl.specific_child
  ON CONFLICT (item_id) DO NOTHING;

  -- ステップ2: ループでPrepped Itemsを計算
  LOOP
    v_iteration := v_iteration + 1;
    
    -- すべての材料のコストが既に計算されているPrepped Itemsを見つけて計算
    INSERT INTO temp_item_costs (item_id, item_name, food_cost_per_gram, labor_cost_per_gram)
    SELECT
      parent.id,
      parent.name,
      -- Food Cost: 材料のfood costを積算 / yield
      SUM(
        tc.food_cost_per_gram *
        CASE
          WHEN rl.unit = 'kg' THEN rl.quantity * 1000
          WHEN rl.unit = 'lb' THEN rl.quantity * 453.592
          WHEN rl.unit = 'oz' THEN rl.quantity * 28.3495
          WHEN rl.unit = 'g' THEN rl.quantity
          WHEN rl.unit = 'gallon' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 3785.41
          WHEN rl.unit = 'liter' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000
          WHEN rl.unit = 'floz' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 29.5735
          WHEN rl.unit = 'ml' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1
          WHEN rl.unit = 'each' THEN rl.quantity * COALESCE(child_items.each_grams, 0)
          ELSE 0
        END
      ) / NULLIF(
        CASE
          WHEN parent.proceed_yield_unit = 'kg' THEN parent.proceed_yield_amount * 1000
          WHEN parent.proceed_yield_unit = 'g' THEN parent.proceed_yield_amount
          WHEN parent.proceed_yield_unit = 'each' THEN parent.proceed_yield_amount * COALESCE(parent.each_grams, 1)
          ELSE 1
        END, 0
      ) as food_cost_per_gram,
      -- Labor Cost: 子の合計labor cost（Inherited + Direct）を積算 / yield
      SUM(
        (tc.labor_cost_per_gram + COALESCE(
          child_labor.labor_cost_batch / NULLIF(
            CASE
              WHEN child_items.proceed_yield_unit = 'kg' THEN child_items.proceed_yield_amount * 1000
              WHEN child_items.proceed_yield_unit = 'g' THEN child_items.proceed_yield_amount
              WHEN child_items.proceed_yield_unit = 'each' THEN child_items.proceed_yield_amount * COALESCE(child_items.each_grams, 1)
              ELSE 1
            END, 0
          ), 0
        )) *
        CASE
          WHEN rl.unit = 'kg' THEN rl.quantity * 1000
          WHEN rl.unit = 'lb' THEN rl.quantity * 453.592
          WHEN rl.unit = 'oz' THEN rl.quantity * 28.3495
          WHEN rl.unit = 'g' THEN rl.quantity
          WHEN rl.unit = 'gallon' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 3785.41
          WHEN rl.unit = 'liter' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000
          WHEN rl.unit = 'floz' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 29.5735
          WHEN rl.unit = 'ml' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1
          WHEN rl.unit = 'each' THEN rl.quantity * COALESCE(child_items.each_grams, 0)
          ELSE 0
        END
      ) / NULLIF(
        CASE
          WHEN parent.proceed_yield_unit = 'kg' THEN parent.proceed_yield_amount * 1000
          WHEN parent.proceed_yield_unit = 'g' THEN parent.proceed_yield_amount
          WHEN parent.proceed_yield_unit = 'each' THEN parent.proceed_yield_amount * COALESCE(parent.each_grams, 1)
          ELSE 1
        END, 0
      ) as labor_cost_per_gram
    FROM items parent
    INNER JOIN recipe_lines rl ON parent.id = rl.parent_item_id AND rl.line_type = 'ingredient'
    INNER JOIN temp_item_costs tc ON rl.child_item_id = tc.item_id
    LEFT JOIN items child_items ON rl.child_item_id = child_items.id
    LEFT JOIN base_items bi ON child_items.base_item_id = bi.id
    LEFT JOIN (
      SELECT
        rl.parent_item_id as item_id,
        SUM((rl.minutes / 60.0) * COALESCE(lr.hourly_wage, 0)) as labor_cost_batch
      FROM recipe_lines rl
      LEFT JOIN labor_roles lr ON rl.labor_role = lr.name
      WHERE rl.line_type = 'labor'
      GROUP BY rl.parent_item_id
    ) child_labor ON child_items.id = child_labor.item_id
    WHERE parent.item_kind = 'prepped'
      AND NOT EXISTS (SELECT 1 FROM temp_item_costs t WHERE t.item_id = parent.id)
      -- すべての材料のコストが計算済みであることを確認
      AND NOT EXISTS (
        SELECT 1 FROM recipe_lines rl2
        WHERE rl2.parent_item_id = parent.id
          AND rl2.line_type = 'ingredient'
          AND NOT EXISTS (SELECT 1 FROM temp_item_costs tc2 WHERE tc2.item_id = rl2.child_item_id)
      )
    GROUP BY parent.id, parent.name, parent.proceed_yield_amount, parent.proceed_yield_unit, parent.each_grams
    ON CONFLICT (item_id) DO NOTHING;

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    EXIT WHEN v_rows_inserted = 0 OR v_iteration > 50;
  END LOOP;

  -- ステップ3: Labor コストを追加して最終結果を返す
  RETURN QUERY
  WITH labor_costs AS (
    SELECT
      rl.parent_item_id as item_id,
      SUM((rl.minutes / 60.0) * COALESCE(lr.hourly_wage, 0)) as labor_cost_batch
    FROM recipe_lines rl
    LEFT JOIN labor_roles lr ON rl.labor_role = lr.name
    WHERE rl.line_type = 'labor'
    GROUP BY rl.parent_item_id
  )
  SELECT
    tc.item_id,
    tc.item_name,
    (tc.food_cost_per_gram + COALESCE(tc.labor_cost_per_gram, 0) + COALESCE(
      lc.labor_cost_batch / NULLIF(
        CASE
          WHEN i.proceed_yield_unit = 'kg' THEN i.proceed_yield_amount * 1000
          WHEN i.proceed_yield_unit = 'g' THEN i.proceed_yield_amount
          WHEN i.proceed_yield_unit = 'each' THEN i.proceed_yield_amount * COALESCE(i.each_grams, 1)
          ELSE 1
        END, 0
      ), 0
    ))::numeric as total_cost_per_gram,
    tc.food_cost_per_gram::numeric,
    (COALESCE(tc.labor_cost_per_gram, 0) + COALESCE(
      lc.labor_cost_batch / NULLIF(
        CASE
          WHEN i.proceed_yield_unit = 'kg' THEN i.proceed_yield_amount * 1000
          WHEN i.proceed_yield_unit = 'g' THEN i.proceed_yield_amount
          WHEN i.proceed_yield_unit = 'each' THEN i.proceed_yield_amount * COALESCE(i.each_grams, 1)
          ELSE 1
        END, 0
      ), 0
    ))::numeric as labor_cost_per_gram
  FROM temp_item_costs tc
  LEFT JOIN items i ON tc.item_id = i.id
  LEFT JOIN labor_costs lc ON tc.item_id = lc.item_id
  WHERE tc.food_cost_per_gram IS NOT NULL
  ORDER BY tc.item_name;

  DROP TABLE IF EXISTS temp_item_costs;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- Step 2: Test the old function
-- =========================================================
-- 注意: この関数はuser_idでフィルタリングしていないので、
-- すべてのユーザーのデータが混在します
-- 特定のユーザーのデータのみを確認したい場合は、結果をフィルタリングしてください

-- 関数を実行
SELECT * FROM calculate_item_costs_with_breakdown_old();

-- 特定のアイテム（例: "diluted milk"）の結果を確認
-- SELECT * FROM calculate_item_costs_with_breakdown_old() 
-- WHERE out_item_name = 'diluted milk';

-- =========================================================
-- Step 3: クリーンアップ（テスト後）
-- =========================================================
-- テストが終わったら、この関数を削除してください
-- DROP FUNCTION IF EXISTS calculate_item_costs_with_breakdown_old();

