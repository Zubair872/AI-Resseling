# Database schema

Source of truth: `db/001_initial.sql`, `db/002_rules.sql` and `db/003_auth_notifications.sql` and `db/004_integrations_sourcing.sql` (applied in order, idempotent). Every business table has `tenant_id` and every query filters by it.

- tenants (id, name, mode, status active|suspended)
- users (tenant_id, email unique, password_hash, role, is_active)
- refresh_sessions (hashed refresh tokens, rotation, revoked_at)
- products (tenant_id, name, category, wholesale_price, selling_price, stock >= 0, status, supplier_url)
- sources, customers (unique tenant_id+phone), orders, plans, subscriptions, usage_events
- payment_verifications (pending|approved|rejected, reviewed_by)
- supplier_orders (unique tenant_id+order_id+supplier_kind, status pending_authorization by default)
- conversations, conversation_messages (outbound stays draft)
- content_drafts (draft|approved|rejected|published)
- social_accounts (platform, category, daily_limit, status, encrypted_token column reserved)
- publishing_jobs (draft + account + scheduled_for, status, attempts)
- auth_tokens (email_verification|password_reset, hashed, expiry, used_at; users.email_verified_at)
- notifications (tenant_id, kind, title, body, read_at)
- integrations (provider buffer|markaz|custom, encrypted_secret, secret_hint, status unverified|verified|failed)
- tenant_settings (sourcing quality rules + default profit), import_runs (import history with rejected rows)
- products also have image_url, rating, review_count, sold_count, source_kind, profit_amount; social_accounts.provider; publishing_jobs.external_post_id
- audit_logs (tenant_id, user_id, action, entity, metadata)

Not yet in the schema: images/SKU/subcategory on products, coupons, invoices, notifications, supplier history, order notes/variants, file uploads.

## 005_customer_chat.sql

- `conversations`: `external_thread_id` (Meta sender id), `last_inbound_at` (24-hour reply window), `human_takeover`.
- `conversation_messages`: `external_message_id` (unique per tenant, makes Meta retries safe), `ai_generated`, `sent_at`, `last_error`.
- `orders`: `conversation_id`, `notes`.
- Social customers have no phone number yet, so `customers.phone` holds `fb:<id>` / `ig:<id>` until an order is created with the real phone.

## Migration 006 (billing and team)
`plans.team_member_limit`, `subscriptions.cancel_at_period_end`, `tenants.referral_code` / `referred_by`, tables `coupons`, `coupon_redemptions`, `invoices` (+ `invoice_number_seq`), `team_invites`.

## Migration 008 (providers and storage)
- `integrations.provider` CHECK widened to buffer, markaz, meta, whatsapp, tiktok, sheets, custom (migration 004 only allowed buffer/markaz/custom, so Meta inserts failed before this).
- `invoices.provider`, `invoices.provider_session_id` (unique per provider).
- `uploads.storage` (`database`/`s3`), `uploads.storage_key`; `data_base64` is now nullable.
- `sheet_syncs` history table.

## Migration 009 (round 12)
`oauth_states` (one-time OAuth state hashes + encrypted Page selection), `whatsapp_templates`, new columns: `integrations.encrypted_refresh_secret/token_expires_at/refresh_expires_at/connected_via`, `conversation_messages.reply_mode/template_name`, `customers.whatsapp_opt_in/whatsapp_opt_in_at`, `products.external_id/source_currency/source_price`.
