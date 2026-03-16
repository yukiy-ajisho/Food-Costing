-- validity_period を「日数」から「年数」として扱う（rolling_expiry の計算をアニバーサリーにするため）
-- コメントのみ更新。既存データが日数で入っている場合は手動で年数に変換すること。
COMMENT ON COLUMN public.user_requirements.validity_period IS '有効期間（年数）。例: 3 = 3年。rolling_expiry のとき発行日からこの年数後が期限';
