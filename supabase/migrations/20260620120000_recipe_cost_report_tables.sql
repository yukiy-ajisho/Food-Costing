-- Recipe Cost Report: Wholesale List + Menu Cost List (tenant-scoped)

-- =============================================================================
-- wholesale_lists
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wholesale_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wholesale_lists_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_wholesale_lists_tenant_id
  ON public.wholesale_lists (tenant_id);

-- =============================================================================
-- wholesale_list_members
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wholesale_list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wholesale_list_id uuid NOT NULL REFERENCES public.wholesale_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wholesale_list_members_list_item_unique UNIQUE (wholesale_list_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_wholesale_list_members_list_id
  ON public.wholesale_list_members (wholesale_list_id);

CREATE INDEX IF NOT EXISTS idx_wholesale_list_members_item_id
  ON public.wholesale_list_members (item_id);

-- =============================================================================
-- wholesale_list_lines (wholesale price ledger — INSERT only)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wholesale_list_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wholesale_list_id uuid NOT NULL REFERENCES public.wholesale_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  wholesale_price numeric,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wholesale_list_lines_list_item_created
  ON public.wholesale_list_lines (wholesale_list_id, item_id, created_at DESC);

-- =============================================================================
-- menu_cost_lists
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.menu_cost_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL,
  wholesale_list_id uuid REFERENCES public.wholesale_lists(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_cost_lists_tenant_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT menu_cost_lists_mode_check
    CHECK (mode = ANY (ARRAY['company_owned'::text, 'franchise'::text])),
  CONSTRAINT menu_cost_lists_franchise_wl_check
    CHECK (
      (mode = 'company_owned' AND wholesale_list_id IS NULL)
      OR (mode = 'franchise' AND wholesale_list_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_menu_cost_lists_tenant_id
  ON public.menu_cost_lists (tenant_id);

CREATE INDEX IF NOT EXISTS idx_menu_cost_lists_wholesale_list_id
  ON public.menu_cost_lists (wholesale_list_id);

-- =============================================================================
-- menu_cost_list_members
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.menu_cost_list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_cost_list_id uuid NOT NULL REFERENCES public.menu_cost_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_cost_list_members_list_item_unique UNIQUE (menu_cost_list_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_cost_list_members_list_id
  ON public.menu_cost_list_members (menu_cost_list_id);

-- =============================================================================
-- menu_cost_list_lines (retail price ledger — INSERT only)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.menu_cost_list_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_cost_list_id uuid NOT NULL REFERENCES public.menu_cost_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  retail_price numeric,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_cost_list_lines_list_item_created
  ON public.menu_cost_list_lines (menu_cost_list_id, item_id, created_at DESC);

-- =============================================================================
-- RLS (tenant members via profiles)
-- =============================================================================
ALTER TABLE public.wholesale_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_list_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_cost_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_cost_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_cost_list_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY wholesale_lists_tenant_access ON public.wholesale_lists
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE POLICY wholesale_list_members_tenant_access ON public.wholesale_list_members
  FOR ALL
  USING (
    wholesale_list_id IN (
      SELECT wl.id FROM public.wholesale_lists wl
      JOIN public.profiles p ON p.tenant_id = wl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    wholesale_list_id IN (
      SELECT wl.id FROM public.wholesale_lists wl
      JOIN public.profiles p ON p.tenant_id = wl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY wholesale_list_lines_tenant_access ON public.wholesale_list_lines
  FOR ALL
  USING (
    wholesale_list_id IN (
      SELECT wl.id FROM public.wholesale_lists wl
      JOIN public.profiles p ON p.tenant_id = wl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    wholesale_list_id IN (
      SELECT wl.id FROM public.wholesale_lists wl
      JOIN public.profiles p ON p.tenant_id = wl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY menu_cost_lists_tenant_access ON public.menu_cost_lists
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE POLICY menu_cost_list_members_tenant_access ON public.menu_cost_list_members
  FOR ALL
  USING (
    menu_cost_list_id IN (
      SELECT mcl.id FROM public.menu_cost_lists mcl
      JOIN public.profiles p ON p.tenant_id = mcl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    menu_cost_list_id IN (
      SELECT mcl.id FROM public.menu_cost_lists mcl
      JOIN public.profiles p ON p.tenant_id = mcl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY menu_cost_list_lines_tenant_access ON public.menu_cost_list_lines
  FOR ALL
  USING (
    menu_cost_list_id IN (
      SELECT mcl.id FROM public.menu_cost_lists mcl
      JOIN public.profiles p ON p.tenant_id = mcl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    menu_cost_list_id IN (
      SELECT mcl.id FROM public.menu_cost_lists mcl
      JOIN public.profiles p ON p.tenant_id = mcl.tenant_id
      WHERE p.user_id = auth.uid()
    )
  );

-- Realtime: MCL listens for wholesale price ledger inserts
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wholesale_list_lines;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.wholesale_lists IS 'Recipe Cost Report: wholesale list header per tenant.';
COMMENT ON TABLE public.wholesale_list_lines IS 'Wholesale price ledger (INSERT only). Current = latest created_at per (list, item).';
COMMENT ON TABLE public.menu_cost_lists IS 'Recipe Cost Report: menu cost list (company_owned or franchise + WL ref).';
COMMENT ON TABLE public.menu_cost_list_lines IS 'Retail price ledger (INSERT only). Current = latest created_at per (list, item).';
