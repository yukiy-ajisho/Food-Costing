-- Invoicing: link templates to wholesale price lists; delivery preselect on items.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS delivery boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.items.delivery IS
  'When true, item appears when Delivery preselect filter is enabled in invoicing template creation.';

ALTER TABLE public.invoice_lists
  ADD COLUMN IF NOT EXISTS wholesale_list_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_lists_wholesale_list_id_fkey'
      AND conrelid = 'public.invoice_lists'::regclass
  ) THEN
    ALTER TABLE public.invoice_lists
      ADD CONSTRAINT invoice_lists_wholesale_list_id_fkey
      FOREIGN KEY (wholesale_list_id) REFERENCES public.wholesale_lists(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_lists_wholesale_list_id
  ON public.invoice_lists (wholesale_list_id);

COMMENT ON COLUMN public.invoice_lists.wholesale_list_id IS
  'Wholesale price list used for invoice line pricing (latest wholesale_price per member).';
