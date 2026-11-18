-- Fixes the integrations provider CHECK (migration 004 allowed only buffer/markaz/custom, so 'meta' inserts failed)
-- and adds WhatsApp, TikTok, Google Sheets. Adds online-checkout fields to invoices and object-storage fields to uploads.
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check CHECK (provider IN ('buffer', 'markaz', 'meta', 'whatsapp', 'tiktok', 'sheets', 'custom'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provider varchar(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provider_session_id text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_session_uidx ON invoices (provider, provider_session_id) WHERE provider_session_id IS NOT NULL;

ALTER TABLE uploads ALTER COLUMN data_base64 DROP NOT NULL;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage varchar(10) NOT NULL DEFAULT 'database';
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_key text;

CREATE TABLE IF NOT EXISTS sheet_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dataset varchar(30) NOT NULL,
  spreadsheet_id varchar(120) NOT NULL,
  tab varchar(80) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('succeeded', 'failed')),
  rows_written integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sheet_syncs_tenant_idx ON sheet_syncs (tenant_id, created_at DESC);
