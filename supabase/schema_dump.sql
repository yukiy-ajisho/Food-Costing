


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."company_member_role" AS ENUM (
    'company_admin',
    'company_director'
);


ALTER TYPE "public"."company_member_role" OWNER TO "postgres";


CREATE TYPE "public"."company_requirement_data_type" AS ENUM (
    'date',
    'int',
    'text'
);


ALTER TYPE "public"."company_requirement_data_type" OWNER TO "postgres";


CREATE TYPE "public"."document_inbox_document_type" AS ENUM (
    'invoice',
    'company_requirement',
    'tenant_requirement',
    'employee_requirement'
);


ALTER TYPE "public"."document_inbox_document_type" OWNER TO "postgres";


CREATE TYPE "public"."tenant_requirement_data_type" AS ENUM (
    'date',
    'int',
    'text'
);


ALTER TYPE "public"."tenant_requirement_data_type" OWNER TO "postgres";


CREATE TYPE "public"."validation_mode" AS ENUM (
    'permit',
    'block',
    'notify'
);


ALTER TYPE "public"."validation_mode" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."after_profiles_insert_assign_requirements"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.user_requirement_assignments (
    user_id,
    user_requirement_id,
    is_currently_assigned,
    created_at,
    deleted_at
  )
  SELECT
    NEW.user_id,
    ur.id,
    true,
    now(),
    NULL
  FROM public.user_requirements ur
  INNER JOIN public.company_tenants ct ON ct.tenant_id = NEW.tenant_id
    AND ct.company_id = ur.company_id
  INNER JOIN public.user_jurisdictions uj ON uj.company_id = ur.company_id
    AND uj.user_id = NEW.user_id
    AND uj.jurisdiction_id = ur.jurisdiction_id
  ON CONFLICT (user_id, user_requirement_id)
    DO UPDATE SET
      is_currently_assigned = true,
      deleted_at = NULL;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."after_profiles_insert_assign_requirements"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."after_profiles_insert_assign_tenant_requirements"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    INSERT INTO public.tenant_requirement_assignments (tenant_id, tenant_requirement_id, is_currently_assigned, created_at, deleted_at)
    SELECT
      NEW.tenant_id,
      tr.id,
      true,
      now(),
      NULL
    FROM public.tenant_requirements tr
    WHERE tr.created_by = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."after_profiles_insert_assign_tenant_requirements"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_item_costs"("p_tenant_id" "uuid", "p_item_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("item_id" "uuid", "cost_per_gram" numeric)
    LANGUAGE "plpgsql"
    AS $$
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
                -- specific_childが"lowest"またはnullの場合、最安のvirtual_vendor_productを選択
                WHEN rl.specific_child = 'lowest' OR rl.specific_child IS NULL THEN
                  (SELECT MIN(
                    CASE
                      WHEN vvp.purchase_unit = 'g' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity, 0))
                      WHEN vvp.purchase_unit = 'kg' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity * 1000, 0))
                      WHEN vvp.purchase_unit = 'lb' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity * 453.592, 0))
                      WHEN vvp.purchase_unit = 'oz' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity * 28.3495, 0))
                      WHEN vvp.purchase_unit = 'each' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(child_items.each_grams, 0), 0))
                      WHEN vvp.purchase_unit = 'gallon' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541, 0))
                      WHEN vvp.purchase_unit = 'liter' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1, 0))
                      WHEN vvp.purchase_unit = 'floz' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735, 0))
                      WHEN vvp.purchase_unit = 'ml' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001, 0))
                      ELSE NULL
                    END
                  )
                  FROM virtual_vendor_products vvp
                  JOIN product_mappings pm ON vvp.id = pm.virtual_product_id
                  JOIN base_items bi ON pm.base_item_id = bi.id
                  WHERE pm.base_item_id = child_items.base_item_id
                    AND pm.tenant_id = p_tenant_id
                    AND vvp.tenant_id = p_tenant_id
                    AND bi.tenant_id = p_tenant_id
                    AND vvp.deprecated IS NULL
                    AND vvp.current_price > 0
                    AND vvp.purchase_quantity > 0)
                -- specific_childがvirtual_product.idの場合、そのvirtual_productを使用
                -- ただし、product_mappingsでマッピングが存在することを確認
                ELSE
                  (SELECT
                    CASE
                      WHEN vvp.purchase_unit = 'g' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity, 0))
                      WHEN vvp.purchase_unit = 'kg' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity * 1000, 0))
                      WHEN vvp.purchase_unit = 'lb' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity * 453.592, 0))
                      WHEN vvp.purchase_unit = 'oz' THEN (vvp.current_price / NULLIF(vvp.purchase_quantity * 28.3495, 0))
                      WHEN vvp.purchase_unit = 'each' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(child_items.each_grams, 0), 0))
                      WHEN vvp.purchase_unit = 'gallon' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541, 0))
                      WHEN vvp.purchase_unit = 'liter' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1, 0))
                      WHEN vvp.purchase_unit = 'floz' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735, 0))
                      WHEN vvp.purchase_unit = 'ml' THEN 
                        (vvp.current_price / NULLIF(vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001, 0))
                      ELSE NULL
                    END
                  FROM virtual_vendor_products vvp
                  JOIN product_mappings pm ON vvp.id = pm.virtual_product_id
                  JOIN base_items bi ON pm.base_item_id = bi.id
                  WHERE vvp.id = rl.specific_child::uuid
                    AND pm.base_item_id = child_items.base_item_id
                    AND pm.tenant_id = p_tenant_id
                    AND vvp.tenant_id = p_tenant_id
                    AND bi.tenant_id = p_tenant_id
                    AND vvp.current_price > 0
                    AND vvp.purchase_quantity > 0)
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
$$;


ALTER FUNCTION "public"."calculate_item_costs"("p_tenant_id" "uuid", "p_item_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_item_costs_with_breakdown"("p_tenant_id" "uuid", "p_call_depth" integer DEFAULT 0) RETURNS TABLE("out_item_id" "uuid", "out_item_name" "text", "out_total_cost_per_gram" numeric, "out_food_cost_per_gram" numeric, "out_labor_cost_per_gram" numeric)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_seed_item_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT rl.parent_item_id)
  INTO v_seed_item_ids
  FROM recipe_lines rl
  WHERE rl.tenant_id = p_tenant_id
    AND rl.line_type = 'ingredient';

  RETURN QUERY
    SELECT *
    FROM public.calculate_item_costs_with_breakdown_scoped(p_tenant_id, p_call_depth, v_seed_item_ids);
END;
$$;


