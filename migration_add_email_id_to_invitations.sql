-- =========================================================
-- Migration: Add email_id to invitations table
-- =========================================================
-- This migration adds the email_id column to the invitations table
-- to support accurate webhook updates in multi-tenant environments.
--
-- email_id is the unique identifier returned by Resend when sending
-- an email, which allows us to uniquely identify which invitation
-- a webhook event refers to, even when multiple tenants have sent
-- invitations to the same email address.
-- =========================================================

BEGIN;

-- =========================================================
-- 1) email_id カラムを追加
-- =========================================================
ALTER TABLE invitations
ADD COLUMN IF NOT EXISTS email_id text;

-- =========================================================
-- 2) email_id のインデックスを作成（Webhook更新の高速化）
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_invitations_email_id ON invitations(email_id);

COMMIT;


