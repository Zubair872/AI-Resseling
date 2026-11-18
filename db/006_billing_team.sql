-- Billing (coupons, invoices, cancellation), team invites, referrals.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS team_member_limit integer NOT NULL DEFAULT 1;
UPDATE plans SET team_member_limit = CASE code WHEN 'starter' THEN 1 WHEN 'professional' THEN 3 WHEN 'business' THEN 10 WHEN 'enterprise' THEN 100 ELSE team_member_limit END;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_code varchar(16);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES tenants(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_referral_code_idx ON tenants (referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) UNIQUE NOT NULL,
  percent_off numeric(5,2) CHECK (percent_off > 0 AND percent_off <= 100),
  amount_off numeric(12,2) CHECK (amount_off > 0),
  plan_code varchar(40),
  max_redemptions integer CHECK (max_redemptions > 0),
  redeemed_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((percent_off IS NOT NULL AND amount_off IS NULL) OR (percent_off IS NULL AND amount_off IS NOT NULL))
);

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number varchar(40) UNIQUE NOT NULL,
  plan_code varchar(40) NOT NULL,
  billing_cycle varchar(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  subtotal numeric(12,2) NOT NULL,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'PKR',
  coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'void')),
  payment_reference varchar(180),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role varchar(30) NOT NULL CHECK (role IN ('admin', 'manager', 'staff', 'support_agent')),
  token_hash varchar(64) UNIQUE NOT NULL,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_invites_tenant_idx ON team_invites (tenant_id, created_at DESC);
