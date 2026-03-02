-- =========================================================
-- 改良版 calculate_item_costs_with_breakdown (v2)
-- 作成日: 2026-02-24
-- 元のバージョン: calculate_item_costs_with_breakdown_current_2026-02-24.sql
--
-- v1からの変更点（パフォーマンス改善）:
--   1. temp_labor_costs: labor costsをループ外で一度だけ計算
--      → ループN回分のサブクエリ実行を1回に削減
--   2. temp_ingredient_edges: recipe_linesをループ外でマテリアライズ + インデックス追加
--      → ループ毎のrecipe_linesフルスキャンを排除
--   3. temp_ingredient_counts: ingredient数を事前計算
--      → 二重NOT EXISTSをHAVING COUNT比較に置換（より効率的）
--   4. ステップ3でtemp_labor_costsを再利用（再計算不要）
--   5. 全temp tableを開始時にDROPして前回の失敗実行残りを防止
-- =========================================================

CREATE OR REPLACE FUNCTION calculate_item_costs_with_breakdown(p_tenant_id uuid)
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
  -- 全temp tableをクリア（前回の失敗した実行からの残りを防ぐ）
  DROP TABLE IF EXISTS temp_item_costs;
  DROP TABLE IF EXISTS temp_labor_costs;
  DROP TABLE IF EXISTS temp_ingredient_edges;
  DROP TABLE IF EXISTS temp_ingredient_counts;

  -- メインコスト管理テーブル
  CREATE TEMP TABLE temp_item_costs (
    item_id uuid PRIMARY KEY,
    item_name text,
    food_cost_per_gram numeric,
    labor_cost_per_gram numeric
  );

  -- 最適化①: Labor costsをループ外で一度だけ計算
  CREATE TEMP TABLE temp_labor_costs AS
  SELECT
    rl.parent_item_id AS item_id,
    SUM((rl.minutes / 60.0) * COALESCE(lr.hourly_wage, 0)) AS labor_cost_batch
  FROM recipe_lines rl
  LEFT JOIN labor_roles lr ON rl.labor_role = lr.name
  WHERE rl.line_type = 'labor'
    AND rl.tenant_id = p_tenant_id
    AND lr.tenant_id = p_tenant_id
  GROUP BY rl.parent_item_id;

  CREATE INDEX ON temp_labor_costs(item_id);

  -- 最適化②: Ingredient edgesをループ外でマテリアライズ + インデックス追加
  CREATE TEMP TABLE temp_ingredient_edges AS
  SELECT
    rl.parent_item_id,
    rl.child_item_id,
    rl.quantity,
    rl.unit
  FROM recipe_lines rl
  WHERE rl.line_type = 'ingredient'
    AND rl.tenant_id = p_tenant_id;

  CREATE INDEX ON temp_ingredient_edges(parent_item_id);
  CREATE INDEX ON temp_ingredient_edges(child_item_id);

  -- 最適化③: 各prepped itemのingredient数を事前計算（二重NOT EXISTSの代替用）
  CREATE TEMP TABLE temp_ingredient_counts AS
  SELECT parent_item_id, COUNT(DISTINCT child_item_id) AS total_count
  FROM temp_ingredient_edges
  GROUP BY parent_item_id;

  CREATE INDEX ON temp_ingredient_counts(parent_item_id);

  -- ステップ1: Raw Itemsのコストを計算（tenant_idでフィルタリング、specific_child処理を保持）
  -- ※ specific_child判定のためrecipe_linesを直接使用（ループ外の一回のみ）
  INSERT INTO temp_item_costs (item_id, item_name, food_cost_per_gram, labor_cost_per_gram)
  SELECT
    i.id,
    i.name,
    CASE
      WHEN rl.specific_child = 'lowest' OR rl.specific_child IS NULL THEN
        (SELECT MIN(
          CASE
            WHEN vvp.purchase_unit = 'kg' THEN (vvp.purchase_cost / (vvp.purchase_quantity * 1000))
            WHEN vvp.purchase_unit = 'lb' THEN (vvp.purchase_cost / (vvp.purchase_quantity * 453.592))
            WHEN vvp.purchase_unit = 'oz' THEN (vvp.purchase_cost / (vvp.purchase_quantity * 28.3495))
            WHEN vvp.purchase_unit = 'g' THEN (vvp.purchase_cost / vvp.purchase_quantity)
            WHEN vvp.purchase_unit = 'each' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(i.each_grams, 0)))
            WHEN vvp.purchase_unit = 'gallon' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541))
            WHEN vvp.purchase_unit = 'liter' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1))
            WHEN vvp.purchase_unit = 'floz' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735))
            WHEN vvp.purchase_unit = 'ml' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001))
            ELSE NULL
          END
        )
        FROM virtual_vendor_products vvp
        JOIN product_mappings pm ON vvp.id = pm.virtual_product_id
        JOIN base_items bi ON pm.base_item_id = bi.id
        WHERE pm.base_item_id = i.base_item_id
          AND pm.tenant_id = p_tenant_id
          AND vvp.tenant_id = p_tenant_id
          AND bi.tenant_id = p_tenant_id
          AND vvp.deprecated IS NULL
          AND vvp.purchase_cost > 0
          AND vvp.purchase_quantity > 0)
      ELSE
        (SELECT
          CASE
            WHEN vvp.purchase_unit = 'kg' THEN (vvp.purchase_cost / (vvp.purchase_quantity * 1000))
            WHEN vvp.purchase_unit = 'lb' THEN (vvp.purchase_cost / (vvp.purchase_quantity * 453.592))
            WHEN vvp.purchase_unit = 'oz' THEN (vvp.purchase_cost / (vvp.purchase_quantity * 28.3495))
            WHEN vvp.purchase_unit = 'g' THEN (vvp.purchase_cost / vvp.purchase_quantity)
            WHEN vvp.purchase_unit = 'each' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(i.each_grams, 0)))
            WHEN vvp.purchase_unit = 'gallon' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541))
            WHEN vvp.purchase_unit = 'liter' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1))
            WHEN vvp.purchase_unit = 'floz' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735))
            WHEN vvp.purchase_unit = 'ml' THEN (vvp.purchase_cost / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001))
            ELSE NULL
          END
        FROM virtual_vendor_products vvp
        JOIN product_mappings pm ON vvp.id = pm.virtual_product_id
        JOIN base_items bi ON pm.base_item_id = bi.id
        WHERE vvp.id = rl.specific_child::uuid
          AND pm.base_item_id = i.base_item_id
          AND pm.tenant_id = p_tenant_id
          AND vvp.tenant_id = p_tenant_id
          AND bi.tenant_id = p_tenant_id
          AND vvp.purchase_cost > 0
          AND vvp.purchase_quantity > 0)
    END as food_cost_per_gram,
    0::numeric as labor_cost_per_gram
  FROM items i
  LEFT JOIN recipe_lines rl ON i.id = rl.child_item_id AND rl.line_type = 'ingredient'
  LEFT JOIN base_items bi ON i.base_item_id = bi.id
  WHERE i.item_kind = 'raw'
    AND i.tenant_id = p_tenant_id
    AND (rl.tenant_id = p_tenant_id OR rl.tenant_id IS NULL)
    AND (bi.tenant_id = p_tenant_id OR bi.tenant_id IS NULL)
  GROUP BY i.id, i.name, i.each_grams, i.base_item_id, bi.specific_weight, rl.specific_child
  ON CONFLICT (item_id) DO NOTHING;

  -- ステップ2: ループでPrepped Itemsを計算
  -- 最適化: temp_ingredient_edges / temp_labor_costs / temp_ingredient_counts を使用
  LOOP
    v_iteration := v_iteration + 1;

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
          WHEN rl.unit = 'liter' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000
          WHEN rl.unit = 'floz' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 29.5735
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
      ) AS food_cost_per_gram,
      -- Labor Cost: 子の合計labor cost（Inherited + Direct）を積算 / yield
      SUM(
        (tc.labor_cost_per_gram + COALESCE(
          tlc_child.labor_cost_batch / NULLIF(
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
          WHEN rl.unit = 'liter' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000
          WHEN rl.unit = 'floz' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 29.5735
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
      ) AS labor_cost_per_gram
    FROM items parent
    INNER JOIN temp_ingredient_edges rl ON parent.id = rl.parent_item_id
    INNER JOIN temp_item_costs tc ON rl.child_item_id = tc.item_id
    LEFT JOIN items child_items ON rl.child_item_id = child_items.id
    LEFT JOIN base_items bi ON child_items.base_item_id = bi.id
    LEFT JOIN temp_labor_costs tlc_child ON child_items.id = tlc_child.item_id
    WHERE parent.item_kind = 'prepped'
      AND parent.tenant_id = p_tenant_id
      AND child_items.tenant_id = p_tenant_id
      AND (bi.tenant_id = p_tenant_id OR bi.tenant_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM temp_item_costs t WHERE t.item_id = parent.id)
    GROUP BY parent.id, parent.name, parent.proceed_yield_amount, parent.proceed_yield_unit, parent.each_grams
    -- 最適化: 二重NOT EXISTSをHAVING COUNT比較に置換
    -- 「計算済みのingredient数 = 全ingredient数」であれば全材料が揃っている
    HAVING COUNT(DISTINCT rl.child_item_id) = (
      SELECT total_count FROM temp_ingredient_counts WHERE parent_item_id = parent.id
    )
    ON CONFLICT (item_id) DO NOTHING;

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    EXIT WHEN v_rows_inserted = 0 OR v_iteration > 50;
  END LOOP;

  -- ステップ3: Labor コストを追加して最終結果を返す
  -- 最適化: temp_labor_costsを再利用（再計算不要）
  RETURN QUERY
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
    ))::numeric AS total_cost_per_gram,
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
    ))::numeric AS labor_cost_per_gram
  FROM temp_item_costs tc
  LEFT JOIN items i ON tc.item_id = i.id
  LEFT JOIN temp_labor_costs lc ON tc.item_id = lc.item_id
  WHERE tc.food_cost_per_gram IS NOT NULL
    AND i.tenant_id = p_tenant_id
  ORDER BY tc.item_name;

  DROP TABLE IF EXISTS temp_item_costs;
  DROP TABLE IF EXISTS temp_labor_costs;
  DROP TABLE IF EXISTS temp_ingredient_edges;
  DROP TABLE IF EXISTS temp_ingredient_counts;
END;
$$ LANGUAGE plpgsql;