ALTER FUNCTION "public"."calculate_item_costs_with_breakdown"("p_tenant_id" "uuid", "p_call_depth" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_item_costs_with_breakdown"("p_tenant_id" "uuid", "p_call_depth" integer) IS 'Phase2: required-item scoped cross-tenant breakdown recursion. (RPC wrapper)';



CREATE OR REPLACE FUNCTION "public"."calculate_item_costs_with_breakdown_old"() RETURNS TABLE("out_item_id" "uuid", "out_item_name" "text", "out_total_cost_per_gram" numeric, "out_food_cost_per_gram" numeric, "out_labor_cost_per_gram" numeric)
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."calculate_item_costs_with_breakdown_old"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_item_costs_with_breakdown_scoped"("p_tenant_id" "uuid", "p_call_depth" integer, "p_seed_item_ids" "uuid"[]) RETURNS TABLE("out_item_id" "uuid", "out_item_name" "text", "out_total_cost_per_gram" numeric, "out_food_cost_per_gram" numeric, "out_labor_cost_per_gram" numeric)
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_rows_inserted integer;
  v_iteration integer := 0;
  r_owner record;

  v_pause_tic text;
  v_pause_tlc text;
  v_pause_tie text;
  v_pause_ticnt text;
  v_pause_fn text;
  v_pause_need text;

  v_seed_item_ids_norm uuid[];
  v_owner_seeds uuid[];
BEGIN
  IF p_call_depth > 8 THEN
    RAISE EXCEPTION 'calculate_item_costs_with_breakdown: cross-tenant recursion depth exceeded (max 8)';
  END IF;

  -- Per-depth pause names to avoid recursive rename collisions.
  v_pause_tic := format('_ct_brk_pause_tic_%s', p_call_depth);
  v_pause_tlc := format('_ct_brk_pause_tlc_%s', p_call_depth);
  v_pause_tie := format('_ct_brk_pause_tie_%s', p_call_depth);
  v_pause_ticnt := format('_ct_brk_pause_ticnt_%s', p_call_depth);
  v_pause_fn := format('_ct_brk_pause_fn_%s', p_call_depth);
  v_pause_need := format('_ct_brk_pause_need_%s', p_call_depth);

  -- Normalize seeds to prepped items owned by this tenant.
  SELECT array_agg(DISTINCT i.id)
  INTO v_seed_item_ids_norm
  FROM items i
  WHERE i.tenant_id = p_tenant_id
    AND i.item_kind = 'prepped'
    AND i.id = ANY(p_seed_item_ids);

  BEGIN
    -- Cleanup tables from prior failed runs in this session.
    DROP TABLE IF EXISTS temp_item_costs;
    DROP TABLE IF EXISTS temp_labor_costs;
    DROP TABLE IF EXISTS temp_ingredient_edges;
    DROP TABLE IF EXISTS temp_ingredient_counts;
    DROP TABLE IF EXISTS temp_ct_foreign_needed;
    DROP TABLE IF EXISTS temp_needed_local_prepped;

    EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tic);
    EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tlc);
    EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tie);
    EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_ticnt);
    EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_fn);
    EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_need);

    -- Main cost management table.
    CREATE TEMP TABLE temp_item_costs (
      item_id uuid PRIMARY KEY,
      item_name text,
      food_cost_per_gram numeric,
      labor_cost_per_gram numeric
    );

    -- Labor: compute once per call (can be broader than seed scope, but correct).
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

    -- Raw items: preserve existing behavior (compute all tenant raws).
    INSERT INTO temp_item_costs (item_id, item_name, food_cost_per_gram, labor_cost_per_gram)
    SELECT
      i.id,
      i.name,
      CASE
        WHEN rl.specific_child = 'lowest' OR rl.specific_child IS NULL THEN
          (SELECT MIN(
            CASE
              WHEN vvp.purchase_unit = 'kg' THEN (vvp.current_price / (vvp.purchase_quantity * 1000))
              WHEN vvp.purchase_unit = 'lb' THEN (vvp.current_price / (vvp.purchase_quantity * 453.592))
              WHEN vvp.purchase_unit = 'oz' THEN (vvp.current_price / (vvp.purchase_quantity * 28.3495))
              WHEN vvp.purchase_unit = 'g' THEN (vvp.current_price / vvp.purchase_quantity)
              WHEN vvp.purchase_unit = 'each' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(i.each_grams, 0)))
              WHEN vvp.purchase_unit = 'gallon' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541))
              WHEN vvp.purchase_unit = 'liter' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1))
              WHEN vvp.purchase_unit = 'floz' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735))
              WHEN vvp.purchase_unit = 'ml' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001))
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
            AND vvp.current_price > 0
            AND vvp.purchase_quantity > 0)
        ELSE
          (SELECT
            CASE
              WHEN vvp.purchase_unit = 'kg' THEN (vvp.current_price / (vvp.purchase_quantity * 1000))
              WHEN vvp.purchase_unit = 'lb' THEN (vvp.current_price / (vvp.purchase_quantity * 453.592))
              WHEN vvp.purchase_unit = 'oz' THEN (vvp.current_price / (vvp.purchase_quantity * 28.3495))
              WHEN vvp.purchase_unit = 'g' THEN (vvp.current_price / vvp.purchase_quantity)
              WHEN vvp.purchase_unit = 'each' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(i.each_grams, 0)))
              WHEN vvp.purchase_unit = 'gallon' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541))
              WHEN vvp.purchase_unit = 'liter' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1))
              WHEN vvp.purchase_unit = 'floz' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.0295735))
              WHEN vvp.purchase_unit = 'ml' THEN (vvp.current_price / (vvp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 0.001))
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
            AND vvp.current_price > 0
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

    -- Seed expansion (local prepped only): closure of local prepped dependencies.
    CREATE TEMP TABLE temp_needed_local_prepped (
      item_id uuid PRIMARY KEY
    );

    WITH RECURSIVE needed(item_id) AS (
      SELECT DISTINCT unnest(v_seed_item_ids_norm) AS item_id
      UNION
      SELECT rl.child_item_id
      FROM recipe_lines rl
      INNER JOIN needed n ON rl.parent_item_id = n.item_id
      INNER JOIN items ci ON ci.id = rl.child_item_id
      WHERE rl.line_type = 'ingredient'
        AND rl.tenant_id = p_tenant_id
        AND ci.item_kind = 'prepped'
        AND ci.tenant_id = p_tenant_id
    )
    INSERT INTO temp_needed_local_prepped(item_id)
    SELECT DISTINCT item_id FROM needed
    ON CONFLICT (item_id) DO NOTHING;

    -- Ingredient edges restricted to the needed local prepped parents.
    CREATE TEMP TABLE temp_ingredient_edges AS
    SELECT
      rl.parent_item_id,
      rl.child_item_id,
      rl.quantity,
      rl.unit
    FROM recipe_lines rl
    WHERE rl.line_type = 'ingredient'
      AND rl.tenant_id = p_tenant_id
      AND rl.parent_item_id IN (SELECT item_id FROM temp_needed_local_prepped);

    CREATE INDEX ON temp_ingredient_edges(parent_item_id);
    CREATE INDEX ON temp_ingredient_edges(child_item_id);

    CREATE TEMP TABLE temp_ingredient_counts AS
    SELECT parent_item_id, COUNT(DISTINCT child_item_id) AS total_count
    FROM temp_ingredient_edges
    GROUP BY parent_item_id;

    CREATE INDEX ON temp_ingredient_counts(parent_item_id);

    -- temp_needed_local_prepped は以降の計算（temp_ingredient_edges / counts が確定した後）では不要。
    -- 再帰呼び出し時の temp table 衝突を避けるためにここで破棄する。
    DROP TABLE IF EXISTS temp_needed_local_prepped;

    -- Cross-tenant: only foreign prepped that appear in the scoped ingredient edges.
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
        AND (
          EXISTS (
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
          OR EXISTS (
            SELECT 1
            FROM recipe_lines rl_gf
            WHERE rl_gf.tenant_id = p_tenant_id
              AND rl_gf.line_type = 'ingredient'
              AND rl_gf.child_item_id = ci.id
          )
        )
      ORDER BY ci.id
    ) s
    ON CONFLICT (child_item_id) DO NOTHING;

    -- -------------------------------------------------------------------------
    -- Recursive foreign prepped cost seeding
    -- -------------------------------------------------------------------------
    FOR r_owner IN
      SELECT DISTINCT owner_tid FROM temp_ct_foreign_needed
    LOOP
      SELECT array_agg(child_item_id)
      INTO v_owner_seeds
      FROM temp_ct_foreign_needed
      WHERE owner_tid = r_owner.owner_tid;

      -- 安全: NULL/empty の場合はスキップ
      IF v_owner_seeds IS NULL OR array_length(v_owner_seeds, 1) IS NULL THEN
        CONTINUE;
      END IF;

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
        FROM public.calculate_item_costs_with_breakdown_scoped($1, $2, $3) fr
        INNER JOIN %I n
          ON n.child_item_id = fr.out_item_id
         AND n.owner_tid = $4
        ON CONFLICT (item_id) DO NOTHING
      $q$, v_pause_tic, v_pause_fn)
      USING r_owner.owner_tid, p_call_depth + 1, v_owner_seeds, r_owner.owner_tid;

      EXECUTE format('ALTER TABLE %I RENAME TO temp_item_costs', v_pause_tic);
      EXECUTE format('ALTER TABLE %I RENAME TO temp_labor_costs', v_pause_tlc);
      EXECUTE format('ALTER TABLE %I RENAME TO temp_ingredient_edges', v_pause_tie);
      EXECUTE format('ALTER TABLE %I RENAME TO temp_ingredient_counts', v_pause_ticnt);
      EXECUTE format('ALTER TABLE %I RENAME TO temp_ct_foreign_needed', v_pause_fn);
    END LOOP;

    -- -------------------------------------------------------------------------
    -- Local prepped cost calculation (only within the scoped edges/parents)
    -- -------------------------------------------------------------------------
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

    -- -------------------------------------------------------------------------
    -- Return (scoped local items + scoped foreign items needed by this scope)
    -- -------------------------------------------------------------------------
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

    -- Cleanup
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
    EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_need);

  EXCEPTION
    WHEN OTHERS THEN
      -- Ensure outer temp tables don't leak across failed runs.
      DROP TABLE IF EXISTS temp_item_costs;
      DROP TABLE IF EXISTS temp_labor_costs;
      DROP TABLE IF EXISTS temp_ingredient_edges;
      DROP TABLE IF EXISTS temp_ingredient_counts;
      DROP TABLE IF EXISTS temp_ct_foreign_needed;
      DROP TABLE IF EXISTS temp_needed_local_prepped;
      EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tic);
      EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tlc);
      EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_tie);
      EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_ticnt);
      EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_fn);
      EXECUTE format('DROP TABLE IF EXISTS %I', v_pause_need);
      RAISE;
  END;
END;
$_$;


