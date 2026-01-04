-- =========================================================
-- Migration: Create resource_shares records for existing Prepped Items
-- =========================================================
-- This migration creates resource_shares records for existing Prepped Items
-- where responsible_user_id is set, to maintain consistency with the new
-- sharing control feature.
--
-- For each Prepped Item with responsible_user_id:
-- - Creates a resource_shares record with target_type: "role", target_id: "manager"
-- - Sets allowed_actions to [] (hide state)
-- - Only creates if no resource_shares record already exists for that item
-- =========================================================

BEGIN;

-- =========================================================
-- 既存のPrepped Itemsに対してresource_sharesレコードを作成
-- =========================================================
-- item_kind = 'prepped' かつ responsible_user_id が設定されているアイテムに対して
-- resource_sharesレコードが存在しない場合のみ作成
INSERT INTO resource_shares (
  resource_type,
  resource_id,
  owner_tenant_id,
  target_type,
  target_id,
  allowed_actions,
  is_exclusion,
  show_history_to_shared
)
SELECT
  'item'::text AS resource_type,
  i.id AS resource_id,
  i.tenant_id AS owner_tenant_id,
  'role'::text AS target_type,
  'manager'::text AS target_id,
  ARRAY[]::text[] AS allowed_actions, -- hide状態 = allowed_actionsが空
  false AS is_exclusion,
  false AS show_history_to_shared
FROM items i
WHERE i.item_kind = 'prepped'
  AND i.responsible_user_id IS NOT NULL
  AND NOT EXISTS (
    -- 既にresource_sharesレコードが存在する場合は作成しない
    SELECT 1
    FROM resource_shares rs
    WHERE rs.resource_type = 'item'
      AND rs.resource_id = i.id
      AND rs.target_type = 'role'
      AND rs.target_id = 'manager'
  );

-- 作成されたレコード数を確認（ログ出力用）
DO $$
DECLARE
  created_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO created_count
  FROM resource_shares rs
  INNER JOIN items i ON rs.resource_id = i.id
  WHERE i.item_kind = 'prepped'
    AND i.responsible_user_id IS NOT NULL
    AND rs.resource_type = 'item'
    AND rs.target_type = 'role'
    AND rs.target_id = 'manager'
    AND rs.allowed_actions = ARRAY[]::text[];
  
  RAISE NOTICE 'Created % resource_shares records for existing Prepped Items', created_count;
END $$;

COMMIT;

