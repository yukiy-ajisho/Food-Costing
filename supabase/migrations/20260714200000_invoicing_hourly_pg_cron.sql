-- Hourly invoicing cron: pg_net POST to backend /internal/cron/invoicing-hourly
--
-- BEFORE applying in production, create Vault secrets (Supabase Dashboard → Database → Vault):
--   invoicing_cron_backend_url  e.g. https://api.example.com/internal/cron/invoicing-hourly
--   invoicing_cron_secret       same value as backend CRON_SECRET
--
-- Local supabase: extensions may already exist; cron runs only when secrets are set.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoicing-hourly') THEN
    PERFORM cron.unschedule('invoicing-hourly');
  END IF;
END
$cron$;

SELECT cron.schedule(
  'invoicing-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'invoicing_cron_backend_url'
      LIMIT 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'invoicing_cron_secret' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
