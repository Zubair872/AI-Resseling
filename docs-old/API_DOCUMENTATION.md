# API documentation

All `/api/*` routes except register, login, refresh and `/api/plans` need `Authorization: Bearer <token>`. Role order: staff/support_agent < manager < admin < owner < super_admin.

## Auth
POST /api/auth/register, /login, /refresh, /logout; GET /api/me (includes emailVerified)
POST /api/auth/forgot-password (always 202, rate limited), /reset-password {token, password} (single use, revokes sessions), /verify-email {token}, /resend-verification
No email provider is connected: links are logged by the server in development only and are not delivered.

## Catalog
GET/POST /api/products (plan product limit enforced, 429 when reached); PATCH (manager), DELETE (admin) /api/products/:id; POST /api/products/import/csv (manager); POST /api/pricing/calculate; GET/POST /api/sources

## Orders
GET/POST /api/orders; PATCH /api/orders/:id/status (manager; allowed transitions only; cancelling restores stock)

## Content and publishing
POST /api/content/generate (monthly AI limit); GET /api/content/drafts; POST /api/content/drafts/:id/decision (manager)
GET/POST /api/social-accounts (plan account limit; body: platform, displayName, externalAccountId?, category?, dailyLimit)
POST /api/publishing/jobs: 409 with `reasons` unless account connected, platform matches, category matches, daily limit free, product in stock, draft approved, not a duplicate

## Payments, suppliers, conversations
POST/GET /api/payments/verification-requests; POST .../:id/decision (manager)
POST/GET /api/supplier-orders; POST .../:id/decision (manager; records intent only, no external order)
GET/POST /api/conversations; GET/POST /api/conversations/:id/messages

## Subscription
GET /api/plans, GET /api/subscription, POST /api/workflows/enqueue

## Super admin
GET /api/admin/tenants; POST /api/admin/tenants/:id/status {status: active|suspended}

## Notifications, analytics, export
GET /api/notifications; POST /api/notifications/:id/read; POST /api/notifications/read-all (created for new orders, low stock, payment and supplier reviews)
GET /api/analytics/summary (delivered orders only; gross profit is before delivery, fees and refunds)
GET /api/exports/orders.csv (formula-injection safe)

## Integrations (admin to change, any user to read)
GET/POST /api/integrations (provider: buffer | markaz | custom; keys encrypted, only secret_hint returned); PATCH/DELETE /api/integrations/:id
POST /api/integrations/:id/test (Buffer only: lists organizations, sets status verified/failed)
POST /api/integrations/:id/sync-channels (Buffer: creates/updates connected social accounts, respects plan limit)

## Sourcing (Markaz via CSV or manual, no scraping)
GET/PUT /api/sourcing/settings (min rating, min reviews, min units sold, profit amount, profit percent)
POST /api/sourcing/markaz/import {csv, dryRun} (manager): only rows passing all quality rules are saved as draft products, selling price = Markaz price + your profit
POST /api/sourcing/products (manager): manual product, skips quality rules, profit defaults to your setting
GET /api/sourcing/imports

## Publishing queue
GET /api/publishing/jobs; POST /api/publishing/jobs/:id/retry (manager). Jobs for Buffer channels are sent to Buffer immediately; status scheduled_in_buffer only after Buffer confirms, failed otherwise.

## Customer chat (Meta)

- `GET /webhooks/meta`: Meta verification handshake (needs `META_VERIFY_TOKEN`).
- `POST /webhooks/meta`: incoming Messenger/Instagram messages. The `X-Hub-Signature-256` header is checked with `META_APP_SECRET`; invalid signatures get 401. The tenant is found by the Page ID or Instagram account ID saved in the Meta integration.
- `POST /api/integrations` with `provider: meta`: `secret` = Page access token, `config.pageId` (required), `config.instagramId` (optional), `config.aiMode` = `manual` | `approval` (default) | `auto`. `POST /api/integrations/:id/test` checks the token.
- `PATCH /api/conversations/:id` `{ humanTakeover?, status? }`.
- `PATCH /api/conversations/:id/messages/:messageId` edits an unsent outbound draft.
- `POST /api/conversations/:id/messages/:messageId/send` sends through Meta. Refused when the 24-hour window is closed. Status becomes `sent` only after Meta confirms.
- `POST /api/conversations/:id/create-order` creates an order from the chat (stock is reduced in the same transaction).
- `GET /api/orders/:id/markaz-summary` returns text to enter by hand in the Markaz app. Nothing is submitted to Markaz.

