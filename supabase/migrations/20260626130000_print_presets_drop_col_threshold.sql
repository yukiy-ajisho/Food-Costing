-- Print presets: remove unused caution/over column flag

ALTER TABLE public.recipe_cost_report_print_presets
  DROP COLUMN IF EXISTS col_threshold;
