-- Print column presets for recipe cost report (tenant × wholesale/retail × up to 4 slots)

CREATE TABLE IF NOT EXISTS public.recipe_cost_report_print_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('wholesale', 'retail')),
  preset_slot smallint NOT NULL CHECK (preset_slot BETWEEN 1 AND 4),
  name text NOT NULL,
  col_item boolean NOT NULL DEFAULT false,
  col_type boolean NOT NULL DEFAULT false,
  col_cost boolean NOT NULL DEFAULT false,
  col_price boolean NOT NULL DEFAULT false,
  col_lcog boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, report_type, preset_slot)
);

CREATE INDEX IF NOT EXISTS recipe_cost_report_print_presets_tenant_idx
  ON public.recipe_cost_report_print_presets (tenant_id);

ALTER TABLE public.recipe_cost_report_print_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY recipe_cost_report_print_presets_tenant_access
  ON public.recipe_cost_report_print_presets
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

COMMENT ON TABLE public.recipe_cost_report_print_presets IS
  'Tenant-scoped print column presets for Wholesale Costing (wholesale) and Pricing Strategy (retail)';
