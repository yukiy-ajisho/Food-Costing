-- Standard Technical Sheet versions (append-only per base recipe)

CREATE TABLE IF NOT EXISTS public.standard_technical_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  is_latest boolean NOT NULL DEFAULT false,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT standard_technical_sheets_version_nonneg CHECK (version_number >= 0),
  CONSTRAINT standard_technical_sheets_unique_version UNIQUE (tenant_id, source_item_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_standard_technical_sheets_one_latest
  ON public.standard_technical_sheets (tenant_id, source_item_id)
  WHERE is_latest = true;

CREATE INDEX IF NOT EXISTS idx_standard_technical_sheets_tenant_id
  ON public.standard_technical_sheets (tenant_id);

CREATE INDEX IF NOT EXISTS idx_standard_technical_sheets_source_item_id
  ON public.standard_technical_sheets (source_item_id);

ALTER TABLE public.standard_technical_sheets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.standard_technical_sheets IS
  'Standard Technical Sheet version rows. snapshot JSONB holds sheet, recipe_snapshot, cost_inputs.';
