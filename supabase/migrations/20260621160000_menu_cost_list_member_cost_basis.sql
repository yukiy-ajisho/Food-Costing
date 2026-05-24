-- Per-row cost calculation mode for retail (menu cost) list members.

ALTER TABLE public.menu_cost_list_members
  ADD COLUMN IF NOT EXISTS cost_basis text NOT NULL DEFAULT 'corporate';

ALTER TABLE public.menu_cost_list_members
  DROP CONSTRAINT IF EXISTS menu_cost_list_members_cost_basis_check;

ALTER TABLE public.menu_cost_list_members
  ADD CONSTRAINT menu_cost_list_members_cost_basis_check
  CHECK (cost_basis = ANY (ARRAY['corporate'::text, 'wholesale'::text]));

COMMENT ON COLUMN public.menu_cost_list_members.cost_basis IS
  'corporate = scoped breakdown (Costing); wholesale = franchise WL override RPC when linked WL has price.';
