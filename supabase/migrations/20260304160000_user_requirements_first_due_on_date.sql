-- first_due_on_date: 初回期限を特定の日付で指定する場合の日付（First due date on）
-- first_due_date は「入社から何日後」の日数。どちらか一方のみ使用。
ALTER TABLE public.user_requirements
  ADD COLUMN IF NOT EXISTS first_due_on_date date NULL;

COMMENT ON COLUMN public.user_requirements.first_due_on_date IS '初回期限を特定の日付で指定する場合の日付。First due date on のとき使用。first_due_date と排他。';
