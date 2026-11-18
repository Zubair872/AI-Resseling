-- Customer chat (Facebook Messenger / Instagram DM) support.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_thread_id varchar(120);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS human_takeover boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS conversations_thread_idx ON conversations (tenant_id, channel, external_thread_id);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS external_message_id varchar(200);
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS last_error text;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_external_uidx ON conversation_messages (tenant_id, external_message_id) WHERE external_message_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;
