-- Invoicing: delivery_sites, invoice_lists, invoice_box_invoices (tenant-scoped)

-- =============================================================================
-- delivery_sites (Delivery Information)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.delivery_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  street text,
  city text,
  state_zip text,
  phone_1 text,
  phone_2 text,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_sites_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_delivery_sites_tenant_id
  ON public.delivery_sites (tenant_id);

-- =============================================================================
-- invoice_lists (Invoice Generation)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoice_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  delivery_site_id uuid NOT NULL REFERENCES public.delivery_sites(id) ON DELETE RESTRICT,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT invoice_lists_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lists_tenant_id
  ON public.invoice_lists (tenant_id);

CREATE INDEX IF NOT EXISTS idx_invoice_lists_delivery_site_id
  ON public.invoice_lists (delivery_site_id);

-- =============================================================================
-- invoice_box_invoices (Invoice Box)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoice_box_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_number text NOT NULL,
  list_id uuid REFERENCES public.invoice_lists(id) ON DELETE SET NULL,
  delivery_site_id uuid REFERENCES public.delivery_sites(id) ON DELETE SET NULL,
  delivery_site_name text NOT NULL,
  delivery_email text NOT NULL,
  order_received_date date,
  delivery_date date,
  invoice_date date,
  total_amount numeric NOT NULL,
  sent_at timestamptz,
  note text,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT invoice_box_invoices_tenant_number_unique UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoice_box_invoices_tenant_id
  ON public.invoice_box_invoices (tenant_id);

CREATE INDEX IF NOT EXISTS idx_invoice_box_invoices_list_id
  ON public.invoice_box_invoices (list_id);

CREATE INDEX IF NOT EXISTS idx_invoice_box_invoices_invoice_date
  ON public.invoice_box_invoices (tenant_id, invoice_date DESC);

-- =============================================================================
-- updated_at triggers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_invoicing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_sites_set_updated_at ON public.delivery_sites;
CREATE TRIGGER delivery_sites_set_updated_at
  BEFORE UPDATE ON public.delivery_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_invoicing_updated_at();

DROP TRIGGER IF EXISTS invoice_lists_set_updated_at ON public.invoice_lists;
CREATE TRIGGER invoice_lists_set_updated_at
  BEFORE UPDATE ON public.invoice_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_invoicing_updated_at();

-- =============================================================================
-- RLS (tenant members via profiles)
-- =============================================================================
ALTER TABLE public.delivery_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_box_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY delivery_sites_tenant_access ON public.delivery_sites
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE POLICY invoice_lists_tenant_access ON public.invoice_lists
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE POLICY invoice_box_invoices_tenant_access ON public.invoice_box_invoices
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

COMMENT ON TABLE public.delivery_sites IS 'Invoicing: delivery site master (tenant-scoped).';
COMMENT ON TABLE public.invoice_lists IS 'Invoicing: generation list preset with lines JSONB.';
COMMENT ON TABLE public.invoice_box_invoices IS 'Invoicing: saved invoice snapshot (Box). PDF not stored.';