ALTER FUNCTION "public"."calculate_item_costs_with_breakdown_scoped"("p_tenant_id" "uuid", "p_call_depth" integer, "p_seed_item_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_item_costs_with_breakdown_scoped"("p_tenant_id" "uuid", "p_call_depth" integer, "p_seed_item_ids" "uuid"[]) IS 'Phase2 scoped breakdown + grandfather: foreign prepped allowed when read share OR local recipe line references child (Hide 後の既存行).';



CREATE OR REPLACE FUNCTION "public"."check_before_signup"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_email text;
BEGIN
  -- Extract email from event
  user_email := event->'user'->>'email';
  
  -- Check if email is in allowlist (approved)
  IF NOT EXISTS (
    SELECT 1 FROM allowlist 
    WHERE email = user_email 
    AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Access denied. Please request access or wait for an invitation.';
  END IF;
  
  -- Return the event unmodified
  RETURN event;
END;
$$;


ALTER FUNCTION "public"."check_before_signup"("event" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_before_signup"("event" "jsonb") IS 'Auth Hook: Check allowlist before user signup';



CREATE OR REPLACE FUNCTION "public"."create_proceed_validation_settings_for_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  BEGIN
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (NEW.id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- エラーが発生しても認証プロセスを継続させる
    RAISE WARNING 'Failed to create proceed_validation_settings for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_proceed_validation_settings_for_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_proceed_validation_settings_for_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RAISE NOTICE 'Trigger fired for user_id: %', NEW.id;
  BEGIN
    RAISE NOTICE 'Attempting to insert proceed_validation_settings for user_id: %', NEW.id;
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (NEW.id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
    RAISE NOTICE 'Successfully inserted proceed_validation_settings for user_id: %', NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create proceed_validation_settings for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_proceed_validation_settings_for_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debug_calculate_item_costs"() RETURNS TABLE("step" "text", "out_item_name" "text", "out_depth" integer, "out_food_cost" numeric, "out_labor_cost" numeric)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_depth integer := 0;
  v_rows_inserted integer;
BEGIN
  DROP TABLE IF EXISTS temp_recipe_line_costs;
  CREATE TEMP TABLE temp_recipe_line_costs (
    parent_item_id uuid,
    recipe_line_id uuid,
    child_item_id uuid,
    quantity numeric,
    unit text,
    child_food_cost_per_gram numeric,
    child_labor_cost_per_gram numeric,
    depth integer
  );

  DROP TABLE IF EXISTS temp_item_costs;
  CREATE TEMP TABLE temp_item_costs (
    item_id uuid,
    item_name text,
    food_cost_per_gram numeric,
    labor_cost_per_gram numeric,
    depth integer
  );

  -- ステップ1: Raw Items用のRecipe Linesを収集
  INSERT INTO temp_recipe_line_costs (parent_item_id, recipe_line_id, child_item_id, quantity, unit, child_food_cost_per_gram, child_labor_cost_per_gram, depth)
  SELECT
    rl.parent_item_id,
    rl.id,
    rl.child_item_id,
    rl.quantity,
    rl.unit,
    CASE
      WHEN vp.purchase_unit = 'kg' THEN (vp.purchase_cost / (vp.purchase_quantity * 1000))
      WHEN vp.purchase_unit = 'lb' THEN (vp.purchase_cost / (vp.purchase_quantity * 453.592))
      WHEN vp.purchase_unit = 'oz' THEN (vp.purchase_cost / (vp.purchase_quantity * 28.3495))
      WHEN vp.purchase_unit = 'g' THEN (vp.purchase_cost / vp.purchase_quantity)
      WHEN vp.purchase_unit = 'liter' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 1))
      WHEN vp.purchase_unit = 'gallon' THEN (vp.purchase_cost / (vp.purchase_quantity * NULLIF(bi.specific_weight, 0) * 1000 * 3.78541))
      ELSE 0.01
    END as child_food_cost_per_gram,
    0,
    0
  FROM recipe_lines rl
  INNER JOIN items child ON rl.child_item_id = child.id
  INNER JOIN vendor_products vp ON child.base_item_id = vp.base_item_id
  LEFT JOIN base_items bi ON child.base_item_id = bi.id
  WHERE rl.line_type = 'ingredient'
    AND child.item_kind = 'raw'
    AND vp.deprecated IS NULL
    AND vp.purchase_cost > 0
    AND vp.purchase_quantity > 0;

  -- Raw Itemsをtemp_item_costsに追加
  INSERT INTO temp_item_costs (item_id, item_name, food_cost_per_gram, labor_cost_per_gram, depth)
  SELECT DISTINCT ON (child_item_id)
    child_item_id,
    i.name,
    child_food_cost_per_gram,
    0,
    0
  FROM temp_recipe_line_costs trc
  INNER JOIN items i ON trc.child_item_id = i.id;

  -- デバッグ出力1: Raw Items
  RETURN QUERY
  SELECT 
    'Step 1: Raw Items in temp_item_costs'::text, 
    tc.item_name, 
    tc.depth, 
    tc.food_cost_per_gram, 
    tc.labor_cost_per_gram
  FROM temp_item_costs tc
  ORDER BY tc.item_name;

  -- デバッグ出力2: Recipe Line Costs
  RETURN QUERY
  SELECT 
    'Step 2: Recipe Lines using Raw Items'::text, 
    (SELECT name FROM items WHERE id = trc.parent_item_id),
    trc.depth, 
    trc.child_food_cost_per_gram, 
    trc.child_labor_cost_per_gram
  FROM temp_recipe_line_costs trc
  ORDER BY trc.parent_item_id;

  DROP TABLE IF EXISTS temp_recipe_line_costs;
  DROP TABLE IF EXISTS temp_item_costs;
END;
$$;


ALTER FUNCTION "public"."debug_calculate_item_costs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- public.usersにレコードを作成
  INSERT INTO public.users (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  
  -- proceed_validation_settingsにもレコードを作成（スキーマを明示）
  BEGIN
    INSERT INTO public.proceed_validation_settings (user_id, validation_mode)
    VALUES (new.id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create proceed_validation_settings for user %: %', new.id, SQLERRM;
  END;
  
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_price_events_update_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'price_events is append-only; UPDATE/DELETE is not allowed';
END;
$$;


ALTER FUNCTION "public"."prevent_price_events_update_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_manual_prices_atomic"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_operations" "jsonb") RETURNS TABLE("changed_vendor_product_ids" "uuid"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  op jsonb;
  v_kind text;
  v_vp_id uuid;
  v_new_vp_id uuid;
  v_vendor_id uuid;
  v_base_item_id uuid;
  v_product_name text;
  v_brand_name text;
  v_purchase_unit text;
  v_purchase_quantity numeric;
  v_price numeric;
  v_case_unit integer;
  v_changed_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and user_id are required';
  END IF;

  IF p_operations IS NULL OR jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'operations must be a JSON array';
  END IF;

  FOR op IN SELECT value FROM jsonb_array_elements(p_operations)
  LOOP
    v_kind := COALESCE(op->>'kind', '');

    IF v_kind = 'existing' THEN
      v_vp_id := (op->>'vendor_product_id')::uuid;
      v_price := (op->>'price')::numeric;

      IF v_vp_id IS NULL THEN
        RAISE EXCEPTION 'existing operation requires vendor_product_id';
      END IF;
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'existing operation requires price > 0';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.virtual_vendor_products vvp
        WHERE vvp.id = v_vp_id
          AND vvp.tenant_id = p_tenant_id
      ) THEN
        RAISE EXCEPTION 'vendor_product_id % is not found in tenant %', v_vp_id, p_tenant_id;
      END IF;

      INSERT INTO public.price_events (
        tenant_id,
        virtual_vendor_product_id,
        price,
        source_type,
        user_id
      )
      VALUES (
        p_tenant_id,
        v_vp_id,
        v_price,
        'manual',
        p_user_id
      );

      v_changed_ids := array_append(v_changed_ids, v_vp_id);

    ELSIF v_kind = 'new' THEN
      v_vendor_id := (op->>'vendor_id')::uuid;
      v_base_item_id := (op->>'base_item_id')::uuid;
      v_product_name := NULLIF(op->>'product_name', '');
      v_brand_name := NULLIF(op->>'brand_name', '');
      v_purchase_unit := op->>'purchase_unit';
      v_purchase_quantity := (op->>'purchase_quantity')::numeric;
      v_price := (op->>'price')::numeric;
      v_case_unit :=
        CASE
          WHEN op ? 'case_unit' AND op->>'case_unit' IS NOT NULL AND op->>'case_unit' <> ''
            THEN (op->>'case_unit')::integer
          ELSE NULL
        END;

      IF v_vendor_id IS NULL OR v_base_item_id IS NULL OR v_purchase_unit IS NULL OR btrim(v_purchase_unit) = '' THEN
        RAISE EXCEPTION 'new operation requires vendor_id, base_item_id, and purchase_unit';
      END IF;
      IF v_purchase_quantity IS NULL OR v_purchase_quantity <= 0 THEN
        RAISE EXCEPTION 'new operation requires purchase_quantity > 0';
      END IF;
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'new operation requires price > 0';
      END IF;
      IF v_case_unit IS NOT NULL AND v_case_unit <= 0 THEN
        RAISE EXCEPTION 'case_unit must be a positive integer';
      END IF;

      INSERT INTO public.virtual_vendor_products (
        vendor_id,
        product_name,
        brand_name,
        purchase_unit,
        purchase_quantity,
        current_price,
        case_unit,
        tenant_id
      )
      VALUES (
        v_vendor_id,
        v_product_name,
        v_brand_name,
        v_purchase_unit,
        v_purchase_quantity,
        v_price,
        v_case_unit,
        p_tenant_id
      )
      RETURNING id INTO v_new_vp_id;

      INSERT INTO public.product_mappings (
        base_item_id,
        virtual_product_id,
        tenant_id
      )
      VALUES (
        v_base_item_id,
        v_new_vp_id,
        p_tenant_id
      );

      INSERT INTO public.price_events (
        tenant_id,
        virtual_vendor_product_id,
        price,
        source_type,
        user_id,
        case_unit,
        case_purchased,
        unit_purchased
      )
      VALUES (
        p_tenant_id,
        v_new_vp_id,
        v_price,
        'manual',
        p_user_id,
        v_case_unit,
        NULL,
        CASE WHEN v_case_unit IS NULL THEN 1 ELSE NULL END
      );

      v_changed_ids := array_append(v_changed_ids, v_new_vp_id);
    ELSE
      RAISE EXCEPTION 'operation kind must be "existing" or "new"';
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_changed_ids;
END;
$$;


ALTER FUNCTION "public"."record_manual_prices_atomic"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_operations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_document_inbox_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_document_inbox_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at_cross_tenant_item_shares"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at_cross_tenant_item_shares"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_virtual_vendor_current_price_from_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF COALESCE(NEW.apply_to_current_price, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  UPDATE public.virtual_vendor_products
     SET current_price = NEW.price,
        updated_at = NEW.created_at
   WHERE id = NEW.virtual_vendor_product_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_virtual_vendor_current_price_from_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_proceed_validation_settings_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_proceed_validation_settings_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_recipe_lines_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_recipe_lines_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_jurisdictions_company_match"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.jurisdictions j
    WHERE j.id = NEW.jurisdiction_id
      AND j.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'user_jurisdictions: jurisdiction_id does not belong to company_id';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."user_jurisdictions_company_match"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."allowlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "approved_at" timestamp with time zone,
    "approved_by" "text",
    "request_count" integer DEFAULT 0,
    "last_requested_at" timestamp with time zone,
    "note" "text",
    "source" "text",
    CONSTRAINT "allowlist_source_check" CHECK (("source" = ANY (ARRAY['request'::"text", 'invitation'::"text"]))),
    CONSTRAINT "allowlist_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."allowlist" OWNER TO "postgres";


COMMENT ON TABLE "public"."allowlist" IS 'Access control list for new user registration';



COMMENT ON COLUMN "public"."allowlist"."status" IS 'pending: waiting for approval, approved: can login, rejected: denied, revoked: access removed';



COMMENT ON COLUMN "public"."allowlist"."request_count" IS 'Number of access requests from this email (spam prevention)';



COMMENT ON COLUMN "public"."allowlist"."source" IS 'Source of allowlist entry: request (user requested access) or invitation (user was invited)';



CREATE TABLE IF NOT EXISTS "public"."base_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "specific_weight" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deprecated" timestamp with time zone,
    "user_id" "uuid",
    "tenant_id" "uuid" NOT NULL,
    CONSTRAINT "raw_items_specific_weight_check" CHECK (("specific_weight" > (0)::numeric))
);


ALTER TABLE "public"."base_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


COMMENT ON TABLE "public"."companies" IS '会社マスタ。Tenant の上位レイヤー。';



CREATE TABLE IF NOT EXISTS "public"."company_document_metadata" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "real_data_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_document_metadata" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_document_metadata" IS '会社要件の Document アップロードのメタデータ。実体のパスは company_requirement_real_data.value に格納';



CREATE TABLE IF NOT EXISTS "public"."company_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "email_status" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL,
    "email_id" "text",
    "accepted_at" timestamp with time zone,
    CONSTRAINT "company_invitations_email_status_check" CHECK (("email_status" = ANY (ARRAY['delivered'::"text", 'failed'::"text"]))),
    CONSTRAINT "company_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."company_invitations" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_invitations" IS '会社への director 招待。受け入れ時に company_members に追加。';



COMMENT ON COLUMN "public"."company_invitations"."accepted_at" IS '同上（会社ディレクター招待）';



CREATE TABLE IF NOT EXISTS "public"."company_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."company_member_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_members" IS '会社メンバー。company_admin は作成者1人のみ、company_director は複数可。';



COMMENT ON COLUMN "public"."company_members"."role" IS 'company_admin: 作成者・1会社1人。company_director: 同等権限・複数可。';



CREATE TABLE IF NOT EXISTS "public"."company_requirement_real_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_requirement_id" "uuid" NOT NULL,
    "group_key" integer NOT NULL,
    "type_id" "uuid" NOT NULL,
    "value" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_requirement_real_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_requirement_real_data" IS '要件ごとの実データ。group_key で同じ組の行をまとめる';



CREATE TABLE IF NOT EXISTS "public"."company_requirement_value_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "data_type" "public"."company_requirement_data_type" NOT NULL
);


ALTER TABLE "public"."company_requirement_value_types" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_requirement_value_types" IS 'Due date / Bill date / Pay date / Validity duration / Document などの種類定義';



CREATE TABLE IF NOT EXISTS "public"."company_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_requirements" IS '会社向け要件。最初からこの会社の要件として作成する';



CREATE TABLE IF NOT EXISTS "public"."company_tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."company_tenants" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_tenants" IS '会社に属するテナント。1 tenant は 0 または 1 company に属する（将来制約を入れる場合はアプリ側で担保）。';



CREATE TABLE IF NOT EXISTS "public"."cross_tenant_item_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "owner_tenant_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "allowed_actions" "text"[] DEFAULT ARRAY['read'::"text"] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cross_tenant_item_shares_target_type_check" CHECK (("target_type" = ANY (ARRAY['company'::"text", 'tenant'::"text"])))
);


ALTER TABLE "public"."cross_tenant_item_shares" OWNER TO "postgres";


COMMENT ON TABLE "public"."cross_tenant_item_shares" IS '同一 company 内テナント間での prepped item 公開設定。target_type=company: 会社全体公開、target_type=tenant: 特定テナントのみ。';



COMMENT ON COLUMN "public"."cross_tenant_item_shares"."allowed_actions" IS 'read のみ許可。空配列は明示的な hide 状態（レコードなし = デフォルト hide）。';



CREATE TABLE IF NOT EXISTS "public"."document_inbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "value" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "document_type" "public"."document_inbox_document_type",
    "classified_at" timestamp with time zone,
    "classified_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_inbox_classify_consistency" CHECK (((("document_type" IS NULL) AND ("classified_at" IS NULL) AND ("classified_by" IS NULL)) OR (("document_type" IS NOT NULL) AND ("classified_at" IS NOT NULL) AND ("classified_by" IS NOT NULL)))),
    CONSTRAINT "document_inbox_reviewed_requires_classify" CHECK ((("reviewed_at" IS NULL) OR (("document_type" IS NOT NULL) AND ("reviewed_by" IS NOT NULL))))
);


ALTER TABLE "public"."document_inbox" OWNER TO "postgres";


COMMENT ON TABLE "public"."document_inbox" IS '一次受け inbox。仕分け後に invoice / requirement 系へ連携する。';



CREATE TABLE IF NOT EXISTS "public"."document_metadata" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "real_data_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."document_metadata" OWNER TO "postgres";


COMMENT ON TABLE "public"."document_metadata" IS 'Document アップロードのメタデータ。実体のパスは tenant_requirement_real_data.value に格納';



COMMENT ON COLUMN "public"."document_metadata"."real_data_id" IS '対応する tenant_requirement_real_data の id（type = Document の行）';



COMMENT ON COLUMN "public"."document_metadata"."file_name" IS '元のファイル名';



COMMENT ON COLUMN "public"."document_metadata"."content_type" IS 'MIME type（例: application/pdf, image/jpeg）';



COMMENT ON COLUMN "public"."document_metadata"."size_bytes" IS 'ファイルサイズ（バイト）';



CREATE TABLE IF NOT EXISTS "public"."document_metadata_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "vendor_id" "uuid",
    "value" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "invoice_date" "date",
    "total_amount" numeric(12,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "document_metadata_invoices_total_amount_positive" CHECK (("total_amount" > (0)::numeric))
);


ALTER TABLE "public"."document_metadata_invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_metadata_user_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mapping_user_requirement_id" "uuid" NOT NULL,
    "value" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."document_metadata_user_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."document_metadata_user_requirements" IS '従業員要件の Document。value は R2 オブジェクトキー（例: employee/{mapping_id}/{uuid}.pdf）。';



COMMENT ON COLUMN "public"."document_metadata_user_requirements"."mapping_user_requirement_id" IS 'mapping_user_requirements.id（user_requirements マスタではない）';



CREATE TABLE IF NOT EXISTS "public"."history_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "changed_fields" "jsonb",
    "changed_by" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "visibility" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "history_logs_action_check" CHECK (("action" = ANY (ARRAY['create'::"text", 'update'::"text", 'delete'::"text"]))),
    CONSTRAINT "history_logs_visibility_check" CHECK (("visibility" = ANY (ARRAY['internal'::"text", 'shared'::"text"])))
);


