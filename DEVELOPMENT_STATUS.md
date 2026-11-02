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
