-- Pricing ledger migration:
-- - virtual_vendor_products.purchase_cost -> current_price
-- - remove virtual_vendor_products.user_id
-- - add append-only price_events ledger
-- - sync current_price as cache from latest inserted event

BEGIN;

-- 1) Rename price column and related constraint
ALTER TABLE public.virtual_vendor_products
  RENAME COLUMN purchase_cost TO current_price;

ALTER TABLE public.virtual_vendor_products
  RENAME CONSTRAINT vendor_products_purchase_cost_check TO vendor_products_current_price_check;

-- 2) Create price_events ledger table
CREATE TABLE IF NOT EXISTS public.price_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  virtual_vendor_product_id uuid NOT NULL REFERENCES public.virtual_vendor_products(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price > 0::numeric),
  source_type text NOT NULL CHECK (source_type IN ('manual', 'invoice')),
  invoice_id uuid,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_events_tenant_id
  ON public.price_events USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS idx_price_events_virtual_vendor_product_id_created_at
  ON public.price_events USING btree (virtual_vendor_product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_events_source_type
  ON public.price_events USING btree (source_type);

CREATE INDEX IF NOT EXISTS idx_price_events_invoice_id
  ON public.price_events USING btree (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- 3) Backfill one baseline event from existing current values
INSERT INTO public.price_events (
  tenant_id,
  virtual_vendor_product_id,
  price,
  source_type,
  invoice_id,
  user_id,
  created_at
)
SELECT
  vvp.tenant_id,
  vvp.id,
  vvp.current_price,
  'manual',
  NULL,
  vvp.user_id,
  COALESCE(vvp.updated_at, vvp.created_at, now())
FROM public.virtual_vendor_products vvp
WHERE vvp.user_id IS NOT NULL
  AND vvp.current_price > 0::numeric;

-- 4) Make ledger append-only (no UPDATE/DELETE)
CREATE OR REPLACE FUNCTION public.prevent_price_events_update_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'price_events is append-only; UPDATE/DELETE is not allowed';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_price_events_update ON public.price_events;
CREATE TRIGGER trg_prevent_price_events_update
BEFORE UPDATE ON public.price_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_price_events_update_delete();

DROP TRIGGER IF EXISTS trg_prevent_price_events_delete ON public.price_events;
CREATE TRIGGER trg_prevent_price_events_delete
BEFORE DELETE ON public.price_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_price_events_update_delete();

-- 5) Keep current_price as cache from latest event
CREATE OR REPLACE FUNCTION public.sync_virtual_vendor_current_price_from_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.virtual_vendor_products
     SET current_price = NEW.price,
        updated_at = NEW.created_at
   WHERE id = NEW.virtual_vendor_product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_virtual_vendor_current_price ON public.price_events;
CREATE TRIGGER trg_sync_virtual_vendor_current_price
AFTER INSERT ON public.price_events
FOR EACH ROW
EXECUTE FUNCTION public.sync_virtual_vendor_current_price_from_event();

-- 6) Remove user_id from virtual_vendor_products
ALTER TABLE public.virtual_vendor_products
  DROP CONSTRAINT IF EXISTS vendor_products_user_id_fkey;

DROP INDEX IF EXISTS public.idx_vendor_products_user_id;

ALTER TABLE public.virtual_vendor_products
  DROP COLUMN IF EXISTS user_id;

COMMIT;