ALTER TABLE "public"."history_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "email_status" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL,
    "email_id" "text",
    "accepted_at" timestamp with time zone,
    CONSTRAINT "invitations_email_status_check" CHECK (("email_status" = ANY (ARRAY['delivered'::"text", 'failed'::"text"]))),
    CONSTRAINT "invitations_role_check" CHECK (("role" = ANY (ARRAY['manager'::"text", 'staff'::"text", 'director'::"text"]))),
    CONSTRAINT "invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."invitations"."accepted_at" IS 'status が accepted になった日時';



CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "item_kind" "text" NOT NULL,
    "is_menu_item" boolean DEFAULT false NOT NULL,
    "proceed_yield_amount" numeric,
    "proceed_yield_unit" "text",
    "notes" "text",
    "each_grams" numeric,
    "base_item_id" "uuid",
    "deprecated" timestamp with time zone,
    "deprecation_reason" "text",
    "wholesale" numeric,
    "retail" numeric,
    "user_id" "uuid",
    "tenant_id" "uuid" NOT NULL,
    "responsible_user_id" "uuid",
    CONSTRAINT "chk_items_menu_must_be_prepped" CHECK (((NOT "is_menu_item") OR ("item_kind" = 'prepped'::"text"))),
    CONSTRAINT "chk_items_prepped_fields_new" CHECK ((("item_kind" <> 'prepped'::"text") OR (("proceed_yield_amount" IS NOT NULL) AND ("proceed_yield_amount" > (0)::numeric) AND ("proceed_yield_unit" IS NOT NULL) AND ("base_item_id" IS NULL)))),
    CONSTRAINT "chk_items_prepped_has_name" CHECK ((("item_kind" <> 'prepped'::"text") OR ("name" IS NOT NULL))),
    CONSTRAINT "chk_items_raw_fields_new" CHECK ((("item_kind" <> 'raw'::"text") OR (("base_item_id" IS NOT NULL) AND ("proceed_yield_amount" IS NULL) AND ("proceed_yield_unit" IS NULL)))),
    CONSTRAINT "chk_items_raw_has_base_item" CHECK ((("item_kind" <> 'raw'::"text") OR ("base_item_id" IS NOT NULL))),
    CONSTRAINT "chk_items_yield_unit_mass" CHECK ((("proceed_yield_unit" IS NULL) OR ("proceed_yield_unit" = ANY (ARRAY['g'::"text", 'kg'::"text", 'lb'::"text", 'oz'::"text", 'each'::"text"])))),
    CONSTRAINT "items_each_grams_check" CHECK (("each_grams" > (0)::numeric)),
    CONSTRAINT "items_item_kind_check" CHECK (("item_kind" = ANY (ARRAY['raw'::"text", 'prepped'::"text"])))
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jurisdictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."jurisdictions" OWNER TO "postgres";


COMMENT ON TABLE "public"."jurisdictions" IS 'Employee requirements: 管轄ラベル（会社スコープ）';



COMMENT ON COLUMN "public"."jurisdictions"."company_id" IS 'ヘッダー company プルダウンと一致';



CREATE TABLE IF NOT EXISTS "public"."labor_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "hourly_wage" numeric NOT NULL,
    "user_id" "uuid",
    "tenant_id" "uuid" NOT NULL,
    CONSTRAINT "labor_roles_hourly_wage_check" CHECK (("hourly_wage" > (0)::numeric))
);


ALTER TABLE "public"."labor_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mapping_user_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_requirement_id" "uuid" NOT NULL,
    "issued_date" "date",
    "specific_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mapping_user_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."mapping_user_requirements" IS 'ユーザーと要件の紐付け。同一ユーザー・同一要件で複数行可（更新履歴）';



COMMENT ON COLUMN "public"."mapping_user_requirements"."issued_date" IS '発行日・取得日・完了日';



COMMENT ON COLUMN "public"."mapping_user_requirements"."specific_date" IS '期限日';



CREATE TABLE IF NOT EXISTS "public"."price_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "virtual_vendor_product_id" "uuid" NOT NULL,
    "price" numeric NOT NULL,
    "source_type" "text" NOT NULL,
    "invoice_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "apply_to_current_price" boolean DEFAULT true NOT NULL,
    "case_unit" integer,
    "case_purchased" integer,
    "unit_purchased" integer,
    CONSTRAINT "pe_case_purchased_positive" CHECK (("case_purchased" > 0)),
    CONSTRAINT "pe_case_unit_positive" CHECK (("case_unit" > 0)),
    CONSTRAINT "pe_purchase_qty_not_all_null" CHECK ((("case_unit" IS NOT NULL) OR ("case_purchased" IS NOT NULL) OR ("unit_purchased" IS NOT NULL))),
    CONSTRAINT "pe_unit_purchased_positive" CHECK (("unit_purchased" > 0)),
    CONSTRAINT "price_events_price_check" CHECK (("price" > (0)::numeric)),
    CONSTRAINT "price_events_source_type_check" CHECK (("source_type" = ANY (ARRAY['manual'::"text", 'invoice'::"text"])))
);


ALTER TABLE "public"."price_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."price_events"."apply_to_current_price" IS 'When true (default), AFTER INSERT trigger syncs VVP current_price/updated_at from this row. When false, ledger row only.';



