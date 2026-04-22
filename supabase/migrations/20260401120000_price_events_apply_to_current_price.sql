-- Optional: skip updating virtual_vendor_products when appending invoice/history rows (Confirm step "B").

BEGIN;

ALTER TABLE public.price_events
  ADD COLUMN IF NOT EXISTS apply_to_current_price boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.price_events.apply_to_current_price IS
  'When true (default), AFTER INSERT trigger syncs VVP current_price/updated_at from this row. When false, ledger row only.';

CREATE OR REPLACE FUNCTION public.sync_virtual_vendor_current_price_from_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.apply_to_current_price, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  UPDATE public.virtual_vendor_products
     SET current_price = NEW.price,
        updated_at = NEW.created_at
   WHERE id = NEW.virtual_vendor_product_id;
  RETURN NEW;
END;
$$;

COMMIT;
