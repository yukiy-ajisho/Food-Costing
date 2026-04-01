-- validity_period の単位を指定。years / months / days。NULL は従来どおり年数扱い。
ALTER TABLE public.user_requirements
  ADD COLUMN IF NOT EXISTS validity_period_unit text NULL;

COMMENT ON COLUMN public.user_requirements.validity_period_unit IS '有効期間の単位: years, months, days。NULL は年数として扱う（後方互換）';
