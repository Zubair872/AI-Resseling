-- Autopilot: automatic product rotation and scheduling per account.
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS autopilot_language varchar(20) NOT NULL DEFAULT 'roman_urdu' CHECK (autopilot_language IN ('english', 'urdu', 'roman_urdu'));
