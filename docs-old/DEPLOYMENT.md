# Deployment

Status: configuration files are written but have NOT been deployed or build-tested yet. Run the CI steps locally first.

## Before deploying
1. `npm ci && npm run api:build && npm run build && npm run test:pricing && npm run test:integration`
2. Provision PostgreSQL and Redis (Railway plugins or any managed service).

## Railway (API)
1. New service from this repo. `railway.json` selects `Dockerfile` and `/health` as healthcheck.
2. Set variables: `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (random 32+ chars), `INTEGRATION_ENCRYPTION_KEY` (`openssl rand -hex 32`, keep a backup), `CORS_ORIGIN` (frontend URL), optional `AI_*`.
3. Migrations run automatically at API start (`db/001_initial.sql`, `db/002_rules.sql`, idempotent).

## Railway (worker)
Second service from the same repo, same variables, start command override: `node dist-api/api/worker.js`.

## Frontend
Build with `Dockerfile.web` (`--build-arg VITE_API_URL=<api url>`) or deploy `dist/` to any static host.

## Super admin
There is no signup path for `super_admin`. After registering your own account run once in the database:
`UPDATE users SET role = 'super_admin' WHERE email = 'you@example.com';`

## Buffer
After deploying, open Integrations, add your Buffer API key (publish.buffer.com/settings/api), press Test connection, then Sync channels. Buffer API limits depend on your Buffer plan. Buffer cannot read comments or upload media: product images must be public URLs.

## Backups and recovery
Use the managed PostgreSQL provider's automated backups and test a restore before launch. Not automated by this repo yet.

## External access still required
Meta, TikTok, WhatsApp, supplier, payment and LLM providers need your own credentials and platform approvals. None is verified.

## Meta customer chat (Facebook Messenger + Instagram DM)

Written from Meta's documentation, NOT yet tested against a live Meta app. Menu names in Meta's dashboard change, so follow developers.facebook.com if a label differs.

1. Create a Meta developer app (developers.facebook.com) and add the Messenger product. For Instagram, link the Instagram Professional account to your Facebook Page and add Instagram messaging.
2. Own accounts only (Personal Mode): Standard Access is enough and App Review is not needed. Serving other businesses' accounts (SaaS Mode) needs Advanced Access: App Review plus Business Verification.
3. Permissions used for Messenger: pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement, business_management. For Instagram also instagram_basic and instagram_manage_messages.
4. The API must be reachable over public HTTPS. Set `META_APP_SECRET` and `META_VERIFY_TOKEN` (see ENVIRONMENT_VARIABLES.md).
5. In the app's webhook settings use callback URL `https://YOUR-API-HOST/webhooks/meta`, the same verify token, and subscribe the Page (object `page`) and, for Instagram, object `instagram` to the `messages` field.
6. Create a Page access token and add it in Integrations: provider Meta, Page ID, optional Instagram account ID, AI mode. Press Test connection.
7. Rules the app enforces: replies only within 24 hours of the customer's last message; the assistant answers only from your products table; delivery cost and order confirmation are always left to a human; a message is shown as sent only after Meta confirms it.
8. Comments: also subscribe the Page to the `feed` field (Instagram: `comments`). A new comment creates its own conversation; your reply is sent as ONE private message to the commenter within 7 days (Meta's private reply rule). Public replies under the comment are not built yet. Check Meta's docs for the extra permission private replies need.

## Round 11 setup (all written from official docs, NOT verified against live accounts)

### Email (Resend)
Create an account at resend.com, verify your sending domain, set `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`. An email counts as delivered only if Resend returns a message id.

### WhatsApp Business (Cloud API)
1. In your Meta app add the WhatsApp product, get the **phone number ID** and create a **permanent system-user token** (permissions `whatsapp_business_messaging`, `whatsapp_business_management`).
2. Webhook callback URL `https://YOUR-API-HOST/webhooks/whatsapp`, verify token = `META_VERIFY_TOKEN`, subscribe to the `messages` field. The webhook uses the same `META_APP_SECRET` signature check.
3. In Integrations choose WhatsApp Business, enter phone number ID, token and AI mode, then Test connection.
4. Rules enforced: free-form replies only within 24 hours of the customer's last message (outside that window WhatsApp requires approved templates, which are not built); replies come only from your products table; a message is marked sent only after WhatsApp returns a message id. Business-initiated bulk messaging is not built.

### TikTok
1. Register an app at developers.tiktok.com and request the **Content Posting API** product. Add your image domain under URL properties (photo posts load images from a verified domain).
2. Obtain a user access token with `video.publish` scope (OAuth login flow is NOT built; paste a token you obtained). Tokens expire, so refresh/replace them.
3. Integrations > TikTok > Test connection > Connect TikTok account. Until TikTok audits your app every post is private (`SELF_ONLY`). The job status `submitted_to_tiktok` means TikTok accepted it, not that it is public.

### Stripe card payments for subscriptions
Create a Stripe account that can charge PKR (or change the invoice currency), set `STRIPE_SECRET_KEY`, add a webhook endpoint `https://YOUR-API-HOST/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and set `STRIPE_WEBHOOK_SECRET`. A plan switches on only from a signed webhook whose amount and currency match the invoice. JazzCash/Easypaisa/Safepay can be added behind `BillingProvider` in `api/stripe.ts` once you have merchant credentials.

### S3-compatible storage
Set `STORAGE_PROVIDER=s3` and the S3_* variables. Payment proofs stay private (5-minute signed links). Product images need `S3_PUBLIC_BASE_URL`.

### Google Sheets
Create a Google Cloud service account, enable the Sheets API, put its JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`, share your sheet with the service account email, then use Analytics > Exports and Google Sheets. The tab must already exist; its contents are replaced.

### Payment OCR
`OCR_PROVIDER=openai_vision` enables `POST /api/uploads/:id/ocr`. The result is a hint for the human reviewer and is never marked verified.

## Round 12 setup (written from official docs, NOT verified against live accounts)

### Login-based connect (OAuth)
1. Set `PUBLIC_API_URL` to the public https URL of the API (Railway domain), `APP_URL` to the frontend URL.
2. **Meta**: developers.facebook.com → your app → Facebook Login for Business / Facebook Login → *Valid OAuth Redirect URIs*: add `PUBLIC_API_URL/api/oauth/meta/callback`. Set `META_APP_ID` and `META_APP_SECRET`. In development mode only people with a role on the app (you, testers) can log in; other people need **App Review** for the permissions in `META_OAUTH_SCOPES` and Business Verification.
3. Instagram webhooks (messages, comments) are subscribed in the app dashboard (Webhooks → Instagram); Facebook Page webhooks are subscribed automatically after login (`subscribed_apps`).
4. **TikTok**: developers.tiktok.com → your app → Login Kit → add redirect URI `PUBLIC_API_URL/api/oauth/tiktok/callback`; add the Content Posting API product. Set `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`. Until the app is audited, posts are private (SELF_ONLY). Tokens last about 24 h and are refreshed automatically; if the refresh token expires (about a year) press *Connect TikTok* again.
5. In the app: Integrations → *Connect Facebook / Instagram* (pick the Page) or *Connect TikTok*.

### Public comment replies
Integrations → Meta connection → *Comments*: `private` (default, one private message per comment), `public` (short, safe public reply; falls back to private if no safe text exists) or `both` (private message first, then a short public note only after the private message was confirmed). Public replies are blocked if they contain phone/account numbers, emails, links or payment details. Needs `pages_manage_engagement` (Facebook) and `instagram_manage_comments` (Instagram).

### WhatsApp templates
Add `wabaId` (WhatsApp Business Account ID, Meta Business Settings → WhatsApp accounts) to the WhatsApp connection. Webhook field `message_template_status_update` must be subscribed (WhatsApp → Configuration → Webhook fields) so approval/rejection shows up automatically; *Sync from Meta* also works. Marketing templates need a recorded customer opt-in.

### AI assistant (LLM tool calling)
Set `AI_PROVIDER=openai`, `AI_API_KEY` (and `AI_BASE_URL`/`AI_MODEL` for another OpenAI-compatible provider that supports `tools`). Runs count against the monthly AI action limit of the plan.

### AliExpress / Temu / Daraz CSV import
Integrations → *AliExpress / Temu / Daraz*. No credentials are needed because you upload a file. Automatic API import needs partner approval (AliExpress affiliate/dropshipping API, Daraz Open Platform): not built, see EXTERNAL_TODO.md.
