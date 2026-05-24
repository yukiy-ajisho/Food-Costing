-- Backfill labor into existing standard_technical_sheets.snapshot JSONB (e.g. v0 rows
-- created before labor was stored). Uses current recipe_lines + labor_roles wages.

CREATE OR REPLACE FUNCTION public.backfill_labor_into_standard_snapshot(
  p_snapshot jsonb,
  p_source_item_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_snapshot jsonb;
  v_labor_rows jsonb := '[]'::jsonb;
  v_recipe_labor_lines jsonb := '[]'::jsonb;
  v_by_labor_role jsonb := '{}'::jsonb;
  v_ingredient_only jsonb := '[]'::jsonb;
  v_total_labor numeric := 0;
  v_has_unpriced boolean := false;
  v_row record;
  v_cost numeric;
  v_existing_recipe jsonb;
BEGIN
  v_snapshot := p_snapshot;

  IF jsonb_typeof(COALESCE(v_snapshot #> '{sheet,labor_rows}', 'null'::jsonb)) = 'array'
     AND jsonb_array_length(v_snapshot #> '{sheet,labor_rows}') > 0
  THEN
    RETURN v_snapshot;
  END IF;

  FOR v_row IN
    SELECT
      rl.id,
      btrim(rl.labor_role) AS labor_role,
      rl.minutes::numeric AS minutes,
      lr.hourly_wage
    FROM public.recipe_lines rl
    LEFT JOIN public.labor_roles lr
      ON lr.tenant_id = p_tenant_id
     AND lr.name = btrim(rl.labor_role)
    WHERE rl.parent_item_id = p_source_item_id
      AND rl.line_type = 'labor'
      AND rl.labor_role IS NOT NULL
      AND btrim(rl.labor_role) <> ''
      AND rl.minutes IS NOT NULL
      AND rl.minutes > 0
    ORDER BY btrim(rl.labor_role), rl.id
  LOOP
    v_cost := NULL;
    IF v_row.hourly_wage IS NOT NULL AND v_row.hourly_wage > 0 THEN
      v_cost := (v_row.hourly_wage / 60.0) * v_row.minutes;
      v_total_labor := v_total_labor + v_cost;
    ELSE
      v_has_unpriced := true;
    END IF;

    v_labor_rows := v_labor_rows || jsonb_build_array(
      jsonb_build_object(
        'row_key', v_row.id::text,
        'labor_role', v_row.labor_role,
        'minutes', v_row.minutes,
        'hourly_wage', v_row.hourly_wage,
        'cost', v_cost
      )
    );

    IF v_row.hourly_wage IS NOT NULL THEN
      v_by_labor_role := v_by_labor_role || jsonb_build_object(
        v_row.labor_role,
        jsonb_build_object('hourly_wage', v_row.hourly_wage)
      );
    END IF;

    v_recipe_labor_lines := v_recipe_labor_lines || jsonb_build_array(
      jsonb_build_object(
        'line_type', 'labor',
        'row_key', v_row.id::text,
        'labor_role', v_row.labor_role,
        'minutes', v_row.minutes
      )
    );
  END LOOP;

  v_snapshot := jsonb_set(v_snapshot, '{sheet,labor_rows}', v_labor_rows, true);

  v_snapshot := jsonb_set(
    v_snapshot,
    '{sheet,total_labor_cost}',
    CASE
      WHEN v_has_unpriced AND v_total_labor = 0 THEN 'null'::jsonb
      ELSE to_jsonb(round(v_total_labor::numeric, 2))
    END,
    true
  );

  IF v_snapshot #> '{cost_inputs}' IS NULL THEN
    v_snapshot := jsonb_set(
      v_snapshot,
      '{cost_inputs}',
      jsonb_build_object('captured_at', to_jsonb(now())),
      true
    );
  END IF;

  v_snapshot := jsonb_set(
    v_snapshot,
    '{cost_inputs,by_labor_role}',
    COALESCE(v_snapshot #> '{cost_inputs,by_labor_role}', '{}'::jsonb) || v_by_labor_role,
    true
  );

  v_existing_recipe := COALESCE(v_snapshot #> '{recipe_snapshot,lines}', '[]'::jsonb);

  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  INTO v_ingredient_only
  FROM jsonb_array_elements(v_existing_recipe) WITH ORDINALITY AS t(elem, ord)
  WHERE COALESCE(elem ->> 'line_type', 'ingredient') <> 'labor';

  v_snapshot := jsonb_set(
    v_snapshot,
    '{recipe_snapshot,lines}',
    v_ingredient_only || v_recipe_labor_lines,
    true
  );

  RETURN v_snapshot;
END;
$$;

COMMENT ON FUNCTION public.backfill_labor_into_standard_snapshot IS
  'One-time helper: merge labor_rows, total_labor_cost, cost_inputs.by_labor_role, and recipe_snapshot labor lines from live recipe_lines. Idempotent if labor_rows already non-empty.';

UPDATE public.standard_technical_sheets sts
SET snapshot = public.backfill_labor_into_standard_snapshot(
  sts.snapshot,
  sts.source_item_id,
  sts.tenant_id
)
WHERE sts.snapshot IS NOT NULL
  AND (
    jsonb_typeof(sts.snapshot #> '{sheet,labor_rows}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(COALESCE(sts.snapshot #> '{sheet,labor_rows}', '[]'::jsonb)) = 0
  );

-- Optional: keep function for manual re-run; or drop after deploy:
-- DROP FUNCTION public.backfill_labor_into_standard_snapshot(jsonb, uuid, uuid);
