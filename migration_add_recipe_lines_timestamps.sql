-- =========================================================
-- Migration: Add created_at and updated_at to recipe_lines table
-- =========================================================

-- recipe_linesテーブルにcreated_atとupdated_atカラムを追加
ALTER TABLE recipe_lines
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 既存のレコードにデフォルト値を設定
UPDATE recipe_lines
SET created_at = now(),
    updated_at = now()
WHERE created_at IS NULL OR updated_at IS NULL;

-- updated_atを自動更新するトリガーを作成（オプション）
CREATE OR REPLACE FUNCTION update_recipe_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーを作成（既に存在する場合は置き換え）
DROP TRIGGER IF EXISTS trigger_update_recipe_lines_updated_at ON recipe_lines;
CREATE TRIGGER trigger_update_recipe_lines_updated_at
  BEFORE UPDATE ON recipe_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_lines_updated_at();

-- =========================================================
-- 完了
-- =========================================================

