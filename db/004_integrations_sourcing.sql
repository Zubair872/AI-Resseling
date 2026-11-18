ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS rating numeric(3,2),
  ADD COLUMN IF NOT EXISTS review_count integer,
  ADD COLUMN IF NOT EXISTS sold_count integer,
  ADD COLUMN IF NOT EXISTS source_kind varchar(30) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS profit_amount numeric(12,2);

ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider varchar(30);

ALTER TABLE publishing_jobs
  ADD COLUMN IF NOT EXISTS external_post_id text,
  ADD COLUMN IF NOT EXISTS provider varchar(30);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider varchar(30) NOT NULL CHECK (provider IN ('buffer', 'markaz', 'custom')),
  label varchar(120) NOT NULL,
  base_url text,
  config jsonb NOT NULL DEFAULT '{}',
  encrypted_secret text,
  secret_hint varchar(8),
  enabled boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'failed')),
  status_message text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integrations_tenant_idx ON integrations (tenant_id, provider);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  min_rating numeric(3,2) NOT NULL DEFAULT 4.5,
  min_reviews integer NOT NULL DEFAULT 50,
  min_sold integer NOT NULL DEFAULT 200,
  profit_amount numeric(12,2) NOT NULL DEFAULT 150,
  profit_percent numeric(5,2),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source varchar(30) NOT NULL,
  total integer NOT NULL,
  imported integer NOT NULL,
  rejected jsonb NOT NULL DEFAULT '[]',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_runs_tenant_idx ON import_runs (tenant_id, created_at DESC);