Comments: `POST /webhooks/meta` also accepts Facebook `feed` comment events and Instagram `comments` events. The conversation `external_thread_id` is `c:<comment id>` and sending uses a private reply (7 day window).

## Team and billing (round 9)

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | /api/team | any | Members, pending invites, seat limit |
| POST | /api/team/invites | admin | Invite by email and role (plan seat limit applies) |
| DELETE | /api/team/invites/:id | admin | Revoke an invite |
| POST | /api/team/accept | public | Accept an invite and set a password |
| PATCH | /api/team/:id | admin | Change role or deactivate a member |
| GET | /api/billing | admin | Subscription, plans, usage, invoices |
| POST | /api/billing/quote | admin | Price a plan with an optional coupon |
| POST | /api/billing/change-plan | owner | Create invoice (pending) or apply free change |
| POST | /api/billing/cancel, /resume | owner | Cancel at period end / undo |
| GET | /api/invoices/:id/document | admin | Printable invoice HTML |
| GET | /api/referrals | any | Referral code, link, count |
| GET | /api/admin/invoices | super_admin | List invoices (?status=pending) |
| POST | /api/admin/invoices/:id/mark-paid | super_admin | Confirm real payment, activate plan |
| POST | /api/admin/invoices/:id/void | super_admin | Void a pending invoice |
| GET/POST/PATCH | /api/admin/coupons | super_admin | Manage coupons |
| POST | /api/admin/subscriptions/sweep | super_admin | Expire due subscriptions now |

## Round 11 endpoints
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET/POST | /webhooks/whatsapp | public (signature) | WhatsApp Cloud API webhook |
| POST | /webhooks/stripe | public (signature) | Stripe webhook; settles a pending invoice only for a paid session with matching amount |
| POST | /api/billing/checkout | owner | Starts Stripe Checkout for the pending invoice (503 if not configured) |
| GET | /api/exports/:dataset?format=csv\|xls | any | datasets: orders, products, customers, payments, supplier_orders, profit |
| POST | /api/exports/sheets | admin | Replace a Google Sheets tab with a dataset |
| GET | /api/exports/sheets/history | admin | Sheets sync history |
| POST | /api/integrations/:id/connect-tiktok-account | admin | Register the TikTok account after the token works |
| POST | /api/uploads/:id/ocr | manager | OCR hint for a payment proof (never verifies) |
Integrations now accept providers `whatsapp` and `tiktok`; `POST /api/integrations/:id/test` supports Buffer, Meta, WhatsApp and TikTok.

## Round 12 endpoints
| Method + path | Role | What it does |
|---|---|---|
| GET `/api/oauth/status` | any | Which OAuth providers are configured, redirect URI to register, missing env vars |
| POST `/api/oauth/:provider/start` | admin | `meta` or `tiktok`. Returns `{ url }` to open. Stores a one-time state (10 min) |
| GET `/api/oauth/:provider/callback` | public (state-checked) | Provider redirect target. Redirects the browser to `APP_URL/?oauth=...&status=success|select|error` (never tokens) |
| GET `/api/oauth/pending?token=` | admin | Pages granted at Meta login (names only) |
| POST `/api/oauth/meta/finish` | admin | `{ token, pageId, aiMode, commentReplyMode }`: saves the Page token (encrypted) and subscribes Page webhooks |
| GET `/api/whatsapp/templates` | any | Stored templates |
| POST `/api/whatsapp/templates/sync` | manager | Pull templates + status from Meta |
| POST `/api/whatsapp/templates` | admin | Validate locally, submit to Meta for review |
| DELETE `/api/whatsapp/templates/:id` | admin | Delete at Meta and locally |
| PUT `/api/customers/:id/whatsapp-opt-in` | manager | `{ optIn, source }` (source required when opting in; audited) |
| POST `/api/conversations/:id/send-template` | manager | `{ templateId, params[] }`: APPROVED templates only; marketing needs opt-in; stored only after WhatsApp accepts |
| GET `/api/agents/llm/status` | any | Whether the LLM assistant is configured |
| POST `/api/agents/llm/run` | manager | `{ goal }`: tool-calling run. Returns answer, tool trace, proposals. Proposals are applied via `POST /api/agents/runs/:id/decision` |
| GET `/api/sourcing/marketplaces` | any | Presets and recognised columns |
| POST `/api/sourcing/marketplace/import` | manager | `{ marketplace, csv, dryRun, exchangeRates, shippingPerItem, dutyPercent, defaultStock, qualityMode, columnMap }` |
Comment replies: `conversation_messages.reply_mode` is `private`, `public` or `public_ack`; the existing `POST /api/conversations/:id/messages/:messageId/send` delivers it.
