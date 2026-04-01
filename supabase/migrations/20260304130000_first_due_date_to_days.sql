-- first_due_date を「特定の日付」から「雇われてから何日以内に取得が必要か」の日数(integer)に変更
-- user_requirements は定義なので、初回期限は「入社日から何日以内」で持つ

ALTER TABLE public.user_requirements
  ADD COLUMN IF NOT EXISTS first_due_days integer NULL;

-- 既存の first_due_date (date) は移行しない（意味が異なるため）
UPDATE public.user_requirements SET first_due_days = NULL WHERE true;

ALTER TABLE public.user_requirements DROP COLUMN IF EXISTS first_due_date;

ALTER TABLE public.user_requirements RENAME COLUMN first_due_days TO first_due_date;

COMMENT ON COLUMN public.user_requirements.first_due_date IS '雇われてから何日以内に取得が必要か（整数）。例: I-9 は 3';
