# External work that only you can do

Everything below needs your accounts, keys, approvals or a machine with internet. The code for each is written; none is verified live.

## Do this first (5 minutes, on your PC)
1. `npm ci`
2. `npm run verify`  (builds API + web and runs all tests, including the integration tests never run before)
3. Send me any error text and I will fix it.

## Accounts and approvals
| Item | What you do | Where in the repo |
|---|---|---|
| PostgreSQL + Redis | Create on Railway, set DATABASE_URL, REDIS_URL, JWT_SECRET, INTEGRATION_ENCRYPTION_KEY | DEPLOYMENT.md |
| Super Admin | After registering, run `UPDATE users SET role='super_admin' WHERE email='you@example.com';` | DEPLOYMENT.md |
| Email | Resend account + verified domain | DEPLOYMENT.md "Email" |
| AI | OpenAI-compatible key (AI_PROVIDER=openai) | ENVIRONMENT_VARIABLES.md |
| Facebook/Instagram chat | Meta app, Page token, webhook; App Review + Business Verification for SaaS mode | DEPLOYMENT.md "Meta customer chat" |
| WhatsApp | WhatsApp product, phone number ID, permanent token, templates for messages after 24h | DEPLOYMENT.md "WhatsApp" |
| TikTok | Developer app + Content Posting API approval + app audit (else posts are private); OAuth login flow is not built | DEPLOYMENT.md "TikTok" |
| Buffer | API key (organization owner) | DEPLOYMENT.md "Buffer" |
| Card payments | Stripe account + webhook | DEPLOYMENT.md "Stripe" |
| JazzCash / Easypaisa | Merchant accounts; then implement `BillingProvider` | api/stripe.ts |
| Storage | S3/R2/B2 bucket | DEPLOYMENT.md "S3" |
| Google Sheets | Service account | DEPLOYMENT.md "Google Sheets" |
| Suppliers | Markaz/HHC/Zaroori have no public API found: CSV/manual. AliExpress/Daraz need affiliate/partner API approval | api/sourcing.ts |
| Domain, HTTPS, backups | Railway custom domain; enable managed DB backups and test a restore | DEPLOYMENT.md |
| Legal | Privacy policy and terms pages (required by Meta/TikTok review) | not in repo |

## Added in round 12 (what you must do so these work for real)
| Item | What you do |
|---|---|
| Meta login (OAuth) | Create/choose the Meta app, set META_APP_ID + META_APP_SECRET + PUBLIC_API_URL, add the redirect URI, add Facebook Login + Messenger + Instagram + Webhooks products. Without App Review only you and testers can log in. Submit App Review (with privacy policy, screencasts) for: pages_messaging, pages_manage_engagement, pages_read_engagement, instagram_manage_messages, instagram_manage_comments |
| TikTok login | TikTok developer app with Login Kit + Content Posting API; redirect URI; app audit before posts can be public |
| Public comment replies | Same Meta permissions as above (pages_manage_engagement / instagram_manage_comments) |
| WhatsApp templates | WABA ID in the WhatsApp connection; subscribe webhook field message_template_status_update; write real, honest templates; collect and record customer opt-in before marketing messages |
| AI assistant | Paid AI key (AI_PROVIDER=openai + AI_API_KEY) whose model supports tool calling |
| AliExpress / Daraz APIs | Optional later: AliExpress affiliate / DS API and Daraz Open Platform need partner approval. Today: CSV only. Temu has no public API |

## Known code limits (honest list)
- OAuth login exists for Meta (Facebook + Instagram) and TikTok. WhatsApp "Embedded Signup" (customers connecting their own WhatsApp number by login) is NOT built: the WhatsApp token is still pasted.
- The 4 rule-based agents stay rule-based; the new AI assistant is a real LLM tool-calling agent (read tools + proposal-only writes).
- WhatsApp templates: text-only templates (no buttons/media headers/header variables). Bulk marketing campaigns are not built.
- Public comment replies exist; Instagram/Facebook rate limits and spam filters can still hide replies.
- AliExpress/Temu/Daraz: CSV import only (header names are matched by aliases and NOT verified against real exports; use the preview and the column overrides). No API sync, no automatic purchasing.
- Direct Facebook/Instagram publishing through Meta (without Buffer) is still not built.
- Not yet verified: real-library TypeScript build, Fastify runtime, 5+ integration tests, all live providers.

## Added in round 15 (free local flow)
| Item | What you do |
|---|---|
| Bluesky | Settings -> Privacy and security -> App passwords. Use handle + app password. |
| Mastodon | Preferences -> Development -> New application (write:statuses, write:media). Use server address + access token. |
| Discord | Channel -> Edit -> Integrations -> Webhooks -> copy URL. |
| Facebook / Instagram / TikTok | Through Buffer (free plan: 3 channels). Integrations -> Buffer key -> Sync channels. |
| Free AI wording (optional) | Gemini or Groq free key in `.env` (see `.env.example`, Round 15 block). Without it the post is built from your product data. |
| First real Markaz run | Markaz Studio -> paste a category link -> Preview. If it fails, copy the red text and send it to me. |

## Added in round 16
| Item | What you do |
|---|---|
| Auto orders | Integrations -> Meta / WhatsApp -> set AI mode to `auto`. Customers must send details as labelled lines (Name:, Phone:, City:, Address:, Qty:); the assistant asks for them. |
| Markaz hand-off | Open the notification "Naya order: Markaz ko dene ke liye tayyar", copy the text, place the order in Markaz. No Markaz API exists to do this automatically. |
