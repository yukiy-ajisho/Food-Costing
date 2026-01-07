-- =========================================================
-- Migration: Add 'source' column to allowlist table
-- =========================================================
-- Purpose:
-- Add 'source' column to track where the allowlist entry came from
-- - 'request': User requested access
-- - 'invitation': User was invited
-- =========================================================

BEGIN;

-- Add source column to allowlist table
ALTER TABLE allowlist 
ADD COLUMN IF NOT EXISTS source text CHECK (source IN ('request', 'invitation'));

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_allowlist_source ON allowlist(source);

-- Add comment
COMMENT ON COLUMN allowlist.source IS 'Source of allowlist entry: request (user requested access) or invitation (user was invited)';

COMMIT;

