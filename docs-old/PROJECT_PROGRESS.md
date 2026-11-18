# Project progress

## Completed

- Colorful responsive React/Vite SaaS workspace UI with dashboard, catalog, sources, content, publishing, orders, customers, analytics, billing, team, and settings views.
- Fastify API with Helmet, CORS, rate limiting, Zod validation, JWT authentication, bcrypt password hashing, and health check.
- PostgreSQL schema for tenants, users, products, sources, customers, orders, plans, subscriptions, usage, content drafts, social accounts, payment verifications, supplier orders, publishing jobs, and audit logs.
- Tenant-scoped product, source, order, pricing, subscription, content, social, payment, supplier, and publishing API boundaries.
- BullMQ/Redis workflow queue with retries, exponential backoff, cleanup, idempotency keys, and worker boundary.
- Frontend API client with real API health detection, workspace login/registration, persisted token state, and tenant-scoped live product loading.
- Product catalog UI now supports authenticated live create, edit, delete, search, and CSV import workflows.
- Orders UI now loads live tenant orders, creates manual orders with stock reservation, and submits explicit payment-verification and supplier-review requests.
- Manual customer inbox now stores tenant-scoped conversations and messages; outbound messages remain drafts until human approval and an official channel adapter exists.
- Payment verification and supplier workflows now expose history plus manager-only approval/rejection endpoints with audit logs.
- AI provider selection now supports an explicit mock default and an optional server-side OpenAI-compatible adapter with strict response validation.
- Content Studio is now connected to the authenticated generation endpoint and displays saved review-required drafts.
- Pricing unit tests and clean runtime dependency audit.
- Zero-setup local runtime using embedded PGlite, in-memory queue fallback, automatic migrations, and a persistent generated development JWT secret.

## Partially complete

- Authentication UI is connected to the API, but refresh-token rotation, email verification, password recovery, and session revocation remain.
- Product catalog can load live API products and now has authenticated add/edit/delete/search/CSV import UI actions.
- Content generation has a provider-independent mock adapter and queued boundary; real LLM providers need configured credentials.
- Social, supplier, and payment workflows have safe adapter boundaries; official OAuth/provider adapters are not connected.
- OpenAI-compatible AI remains unverified until a valid key and controlled generation test succeed.
- Manual payment verification and supplier review requests are connected to the API, with manager-only decisions and audit history; they do not claim payment or fulfillment success.
- Subscription plans and starter provisioning exist; checkout, invoices, coupons, renewals, and webhooks remain.

## Missing or blocked

- Production PostgreSQL/Redis integration tests require configured services; local development does not.
- Provider credentials, approvals, and webhooks are required for real supplier, social, payment, and LLM operation.
- Super Admin analytics and tenant management UI/API.
- Customer support inbox and conversation/event model.
- File upload storage, OCR, exports, backups, monitoring, and Railway/GitHub Actions deployment.

## Current task

Begin Phase 2 provider integration planning after the manual-first MVP verification.

## Verification

- `npm run build` passes.
- `npm run api:build` passes.
- `npm run test:pricing` passes.
- `npm run build` passes after product CRUD/import UI wiring.
- `npm run build` passes after live orders and manual workflow UI wiring.
- `npm run api:build` passes after approval and conversation endpoints.
- `npm run db:migrate` applies the conversation schema locally.
- `git diff --check` passes.
- `npm run test:pricing` passes with the mock AI regression test (5 tests).
- `npm run api:build` passes after the AI adapter/configuration changes.
- `npm run build` passes after Content Studio UI/API wiring.
- `npm run test:pricing` passes with 5 regression tests.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- `GET http://localhost:4000/health` returns HTTP 200 when the API is running.

## Next development steps

1. Add provider-specific integration tests and official OAuth adapters when credentials and approvals are available.
2. Select one AI provider and one product source for Phase 2.
3. Implement refresh-token/session lifecycle and email recovery.
4. Add subscription checkout abstraction, usage enforcement, and admin controls.
5. Add official provider adapter configuration and deployment automation.
