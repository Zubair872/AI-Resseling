# Development status

## Complete

- Stage 1 UI prototype with responsive navigation and colorful commercial SaaS styling.
- Vite production build.
- Fastify API foundation and `/health` endpoint.
- PostgreSQL initial migration.
- Tenant-aware registration, login, `/api/me`, and product CRUD endpoints.
- Docker Compose development infrastructure.
- Frontend API client with authenticated workspace login/registration, API health status, persisted session state, and live product catalog loading.
- Product catalog UI supports authenticated create, edit, delete, search, and CSV import against the API.
- Orders UI loads live orders, creates manual orders with stock reservation, and submits payment-verification and supplier-review requests without claiming external success.
- Manual customer inbox, conversation messages, manager-only payment/supplier decisions, and audit history are implemented.
- AI provider configuration supports mock mode and an optional OpenAI-compatible server-side adapter; live AI remains unverified without credentials.

Phase 2 progress:

- OpenAI-compatible adapter is implemented with server-side key configuration,
  strict JSON/schema validation, provider error handling, and review-required
  content.
- Content Studio can select a live product, platform, and language, call the
  authenticated API, and show saved drafts with disclaimers.
- Live provider verification is blocked until an API key and billing-enabled
  provider account are configured by the user.
- Pricing and profit calculation endpoint with shipping, fees, discounts, and net-profit output.
- Source, customer, and order APIs with tenant scoping, stock locking, and stock decrement.
- Subscription plan catalog, starter subscription provisioning, usage events, and subscription lookup.
- Provider-independent content generation boundary with review-safe mock output and content drafts.
- Social account records with explicit pending OAuth status.
- Payment verification requests with human-review status.
- Supplier order records that remain pending authorization until an approved adapter is configured.
- Approval-gated publishing job records.
- Redis/BullMQ workflow queue with exponential retries, bounded cleanup, idempotency keys, and worker boundary.
- Patched runtime dependencies with a clean production audit.
- Pricing unit tests.
- Zero-setup local runtime using embedded PGlite, in-memory queue fallback, automatic migrations, and a persistent generated development JWT secret.

## In progress

- Provider-specific source, social, payment, supplier, and AI adapters.
- Durable Redis/BullMQ workers, retries, idempotency, and monitoring.
- Email verification, refresh-token rotation, recovery, and session revocation.
- Live subscription billing and webhook reconciliation.
- End-to-end tenant, authentication, subscription, payment, and order tests against production PostgreSQL.

## Phase 1 status

Manual-first MVP is complete for local development:

- Product entry, editing, deletion, search, and CSV import.
- Customer and order creation with tenant scoping and stock reservation.
- Manual payment verification requests plus manager approval/rejection.
- Manual supplier review requests plus manager approval/rejection.
- Customer conversation/message storage with outbound draft protection.
- Audit events for sensitive approval decisions.

External provider actions remain intentionally disabled until official accounts,
credentials, permissions, and live verification are supplied.

## Not yet enabled

No supplier, social, payment, or AI provider is claimed to be operational until credentials, permissions, and live verification are completed.

## Session update (2026-11-03)

Verified (ran here): `api/scheduler.ts`, `api/limits.ts`, `api/orderStatus.ts` + `tests/rules.test.ts` (6/6 pass).

Written but NOT compiled or run (npm registry was blocked in the authoring session; only a syntax check passed):

- `db/002_rules.sql`: social_accounts.category / daily_limit, tenants.status. `api/migration.ts` now applies all migration files in order.
- `api/app.ts` (the Fastify app, exported) and `api/server.ts` (only listens). `api/db.ts` supports `LOCAL_DB_PATH=memory://` for tests.
- Wired into the app: product limit (create + CSV import), social account limit, publishing validation (connected, platform, category match, daily limit, stock, approval, duplicate), order status transitions with stock restore on cancel, audit for order create/status/publishing, UUID validation on `:id` params, suspended tenants blocked at login, Super Admin `GET /api/admin/tenants` and `POST /api/admin/tenants/:id/status`.
- `tests/integration.test.ts` (`npm run test:integration`): tenant isolation, stock, payment approval + audit, publishing rules, suspension.

FIRST THING TO DO LOCALLY: `npm ci && npm run api:build && npm run build && npm run test:pricing && npm run test:integration`, then fix any compile/test errors.

