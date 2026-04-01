-- =============================================================================
-- Fix: calculate_item_costs_with_breakdown temp table rename collision
-- =============================================================================
-- Symptom:
--   42P07 relation "_ct_brk_pause_tic" already exists
-- Cause:
--   Recursive calls used fixed pause table names during ALTER TABLE ... RENAME.
-- Fix:
--   Use per-call-depth dynamic pause table names.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_item_costs_with_breakdown(
  p_tenant_id uuid,
  p_call_depth integer DEFAULT 0
)
RETURNS TABLE (
  out_item_id uuid,
  out_item_name text,
  out_total_cost_per_gram numeric,
  out_food_cost_per_gram numeric,
  out_labor_cost_per_gram numeric
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_inserted integer;
  v_iteration integer := 0;
  r_owner record;
  v_pause_tic text;
  v_pause_tlc text;
  v_pause_tie text;
  v_pause_ticnt text;
  v_pause_fn text;
BEGIN
  IF p_call_depth > 8 THEN
    RAISE EXCEPTION 'calculate_item_costs_with_breakdown: cross-tenant recursion depth exceeded (max 8)';
  END IF;

  -- depth ごとに固有名を使って再帰衝突を避ける
  v_pause_tic := format('_ct_brk_pause_tic_%s', p_call_depth);
  v_pause_tlc := format('_ct_brk_pause_tlc_%s', p_call_depth);
  v_pause_tie := format('_ct_brk_pause_tie_%s', p_call_depth);
  v_pause_ticnt := format('_ct_brk_pause_ticnt_%s', p_call_depth);
  v_pause_fn := format('_ct_brk_pause_fn_%s', p_call_depth);

  -- 全temp tableをクリア（前回の失敗した実行からの残りを防ぐ）
  DROP TABLE IF EXISTS temp_item_costs;
  DROP TABLE IF EXISTS temp_labor_costs;
  DROP TABLE IF EXISTS temp_ingredient_edges;
  DROP TABLE IF EXISTS temp_ingredient_counts;
  DROP TABLE IF EXISTS temp_ct_foreign_needed;
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tic);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tlc);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tie);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_ticnt);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_fn);

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

  -- -------------------------------------------------------------------------
  -- Cross-tenant: 閲覧テナントのレシピから参照される「共有済み foreign prepped」を
  -- temp_item_costs に先に載せる（GET /cross-tenant-item-shares/available と同等の read 条件）
  -- -------------------------------------------------------------------------
  CREATE TEMP TABLE temp_ct_foreign_needed (
    child_item_id uuid PRIMARY KEY,
    owner_tid uuid NOT NULL,
    item_name text
  );

  INSERT INTO temp_ct_foreign_needed (child_item_id, owner_tid, item_name)
  SELECT s.child_item_id, s.owner_tid, s.item_name
  FROM (
    SELECT DISTINCT ON (ci.id)
      ci.id AS child_item_id,
      ci.tenant_id AS owner_tid,
      ci.name AS item_name
    FROM temp_ingredient_edges e
    INNER JOIN items ci ON ci.id = e.child_item_id
    WHERE ci.tenant_id <> p_tenant_id
      AND ci.item_kind = 'prepped'
      AND EXISTS (
        SELECT 1
        FROM cross_tenant_item_shares cts
        INNER JOIN company_tenants ct_v
          ON ct_v.company_id = cts.company_id
         AND ct_v.tenant_id = p_tenant_id
        WHERE cts.item_id = ci.id
          AND cts.owner_tenant_id = ci.tenant_id
          AND 'read' = ANY (cts.allowed_actions)
          AND (
            (cts.target_type = 'company' AND cts.target_id = cts.company_id::text)
            OR
            (cts.target_type = 'tenant' AND cts.target_id = p_tenant_id::text)
          )
      )
    ORDER BY ci.id
  ) s
  ON CONFLICT (child_item_id) DO NOTHING;

  FOR r_owner IN
    SELECT DISTINCT owner_tid FROM temp_ct_foreign_needed
  LOOP
    EXECUTE format('ALTER TABLE temp_item_costs RENAME TO %I', v_pause_tic);
    EXECUTE format('ALTER TABLE temp_labor_costs RENAME TO %I', v_pause_tlc);
    EXECUTE format('ALTER TABLE temp_ingredient_edges RENAME TO %I', v_pause_tie);
    EXECUTE format('ALTER TABLE temp_ingredient_counts RENAME TO %I', v_pause_ticnt);
    EXECUTE format('ALTER TABLE temp_ct_foreign_needed RENAME TO %I', v_pause_fn);

    EXECUTE format($q$
      INSERT INTO %I (item_id, item_name, food_cost_per_gram, labor_cost_per_gram)
      SELECT
        fr.out_item_id,
        fr.out_item_name,
        fr.out_food_cost_per_gram,
        fr.out_labor_cost_per_gram
      FROM calculate_item_costs_with_breakdown($1, $2) fr
      INNER JOIN %I n
        ON n.child_item_id = fr.out_item_id
       AND n.owner_tid = $3
      ON CONFLICT (item_id) DO NOTHING
    $q$, v_pause_tic, v_pause_fn)
    USING r_owner.owner_tid, p_call_depth + 1, r_owner.owner_tid;

    EXECUTE format('ALTER TABLE %I RENAME TO temp_item_costs', v_pause_tic);
    EXECUTE format('ALTER TABLE %I RENAME TO temp_labor_costs', v_pause_tlc);
    EXECUTE format('ALTER TABLE %I RENAME TO temp_ingredient_edges', v_pause_tie);
    EXECUTE format('ALTER TABLE %I RENAME TO temp_ingredient_counts', v_pause_ticnt);
    EXECUTE format('ALTER TABLE %I RENAME TO temp_ct_foreign_needed', v_pause_fn);
  END LOOP;

  -- ステップ2: ループでPrepped Itemsを計算
  LOOP
    v_iteration := v_iteration + 1;

    INSERT INTO temp_item_costs (item_id, item_name, food_cost_per_gram, labor_cost_per_gram)
    SELECT
      parent.id,
      parent.name,
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
      AND (
        child_items.tenant_id = p_tenant_id
        OR EXISTS (
          SELECT 1 FROM temp_ct_foreign_needed n WHERE n.child_item_id = child_items.id
        )
      )
      AND (
        bi.tenant_id = p_tenant_id
        OR bi.tenant_id IS NULL
        OR EXISTS (
          SELECT 1 FROM temp_ct_foreign_needed n2 WHERE n2.child_item_id = child_items.id
        )
      )
      AND NOT EXISTS (SELECT 1 FROM temp_item_costs t WHERE t.item_id = parent.id)
    GROUP BY parent.id, parent.name, parent.proceed_yield_amount, parent.proceed_yield_unit, parent.each_grams
    HAVING COUNT(DISTINCT rl.child_item_id) = (
      SELECT total_count FROM temp_ingredient_counts WHERE parent_item_id = parent.id
    )
    ON CONFLICT (item_id) DO NOTHING;

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    EXIT WHEN v_rows_inserted = 0 OR v_iteration > 50;
  END LOOP;

  -- ステップ3: Labor コストを追加して最終結果を返す
  -- 閲覧テナント所属の item に加え、本 run で共有 seed した foreign prepped も返す（UI の材料行用）
  RETURN QUERY
  SELECT *
  FROM (
    SELECT
      tc.item_id AS out_item_id,
      tc.item_name AS out_item_name,
      (tc.food_cost_per_gram + COALESCE(tc.labor_cost_per_gram, 0) + COALESCE(
        lc.labor_cost_batch / NULLIF(
          CASE
            WHEN i.proceed_yield_unit = 'kg' THEN i.proceed_yield_amount * 1000
            WHEN i.proceed_yield_unit = 'g' THEN i.proceed_yield_amount
            WHEN i.proceed_yield_unit = 'each' THEN i.proceed_yield_amount * COALESCE(i.each_grams, 1)
            ELSE 1
          END, 0
        ), 0
      ))::numeric AS out_total_cost_per_gram,
      tc.food_cost_per_gram::numeric AS out_food_cost_per_gram,
      (COALESCE(tc.labor_cost_per_gram, 0) + COALESCE(
        lc.labor_cost_batch / NULLIF(
          CASE
            WHEN i.proceed_yield_unit = 'kg' THEN i.proceed_yield_amount * 1000
            WHEN i.proceed_yield_unit = 'g' THEN i.proceed_yield_amount
            WHEN i.proceed_yield_unit = 'each' THEN i.proceed_yield_amount * COALESCE(i.each_grams, 1)
            ELSE 1
          END, 0
        ), 0
      ))::numeric AS out_labor_cost_per_gram
    FROM temp_item_costs tc
    LEFT JOIN items i ON tc.item_id = i.id
    LEFT JOIN temp_labor_costs lc ON tc.item_id = lc.item_id
    WHERE tc.food_cost_per_gram IS NOT NULL
      AND i.tenant_id = p_tenant_id

    UNION ALL

    SELECT
      tc.item_id AS out_item_id,
      tc.item_name AS out_item_name,
      (tc.food_cost_per_gram + COALESCE(tc.labor_cost_per_gram, 0) + COALESCE(
        lc.labor_cost_batch / NULLIF(
          CASE
            WHEN i.proceed_yield_unit = 'kg' THEN i.proceed_yield_amount * 1000
            WHEN i.proceed_yield_unit = 'g' THEN i.proceed_yield_amount
            WHEN i.proceed_yield_unit = 'each' THEN i.proceed_yield_amount * COALESCE(i.each_grams, 1)
            ELSE 1
          END, 0
        ), 0
      ))::numeric AS out_total_cost_per_gram,
      tc.food_cost_per_gram::numeric AS out_food_cost_per_gram,
      (COALESCE(tc.labor_cost_per_gram, 0) + COALESCE(
        lc.labor_cost_batch / NULLIF(
          CASE
            WHEN i.proceed_yield_unit = 'kg' THEN i.proceed_yield_amount * 1000
            WHEN i.proceed_yield_unit = 'g' THEN i.proceed_yield_amount
            WHEN i.proceed_yield_unit = 'each' THEN i.proceed_yield_amount * COALESCE(i.each_grams, 1)
            ELSE 1
          END, 0
        ), 0
      ))::numeric AS out_labor_cost_per_gram
    FROM temp_item_costs tc
    INNER JOIN temp_ct_foreign_needed fn ON fn.child_item_id = tc.item_id
    LEFT JOIN items i ON i.id = tc.item_id
    LEFT JOIN temp_labor_costs lc ON lc.item_id = tc.item_id
    WHERE tc.food_cost_per_gram IS NOT NULL
  ) AS combined
  ORDER BY combined.out_item_name;

  DROP TABLE IF EXISTS temp_item_costs;
  DROP TABLE IF EXISTS temp_labor_costs;
  DROP TABLE IF EXISTS temp_ingredient_edges;
  DROP TABLE IF EXISTS temp_ingredient_counts;
  DROP TABLE IF EXISTS temp_ct_foreign_needed;
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tic);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tlc);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tie);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_ticnt);
  EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_fn);
END;
$$;

ALTER FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) OWNER TO postgres;

COMMENT ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) IS
  'テナント単位の item 原価内訳。cross_tenant_item_shares（read）で共有された他テナント prepped を材料に含められる。p_call_depth は内部再帰用（既定 0）。';

GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) TO anon;
GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) TO service_role;
