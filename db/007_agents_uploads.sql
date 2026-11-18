-- AI agent runs + autonomy setting, and image/proof uploads.
-- tenant_settings already exists (migration 004): add the autonomy column.
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS autonomy_mode varchar(20) NOT NULL DEFAULT 'approval' CHECK (autonomy_mode IN ('manual', 'approval', 'hybrid', 'full'));

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent varchar(40) NOT NULL,
  status varchar(30) NOT NULL CHECK (status IN ('completed', 'awaiting_approval', 'applied', 'rejected', 'failed')),
  autonomy_mode varchar(20) NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb NOT NULL DEFAULT '{}',
  error text,
  tokens_used integer NOT NULL DEFAULT 0,
  cost_estimate numeric(12,4) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_runs_tenant_idx ON agent_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('product_image', 'payment_proof')),
  content_type varchar(40) NOT NULL,
  size_bytes integer NOT NULL,
  data_base64 text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_tenant_idx ON uploads (tenant_id, created_at DESC);
