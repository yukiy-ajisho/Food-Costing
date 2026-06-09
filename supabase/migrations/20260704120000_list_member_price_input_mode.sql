-- Persist per-row pricing input mode (price vs LCOG%) on list membership.

ALTER TABLE public.wholesale_list_members
  ADD COLUMN IF NOT EXISTS price_input_mode text NOT NULL DEFAULT 'price';

ALTER TABLE public.menu_cost_list_members
  ADD COLUMN IF NOT EXISTS price_input_mode text NOT NULL DEFAULT 'price';

ALTER TABLE public.wholesale_list_members
  DROP CONSTRAINT IF EXISTS wholesale_list_members_price_input_mode_check;

ALTER TABLE public.wholesale_list_members
  ADD CONSTRAINT wholesale_list_members_price_input_mode_check
  CHECK (price_input_mode = ANY (ARRAY['price'::text, 'lcog'::text]));

ALTER TABLE public.menu_cost_list_members
  DROP CONSTRAINT IF EXISTS menu_cost_list_members_price_input_mode_check;

ALTER TABLE public.menu_cost_list_members
  ADD CONSTRAINT menu_cost_list_members_price_input_mode_check
  CHECK (price_input_mode = ANY (ARRAY['price'::text, 'lcog'::text]));

COMMENT ON COLUMN public.wholesale_list_members.price_input_mode IS
  'Wholesale Costing UI: price = enter wholesale (default); lcog = enter LCOG% and derive wholesale for display.';

COMMENT ON COLUMN public.menu_cost_list_members.price_input_mode IS
  'Pricing Strategy UI: price = enter retail (default); lcog = enter LCOG% and derive retail for display.';
