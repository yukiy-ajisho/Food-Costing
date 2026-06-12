-- orders.first_invoice_sent_at: timestamptz → date (Sent Date, calendar day only).

ALTER TABLE public.orders
  ALTER COLUMN first_invoice_sent_at TYPE date
  USING (
    CASE
      WHEN first_invoice_sent_at IS NULL THEN NULL
      ELSE (first_invoice_sent_at AT TIME ZONE 'UTC')::date
    END
  );

COMMENT ON COLUMN public.orders.first_invoice_sent_at IS
  'First invoice send date (calendar date). NULL when not yet sent.';
