-- Adjustment direction: decrease (default) lowers balance; increase raises balance.
-- NULL for type = payment.

ALTER TABLE public.payments
  ADD COLUMN adjustment_direction text;

UPDATE public.payments
SET adjustment_direction = 'decrease'
WHERE type = 'adjustment'
  AND adjustment_direction IS NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_adjustment_direction_check
  CHECK (
    (type = 'payment' AND adjustment_direction IS NULL)
    OR (
      type = 'adjustment'
      AND adjustment_direction IN ('decrease', 'increase')
    )
  );

COMMENT ON COLUMN public.payments.adjustment_direction IS
  'For type=adjustment only: decrease lowers AR; increase raises AR. NULL for payment.';
