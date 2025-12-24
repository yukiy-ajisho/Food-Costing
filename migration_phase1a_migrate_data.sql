-- =========================================================
-- Migration: Phase 1a - Migrate Existing Data to Tenant Model
-- =========================================================
-- This migration:
-- 1. Creates a tenant for each existing user
-- 2. Creates a profile entry for each user (linking to tenant with 'admin' role)
-- 3. Sets tenant_id for all existing data based on user_id
-- 4. Makes tenant_id NOT NULL after data migration
--
-- PREREQUISITE: migration_phase1a_create_tenants_and_profiles.sql must be run first
-- =========================================================

BEGIN;

-- =========================================================
-- 1) 既存ユーザーごとにtenantを作成
-- =========================================================
INSERT INTO tenants (id, name, type, created_at)
SELECT 
  gen_random_uuid(),
  'Restaurant ' || u.id::text,
  'restaurant',
  COALESCE(u.created_at, now())
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM tenants t 
  WHERE t.name = 'Restaurant ' || u.id::text
);

-- =========================================================
-- 2) 各ユーザーに対してprofileを作成（adminロール）
-- =========================================================
-- 新しい構造: idは自動生成、user_idとtenant_idを指定
INSERT INTO profiles (user_id, tenant_id, role, created_at)
SELECT 
  u.id,
  t.id,
  'admin',
  COALESCE(u.created_at, now())
FROM users u
INNER JOIN tenants t ON t.name = 'Restaurant ' || u.id::text
WHERE NOT EXISTS (
  SELECT 1 FROM profiles p WHERE p.user_id = u.id AND p.tenant_id = t.id
);

-- =========================================================
-- 3) 既存データにtenant_idを設定
-- =========================================================

-- base_items
UPDATE base_items bi
SET tenant_id = p.tenant_id
FROM profiles p
WHERE bi.user_id = p.user_id
  AND bi.tenant_id IS NULL;

-- items
UPDATE items i
SET tenant_id = p.tenant_id
FROM profiles p
WHERE i.user_id = p.user_id
  AND i.tenant_id IS NULL;

-- recipe_lines
UPDATE recipe_lines rl
SET tenant_id = p.tenant_id
FROM profiles p
WHERE rl.user_id = p.user_id
  AND rl.tenant_id IS NULL;

-- labor_roles
UPDATE labor_roles lr
SET tenant_id = p.tenant_id
FROM profiles p
WHERE lr.user_id = p.user_id
  AND lr.tenant_id IS NULL;

-- vendors
UPDATE vendors v
SET tenant_id = p.tenant_id
FROM profiles p
WHERE v.user_id = p.user_id
  AND v.tenant_id IS NULL;

-- vendor_products
UPDATE vendor_products vp
SET tenant_id = p.tenant_id
FROM profiles p
WHERE vp.user_id = p.user_id
  AND vp.tenant_id IS NULL;

-- item_unit_profiles (存在する場合)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'item_unit_profiles') THEN
    UPDATE item_unit_profiles iup
    SET tenant_id = p.tenant_id
    FROM profiles p
    WHERE iup.user_id = p.user_id
      AND iup.tenant_id IS NULL;
  END IF;
END $$;

-- non_mass_units (存在する場合)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'non_mass_units') THEN
    UPDATE non_mass_units nmu
    SET tenant_id = p.tenant_id
    FROM profiles p
    WHERE nmu.user_id = p.user_id
      AND nmu.tenant_id IS NULL;
  END IF;
END $$;

-- =========================================================
-- 4) バリデーション: すべての行にtenant_idが設定されているか確認
-- =========================================================
DO $$
DECLARE
  missing_count integer;
BEGIN
  -- base_items
  SELECT COUNT(*) INTO missing_count
  FROM base_items
  WHERE tenant_id IS NULL;
  
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Found % base_items rows with NULL tenant_id', missing_count;
  END IF;

  -- items
  SELECT COUNT(*) INTO missing_count
  FROM items
  WHERE tenant_id IS NULL;
  
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Found % items rows with NULL tenant_id', missing_count;
  END IF;

  -- recipe_lines
  SELECT COUNT(*) INTO missing_count
  FROM recipe_lines
  WHERE tenant_id IS NULL;
  
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Found % recipe_lines rows with NULL tenant_id', missing_count;
  END IF;

  -- labor_roles
  SELECT COUNT(*) INTO missing_count
  FROM labor_roles
  WHERE tenant_id IS NULL;
  
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Found % labor_roles rows with NULL tenant_id', missing_count;
  END IF;

  -- vendors
  SELECT COUNT(*) INTO missing_count
  FROM vendors
  WHERE tenant_id IS NULL;
  
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Found % vendors rows with NULL tenant_id', missing_count;
  END IF;

  -- vendor_products
  SELECT COUNT(*) INTO missing_count
  FROM vendor_products
  WHERE tenant_id IS NULL;
  
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Found % vendor_products rows with NULL tenant_id', missing_count;
  END IF;

  -- item_unit_profiles (存在する場合のみ)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'item_unit_profiles') THEN
    SELECT COUNT(*) INTO missing_count
    FROM item_unit_profiles
    WHERE tenant_id IS NULL;
    
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'Found % item_unit_profiles rows with NULL tenant_id', missing_count;
    END IF;
  END IF;

  RAISE NOTICE 'All tenant_id values have been set successfully';
END $$;

-- =========================================================
-- 5) tenant_idをNOT NULLに変更
-- =========================================================
ALTER TABLE base_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE recipe_lines ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE labor_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vendors ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vendor_products ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'item_unit_profiles') THEN
    ALTER TABLE item_unit_profiles ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'non_mass_units') THEN
    ALTER TABLE non_mass_units ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- =========================================================
-- 完了
-- =========================================================
-- 次のステップ: バックエンドコードの更新

COMMIT;


