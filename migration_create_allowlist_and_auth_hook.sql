-- =========================================================
-- Migration: Create allowlist table and Auth Hook
-- =========================================================
-- Purpose:
-- 1. Create allowlist table for access control
-- 2. Create before.signup Auth Hook to check allowlist/invitations
-- 3. Enable Supabase Auth Hooks feature
-- =========================================================

BEGIN;

-- =========================================================
-- 1) allowlistテーブル作成
-- =========================================================
CREATE TABLE IF NOT EXISTS allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  created_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  approved_by text,
  request_count integer DEFAULT 0,
  last_requested_at timestamptz,
  note text
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_allowlist_email_status ON allowlist(email, status);
CREATE INDEX IF NOT EXISTS idx_allowlist_status ON allowlist(status);

COMMENT ON TABLE allowlist IS 'Access control list for new user registration';
COMMENT ON COLUMN allowlist.status IS 'pending: waiting for approval, approved: can login, rejected: denied, revoked: access removed';
COMMENT ON COLUMN allowlist.request_count IS 'Number of access requests from this email (spam prevention)';

-- =========================================================
-- 2) before.signup Auth Hook function
-- =========================================================
CREATE OR REPLACE FUNCTION public.check_before_signup(event jsonb)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  user_email text;
BEGIN
  -- Extract email from event
  user_email := event->'user'->>'email';
  
  -- Check if email is in allowlist (approved)
  IF NOT EXISTS (
    SELECT 1 FROM allowlist 
    WHERE email = user_email 
    AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Access denied. Please request access or wait for an invitation.';
  END IF;
  
  -- Return the event unmodified
  RETURN event;
END;
$$;

COMMENT ON FUNCTION public.check_before_signup(jsonb) IS 'Auth Hook: Check allowlist before user signup';

-- =========================================================
-- 3) RLS Policies for allowlist
-- =========================================================
ALTER TABLE allowlist ENABLE ROW LEVEL SECURITY;

-- System admin can do everything (will be implemented with API middleware)
CREATE POLICY "Service role can manage allowlist"
  ON allowlist
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No public access (access through API only)
CREATE POLICY "No public access to allowlist"
  ON allowlist
  FOR ALL
  TO public
  USING (false);

COMMIT;

-- =========================================================
-- Manual Steps Required After Running This Migration
-- =========================================================
-- 
-- You need to enable the Auth Hook in Supabase Dashboard:
-- 
-- 1. Go to Supabase Dashboard > Authentication > Hooks
-- 2. Enable "before.signup" hook
-- 3. Select function: public.check_before_signup()
-- 4. Save
--
-- Or use Supabase CLI:
-- supabase functions deploy --project-ref YOUR_PROJECT_REF
--
-- =========================================================