Not done yet: frontend for new features, creating a super_admin user (set `users.role = 'super_admin'` via SQL for now), refresh/email verification/recovery, checkout/invoices/coupons, uploads/OCR/exports, Railway + GitHub Actions config, remaining docs.

### Added later the same session (also not build-tested)
- Fixed a production bug: migrations are now read from `./db` relative to the working directory (the old path pointed to `dist-api/db`, which does not exist).
- Graceful shutdown in `api/server.ts`.
- Deployment config: `Dockerfile` (API/worker), `Dockerfile.web` (frontend), `.dockerignore`, `railway.json`, `.github/workflows/ci.yml`.
- New docs: `DEPLOYMENT.md`, `ENVIRONMENT_VARIABLES.md`, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`.
- Frontend: Orders page now has an order-status dropdown calling `PATCH /api/orders/:id/status` (`api.updateOrderStatus`, `changeOrderStatus` in App.tsx). Syntax-checked only, not built.
- Frontend `src/Panels.tsx` (syntax-checked only, not built): Publishing page shows a live Social Accounts form (platform, category, daily limit) and a Schedule-a-post form (approved drafts only; server validation reasons are shown). Settings page shows a Super Admin tenant list with suspend/reactivate for `super_admin` users.
- Still missing in the UI: edit/delete of social accounts, publishing queue/calendar view, per-tenant plan changes.

### Round 3 (not compiled or run; `tests/security.test.ts` and `tests/rules.test.ts` pass, 10/10)
- `db/003_auth_notifications.sql`: auth_tokens, notifications, users.email_verified_at.
- Email verification and password recovery endpoints (hashed single-use tokens, rate limited, sessions revoked on reset). No email provider: mail is NOT delivered (`api/mailer.ts`), links appear in the server log in development only.
- In-app notifications (new order, low stock, payment and supplier review) with API and UI.
- Live analytics summary + category report + orders CSV export (API and UI on the Analytics page).
- UI: Forgot password flow in the sign-in modal, `?verify=` and `?reset=` links handled, Notifications panel on Overview, Analytics panel.
- Integration tests extended (verification, reset, notifications, analytics, export).
- Still missing: real email provider, coupons, invoices, checkout, referrals, file uploads/OCR, team invites, AI agents dashboard backend, supplier/social adapters (need credentials).

### Round 4 (backend written; NOT compiled or run. Pure-logic tests 18/18 pass)
- Integrations registry API (`/api/integrations`): add / edit / enable / disable / delete, API keys encrypted (AES-256-GCM, `api/secrets.ts`), never returned (only last 4 characters). Buffer connection test and channel sync.
- Buffer publishing (`api/buffer.ts`, GraphQL at api.buffer.com, built from developers.buffer.com examples): synced Buffer channels become `connected` social accounts, publishing jobs are sent with customScheduled + image URL. A job becomes `scheduled_in_buffer` ONLY after Buffer confirms. Not verified against a live Buffer account.
- Markaz sourcing (`api/sourcing.ts`): no public Markaz API was found, so products come from CSV/manual entry (no scraping). Quality gate: min rating, min reviews, min units sold (defaults 4.5 / 50 / 200). Your profit is added on top of the supplier price (default Rs. 150 fixed, optional percent, optional per-product override). Manual add skips the gate.
- Migration `db/004_integrations_sourcing.sql`, env var `INTEGRATION_ENCRYPTION_KEY` (required in production).
- UI: new Integrations page (`src/Integrations.tsx`): API connections (add/edit/change key/enable/disable/remove/test/sync channels), Markaz sourcing (quality rules, profit, CSV preview then import, manual add with live price), Buffer post queue with retry. Syntax-checked only.
- Integration tests added for integrations and sourcing (`tests/integration.test.ts`), not run yet. Buffer calls are covered by mocked-fetch unit tests only, never by a live account.
- Honest limits: no public Markaz API found (CSV/manual only); Buffer cannot read comments or upload media; Buffer GraphQL queries are copied from Buffer's docs but unverified live; a Buffer key with no organization owner rights cannot be created.
- Next: verify Buffer on a real account, AI-assisted post text per product, product image upload/hosting, team invites, coupons/invoices.

### Round 5: verification done in the authoring environment (npm registry still blocked, so nothing was run through Fastify/PGlite)
Verified for real:
- All 4 migrations apply cleanly, twice in a row (idempotent), on real PostgreSQL 16.
- All 108 SQL statements in `api/*.ts` prepare successfully on that database (syntax, tables, columns, parameter types).
- Found and fixed a real bug this way: the daily posting limit counted "a day" in the database timezone. It now uses `BUSINESS_TIMEZONE` (default Asia/Karachi). Re-checked on PostgreSQL: same-day jobs count, other days do not, failed jobs do not count, duplicates are detected.
- API (`api/*.ts` + tests) and frontend (`App.tsx`, `Panels.tsx`, `Integrations.tsx`, `api.ts`) type-check cleanly against stand-in type shims for fastify/pg/pglite/react (zod types were real). This catches typos and wrong props, but real library types can still report extra errors.
- 18 pure-logic unit tests pass (rules, security, secrets, sourcing, Buffer client with mocked fetch).
Still NOT verified: `npm ci` + `npm run build`, the Fastify routes at runtime, the integration tests, PGlite, and Buffer against a live account.
Run everything locally with: `npm ci && npm run verify`.

### Round 6: bug found by the user's first real run
- Buttons that send a POST with no body (Test connection, Sync channels, Mark read, Retry, Logout) failed with "Unexpected server error". Cause: the web client always sent `Content-Type: application/json`, Fastify rejects an empty JSON body with 400, and the API error handler turned every error into 500. Fixed in both places: the client only sends the header when there is a body, and the API now keeps 4xx statuses with their real message. Regression test added (integration tests did not catch it because `app.inject` sends no content-type header).
- Channel sync now skips channels with an unknown platform instead of crashing.

### Round 7: customer chat (Facebook Messenger + Instagram DM) and order hand-off
Written this round (NOT compiled or run here; the npm registry is blocked in the authoring session):
- `db/005_customer_chat.sql`, `api/meta.ts` (webhook signature check, event parser, 24-hour window rule, Graph API client), `api/support.ts` (replies from the products table only; optional LLM wording with a guard that rejects any number not found in the database).
- `api/app.ts`: `GET/POST /webhooks/meta` (raw-body signature check, Meta retries are idempotent, tenant found by Page/Instagram ID), AI draft after every customer message (mode manual / approval / auto), human takeover, edit and send draft (sent only after Meta confirms, refused after 24 hours), order from chat, `GET /api/orders/:id/markaz-summary`, Meta connection test.
- UI: `src/Inbox.tsx` (Customers page: thread, AI draft, Approve and send, Take over, Create order, Markaz text with Copy), Meta option in Integrations (Page ID, Instagram ID, AI mode).
- Tests: `tests/chat.test.ts` (7 tests, they pass: signature, parser, window, grounded replies, order intake, LLM guard, Meta client). A webhook-to-order test was added to `tests/integration.test.ts` but has NOT been run.
- Verified here: the 22 pure-logic tests pass; changed files have no syntax errors. NOT verified: `npm ci`, full build, Fastify routes at runtime (including the raw-body JSON parser override), the new SQL on PostgreSQL/PGlite, the UI, and everything against a live Meta app.
- Honest limits: replies are rule-based (price, availability, order details) and use an LLM only if AI_PROVIDER=openai. The assistant never answers delivery charges or confirms orders; it hands those to a human. Order submission to Markaz is manual (summary text) because no public Markaz API was found. Meta setup and Page token creation are on you (see DEPLOYMENT.md).
- Still missing for the full master prompt: WhatsApp and TikTok, Facebook/Instagram comment replies, payment screenshot upload/OCR, real email delivery, checkout/invoices/coupons/referrals, team invites, AI agent dashboard backend, supplier APIs that need credentials, product image upload, Google Sheets sync, Meta App Review for SaaS mode.
- Next local step: `npm ci && npm run verify`, then send me any error text.

### Round 8 (not compiled or run; `tests/chat.test.ts` 8/8 and the other pure tests pass)
- Bug found while preparing the Buffer test: `/api/content/generate` trusted the product name and price sent by the browser, and a draft showed a wrong price ("0.115"). Now, when a `productId` is given, the server reads name, category, price and description from the database. The OpenAI provider rejects (and retries once) any caption or hashtag containing a number that is not the product price. The mock provider now puts the price (Rs. format) in the caption. Test added in `tests/ai.test.ts` (not run here: zod missing in the authoring environment).
- Comments: Facebook `feed` and Instagram `comments` webhook events become their own conversation (`external_thread_id` = `c:<comment id>`). An approved reply goes out as ONE private message to the commenter within 7 days. Public replies under the comment are not built. The extra Meta permission private replies need is not verified: check Meta's docs.
- Review old drafts: drafts made before this fix may contain a wrong price. Reject them and generate again before scheduling.

### Round 9: billing, coupons, invoices, team invites, referrals (2026-11-04)
Verified here: `db/006_billing_team.sql` applies twice on real PostgreSQL 16 and the new SQL statements ran there; `tests/billing.test.ts` 8/8 pass; changed files have no syntax errors.
NOT verified (npm registry is blocked in the authoring session, so no `npm ci`): TypeScript compile of `api/billingRoutes.ts` and `src/Billing.tsx`, the Fastify routes at runtime, and the 3 new tests at the end of `tests/integration.test.ts`.
- Team: `GET /api/team`, `POST /api/team/invites` (plan seat limit, role rules: only a higher role can hand out a role), `DELETE /api/team/invites/:id`, `POST /api/team/accept` (single-use 7-day token), `PATCH /api/team/:id` (role change, deactivate; sessions revoked). Invite email is NOT delivered until an email provider exists (link is in the server log in development).
- Billing: `GET /api/billing`, `POST /api/billing/quote`, `POST /api/billing/change-plan` (owner), cancel / resume, printable invoice HTML. A paid plan creates a PENDING invoice; the plan switches only when a Super Admin confirms the payment reference (`POST /api/admin/invoices/:id/mark-paid`). Free or 100%-coupon changes apply immediately. Downgrades are refused while usage exceeds the new limits. Enterprise is custom priced (not self-serve).
- Coupons (Super Admin): create, list, enable/disable; percent or fixed; plan restriction, expiry, max uses, once per workspace.
- Expiry: hourly sweep in `api/server.ts` (and `POST /api/admin/subscriptions/sweep`) moves expired or cancelled paid plans to Starter; data is kept.
- Referrals: every workspace has a code (`/api/referrals`), `?ref=CODE` on the sign-up link records the referrer. Rewards are manual (the owner can give a coupon).
- UI: Billing page, Team page, Super Admin billing panel (Settings), invite link `?invite=` and referral link `?ref=` handled in the sign-in modal.
- Still missing: real online payment provider (JazzCash/Easypaisa/Stripe need merchant accounts), real email provider, WhatsApp/TikTok, payment screenshot upload + OCR, AI agent dashboard backend, product image upload, Google Sheets sync, edit/delete social accounts, publishing calendar.

### Round 10: agents dashboard backend, uploads, social account edit/delete, calendar (2026-11-04)
Verified here: `db/007_agents_uploads.sql` applies twice on real PostgreSQL 16 and the new SQL statements prepare there; `tests/agents.test.ts` 5/5 pass; syntax check passes.
NOT verified (no `npm ci` here): TypeScript compile of `api/platformRoutes.ts`, `src/Agents.tsx`, routes at runtime, and the 3 new tests at the end of `tests/integration.test.ts`.
- Agents (`GET /api/agents`, `PUT /api/agents/mode`, `POST /api/agents/run`, `GET /api/agents/runs`, `POST /api/agents/runs/:id/decision`): runnable agents are Classification, Pricing, Reporting and Payment Review Assistant. They are RULE-BASED (no LLM). Autonomy modes manual / approval / hybrid / full: only low-risk category changes can auto-apply (hybrid/full); price changes always wait for approval; payments can never be verified by an agent. Every run is stored (status, mode, input, output, tokens and cost fields, usage event, audit).
- Uploads (`POST /api/uploads`, `GET /files/:id`, `GET /api/uploads/:id`): PNG/JPEG/WebP, 3 MB, magic-byte check, stored in PostgreSQL as base64. Product images are public by unguessable link; payment proofs are private to the workspace. For production at scale, move to S3-compatible storage (needs your bucket).
- `POST /api/payments/parse-text`: extracts transaction ID and amount from pasted text; OCR is NOT connected; never verifies.
- Social accounts: `PATCH` (name, category, daily limit) and `DELETE` (refused if the account has publishing history). `GET /api/publishing/calendar`.
- UI: new Agents page (mode, runs, approvals, upload, payment text, calendar).
- Still missing in code: WhatsApp Business + TikTok adapters (need Meta/TikTok approval), Google Sheets sync, S3 storage adapter, real OCR provider.

### Round 11 (2026-11-04): all remaining CODE items written
Verified here (ran): 56 pure-logic tests pass, including `tests/providers2.test.ts` (12) and `tests/export.test.ts`. The S3 SigV4 signer reproduces AWS's published example signature exactly. Stripe signature check, Google service-account RS256 JWT (verified with a generated key pair), WhatsApp/TikTok/Resend/OCR clients (mocked fetch) are tested.
NOT verified (no npm registry): `npm ci`, full TypeScript build against real library types (only a shim type-check was run, no real errors found), Fastify routes at runtime, migration 008 on PostgreSQL, the 5 new integration tests, any live provider.
Added:
- Real bug fixed: migration 004 limited `integrations.provider` to buffer/markaz/custom, so adding a Meta integration would have failed. Fixed in `db/008_providers_storage.sql`.
- Email delivery through Resend (`api/resend.ts`, `api/mailer.ts`).
- WhatsApp Business Cloud API chat (`api/whatsapp.ts`, webhook + send in `api/extraRoutes.ts`, same grounded-reply rules as Meta chat, 24h window).
- TikTok Content Posting API publishing (`api/tiktok.ts`), status `submitted_to_tiktok` only when TikTok returns a publish id.
- Stripe Checkout + signed webhook for subscription invoices (`api/stripe.ts`); `settleInvoice` is now shared with the Super Admin mark-paid action; amount/currency mismatch never settles.
- S3-compatible storage with SigV4 (`api/s3.ts`, `api/storage.ts`) for uploads; proofs via 5-minute signed links.
- Google Sheets sync via service account (`api/sheets.ts`); CSV and Excel exports for 6 datasets (`api/csvExport.ts`).
- Payment-proof OCR hint (`api/ocr.ts`), never verified.
- UI: WhatsApp/TikTok in Integrations, exports + Sheets card in Analytics, "Pay pending invoice by card" in Billing.
EXTERNAL work left (cannot be done in code): see EXTERNAL_TODO.md.

### Round 12 (2026-11-04): OAuth connect, public comment replies, WhatsApp templates, LLM tool-calling agent, Temu/AliExpress/Daraz CSV import
Verified here (ran): 87 pure-logic tests pass (new: `tests/oauth.test.ts` 9, `tests/growth.test.ts` 12, `tests/llmagent.test.ts` 10; all older pure suites still pass). The new pure modules (`oauth.ts`, `llmAgent.ts`, `llmTools.ts`, `marketplaceCsv.ts`, `whatsapp.ts`, `meta.ts`) pass a strict `tsc --noEmit` (with a tiny node:crypto shim). All changed files pass a syntax parse.
NOT verified (no npm registry here): `npm ci`, real-library TypeScript build of `api/growthRoutes.ts` and the edited `app.ts`, `extraRoutes.ts`, `platformRoutes.ts`, `src/Growth.tsx`; migration 009 on PostgreSQL/PGlite; the 4 new integration tests at the end of `tests/integration.test.ts`; every live provider (Meta, TikTok, WhatsApp, LLM).
Added:
- **OAuth** (`api/oauth.ts`, routes in `api/growthRoutes.ts`): Meta login -> long-lived user token -> Page list -> you pick a Page -> encrypted Page token saved, Page webhooks subscribed. TikTok login -> encrypted access + refresh token, automatic refresh before use (`freshTikTokToken`, used by publishing and the integration test), TikTok social account registered. State values are single-use, hashed, 10 minutes. Tokens never travel in redirect URLs.
- **Public comment replies** (`api/meta.ts`, `sendChatMessage`/`processInboundChat` in `api/app.ts`): Meta integration setting `commentReplyMode` = private | public | both. Public text is checked by a guard (no phone/account numbers, emails, links, payment/identity words, max 400 chars). In `both` mode the public note is sent only after the private message was confirmed.
- **WhatsApp templates** (`api/whatsapp.ts`, routes): create/sync/delete, status via webhook `message_template_status_update`, send APPROVED text templates to a conversation (also after the 24 h window), marketing needs recorded opt-in. UI: Integrations tab + send box in Customers.
- **LLM assistant** (`api/llmAgent.ts`, `api/llmTools.ts`): real tool-calling loop (OpenAI-compatible `tools`), 8 tools (6 read-only/pure, 2 proposal-only), argument validation, step/tool/time limits, repeated-call guard, results wrapped as untrusted data, tenant fixed by the server, token + optional cost tracking, usage counted against the plan's AI limit. Proposals wait for approval in Agent history; only in Full mode a category change auto-applies when the rule-based classifier independently agrees. Price changes never auto-apply and can never go below wholesale (re-checked at apply time).
- **Marketplace CSV** (`api/marketplaceCsv.ts`): RFC-4180 parser (quoted newlines, `;`/tab delimiters), alias-based column mapping + manual overrides, currency conversion with your PKR rate + duty % + shipping, "10K+ sold" / "96%" parsing, restricted-product rejection, duplicate check by id/link/name, quality gate modes, preview then import into drafts. UI: Integrations -> AliExpress / Temu / Daraz.
Bug-prone spots to check first when you run it: Fastify `reply.redirect` in the OAuth callback, zod v4 `partialRecord`, PGlite handling of `= ANY($2::text[])` in template sync.

### Round 13 (2026-11-05): all mock / show-off UI removed, real flow only
- Removed from `src/App.tsx`: sample products and orders (Unsplash images, "Aura LED Desk Lamp", ...), fake revenue chart and numbers (Rs. 284,520, 1,284 orders, 248 products), fake agent rows, `GenericPage` cards with invented metrics, hard-coded names ("Nova Commerce", "Zubair Shah"), fake order badge, dead search box, dead Filters/Sort/Categories/Published buttons, fake date.
- A real product with no image no longer shows a stock photo (it shows its first letter; uploaded `image_url` is used when present).
- Signed-out users see a sign-in prompt only. No page shows data that is not in the database.
- New real Overview: live counts from `/api/analytics/summary`, recent real orders, and a 6-step checklist of the actual flow (Markaz products -> profit -> Buffer accounts -> approved posts -> scheduled posts -> customer chat -> orders to Markaz). A step is "done" only when real data exists.
- Product list: working All / Low stock / Out of stock tabs and search. Settings: real account info (super admin keeps tenant/billing panels). Sources page explains CSV-only import and links to Integrations.
- Verified: syntax check, 87 pure-logic tests pass (ai.test.ts and integration.test.ts need `npm ci`). NOT verified: real-library TypeScript build of the edited `src/App.tsx`.
- **Content provider:** the default (`AI_PROVIDER=template`) is `TemplateContentProvider`: it writes the post from your own product data only (name, price, your description, "order by message"). `AI_PROVIDER=openai` still works with a key.
- **Autopilot** (`api/autopilot.ts`, `api/autopilotRoutes.ts`, `db/010_autopilot.sql`, `src/Autopilot.tsx`): for every connected account it fills the free daily slots (spread 10:00-21:00 in BUSINESS_TIMEZONE) with products that match the account category, are in stock, have an image where Instagram/TikTok need one, and were never scheduled for that account before (oldest-posted product first = rotation). It writes the post from product data, then schedules it and sends through Buffer/TikTok (status becomes sent only when they confirm). In approval/manual mode the posts wait for your approval; in hybrid/full they are approved automatically. `PUT /api/autopilot` turns the hourly automatic run on; `POST /api/autopilot/run` runs it now. The monthly content limit of the plan applies.
- Verified here (ran): all 10 migrations apply twice on real PostgreSQL 16 (this also covers migrations 008 and 009 for the first time); the Autopilot SQL statements prepare and the Karachi time conversion is correct; 90 pure-logic tests pass (`tests/autopilot.test.ts` 3 new). NOT verified: `npm ci`, TypeScript build, Fastify runtime, the new integration test, live Buffer/TikTok/Meta.

### Round 15 (2026-11-07): Markaz Studio, the real local flow with free services
Verified here (ran): 110 pure-logic tests pass (new: `tests/markaz.test.ts` 12, `tests/freechannels.test.ts` 9). Migration 011 applied twice on real PostgreSQL 16 together with 001-010, and all 16 new SQL statements prepare there. The new API modules and `src/Studio.tsx` type-check against shims (only shim artifacts remained). NOT verified: `npm ci` + real build, Fastify runtime of the new routes, PGlite with the new SQL, and every live service (markaz.app, Bluesky, Mastodon, Discord, Buffer). The authoring environment had no internet.
- **Markaz scraper** (`api/markaz.ts`, `POST /api/markaz/scrape`): paste a markaz.app category or product link. It finds product links, opens each product page one at a time (800 ms pause, max 30 products), reads name/price/image from JSON-LD, then OG tags/h1/page text, then `__NEXT_DATA__`, and shows a PREVIEW. Only then "Add to my catalog" saves products (source `markaz`, your profit added, duplicates skipped by Markaz id and name). If Markaz blocks the request or changes its pages the screen says what was missing. Markaz pages show no rating or sold count, so the quality gate is off by default for this flow; stock is "Only N left" if the page says so, else the number you choose.
- **Free channels** (`api/freeChannels.ts`, `/api/channels`): Bluesky (AT Protocol), Mastodon, Discord (webhook). A channel is saved only after the service confirmed the credentials (bot is channel admin, login works, webhook exists). Posts are sent with image; Bluesky/Mastodon download and upload the image (Bluesky accepts about 1 MB, otherwise it posts text only and tells you). A job becomes `published` only when the service returns an id.
- **Scheduling without a paid tool**: for these channels a future time is stored as `scheduled_local`; a 30-second timer in `api/server.ts` sends it when due while the app is running. Posts interrupted by a crash are marked failed, never silently resent.
- **Post a product** (`POST /api/products/:id/post`): writes the post from product data (template provider, or free Gemini/Groq through `AI_PROVIDER=openai`), pressing Post is the approval, checks stock, category, daily limit, duplicates and plan limit, then sends or schedules to the chosen accounts (free channels and Buffer accounts alike).
- **UI**: new page "Markaz Studio" (`src/Studio.tsx`): Step 1 channels, Step 2 Markaz, Step 3 post. The Overview checklist points there.
- Known limits: one connection per channel type (one Bluesky, one Mastodon...). Markaz scraping depends on Markaz's public page layout and may need a small fix after the first real run: send me the error text.

### Round 15b (2026-11-07): two bugs found by the first real run of "Post now"
- Buffer: "Scheduled time must be in the future". "Post now" sent the current time as a customScheduled time. Now a time that is now or past is sent with `mode: shareNow`; future times still use customScheduled. Test added (and the old test no longer uses a fixed date).
- AI wording: "The AI wrote a number that is not in your product data" blocked a post (the product name has "9 Massage Head"). Numbers that are part of the product's own name/description are now allowed, and if the AI still fails the post is built from the product data only (template) instead of being blocked. The draft's disclaimer says so.

### Round 15c (2026-11-07): Buffer "Facebook posts require a type"
Found by the first live Buffer post (the earlier timing fix worked: Buffer accepted shareNow and reached validation). Buffer needs `metadata: { facebook: { type: post } }` (Instagram: `metadata: { instagram: { type: post, shouldShareToFeed: true } }`). Syntax taken from developers.buffer.com (PostInputMetaData lists the per-network fields; the error text names post/story/reel). The Instagram field names were not verified live. Test added.


## Round 14

- Telegram removed (code, UI, tests, docs).
- Markaz auto mode (`api/markazAuto.ts`, migration `012_markaz_auto.sql`, Studio card "Auto mode"): saved Markaz links are read every 3 hours, new products are saved with your profit, Autopilot writes posts (name, price, category, details) and sends them. Turning it ON is the approval. `POST /api/markaz/auto/run` runs it now.
- Not verified here: `npm ci`, build, live Markaz, live channels (no internet in the authoring environment).

## Round 16 (2026-11-12): AI makes the order itself, Markaz hand-off text ready automatically
- New `api/chatOrder.ts`: `createOrderFromChat` (the old create-order route logic, now shared), `markazSummaryText`, `autoOrderFromChat`.
- Facebook/Instagram DM and WhatsApp chats in **auto** mode: when the customer asked to order and has given name, phone, city, address and quantity (labelled lines such as `Name: ...`, over one or several messages) for an in-stock product, the order is created automatically (stock reduced, customer saved with real phone/address), the customer gets a confirmation message, and a notification "Naya order: Markaz ko dene ke liye tayyar" carries the full Markaz text (product link, quantity, customer name, phone, city, address, payment, margin). A missing detail is never guessed; the assistant asks only for what is still missing. A duplicate order for the same product in the same chat within 24 hours is not created. Comments never create orders.
- Markaz has no public order API: the order is NOT submitted to Markaz automatically. The owner copies the text from the notification or the Customers page and places it in Markaz.
- Approval/manual modes are unchanged (owner presses "Create order").
- Tests: `tests/chatorder.test.ts` (4 new). All 114 pure tests pass here (run with node --experimental-transform-types). NOT verified: `npm ci`, real build, Fastify/PGlite runtime of the new code, live Meta/WhatsApp.
