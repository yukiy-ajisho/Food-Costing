CREATE TABLE IF NOT EXISTS public.recipe_summary_expand_targets (
  summary_id uuid NOT NULL REFERENCES public.recipe_summaries(id) ON DELETE CASCADE,
  target_item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (summary_id, target_item_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_summary_expand_targets_target_item_id
  ON public.recipe_summary_expand_targets (target_item_id);
