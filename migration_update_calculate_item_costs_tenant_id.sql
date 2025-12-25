-- =========================================================
-- Migration: Update calculate_item_costs function for tenant_id
-- =========================================================
-- This migration updates the PostgreSQL function to use tenant_id instead of user_id
-- =========================================================

-- 既存の関数を削除（パラメータ名を変更するため）
DROP FUNCTION IF EXISTS calculate_item_costs(uuid, uuid[]);

-- 新しい関数を作成（p_tenant_idパラメータ付き）
CREATE OR REPLACE FUNCTION calculate_item_costs(
  p_tenant_id uuid,
  p_item_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  item_id uuid,
  cost_per_gram numeric
) AS $$
DECLARE
  -- ループ制御変数
  v_rows_inserted integer;
  v_iteration integer := 0;
  v_max_iterations integer := 50;  -- 無限ループ防止（循環検出）
BEGIN
  -- 一時テーブル: Item単位でコストを管理
  -- 既存のテーブルがあれば削除（関数が複数回呼ばれた場合に備える）
  DROP TABLE IF EXISTS temp_item_costs;
  CREATE TEMP TABLE temp_item_costs (
    item_id uuid PRIMARY KEY,
    item_name text,
    cost_per_gram numeric,
    -- デバッグ用
    item_kind text,
    base_item_id uuid,
    proceed_yield_amount numeric,
    proceed_yield_unit text,
    each_grams numeric
  );

  -- =========================================================
  -- ステップ1: Prepped Itemsのコストを計算（ループで順次計算）
  -- =========================================================
  -- 注意: 循環検出は、最大反復回数（50回）で検出されます
  -- 50回以上ループが続く場合は、循環参照の可能性があります
  -- 
  -- 計算順序:
  -- 1. すべての材料のコストが既に計算されているPrepped Itemsを計算
  -- 2. Raw Itemのコストは、各recipe_lineごとにspecific_childを考慮して計算
  -- 3. Prepped Itemのコストは、temp_item_costsから取得
  -- =========================================================
  
  LOOP
    v_iteration := v_iteration + 1;
    
    -- すべての材料のコストが既に計算されているPrepped Itemsを見つけて計算
    INSERT INTO temp_item_costs (item_id, item_name, cost_per_gram, item_kind, proceed_yield_amount, proceed_yield_unit, each_grams)
    WITH ingredient_costs AS (
      -- 材料コストを計算
      -- 注意: Raw Itemの場合、各recipe_lineのspecific_childを考慮してコストを計算
      SELECT
        parent.id as parent_id,
        SUM(
          -- 子アイテムのコスト/グラムを取得
          -- Raw Itemの場合、specific_childを考慮
          -- Prepped Itemの場合、temp_item_costsから取得
          CASE
            WHEN child_items.item_kind = 'raw' THEN
              -- Raw Itemの場合、specific_childに応じてコストを計算
              CASE
                -- specific_childが"lowest"またはnullの場合、最安のvendor_productを選択
                WHEN rl.specific_child = 'lowest' OR rl.specific_child IS NULL THEN
                  (SELECT MIN(
                    CASE
                      WHEN vp.purchase_unit = 'g' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity, 0))
                      WHEN vp.purchase_unit = 'kg' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity * 1000, 0))
                      WHEN vp.purchase_unit = 'lb' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity * 453.592, 0))
                      WHEN vp.purchase_unit = 'oz' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity * 28.3495, 0))
                      WHEN vp.purchase_unit = 'each' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(child_items.each_grams, 0), 0))
                      WHEN vp.purchase_unit = 'gallon' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541, 0))
                      WHEN vp.purchase_unit = 'liter' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1, 0))
                      WHEN vp.purchase_unit = 'floz' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735, 0))
                      WHEN vp.purchase_unit = 'ml' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001, 0))
                      ELSE NULL
                    END
                  )
                  FROM vendor_products vp
                  LEFT JOIN base_items bi ON vp.base_item_id = bi.id
                  WHERE vp.base_item_id = child_items.base_item_id
                    AND vp.tenant_id = p_tenant_id
                    AND bi.tenant_id = p_tenant_id
                    AND vp.deprecated IS NULL
                    AND vp.purchase_cost > 0
                    AND vp.purchase_quantity > 0)
                -- specific_childがvendor_product.idの場合、そのvendor_productを使用
                ELSE
                  (SELECT
                    CASE
                      WHEN vp.purchase_unit = 'g' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity, 0))
                      WHEN vp.purchase_unit = 'kg' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity * 1000, 0))
                      WHEN vp.purchase_unit = 'lb' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity * 453.592, 0))
                      WHEN vp.purchase_unit = 'oz' THEN (vp.purchase_cost / NULLIF(vp.purchase_quantity * 28.3495, 0))
                      WHEN vp.purchase_unit = 'each' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(child_items.each_grams, 0), 0))
                      WHEN vp.purchase_unit = 'gallon' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541, 0))
                      WHEN vp.purchase_unit = 'liter' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1, 0))
                      WHEN vp.purchase_unit = 'floz' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735, 0))
                      WHEN vp.purchase_unit = 'ml' THEN 
                        (vp.purchase_cost / NULLIF(vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001, 0))
                      ELSE NULL
                    END
                  FROM vendor_products vp
                  LEFT JOIN base_items bi ON vp.base_item_id = bi.id
                  WHERE vp.id = rl.specific_child::uuid
                    AND vp.tenant_id = p_tenant_id
                    AND bi.tenant_id = p_tenant_id
                    AND vp.purchase_cost > 0
                    AND vp.purchase_quantity > 0)
              END
            ELSE
              -- Prepped Itemの場合、temp_item_costsから取得
              tc.cost_per_gram
          END *
          -- 数量をグラムに変換
          CASE
            -- 質量単位
            WHEN rl.unit = 'g' THEN rl.quantity
            WHEN rl.unit = 'kg' THEN rl.quantity * 1000
            WHEN rl.unit = 'lb' THEN rl.quantity * 453.592
            WHEN rl.unit = 'oz' THEN rl.quantity * 28.3495
            -- each単位
            -- Prepped Itemの場合はtemp_item_costsから取得、Raw Itemの場合はchild_itemsから取得
            WHEN rl.unit = 'each' THEN 
              rl.quantity * COALESCE(
                CASE 
                  WHEN child_items.item_kind = 'prepped' THEN tc.each_grams
                  ELSE child_items.each_grams
                END,
                0
              )
            -- 非質量単位（Prepped Itemの材料として使用される場合、child_itemがrawである必要がある）
            WHEN rl.unit = 'gallon' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541
            WHEN rl.unit = 'liter' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1
            WHEN rl.unit = 'floz' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735
            WHEN rl.unit = 'ml' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001
            ELSE 0
          END
        ) as total_ingredient_cost
      FROM items parent
      INNER JOIN recipe_lines rl ON parent.id = rl.parent_item_id 
        AND rl.line_type = 'ingredient'
        AND rl.tenant_id = p_tenant_id
      LEFT JOIN items child_items ON rl.child_item_id = child_items.id
      LEFT JOIN base_items bi ON child_items.base_item_id = bi.id
      LEFT JOIN temp_item_costs tc ON rl.child_item_id = tc.item_id
        AND child_items.item_kind = 'prepped'  -- Prepped Itemの場合のみtemp_item_costsを使用
      WHERE parent.item_kind = 'prepped'
        AND parent.tenant_id = p_tenant_id
        AND child_items.tenant_id = p_tenant_id
        AND (bi.tenant_id = p_tenant_id OR bi.tenant_id IS NULL)
        AND (p_item_ids IS NULL OR parent.id = ANY(p_item_ids))
        AND NOT EXISTS (SELECT 1 FROM temp_item_costs t WHERE t.item_id = parent.id)
        -- すべての材料のコストが計算済みであることを確認
        -- Raw Itemの場合は常に計算可能、Prepped Itemの場合はtemp_item_costsに存在する必要がある
        AND (
          child_items.item_kind = 'raw' OR
          (child_items.item_kind = 'prepped' AND tc.item_id IS NOT NULL)
        )
        AND NOT EXISTS (
          SELECT 1 FROM recipe_lines rl2
          INNER JOIN items child_items2 ON rl2.child_item_id = child_items2.id
          LEFT JOIN temp_item_costs tc2 ON rl2.child_item_id = tc2.item_id
            AND child_items2.item_kind = 'prepped'
          WHERE rl2.parent_item_id = parent.id
            AND rl2.line_type = 'ingredient'
            AND rl2.tenant_id = p_tenant_id
            AND child_items2.item_kind = 'prepped'
            AND tc2.item_id IS NULL
        )
      GROUP BY parent.id
    ),
    labor_costs AS (
      -- 労働コストを計算
      SELECT
        rl.parent_item_id as parent_id,
        SUM((rl.minutes / 60.0) * COALESCE(lr.hourly_wage, 0)) as total_labor_cost
      FROM recipe_lines rl
      LEFT JOIN labor_roles lr ON rl.labor_role = lr.name
      WHERE rl.line_type = 'labor'
        AND rl.tenant_id = p_tenant_id
        AND lr.tenant_id = p_tenant_id
      GROUP BY rl.parent_item_id
    ),
    ingredient_grams AS (
      -- "each"のYield計算用: 材料の総合計（グラム）を計算
      -- 注意: 子アイテムがPrepped Itemの場合、temp_item_costsからeach_gramsを取得
      SELECT
        parent.id as parent_id,
        SUM(
          CASE
            WHEN rl.unit = 'g' THEN rl.quantity
            WHEN rl.unit = 'kg' THEN rl.quantity * 1000
            WHEN rl.unit = 'lb' THEN rl.quantity * 453.592
            WHEN rl.unit = 'oz' THEN rl.quantity * 28.3495
            WHEN rl.unit = 'each' THEN 
              -- each単位の場合、子アイテムのeach_gramsを使用
              -- Prepped Itemの場合はtemp_item_costsから取得、Raw Itemの場合はchild_itemsから取得
              rl.quantity * COALESCE(
                CASE 
                  WHEN child_items.item_kind = 'prepped' THEN tc.each_grams
                  ELSE child_items.each_grams
                END,
                0
              )
            WHEN rl.unit = 'gallon' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541
            WHEN rl.unit = 'liter' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1
            WHEN rl.unit = 'floz' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735
            WHEN rl.unit = 'ml' THEN rl.quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001
            ELSE 0
          END
        ) as total_ingredient_grams
      FROM items parent
      INNER JOIN recipe_lines rl ON parent.id = rl.parent_item_id 
        AND rl.line_type = 'ingredient'
        AND rl.tenant_id = p_tenant_id
      LEFT JOIN items child_items ON rl.child_item_id = child_items.id
      LEFT JOIN base_items bi ON child_items.base_item_id = bi.id
      LEFT JOIN temp_item_costs tc ON rl.child_item_id = tc.item_id
        AND child_items.item_kind = 'prepped'  -- Prepped Itemの場合のみtemp_item_costsを使用
      WHERE parent.item_kind = 'prepped'
        AND parent.tenant_id = p_tenant_id
        AND child_items.tenant_id = p_tenant_id
        AND (bi.tenant_id = p_tenant_id OR bi.tenant_id IS NULL)
        AND (p_item_ids IS NULL OR parent.id = ANY(p_item_ids))
        AND NOT EXISTS (SELECT 1 FROM temp_item_costs t WHERE t.item_id = parent.id)
        -- すべての材料のコストが計算済みであることを確認
        AND (
          child_items.item_kind = 'raw' OR
          (child_items.item_kind = 'prepped' AND tc.item_id IS NOT NULL)
        )
      GROUP BY parent.id
    )
    SELECT
      parent.id,
      parent.name,
      -- コスト計算: (材料コスト + 労働コスト) / yield_grams
      (
        COALESCE(ic.total_ingredient_cost, 0) + COALESCE(lc.total_labor_cost, 0)
      ) / NULLIF(
        -- Yieldをグラムに変換
        CASE
          WHEN parent.proceed_yield_unit = 'g' THEN parent.proceed_yield_amount
          WHEN parent.proceed_yield_unit = 'kg' THEN parent.proceed_yield_amount * 1000
          WHEN parent.proceed_yield_unit = 'each' THEN 
            -- "each"の場合、材料の総合計からeach_gramsを計算
            -- 既にeach_gramsが設定されている場合はそれを使用
            -- そうでない場合は、材料の総合計 / yield_amount を計算
            COALESCE(
              parent.each_grams,
              CASE 
                WHEN ig.total_ingredient_grams > 0 AND parent.proceed_yield_amount > 0 
                THEN ig.total_ingredient_grams / parent.proceed_yield_amount
                ELSE 1
              END
            ) * parent.proceed_yield_amount
          ELSE 1
        END, 0
      ) as cost_per_gram,
      'prepped' as item_kind,
      parent.proceed_yield_amount,
      parent.proceed_yield_unit,
      COALESCE(
        parent.each_grams,
        CASE 
          WHEN parent.proceed_yield_unit = 'each' AND ig.total_ingredient_grams > 0 AND parent.proceed_yield_amount > 0 
          THEN ig.total_ingredient_grams / parent.proceed_yield_amount
          ELSE parent.each_grams
        END
      ) as each_grams
    FROM items parent
    INNER JOIN ingredient_costs ic ON parent.id = ic.parent_id
    LEFT JOIN labor_costs lc ON parent.id = lc.parent_id
    LEFT JOIN ingredient_grams ig ON parent.id = ig.parent_id
    WHERE parent.item_kind = 'prepped'
      AND parent.tenant_id = p_tenant_id
      AND (p_item_ids IS NULL OR parent.id = ANY(p_item_ids))
    ON CONFLICT ON CONSTRAINT temp_item_costs_pkey DO NOTHING;

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    
    -- ループ終了条件: 新しい行が挿入されなかった、または最大反復回数に達した
    EXIT WHEN v_rows_inserted = 0 OR v_iteration >= v_max_iterations;
  END LOOP;

  -- 結果を返す
  RETURN QUERY
  SELECT 
    tc.item_id,
    tc.cost_per_gram
  FROM temp_item_costs tc
  WHERE tc.cost_per_gram IS NOT NULL;

  -- 一時テーブルをクリーンアップ
  DROP TABLE IF EXISTS temp_item_costs;
END;
$$ LANGUAGE plpgsql;