CREATE TABLE IF NOT EXISTS "public"."proceed_validation_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "validation_mode" "public"."validation_mode" DEFAULT 'block'::"public"."validation_mode" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."proceed_validation_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "base_item_id" "uuid" NOT NULL,
    "virtual_product_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'staff'::"text", 'director'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recipe_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_item_id" "uuid" NOT NULL,
    "line_type" "text" NOT NULL,
    "child_item_id" "uuid",
    "quantity" numeric,
    "unit" "text",
    "labor_role" "text",
    "minutes" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "specific_child" "text",
    "last_change" "text",
    "user_id" "uuid",
    "tenant_id" "uuid" NOT NULL,
    CONSTRAINT "chk_recipe_lines_ingredient" CHECK ((("line_type" <> 'ingredient'::"text") OR (("child_item_id" IS NOT NULL) AND ("quantity" IS NOT NULL) AND ("quantity" > (0)::numeric) AND ("unit" IS NOT NULL) AND ("minutes" IS NULL) AND ("labor_role" IS NULL)))),
    CONSTRAINT "chk_recipe_lines_labor" CHECK ((("line_type" <> 'labor'::"text") OR (("minutes" IS NOT NULL) AND ("minutes" > (0)::numeric) AND ("child_item_id" IS NULL) AND ("quantity" IS NULL) AND ("unit" IS NULL)))),
    CONSTRAINT "recipe_lines_line_type_check" CHECK (("line_type" = ANY (ARRAY['ingredient'::"text", 'labor'::"text"])))
);


