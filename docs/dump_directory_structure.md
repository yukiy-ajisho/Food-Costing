# DB ダンプの保管ルール（案）

スキーマとデータは別ファイルで保管する。

## ディレクトリ構成

```
supabase/
  dump/
    20260304_before_user_requirements/
      schema.sql
      data.sql
    20260315_after_reminder_ui/
      schema.sql
      data.sql
    20260401_pre_production_backup/
      schema.sql
      data.sql
```

## 命名ルール

- **フォルダ名**: `YYYYMMDD_コメント`  
  - 日付（8桁） + アンダースコア + その時点の状態が分かる短いコメント（英数字・アンダースコア推奨）
- **ファイル**: 固定で `schema.sql` / `data.sql`

## 実行コマンド例（参考・実行は手動で）

```bash
# 例: 20260304 の「user_requirements 適用前」のダンプを取る場合
DUMP_DIR="supabase/dump/20260304_before_user_requirements"
mkdir -p "$DUMP_DIR"
supabase db dump --linked -f "$DUMP_DIR/schema.sql"
supabase db dump --linked -f "$DUMP_DIR/data.sql" --data-only --use-copy
```

## .gitignore

`supabase/dump/` をそのままコミットするか、サイズや機密性を考慮して除外するかはプロジェクト方針による。  
除外する場合の例:

```
supabase/dump/
```
