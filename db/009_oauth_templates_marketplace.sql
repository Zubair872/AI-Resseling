-- Round 12: OAuth connect (Meta / TikTok), public comment replies, WhatsApp templates, LLM agent runs, marketplace CSV imports.
-- Idempotent: safe to run more than once.

-- 1) OAuth: one-time state values (only the hash is stored) and a short-lived, encrypted "pick your Page" payload.
CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL CHECK (provider IN ('meta', 'tiktok')),
  state_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  selection_hash varchar(64) UNIQUE,
  selection_expires_at timestamptz,
  pending_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_states_tenant_idx ON oauth_states (tenant_id, created_at DESC);

-- TikTok access tokens last about 24 hours: keep the refresh token (encrypted) and the expiry next to the access token.
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS encrypted_refresh_secret text;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS connected_via varchar(10) NOT NULL DEFAULT 'manual' CHECK (connected_via IN ('manual', 'oauth'));

-- 2) Public replies under comments: each outbound message says how it must be delivered.
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS reply_mode varchar(12) NOT NULL DEFAULT 'private' CHECK (reply_mode IN ('private', 'public', 'public_ack'));
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS template_name varchar(120);

-- 3) WhatsApp templates (approved by Meta) + marketing opt-in on customers.
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  language varchar(12) NOT NULL,
  category varchar(20) NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  body_text text NOT NULL,
  header_text text,
  footer_text text,
  variable_count integer NOT NULL DEFAULT 0,
  meta_template_id varchar(60),
  rejected_reason text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, language)
);
CREATE INDEX IF NOT EXISTS whatsapp_templates_tenant_idx ON whatsapp_templates (tenant_id, status);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz;

-- 4) Marketplace imports remember where each product came from, so a second import skips it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id varchar(120);
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_currency varchar(8);
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_price numeric(14,4);
CREATE INDEX IF NOT EXISTS products_tenant_external_idx ON products (tenant_id, source_kind, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_tenant_url_idx ON products (tenant_id, supplier_url) WHERE supplier_url IS NOT NULL;
