-- =============================================================================
-- Phase 2: breakdown required-item scoped recursion
--   - Avoid owner-tenant wide recursion: compute only dependencies reachable
--     from the provided seed items (p_seed_item_ids).
--   - Seed the recursive calls using temp_ct_foreign_needed.child_item_id only.
--   - Keep temp-table rename collision avoidance using per-call-depth pause names.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_item_costs_with_breakdown_scoped(
  p_tenant_id uuid,
  p_call_depth integer,
  p_seed_item_ids uuid[]
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
$$;

-- -----------------------------------------------------------------------------
-- Wrapper: keep RPC signature stable (p_tenant_id only).
-- -----------------------------------------------------------------------------
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

ALTER FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.calculate_item_costs_with_breakdown_scoped(uuid, integer, uuid[]) OWNER TO postgres;

COMMENT ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) IS
  'Phase2: required-item scoped cross-tenant breakdown recursion. (RPC wrapper)';

COMMENT ON FUNCTION public.calculate_item_costs_with_breakdown_scoped(uuid, integer, uuid[]) IS
  'Phase2: compute costs only for items reachable from provided seed items (local closure), and recurse using foreign needed seeds only.';

GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) TO anon;
GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown(uuid, integer) TO service_role;

GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown_scoped(uuid, integer, uuid[]) TO anon;
GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown_scoped(uuid, integer, uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_item_costs_with_breakdown_scoped(uuid, integer, uuid[]) TO service_role;

