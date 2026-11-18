-- Migration 013: Markaz export file support (variants, root SKUs, advance payment / China flag)
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku varchar(120);
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_advance_payment boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku varchar(120) NOT NULL,
  title varchar(180),
  option1_name varchar(80),
  option1_value varchar(120),
  option2_name varchar(80),
  option2_value varchar(120),
  option3_name varchar(80),
  option3_value varchar(120),
  wholesale_price numeric(12,2) NOT NULL CHECK (wholesale_price >= 0),
  selling_price numeric(12,2) NOT NULL CHECK (selling_price >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS product_variants_tenant_product_idx ON product_variants (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS product_variants_tenant_sku_idx ON product_variants (tenant_id, sku);
CREATE INDEX IF NOT EXISTS products_tenant_sku_idx ON products (tenant_id, sku) WHERE sku IS NOT NULL;
