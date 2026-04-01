-- Replace legacy purchase_cost references after virtual_vendor_products rename.
-- Updates currently used RPC functions:
--   - public.calculate_item_costs(uuid, uuid[])
--   - public.calculate_item_costs_with_breakdown_scoped(uuid, integer, uuid[])
-- Also normalizes wrapper path by recreating:
--   - public.calculate_item_costs_with_breakdown(uuid, integer)

BEGIN;

DO $$
DECLARE
  fn_def text;
BEGIN
  -- 1) calculate_item_costs
  SELECT pg_get_functiondef('public.calculate_item_costs(uuid, uuid[])'::regprocedure)
    INTO fn_def;
  fn_def := replace(fn_def, 'purchase_cost', 'current_price');
  EXECUTE fn_def;

  -- 2) calculate_item_costs_with_breakdown_scoped
  SELECT pg_get_functiondef('public.calculate_item_costs_with_breakdown_scoped(uuid, integer, uuid[])'::regprocedure)
    INTO fn_def;
  fn_def := replace(fn_def, 'purchase_cost', 'current_price');
  EXECUTE fn_def;

  -- 3) Wrapper (currently called by GET /items/costs/breakdown)
  --    Keep existing logic but re-create so deployment has consistent latest definitions.
  SELECT pg_get_functiondef('public.calculate_item_costs_with_breakdown(uuid, integer)'::regprocedure)
    INTO fn_def;
  fn_def := replace(fn_def, 'purchase_cost', 'current_price');
  EXECUTE fn_def;
END
$$;

COMMIT;
