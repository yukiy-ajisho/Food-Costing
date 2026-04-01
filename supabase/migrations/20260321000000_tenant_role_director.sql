-- テナントメンバー role に director を追加（Cedar では admin 相当）。
-- 招待テーブルでも director を許可（admin は引き続き招待不可・テナント作成時のみ）。

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'staff'::text, 'director'::text]));

ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_role_check
  CHECK (role = ANY (ARRAY['manager'::text, 'staff'::text, 'director'::text]));
