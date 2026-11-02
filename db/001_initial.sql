CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  mode varchar(20) NOT NULL DEFAULT 'personal' CHECK (mode IN ('personal', 'saas')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role varchar(30) NOT NULL DEFAULT 'staff' CHECK (role IN ('super_admin', 'owner', 'admin', 'manager', 'staff', 'support_agent')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash varchar(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_sessions_user_idx ON refresh_sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(180) NOT NULL,
  description text,
  category varchar(50) NOT NULL,
  wholesale_price numeric(12,2) NOT NULL CHECK (wholesale_price >= 0),
  selling_price numeric(12,2) NOT NULL CHECK (selling_price >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  status varchar(30) NOT NULL DEFAULT 'draft',
  supplier_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_tenant_created_idx ON products (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS products_tenant_category_idx ON products (tenant_id, category);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  kind varchar(40) NOT NULL,
  source_url text,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  last_import_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_tenant_idx ON sources (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  phone varchar(40) NOT NULL,
  city varchar(100),
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  payment_method varchar(30) NOT NULL DEFAULT 'cod',
  status varchar(40) NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON orders (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) UNIQUE NOT NULL,
  name varchar(100) NOT NULL,
  monthly_price numeric(12,2) NOT NULL DEFAULT 0,
  annual_price numeric(12,2) NOT NULL DEFAULT 0,
  product_limit integer NOT NULL DEFAULT 100,
  social_account_limit integer NOT NULL DEFAULT 2,
  ai_action_limit integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plans (code, name, monthly_price, annual_price, product_limit, social_account_limit, ai_action_limit)
VALUES
  ('starter', 'Starter', 0, 0, 100, 2, 100),
  ('professional', 'Professional', 2999, 29990, 1000, 10, 2000),
  ('business', 'Business', 7999, 79990, 5000, 30, 10000),
  ('enterprise', 'Enterprise', 0, 0, 100000, 100, 100000)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  status varchar(30) NOT NULL DEFAULT 'trialing',
  billing_cycle varchar(20) NOT NULL DEFAULT 'monthly',
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  provider varchar(40),
  provider_subscription_id varchar(180),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind varchar(50) NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_tenant_kind_created_idx ON usage_events (tenant_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method varchar(30) NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  reference varchar(180),
  proof_url text,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_kind varchar(40) NOT NULL,
  supplier_order_id varchar(180),
  status varchar(40) NOT NULL DEFAULT 'pending_authorization',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_id, supplier_kind)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel varchar(30) NOT NULL DEFAULT 'manual',
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_tenant_updated_idx ON conversations (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction varchar(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_messages_tenant_created_idx ON conversation_messages (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  platform varchar(30) NOT NULL,
  language varchar(30) NOT NULL,
  content jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'published')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE TABLE IF NOT EXISTS social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform varchar(30) NOT NULL,
  display_name varchar(160) NOT NULL,
  external_account_id varchar(180),
  status varchar(20) NOT NULL DEFAULT 'disconnected',
  encrypted_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, external_account_id)
);

CREATE TABLE IF NOT EXISTS publishing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_draft_id uuid NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(100) NOT NULL,
  entity_type varchar(60) NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
