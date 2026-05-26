-- LCOG caution / over thresholds on wholesale and menu cost lists (% values, nullable)

ALTER TABLE public.wholesale_lists
  ADD COLUMN IF NOT EXISTS caution numeric,
  ADD COLUMN IF NOT EXISTS "over" numeric;

ALTER TABLE public.menu_cost_lists
  ADD COLUMN IF NOT EXISTS caution numeric,
  ADD COLUMN IF NOT EXISTS "over" numeric;

COMMENT ON COLUMN public.wholesale_lists.caution IS 'LCOG% yellow threshold (caution <= LCOG < over)';
COMMENT ON COLUMN public.wholesale_lists."over" IS 'LCOG% red threshold (over <= LCOG)';
COMMENT ON COLUMN public.menu_cost_lists.caution IS 'LCOG% yellow threshold (caution <= LCOG < over)';
COMMENT ON COLUMN public.menu_cost_lists."over" IS 'LCOG% red threshold (over <= LCOG)';
