# Environment variables

Never commit real values. Copy `.env.example` to `.env` for local overrides.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| NODE_ENV | no | development | `production` enforces the three variables below |
| API_PORT | no | 4000 | API listen port |
| DATABASE_URL | production | embedded PGlite | PostgreSQL connection string. `localhost` URLs are ignored outside production |
| REDIS_URL | production | in-memory queue | Redis for BullMQ workers |
| JWT_SECRET | production | generated in `.orbitly/dev-secret` | 32+ random characters. Required in production |
| JWT_EXPIRES_IN | no | 15m | Access token lifetime |
| INTEGRATION_ENCRYPTION_KEY | production | derived from JWT_SECRET in development | 64 hex chars (`openssl rand -hex 32`) that encrypts stored API keys. Changing it makes stored keys unreadable |
| BUSINESS_TIMEZONE | no | Asia/Karachi | IANA timezone that defines a "day" for daily posting limits |
| APP_URL | no | http://localhost:5173 | Base URL used in verification and reset links |
| CORS_ORIGIN | no | http://localhost:5173 | Allowed frontend origin |
| LOCAL_DB_PATH | no | .orbitly/pglite | PGlite data dir. `memory://` is used by tests |
| AI_PROVIDER | no | template | `template` or `openai` |
| AI_API_KEY | when AI_PROVIDER=openai | none | Server-side only |
| AI_MODEL | no | gpt-4o-mini | Model name |
| AI_BASE_URL | no | https://api.openai.com/v1 | OpenAI-compatible endpoint |
| VITE_API_URL | frontend build | http://localhost:4000 | API URL baked into the frontend build |
| META_APP_SECRET | for customer chat | none | Meta app secret. Used to verify that webhook calls really come from Meta (HMAC). Without it the webhook answers 503 |
| META_VERIFY_TOKEN | for customer chat | none | A random string you choose; paste the same value in Meta's webhook setup |
| META_GRAPH_VERSION | no | v23.0 | Graph API version used to send replies. Check developers.facebook.com for the current version |
| MAIL_PROVIDER | no | none | `none` or `resend`. With `none` no email is delivered |
| RESEND_API_KEY | when MAIL_PROVIDER=resend | none | Resend API key. The sender domain must be verified in Resend |
| MAIL_FROM | no | Orbitly <no-reply@example.com> | Sender shown on emails |
| STRIPE_SECRET_KEY | for card payments | none | Stripe secret key. Without it `POST /api/billing/checkout` answers 503 |
| STRIPE_WEBHOOK_SECRET | for card payments | none | Signing secret of the webhook `https://YOUR-API-HOST/webhooks/stripe` (event `checkout.session.completed`) |
| STORAGE_PROVIDER | no | database | `database` (default) or `s3` |
| S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | when STORAGE_PROVIDER=s3 | none | Any S3-compatible bucket (path-style URLs) |
| S3_PUBLIC_BASE_URL | when STORAGE_PROVIDER=s3 | none | Public base URL of the bucket or CDN. Product images are served from here |
| GOOGLE_SERVICE_ACCOUNT_JSON | for Sheets sync | none | Service-account JSON on one line. Share the sheet with its `client_email` |
| OCR_PROVIDER | no | none | `none` or `openai_vision`. OCR output is only a hint and never verifies a payment |
| OCR_MODEL | no | gpt-4o-mini | Vision-capable model name |
| PUBLIC_API_URL | for OAuth login | none | Public https URL of this API. OAuth redirect URLs are `PUBLIC_API_URL/api/oauth/meta/callback` and `.../tiktok/callback`: add them in the Meta / TikTok developer apps |
| META_APP_ID | for Facebook/Instagram login | none | Numeric Meta App ID (the secret is META_APP_SECRET) |
| META_OAUTH_SCOPES | no | built-in list | Comma-separated Meta permissions to ask for. Several need App Review |
| TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET | for TikTok login | none | From your TikTok developer app |
| TIKTOK_OAUTH_SCOPES | no | user.info.basic,video.publish | Scopes requested at TikTok login |
| AI_PRICE_INPUT_PER_1M / AI_PRICE_OUTPUT_PER_1M | no | none | USD per 1M tokens. Only used to estimate the cost of AI assistant runs; without them cost shows 0 (tokens are always counted) |