ALTER TABLE "public"."recipe_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resource_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "owner_tenant_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text",
    "is_exclusion" boolean DEFAULT false,
    "show_history_to_shared" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "allowed_actions" "text"[] DEFAULT ARRAY['read'::"text"] NOT NULL,
    CONSTRAINT "resource_shares_target_type_check" CHECK (("target_type" = ANY (ARRAY['tenant'::"text", 'role'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."resource_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_requirement_real_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_requirement_id" "uuid" NOT NULL,
    "group_key" integer NOT NULL,
    "type_id" "uuid" NOT NULL,
    "value" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tenant_requirement_real_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_requirement_real_data" IS '要件ごとの実データ。group_key で同じ組の行をまとめる（例: 1年目・2年目）';



COMMENT ON COLUMN "public"."tenant_requirement_real_data"."group_key" IS '組の識別。1, 2, 3...';



COMMENT ON COLUMN "public"."tenant_requirement_real_data"."value" IS '実際の値（例: 2024-06-01, 2）';



CREATE TABLE IF NOT EXISTS "public"."tenant_requirement_value_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "data_type" "public"."tenant_requirement_data_type" NOT NULL
);


ALTER TABLE "public"."tenant_requirement_value_types" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_requirement_value_types" IS 'Due date / Bill date / Pay date / Validity duration などの種類定義';



COMMENT ON COLUMN "public"."tenant_requirement_value_types"."data_type" IS '値の型。date=日付, int=整数。UI の入力種別や value の解釈に使用';



CREATE TABLE IF NOT EXISTS "public"."tenant_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tenant_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_requirements" IS 'テナント向け要件。最初からこのテナントの要件として作成する（適用の概念なし）';



CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tenants_type_check" CHECK (("type" = ANY (ARRAY['restaurant'::"text", 'vendor'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unit_conversions" (
    "from_unit" "text" NOT NULL,
    "to_unit" "text" NOT NULL,
    "multiplier_to_grams" numeric NOT NULL,
    CONSTRAINT "chk_unit_conversions_to_unit_g" CHECK (("to_unit" = 'g'::"text")),
    CONSTRAINT "unit_conversions_multiplier_to_grams_check" CHECK (("multiplier_to_grams" > (0)::numeric))
);


ALTER TABLE "public"."unit_conversions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_jurisdictions" (
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "jurisdiction_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_jurisdictions" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_jurisdictions" IS '従業員（profiles 利用者）に付与した管轄';



CREATE TABLE IF NOT EXISTS "public"."user_requirement_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_requirement_id" "uuid",
    "is_currently_assigned" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."user_requirement_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_requirement_assignments" IS '誰にどの要件を適用しているか。適用の有無は mapping の有無では判断しない';



COMMENT ON COLUMN "public"."user_requirement_assignments"."is_currently_assigned" IS 'true=適用中, false=Remove済み。Addでtrueに戻す';



COMMENT ON COLUMN "public"."user_requirement_assignments"."deleted_at" IS '参照している要件が Requirements List から削除された日時。NULL=要件はまだ存在';



CREATE TABLE IF NOT EXISTS "public"."user_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "validity_period" integer,
    "renewal_advance_days" integer,
    "expiry_rule" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "first_due_date" integer,
    "first_due_on_date" "date",
    "validity_period_unit" "text",
    "company_id" "uuid" NOT NULL,
    "jurisdiction_id" "uuid" NOT NULL
);


ALTER TABLE "public"."user_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_requirements" IS '従業員向け要件（会社＋管轄でスコープ）';



COMMENT ON COLUMN "public"."user_requirements"."validity_period" IS '有効期間（日数）。例: 365 = 1年';



COMMENT ON COLUMN "public"."user_requirements"."renewal_advance_days" IS '更新リマインダーを何日前に出すか';



COMMENT ON COLUMN "public"."user_requirements"."expiry_rule" IS '期限の算出ルール（例: anniversary, calendar_year, fiscal_year）';



COMMENT ON COLUMN "public"."user_requirements"."created_by" IS '作成者（users.id）。複数テナントを管理する admin が共通で使う要件の所有者';



COMMENT ON COLUMN "public"."user_requirements"."first_due_date" IS '雇われてから何日以内に取得が必要か（整数）。例: I-9 は 3';



COMMENT ON COLUMN "public"."user_requirements"."first_due_on_date" IS '初回期限を特定の日付で指定する場合の日付。First due date on のとき使用。first_due_date と排他。';



COMMENT ON COLUMN "public"."user_requirements"."validity_period_unit" IS '有効期間の単位: years, months, days。NULL は年数として扱う（後方互換）';



COMMENT ON COLUMN "public"."user_requirements"."company_id" IS '要件が属する会社（選択ヘッダーと一致）';



COMMENT ON COLUMN "public"."user_requirements"."jurisdiction_id" IS 'この要件が適用される管轄';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "birth_day" "date",
    "hire_date" "date",
    "display_name" "text"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."birth_day" IS '生年月日';



COMMENT ON COLUMN "public"."users"."hire_date" IS '入社日';



COMMENT ON COLUMN "public"."users"."display_name" IS '表示名。Auth の user_metadata から同期。reminder-members で使用';



CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."virtual_vendor_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "product_name" "text",
    "brand_name" "text",
    "purchase_unit" "text" NOT NULL,
    "purchase_quantity" numeric NOT NULL,
    "current_price" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deprecated" timestamp with time zone,
    "tenant_id" "uuid" NOT NULL,
    "case_unit" integer,
    CONSTRAINT "vendor_products_current_price_check" CHECK (("current_price" > (0)::numeric)),
    CONSTRAINT "vendor_products_purchase_quantity_check" CHECK (("purchase_quantity" > (0)::numeric)),
    CONSTRAINT "vvp_case_unit_positive" CHECK (("case_unit" > 0))
);


ALTER TABLE "public"."virtual_vendor_products" OWNER TO "postgres";


ALTER TABLE ONLY "public"."allowlist"
    ADD CONSTRAINT "allowlist_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."allowlist"
    ADD CONSTRAINT "allowlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_document_metadata"
    ADD CONSTRAINT "company_document_metadata_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_document_metadata"
    ADD CONSTRAINT "company_document_metadata_real_data_id_key" UNIQUE ("real_data_id");



ALTER TABLE ONLY "public"."company_invitations"
    ADD CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_invitations"
    ADD CONSTRAINT "company_invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_requirement_real_data"
    ADD CONSTRAINT "company_requirement_real_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_requirement_value_types"
    ADD CONSTRAINT "company_requirement_value_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_requirements"
    ADD CONSTRAINT "company_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_tenants"
    ADD CONSTRAINT "company_tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cross_tenant_item_shares"
    ADD CONSTRAINT "cross_tenant_item_shares_item_target_unique" UNIQUE ("item_id", "target_type", "target_id");



ALTER TABLE ONLY "public"."cross_tenant_item_shares"
    ADD CONSTRAINT "cross_tenant_item_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_inbox"
    ADD CONSTRAINT "document_inbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_metadata_invoices"
    ADD CONSTRAINT "document_metadata_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_metadata"
    ADD CONSTRAINT "document_metadata_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_metadata"
    ADD CONSTRAINT "document_metadata_real_data_id_key" UNIQUE ("real_data_id");



ALTER TABLE ONLY "public"."document_metadata_user_requirements"
    ADD CONSTRAINT "document_metadata_user_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."history_logs"
    ADD CONSTRAINT "history_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jurisdictions"
    ADD CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."labor_roles"
    ADD CONSTRAINT "labor_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mapping_user_requirements"
    ADD CONSTRAINT "mapping_user_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unit_conversions"
    ADD CONSTRAINT "pk_unit_conversions" PRIMARY KEY ("from_unit", "to_unit");



ALTER TABLE ONLY "public"."price_events"
    ADD CONSTRAINT "price_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proceed_validation_settings"
    ADD CONSTRAINT "proceed_validation_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proceed_validation_settings"
    ADD CONSTRAINT "proceed_validation_settings_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."product_mappings"
    ADD CONSTRAINT "product_mappings_base_item_id_virtual_product_id_tenant_id_key" UNIQUE ("base_item_id", "virtual_product_id", "tenant_id");



ALTER TABLE ONLY "public"."product_mappings"
    ADD CONSTRAINT "product_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_tenant_id_key" UNIQUE ("user_id", "tenant_id");



ALTER TABLE ONLY "public"."base_items"
    ADD CONSTRAINT "raw_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipe_lines"
    ADD CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resource_shares"
    ADD CONSTRAINT "resource_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_requirement_real_data"
    ADD CONSTRAINT "tenant_requirement_real_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_requirement_value_types"
    ADD CONSTRAINT "tenant_requirement_value_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_requirements"
    ADD CONSTRAINT "tenant_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_jurisdictions"
    ADD CONSTRAINT "user_jurisdictions_pkey" PRIMARY KEY ("company_id", "user_id", "jurisdiction_id");



ALTER TABLE ONLY "public"."user_requirement_assignments"
    ADD CONSTRAINT "user_requirement_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_requirements"
    ADD CONSTRAINT "user_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."virtual_vendor_products"
    ADD CONSTRAINT "vendor_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_allowlist_email_status" ON "public"."allowlist" USING "btree" ("email", "status");



CREATE INDEX "idx_allowlist_source" ON "public"."allowlist" USING "btree" ("source");



CREATE INDEX "idx_allowlist_status" ON "public"."allowlist" USING "btree" ("status");



CREATE INDEX "idx_base_items_deprecated" ON "public"."base_items" USING "btree" ("deprecated");



CREATE UNIQUE INDEX "idx_base_items_name_tenant_id_unique_active" ON "public"."base_items" USING "btree" ("name", "tenant_id") WHERE ("deprecated" IS NULL);



CREATE INDEX "idx_base_items_tenant_id" ON "public"."base_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_base_items_user_id" ON "public"."base_items" USING "btree" ("user_id");



CREATE INDEX "idx_companies_company_name" ON "public"."companies" USING "btree" ("company_name");



CREATE INDEX "idx_company_invitations_company_id" ON "public"."company_invitations" USING "btree" ("company_id");



CREATE INDEX "idx_company_invitations_created_by" ON "public"."company_invitations" USING "btree" ("created_by");



CREATE INDEX "idx_company_invitations_email" ON "public"."company_invitations" USING "btree" ("email");



CREATE INDEX "idx_company_invitations_expires_at" ON "public"."company_invitations" USING "btree" ("expires_at");



CREATE INDEX "idx_company_invitations_status" ON "public"."company_invitations" USING "btree" ("status");



CREATE INDEX "idx_company_invitations_token" ON "public"."company_invitations" USING "btree" ("token");



CREATE UNIQUE INDEX "idx_company_invitations_unique_pending" ON "public"."company_invitations" USING "btree" ("email", "company_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_company_members_company_id" ON "public"."company_members" USING "btree" ("company_id");



CREATE UNIQUE INDEX "idx_company_members_company_user" ON "public"."company_members" USING "btree" ("company_id", "user_id");



CREATE INDEX "idx_company_members_user_id" ON "public"."company_members" USING "btree" ("user_id");



CREATE INDEX "idx_company_requirement_real_data_company_requirement_id" ON "public"."company_requirement_real_data" USING "btree" ("company_requirement_id");



CREATE INDEX "idx_company_requirement_real_data_group_key" ON "public"."company_requirement_real_data" USING "btree" ("company_requirement_id", "group_key");



CREATE INDEX "idx_company_requirements_company_id" ON "public"."company_requirements" USING "btree" ("company_id");



CREATE INDEX "idx_company_tenants_company_id" ON "public"."company_tenants" USING "btree" ("company_id");



CREATE UNIQUE INDEX "idx_company_tenants_company_tenant" ON "public"."company_tenants" USING "btree" ("company_id", "tenant_id");



CREATE INDEX "idx_company_tenants_tenant_id" ON "public"."company_tenants" USING "btree" ("tenant_id");



CREATE INDEX "idx_cross_tenant_item_shares_company_id" ON "public"."cross_tenant_item_shares" USING "btree" ("company_id");



CREATE INDEX "idx_cross_tenant_item_shares_item_id" ON "public"."cross_tenant_item_shares" USING "btree" ("item_id");



CREATE INDEX "idx_cross_tenant_item_shares_owner_tenant" ON "public"."cross_tenant_item_shares" USING "btree" ("owner_tenant_id");



CREATE INDEX "idx_cross_tenant_item_shares_target" ON "public"."cross_tenant_item_shares" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_document_inbox_tenant_created" ON "public"."document_inbox" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_document_inbox_tenant_unreviewed" ON "public"."document_inbox" USING "btree" ("tenant_id") WHERE ("reviewed_at" IS NULL);



CREATE INDEX "idx_document_metadata_invoices_invoice_date" ON "public"."document_metadata_invoices" USING "btree" ("tenant_id", "invoice_date" DESC);



CREATE INDEX "idx_document_metadata_invoices_tenant" ON "public"."document_metadata_invoices" USING "btree" ("tenant_id");



CREATE INDEX "idx_document_metadata_invoices_vendor" ON "public"."document_metadata_invoices" USING "btree" ("vendor_id");



CREATE INDEX "idx_document_metadata_user_requirements_mapping" ON "public"."document_metadata_user_requirements" USING "btree" ("mapping_user_requirement_id");



CREATE INDEX "idx_history_logs_changed_by" ON "public"."history_logs" USING "btree" ("changed_by");



CREATE INDEX "idx_history_logs_created_at" ON "public"."history_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_history_logs_resource" ON "public"."history_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_history_logs_tenant" ON "public"."history_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_history_logs_visibility" ON "public"."history_logs" USING "btree" ("visibility");



CREATE INDEX "idx_invitations_created_by" ON "public"."invitations" USING "btree" ("created_by");



CREATE INDEX "idx_invitations_email" ON "public"."invitations" USING "btree" ("email");



CREATE INDEX "idx_invitations_email_id" ON "public"."invitations" USING "btree" ("email_id");



CREATE INDEX "idx_invitations_email_tenant_status" ON "public"."invitations" USING "btree" ("email", "tenant_id", "status");



CREATE INDEX "idx_invitations_expires_at" ON "public"."invitations" USING "btree" ("expires_at");



CREATE INDEX "idx_invitations_id" ON "public"."invitations" USING "btree" ("id");



CREATE INDEX "idx_invitations_status" ON "public"."invitations" USING "btree" ("status");



CREATE INDEX "idx_invitations_tenant_id" ON "public"."invitations" USING "btree" ("tenant_id");



CREATE INDEX "idx_invitations_token" ON "public"."invitations" USING "btree" ("token");



CREATE UNIQUE INDEX "idx_invitations_unique_pending" ON "public"."invitations" USING "btree" ("email", "tenant_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_items_base_item" ON "public"."items" USING "btree" ("base_item_id");



CREATE INDEX "idx_items_deprecated" ON "public"."items" USING "btree" ("deprecated");



CREATE INDEX "idx_items_is_menu_item" ON "public"."items" USING "btree" ("is_menu_item");



CREATE INDEX "idx_items_item_kind" ON "public"."items" USING "btree" ("item_kind");



CREATE UNIQUE INDEX "idx_items_name_tenant_id_unique_active" ON "public"."items" USING "btree" ("name", "tenant_id") WHERE ("deprecated" IS NULL);



CREATE INDEX "idx_items_responsible_user_id" ON "public"."items" USING "btree" ("responsible_user_id");



CREATE INDEX "idx_items_tenant_id" ON "public"."items" USING "btree" ("tenant_id");



CREATE INDEX "idx_items_tenant_id_item_kind" ON "public"."items" USING "btree" ("tenant_id", "item_kind");



CREATE INDEX "idx_items_user_id" ON "public"."items" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_jurisdictions_company_lower_name" ON "public"."jurisdictions" USING "btree" ("company_id", "lower"("btrim"("name")));



CREATE UNIQUE INDEX "idx_labor_roles_name_user_id_unique" ON "public"."labor_roles" USING "btree" ("name", "user_id");



CREATE INDEX "idx_labor_roles_tenant_id" ON "public"."labor_roles" USING "btree" ("tenant_id");



CREATE INDEX "idx_labor_roles_tenant_id_name" ON "public"."labor_roles" USING "btree" ("tenant_id", "name");



CREATE INDEX "idx_labor_roles_user_id" ON "public"."labor_roles" USING "btree" ("user_id");



CREATE INDEX "idx_mapping_user_requirements_user_id" ON "public"."mapping_user_requirements" USING "btree" ("user_id");



CREATE INDEX "idx_mapping_user_requirements_user_requirement_id" ON "public"."mapping_user_requirements" USING "btree" ("user_requirement_id");



CREATE INDEX "idx_price_events_invoice_id" ON "public"."price_events" USING "btree" ("invoice_id") WHERE ("invoice_id" IS NOT NULL);



CREATE INDEX "idx_price_events_source_type" ON "public"."price_events" USING "btree" ("source_type");



CREATE INDEX "idx_price_events_tenant_id" ON "public"."price_events" USING "btree" ("tenant_id");



CREATE INDEX "idx_price_events_virtual_vendor_product_id_created_at" ON "public"."price_events" USING "btree" ("virtual_vendor_product_id", "created_at" DESC);



CREATE INDEX "idx_proceed_validation_settings_created_at" ON "public"."proceed_validation_settings" USING "btree" ("created_at");



CREATE INDEX "idx_proceed_validation_settings_user_id" ON "public"."proceed_validation_settings" USING "btree" ("user_id");



CREATE INDEX "idx_product_mappings_base_item_id" ON "public"."product_mappings" USING "btree" ("base_item_id");



CREATE INDEX "idx_product_mappings_base_tenant" ON "public"."product_mappings" USING "btree" ("base_item_id", "tenant_id");



CREATE INDEX "idx_product_mappings_tenant_id" ON "public"."product_mappings" USING "btree" ("tenant_id");



CREATE INDEX "idx_product_mappings_virtual_product_id" ON "public"."product_mappings" USING "btree" ("virtual_product_id");



CREATE INDEX "idx_profiles_id" ON "public"."profiles" USING "btree" ("id");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_profiles_tenant_id" ON "public"."profiles" USING "btree" ("tenant_id");



CREATE INDEX "idx_profiles_user_id" ON "public"."profiles" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_user_tenant" ON "public"."profiles" USING "btree" ("user_id", "tenant_id");



CREATE INDEX "idx_recipe_lines_child_item_id_line_type" ON "public"."recipe_lines" USING "btree" ("child_item_id", "line_type");



CREATE INDEX "idx_recipe_lines_parent" ON "public"."recipe_lines" USING "btree" ("parent_item_id");



CREATE INDEX "idx_recipe_lines_tenant_id" ON "public"."recipe_lines" USING "btree" ("tenant_id");



CREATE INDEX "idx_recipe_lines_tenant_id_line_type" ON "public"."recipe_lines" USING "btree" ("tenant_id", "line_type");



CREATE INDEX "idx_recipe_lines_user_id" ON "public"."recipe_lines" USING "btree" ("user_id");



CREATE INDEX "idx_resource_shares_exclusion" ON "public"."resource_shares" USING "btree" ("is_exclusion") WHERE ("is_exclusion" = true);



CREATE INDEX "idx_resource_shares_owner_tenant" ON "public"."resource_shares" USING "btree" ("owner_tenant_id");



CREATE INDEX "idx_resource_shares_resource" ON "public"."resource_shares" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_resource_shares_target" ON "public"."resource_shares" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_tenant_requirement_real_data_group_key" ON "public"."tenant_requirement_real_data" USING "btree" ("tenant_requirement_id", "group_key");



CREATE INDEX "idx_tenant_requirement_real_data_tenant_requirement_id" ON "public"."tenant_requirement_real_data" USING "btree" ("tenant_requirement_id");



CREATE INDEX "idx_tenant_requirements_tenant_id" ON "public"."tenant_requirements" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenants_id" ON "public"."tenants" USING "btree" ("id");



CREATE INDEX "idx_tenants_type" ON "public"."tenants" USING "btree" ("type");



CREATE INDEX "idx_user_jurisdictions_jurisdiction_id" ON "public"."user_jurisdictions" USING "btree" ("jurisdiction_id");



CREATE INDEX "idx_user_jurisdictions_user_id" ON "public"."user_jurisdictions" USING "btree" ("user_id");



CREATE INDEX "idx_user_requirement_assignments_user_id" ON "public"."user_requirement_assignments" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_user_requirement_assignments_user_req" ON "public"."user_requirement_assignments" USING "btree" ("user_id", "user_requirement_id");



CREATE INDEX "idx_user_requirement_assignments_user_requirement_id" ON "public"."user_requirement_assignments" USING "btree" ("user_requirement_id");



CREATE INDEX "idx_user_requirements_company_id" ON "public"."user_requirements" USING "btree" ("company_id");



CREATE INDEX "idx_user_requirements_created_by" ON "public"."user_requirements" USING "btree" ("created_by");



CREATE INDEX "idx_user_requirements_jurisdiction_id" ON "public"."user_requirements" USING "btree" ("jurisdiction_id");



CREATE INDEX "idx_users_id" ON "public"."users" USING "btree" ("id");



CREATE INDEX "idx_vendor_products_deprecated" ON "public"."virtual_vendor_products" USING "btree" ("deprecated");



CREATE UNIQUE INDEX "idx_vendors_name_tenant_id_unique" ON "public"."vendors" USING "btree" ("name", "tenant_id");



CREATE INDEX "idx_vendors_tenant_id" ON "public"."vendors" USING "btree" ("tenant_id");



CREATE INDEX "idx_vendors_user_id" ON "public"."vendors" USING "btree" ("user_id");



CREATE INDEX "idx_virtual_vendor_products_deprecated" ON "public"."virtual_vendor_products" USING "btree" ("deprecated") WHERE ("deprecated" IS NOT NULL);



CREATE INDEX "idx_virtual_vendor_products_tenant_id" ON "public"."virtual_vendor_products" USING "btree" ("tenant_id");



CREATE INDEX "idx_virtual_vendor_products_vendor" ON "public"."virtual_vendor_products" USING "btree" ("vendor_id");



CREATE UNIQUE INDEX "uq_virtual_vendor_products_unique" ON "public"."virtual_vendor_products" USING "btree" ("vendor_id", "product_name", "tenant_id", COALESCE("case_unit", 0)) WHERE ("product_name" IS NOT NULL);



CREATE OR REPLACE TRIGGER "after_profiles_insert_assign_requirements" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."after_profiles_insert_assign_requirements"();



CREATE OR REPLACE TRIGGER "trg_cross_tenant_item_shares_updated_at" BEFORE UPDATE ON "public"."cross_tenant_item_shares" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_cross_tenant_item_shares"();



CREATE OR REPLACE TRIGGER "trg_document_inbox_updated_at" BEFORE UPDATE ON "public"."document_inbox" FOR EACH ROW EXECUTE FUNCTION "public"."set_document_inbox_updated_at"();



CREATE OR REPLACE TRIGGER "trg_prevent_price_events_delete" BEFORE DELETE ON "public"."price_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_price_events_update_delete"();



CREATE OR REPLACE TRIGGER "trg_prevent_price_events_update" BEFORE UPDATE ON "public"."price_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_price_events_update_delete"();



CREATE OR REPLACE TRIGGER "trg_sync_virtual_vendor_current_price" AFTER INSERT ON "public"."price_events" FOR EACH ROW EXECUTE FUNCTION "public"."sync_virtual_vendor_current_price_from_event"();



CREATE OR REPLACE TRIGGER "trigger_update_proceed_validation_settings_updated_at" BEFORE UPDATE ON "public"."proceed_validation_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_proceed_validation_settings_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_recipe_lines_updated_at" BEFORE UPDATE ON "public"."recipe_lines" FOR EACH ROW EXECUTE FUNCTION "public"."update_recipe_lines_updated_at"();



CREATE OR REPLACE TRIGGER "user_jurisdictions_company_match_biub" BEFORE INSERT OR UPDATE ON "public"."user_jurisdictions" FOR EACH ROW EXECUTE FUNCTION "public"."user_jurisdictions_company_match"();



ALTER TABLE ONLY "public"."base_items"
    ADD CONSTRAINT "base_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."base_items"
    ADD CONSTRAINT "base_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_document_metadata"
    ADD CONSTRAINT "company_document_metadata_real_data_id_fkey" FOREIGN KEY ("real_data_id") REFERENCES "public"."company_requirement_real_data"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_invitations"
    ADD CONSTRAINT "company_invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_invitations"
    ADD CONSTRAINT "company_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_requirement_real_data"
    ADD CONSTRAINT "company_requirement_real_data_company_requirement_id_fkey" FOREIGN KEY ("company_requirement_id") REFERENCES "public"."company_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_requirement_real_data"
    ADD CONSTRAINT "company_requirement_real_data_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "public"."company_requirement_value_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."company_requirements"
    ADD CONSTRAINT "company_requirements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_tenants"
    ADD CONSTRAINT "company_tenants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_tenants"
    ADD CONSTRAINT "company_tenants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cross_tenant_item_shares"
    ADD CONSTRAINT "cross_tenant_item_shares_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cross_tenant_item_shares"
    ADD CONSTRAINT "cross_tenant_item_shares_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cross_tenant_item_shares"
    ADD CONSTRAINT "cross_tenant_item_shares_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cross_tenant_item_shares"
    ADD CONSTRAINT "cross_tenant_item_shares_owner_tenant_id_fkey" FOREIGN KEY ("owner_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_inbox"
    ADD CONSTRAINT "document_inbox_classified_by_fkey" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."document_inbox"
    ADD CONSTRAINT "document_inbox_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."document_inbox"
    ADD CONSTRAINT "document_inbox_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."document_inbox"
    ADD CONSTRAINT "document_inbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_metadata_invoices"
    ADD CONSTRAINT "document_metadata_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."document_metadata_invoices"
    ADD CONSTRAINT "document_metadata_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_metadata_invoices"
    ADD CONSTRAINT "document_metadata_invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."document_metadata"
    ADD CONSTRAINT "document_metadata_real_data_id_fkey" FOREIGN KEY ("real_data_id") REFERENCES "public"."tenant_requirement_real_data"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_metadata_user_requirements"
    ADD CONSTRAINT "document_metadata_user_require_mapping_user_requirement_id_fkey" FOREIGN KEY ("mapping_user_requirement_id") REFERENCES "public"."mapping_user_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."history_logs"
    ADD CONSTRAINT "history_logs_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."history_logs"
    ADD CONSTRAINT "history_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_base_item_id_fkey" FOREIGN KEY ("base_item_id") REFERENCES "public"."base_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jurisdictions"
    ADD CONSTRAINT "jurisdictions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jurisdictions"
    ADD CONSTRAINT "jurisdictions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."labor_roles"
    ADD CONSTRAINT "labor_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."labor_roles"
    ADD CONSTRAINT "labor_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mapping_user_requirements"
    ADD CONSTRAINT "mapping_user_requirements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mapping_user_requirements"
    ADD CONSTRAINT "mapping_user_requirements_user_requirement_id_fkey" FOREIGN KEY ("user_requirement_id") REFERENCES "public"."user_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_events"
    ADD CONSTRAINT "price_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."document_metadata_invoices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."price_events"
    ADD CONSTRAINT "price_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_events"
    ADD CONSTRAINT "price_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."price_events"
    ADD CONSTRAINT "price_events_virtual_vendor_product_id_fkey" FOREIGN KEY ("virtual_vendor_product_id") REFERENCES "public"."virtual_vendor_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proceed_validation_settings"
    ADD CONSTRAINT "proceed_validation_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_mappings"
    ADD CONSTRAINT "product_mappings_base_item_id_fkey" FOREIGN KEY ("base_item_id") REFERENCES "public"."base_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_mappings"
    ADD CONSTRAINT "product_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_mappings"
    ADD CONSTRAINT "product_mappings_virtual_product_id_fkey" FOREIGN KEY ("virtual_product_id") REFERENCES "public"."virtual_vendor_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_lines"
    ADD CONSTRAINT "recipe_lines_child_item_id_fkey" FOREIGN KEY ("child_item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."recipe_lines"
    ADD CONSTRAINT "recipe_lines_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_lines"
    ADD CONSTRAINT "recipe_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_lines"
    ADD CONSTRAINT "recipe_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_shares"
    ADD CONSTRAINT "resource_shares_owner_tenant_id_fkey" FOREIGN KEY ("owner_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_requirement_real_data"
    ADD CONSTRAINT "tenant_requirement_real_data_tenant_requirement_id_fkey" FOREIGN KEY ("tenant_requirement_id") REFERENCES "public"."tenant_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_requirement_real_data"
    ADD CONSTRAINT "tenant_requirement_real_data_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "public"."tenant_requirement_value_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tenant_requirements"
    ADD CONSTRAINT "tenant_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_jurisdictions"
    ADD CONSTRAINT "user_jurisdictions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_jurisdictions"
    ADD CONSTRAINT "user_jurisdictions_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_jurisdictions"
    ADD CONSTRAINT "user_jurisdictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_requirement_assignments"
    ADD CONSTRAINT "user_requirement_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_requirement_assignments"
    ADD CONSTRAINT "user_requirement_assignments_user_requirement_id_fkey" FOREIGN KEY ("user_requirement_id") REFERENCES "public"."user_requirements"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_requirements"
    ADD CONSTRAINT "user_requirements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_requirements"
    ADD CONSTRAINT "user_requirements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_requirements"
    ADD CONSTRAINT "user_requirements_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."virtual_vendor_products"
    ADD CONSTRAINT "vendor_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."virtual_vendor_products"
    ADD CONSTRAINT "vendor_products_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "No public access to allowlist" ON "public"."allowlist" USING (false);



CREATE POLICY "Postgres role can insert proceed_validation_settings" ON "public"."proceed_validation_settings" FOR INSERT TO "postgres" WITH CHECK (true);



CREATE POLICY "Service role and postgres can insert profiles" ON "public"."profiles" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role and postgres can insert tenants" ON "public"."tenants" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can insert proceed_validation_settings" ON "public"."proceed_validation_settings" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can manage allowlist" ON "public"."allowlist" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Users can insert their own proceed_validation_settings" ON "public"."proceed_validation_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own proceed_validation_settings" ON "public"."proceed_validation_settings" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own proceed_validation_settings" ON "public"."proceed_validation_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."allowlist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cross_tenant_item_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cross_tenant_item_shares_delete" ON "public"."cross_tenant_item_shares" FOR DELETE USING ((("owner_tenant_id" IN ( SELECT "p"."tenant_id"
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'director'::"text"]))))) OR ("company_id" IN ( SELECT "cm"."company_id"
   FROM "public"."company_members" "cm"
  WHERE (("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = ANY (ARRAY['company_admin'::"public"."company_member_role", 'company_director'::"public"."company_member_role"])))))));



CREATE POLICY "cross_tenant_item_shares_insert" ON "public"."cross_tenant_item_shares" FOR INSERT WITH CHECK ((("owner_tenant_id" IN ( SELECT "p"."tenant_id"
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'director'::"text"]))))) OR ("company_id" IN ( SELECT "cm"."company_id"
   FROM "public"."company_members" "cm"
  WHERE (("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = ANY (ARRAY['company_admin'::"public"."company_member_role", 'company_director'::"public"."company_member_role"])))))));



CREATE POLICY "cross_tenant_item_shares_select" ON "public"."cross_tenant_item_shares" FOR SELECT USING ((("company_id" IN ( SELECT "ct"."company_id"
   FROM ("public"."company_tenants" "ct"
     JOIN "public"."profiles" "p" ON (("p"."tenant_id" = "ct"."tenant_id")))
  WHERE ("p"."user_id" = "auth"."uid"()))) OR ("company_id" IN ( SELECT "cm"."company_id"
   FROM "public"."company_members" "cm"
  WHERE ("cm"."user_id" = "auth"."uid"())))));



CREATE POLICY "cross_tenant_item_shares_update" ON "public"."cross_tenant_item_shares" FOR UPDATE USING ((("owner_tenant_id" IN ( SELECT "p"."tenant_id"
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'director'::"text"]))))) OR ("company_id" IN ( SELECT "cm"."company_id"
   FROM "public"."company_members" "cm"
  WHERE (("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = ANY (ARRAY['company_admin'::"public"."company_member_role", 'company_director'::"public"."company_member_role"])))))));



ALTER TABLE "public"."document_inbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_metadata_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proceed_validation_settings" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."after_profiles_insert_assign_requirements"() TO "anon";
GRANT ALL ON FUNCTION "public"."after_profiles_insert_assign_requirements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."after_profiles_insert_assign_requirements"() TO "service_role";



GRANT ALL ON FUNCTION "public"."after_profiles_insert_assign_tenant_requirements"() TO "anon";
GRANT ALL ON FUNCTION "public"."after_profiles_insert_assign_tenant_requirements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."after_profiles_insert_assign_tenant_requirements"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_item_costs"("p_tenant_id" "uuid", "p_item_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_item_costs"("p_tenant_id" "uuid", "p_item_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_item_costs"("p_tenant_id" "uuid", "p_item_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown"("p_tenant_id" "uuid", "p_call_depth" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown"("p_tenant_id" "uuid", "p_call_depth" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown"("p_tenant_id" "uuid", "p_call_depth" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown_old"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown_old"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown_old"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown_scoped"("p_tenant_id" "uuid", "p_call_depth" integer, "p_seed_item_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown_scoped"("p_tenant_id" "uuid", "p_call_depth" integer, "p_seed_item_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_item_costs_with_breakdown_scoped"("p_tenant_id" "uuid", "p_call_depth" integer, "p_seed_item_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_before_signup"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_before_signup"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."check_before_signup"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."create_proceed_validation_settings_for_new_auth_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_proceed_validation_settings_for_new_auth_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_proceed_validation_settings_for_new_auth_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_proceed_validation_settings_for_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_proceed_validation_settings_for_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_proceed_validation_settings_for_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."debug_calculate_item_costs"() TO "anon";
GRANT ALL ON FUNCTION "public"."debug_calculate_item_costs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."debug_calculate_item_costs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_price_events_update_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_price_events_update_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_price_events_update_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_manual_prices_atomic"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_operations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."record_manual_prices_atomic"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_operations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_manual_prices_atomic"("p_tenant_id" "uuid", "p_user_id" "uuid", "p_operations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_document_inbox_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_document_inbox_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_document_inbox_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at_cross_tenant_item_shares"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at_cross_tenant_item_shares"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at_cross_tenant_item_shares"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_virtual_vendor_current_price_from_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_virtual_vendor_current_price_from_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_virtual_vendor_current_price_from_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_proceed_validation_settings_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_proceed_validation_settings_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_proceed_validation_settings_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_recipe_lines_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_recipe_lines_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_recipe_lines_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_jurisdictions_company_match"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_jurisdictions_company_match"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_jurisdictions_company_match"() TO "service_role";



GRANT ALL ON TABLE "public"."allowlist" TO "anon";
GRANT ALL ON TABLE "public"."allowlist" TO "authenticated";
GRANT ALL ON TABLE "public"."allowlist" TO "service_role";



GRANT ALL ON TABLE "public"."base_items" TO "anon";
GRANT ALL ON TABLE "public"."base_items" TO "authenticated";
GRANT ALL ON TABLE "public"."base_items" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."company_document_metadata" TO "anon";
GRANT ALL ON TABLE "public"."company_document_metadata" TO "authenticated";
GRANT ALL ON TABLE "public"."company_document_metadata" TO "service_role";



GRANT ALL ON TABLE "public"."company_invitations" TO "anon";
GRANT ALL ON TABLE "public"."company_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."company_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."company_members" TO "anon";
GRANT ALL ON TABLE "public"."company_members" TO "authenticated";
GRANT ALL ON TABLE "public"."company_members" TO "service_role";



GRANT ALL ON TABLE "public"."company_requirement_real_data" TO "anon";
GRANT ALL ON TABLE "public"."company_requirement_real_data" TO "authenticated";
GRANT ALL ON TABLE "public"."company_requirement_real_data" TO "service_role";



GRANT ALL ON TABLE "public"."company_requirement_value_types" TO "anon";
GRANT ALL ON TABLE "public"."company_requirement_value_types" TO "authenticated";
GRANT ALL ON TABLE "public"."company_requirement_value_types" TO "service_role";



GRANT ALL ON TABLE "public"."company_requirements" TO "anon";
GRANT ALL ON TABLE "public"."company_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."company_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."company_tenants" TO "anon";
GRANT ALL ON TABLE "public"."company_tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."company_tenants" TO "service_role";



GRANT ALL ON TABLE "public"."cross_tenant_item_shares" TO "anon";
GRANT ALL ON TABLE "public"."cross_tenant_item_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."cross_tenant_item_shares" TO "service_role";



GRANT ALL ON TABLE "public"."document_inbox" TO "anon";
GRANT ALL ON TABLE "public"."document_inbox" TO "authenticated";
GRANT ALL ON TABLE "public"."document_inbox" TO "service_role";



GRANT ALL ON TABLE "public"."document_metadata" TO "anon";
GRANT ALL ON TABLE "public"."document_metadata" TO "authenticated";
GRANT ALL ON TABLE "public"."document_metadata" TO "service_role";



GRANT ALL ON TABLE "public"."document_metadata_invoices" TO "anon";
GRANT ALL ON TABLE "public"."document_metadata_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."document_metadata_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."document_metadata_user_requirements" TO "anon";
GRANT ALL ON TABLE "public"."document_metadata_user_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."document_metadata_user_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."history_logs" TO "anon";
GRANT ALL ON TABLE "public"."history_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."history_logs" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."items" TO "anon";
GRANT ALL ON TABLE "public"."items" TO "authenticated";
GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT ALL ON TABLE "public"."jurisdictions" TO "anon";
GRANT ALL ON TABLE "public"."jurisdictions" TO "authenticated";
GRANT ALL ON TABLE "public"."jurisdictions" TO "service_role";



GRANT ALL ON TABLE "public"."labor_roles" TO "anon";
GRANT ALL ON TABLE "public"."labor_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."labor_roles" TO "service_role";



GRANT ALL ON TABLE "public"."mapping_user_requirements" TO "anon";
GRANT ALL ON TABLE "public"."mapping_user_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."mapping_user_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."price_events" TO "anon";
GRANT ALL ON TABLE "public"."price_events" TO "authenticated";
GRANT ALL ON TABLE "public"."price_events" TO "service_role";



GRANT ALL ON TABLE "public"."proceed_validation_settings" TO "anon";
GRANT ALL ON TABLE "public"."proceed_validation_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."proceed_validation_settings" TO "service_role";



GRANT ALL ON TABLE "public"."product_mappings" TO "anon";
GRANT ALL ON TABLE "public"."product_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."product_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."recipe_lines" TO "anon";
GRANT ALL ON TABLE "public"."recipe_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_lines" TO "service_role";



GRANT ALL ON TABLE "public"."resource_shares" TO "anon";
GRANT ALL ON TABLE "public"."resource_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."resource_shares" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_requirement_real_data" TO "anon";
GRANT ALL ON TABLE "public"."tenant_requirement_real_data" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_requirement_real_data" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_requirement_value_types" TO "anon";
GRANT ALL ON TABLE "public"."tenant_requirement_value_types" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_requirement_value_types" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_requirements" TO "anon";
GRANT ALL ON TABLE "public"."tenant_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."unit_conversions" TO "anon";
GRANT ALL ON TABLE "public"."unit_conversions" TO "authenticated";
GRANT ALL ON TABLE "public"."unit_conversions" TO "service_role";



GRANT ALL ON TABLE "public"."user_jurisdictions" TO "anon";
GRANT ALL ON TABLE "public"."user_jurisdictions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_jurisdictions" TO "service_role";



GRANT ALL ON TABLE "public"."user_requirement_assignments" TO "anon";
GRANT ALL ON TABLE "public"."user_requirement_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."user_requirement_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."user_requirements" TO "anon";
GRANT ALL ON TABLE "public"."user_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT ALL ON TABLE "public"."virtual_vendor_products" TO "anon";
GRANT ALL ON TABLE "public"."virtual_vendor_products" TO "authenticated";
GRANT ALL ON TABLE "public"."virtual_vendor_products" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







