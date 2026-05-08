ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS procedure text;
