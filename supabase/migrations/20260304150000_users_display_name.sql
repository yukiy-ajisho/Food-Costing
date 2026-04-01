-- reminder-members を高速化するため、表示名を users に持たせる（Auth の N 回呼び出しをやめる）
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN public.users.display_name IS '表示名。Auth の user_metadata から同期。reminder-members で使用';
