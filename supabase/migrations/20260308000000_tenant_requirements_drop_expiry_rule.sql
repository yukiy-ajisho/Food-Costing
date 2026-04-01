-- Remove expiry_rule from tenant_requirements (only value was 'hard'; behaviour is always validity-duration-based).
-- No existing data to migrate.

ALTER TABLE public.tenant_requirements
  DROP COLUMN IF EXISTS expiry_rule;

DROP TYPE IF EXISTS public.tenant_requirement_expiry_rule;
