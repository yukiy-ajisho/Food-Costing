CREATE TABLE IF NOT EXISTS public.recipe_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  summary_name text NOT NULL,
  source_item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipe_summaries_tenant_id
  ON public.recipe_summaries (tenant_id);

CREATE INDEX IF NOT EXISTS idx_recipe_summaries_source_item_id
  ON public.recipe_summaries (source_item_id);
