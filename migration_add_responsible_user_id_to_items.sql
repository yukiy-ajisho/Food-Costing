-- =========================================================
-- Migration: Add responsible_user_id column to items table
-- =========================================================
-- This migration adds the responsible_user_id column to the items table
-- to support the "Full Access" sharing feature where a designated Manager
-- can change access rights for a record.
--
-- responsible_user_id: The ID of the Manager who has the right to change
-- access rights (Hide/View-only/Editable) for this record.
-- Default: user_id (the creator of the record)
-- =========================================================

BEGIN;

-- Add responsible_user_id column to items table
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Set default value: responsible_user_id = user_id for existing records
UPDATE items
SET responsible_user_id = user_id
WHERE responsible_user_id IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_items_responsible_user_id ON items (responsible_user_id);

COMMIT;

