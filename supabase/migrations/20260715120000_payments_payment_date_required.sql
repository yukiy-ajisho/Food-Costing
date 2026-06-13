-- payments.payment_date is required (calendar date), same model as orders.order_created_date.
-- One-time backfill for legacy NULL rows only; ongoing logic uses payment_date, not created_at.

UPDATE public.payments p
SET payment_date = (p.created_at AT TIME ZONE COALESCE(c.timezone, 'America/Los_Angeles'))::date
FROM public.companies c
WHERE p.company_id = c.id
  AND p.payment_date IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN payment_date SET NOT NULL;

COMMENT ON COLUMN public.payments.payment_date IS
  'Date money was received (calendar date). Required; drives ledger period and edit locks.';
