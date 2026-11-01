# Development status

## Complete

- Stage 1 UI prototype with responsive navigation and colorful commercial SaaS styling.
- Vite production build.
- Fastify API foundation and `/health` endpoint.
- PostgreSQL initial migration.
- Tenant-aware registration, login, `/api/me`, and product CRUD endpoints.
- Docker Compose development infrastructure.
- Frontend API client with authenticated workspace login/registration, API health status, persisted session state, and live product catalog loading.
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

## In progress

- Database-backed auth integration with the UI.
- Product source adapters, import history, and background queues.
- Durable Redis/BullMQ workers, retries, idempotency, and monitoring.
- Payment verification, supplier workflows, publishing jobs, and platform-specific OAuth adapters.
- UI authentication and live API data integration.
- Product create/edit/delete actions in the UI and live order/subscription panels.
- End-to-end tenant, authentication, subscription, payment, and order tests against PostgreSQL.

## Not yet enabled

No supplier, social, payment, or AI provider is claimed to be operational until credentials, permissions, and live verification are completed.
