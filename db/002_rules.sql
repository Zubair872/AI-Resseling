ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS category varchar(50),
  ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 3 CHECK (daily_limit >= 0);

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS publishing_jobs_account_sched_idx ON publishing_jobs (social_account_id, scheduled_for);
CREATE INDEX IF NOT EXISTS publishing_jobs_draft_account_idx ON publishing_jobs (content_draft_id, social_account_id);
