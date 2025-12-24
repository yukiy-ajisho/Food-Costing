-- =========================================================
-- Migration: Phase 1a - Update handle_new_user() Function
-- =========================================================
-- This migration updates the handle_new_user() function to:
-- 1. Create a tenant for each new user (matching existing migration pattern)
-- 2. Create a profile entry for each new user (linking to tenant with 'admin' role)
-- 3. Create proceed_validation_settings (user preference, no tenant_id)
--
-- PREREQUISITE: 
-- - migration_phase1a_create_tenants_and_profiles.sql must be run first
-- - migration_phase1a_migrate_data.sql must be run first (for existing users)
-- =========================================================

-- =========================================================
-- handle_new_user()関数を更新して、tenants/profiles/proceed_validation_settingsを作成
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- 1. public.usersにレコードを作成（既存の動作を維持）
  INSERT INTO public.users (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  
  -- 2. tenantsテーブルにレコードを作成（デフォルト名で）
  -- 既存ユーザーのマイグレーションと同じパターン: 'Restaurant ' || user_id
  -- 既に存在する場合は作成しない（既存ユーザーのマイグレーションと同じアプローチ）
  BEGIN
    -- まず、既存のテナントをチェック
    SELECT id INTO v_tenant_id
    FROM tenants
    WHERE name = 'Restaurant ' || new.id::text
    LIMIT 1;
    
    -- テナントが存在しない場合のみ作成
    IF v_tenant_id IS NULL THEN
      INSERT INTO tenants (id, name, type, created_at)
      VALUES (
        gen_random_uuid(),
        'Restaurant ' || new.id::text,
        'restaurant',
        now()
      )
      RETURNING id INTO v_tenant_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- エラーが発生した場合、警告を出して続行を試みる
    RAISE WARNING 'Failed to create or find tenant for user %: %', new.id, SQLERRM;
    -- 再度テナントを検索してみる
    SELECT id INTO v_tenant_id
    FROM tenants
    WHERE name = 'Restaurant ' || new.id::text
    LIMIT 1;
  END;
  
  -- 3. profilesテーブルにレコードを作成（role='admin'）
  -- v_tenant_idがNULLの場合はエラーを発生させる
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create or find tenant for user %', new.id;
  END IF;
  
  BEGIN
    INSERT INTO profiles (user_id, tenant_id, role, created_at)
    VALUES (new.id, v_tenant_id, 'admin', now())
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET
      role = EXCLUDED.role;
  EXCEPTION WHEN OTHERS THEN
    -- エラーが発生しても認証プロセスを継続させる
    RAISE WARNING 'Failed to create profile for user %: %', new.id, SQLERRM;
  END;
  
  -- 4. proceed_validation_settingsにレコードを作成（既存の動作を維持）
  -- validation_modeは既存の値を保持（新規作成時のみ'block'を設定）
  BEGIN
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (new.id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- エラーが発生しても認証プロセスを継続させる
    RAISE WARNING 'Failed to create proceed_validation_settings for user %: %', new.id, SQLERRM;
  END;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================
-- RLSポリシーの確認（tenants/profilesテーブル用）
-- =========================================================
-- SECURITY DEFINER関数がINSERTできるように、postgresロールを許可するポリシーが必要
-- 既存のポリシーがある場合はそのまま使用、ない場合は作成

-- tenantsテーブルのINSERTポリシー（存在しない場合のみ作成）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'tenants' 
    AND policyname = 'Service role and postgres can insert tenants'
  ) THEN
    CREATE POLICY "Service role and postgres can insert tenants"
      ON tenants
      FOR INSERT
      TO public, postgres
      WITH CHECK (true);
  END IF;
END $$;

-- profilesテーブルのINSERTポリシー（存在しない場合のみ作成）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'profiles' 
    AND policyname = 'Service role and postgres can insert profiles'
  ) THEN
    CREATE POLICY "Service role and postgres can insert profiles"
      ON profiles
      FOR INSERT
      TO public, postgres
      WITH CHECK (true);
  END IF;
END $$;

-- =========================================================
-- 完了
-- =========================================================
-- これで、新規ユーザーがGoogle Authでログインすると：
-- 1. auth.usersにレコードが作成される
-- 2. handle_new_user()が発火して：
--    a. public.usersにレコードが作成される
--    b. tenantsテーブルに新しいテナントが作成される（'Restaurant ' || user_id）
--    c. profilesテーブルにプロファイルが作成される（role='admin'）
--    d. proceed_validation_settingsにレコードが作成される（validation_mode='block'）

