-- =========================================================
-- data_type に 'text' を追加（Document 用 value = R2 パス文字列）
-- ※ ADD VALUE した enum は同一トランザクションでは使えないため、
--    value_type 追加と document_metadata 作成は次マイグレーションで実行
-- =========================================================
ALTER TYPE public.tenant_requirement_data_type ADD VALUE IF NOT EXISTS 'text';
