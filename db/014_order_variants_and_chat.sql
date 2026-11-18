-- Migration 014: Variant SKU in orders and Meta/WhatsApp chat setup
ALTER TABLE orders ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS variant_sku varchar(120);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS variant_title varchar(180);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS public_api_url text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_verify_token varchar(120);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_webhook_verified boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_last_webhook_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_last_message_at timestamptz;
