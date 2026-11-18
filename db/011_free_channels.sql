-- Free posting channels (Bluesky, Mastodon, Discord) and Markaz scraping.
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check CHECK (provider IN ('buffer', 'markaz', 'meta', 'whatsapp', 'tiktok', 'sheets', 'telegram', 'bluesky', 'mastodon', 'discord', 'custom'));
CREATE INDEX IF NOT EXISTS publishing_jobs_due_idx ON publishing_jobs (status, scheduled_for) WHERE status = 'scheduled_local';
