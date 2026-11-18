-- Markaz auto mode: the app picks new products from saved Markaz links by itself and Autopilot posts them.
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS markaz_auto_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS markaz_auto_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS markaz_auto_per_run integer NOT NULL DEFAULT 5 CHECK (markaz_auto_per_run BETWEEN 1 AND 10);
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS markaz_auto_last_run timestamptz;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS markaz_auto_last_message text;
