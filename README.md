# Orbitly AI Commerce Platform

Orbitly is a multi-tenant AI commerce operations platform for product sourcing, catalog management, pricing, content workflows, publishing, orders, and SaaS workspaces.

## Current production milestone

- Colorful responsive React workspace UI.
- Fastify API with security headers, CORS, rate limiting, structured request logging, and health checks.
- PostgreSQL schema for tenants, users, products, and audit logs.
- Password hashing with bcrypt and short-lived JWT access tokens.
- Tenant-scoped product listing and creation endpoints.
- Pricing, sources, orders, subscriptions, content drafts, usage, and social-account endpoints.
- Docker Compose services for PostgreSQL and Redis.

External supplier, social, payment, and AI provider integrations remain adapter-based and require approved credentials before they are enabled.

AI content defaults to a clearly marked local mock. To enable a real
OpenAI-compatible provider, set `AI_PROVIDER=openai` and `AI_API_KEY` in the
server environment only; never expose the key in the frontend or commit it.

## Zero-setup local development

Development uses an embedded PGlite database at `.orbitly/local`, an in-memory workflow queue, and an automatically generated persistent JWT secret at `.orbitly/dev-secret`. Docker, PostgreSQL, Redis, Neon, Upstash, and a `.env` file are not required. The API applies migrations automatically at startup.

If an old development `.env` contains `localhost` PostgreSQL or Redis URLs, they are ignored automatically so the embedded database and in-memory queue remain zero-setup. Production and non-local managed URLs are still honored.

Run these two commands in separate terminals:

```powershell
npm run api:dev
npm run dev
```

The UI runs on `http://localhost:5173` and the API runs on `http://localhost:4000`.

The workspace avatar opens the real login/registration flow. After authentication, the catalog requests tenant-scoped products from the API.

## API endpoints

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me` with a bearer token
- `GET /api/products` with a bearer token
- `POST /api/products` with a bearer token
- `POST /api/pricing/calculate` with a bearer token
- `GET /api/plans`
- `GET /api/subscription` with a bearer token
- `POST /api/content/generate` with a bearer token
- `GET /api/social-accounts` with a bearer token
- `POST /api/payments/verification-requests` with a bearer token
- `POST /api/supplier-orders` with a bearer token
- `POST /api/publishing/jobs` with a bearer token

Build and test scripts remain available in `package.json` for CI and release verification.

Production can override the embedded defaults by providing `DATABASE_URL`, `REDIS_URL`, and an explicit strong `JWT_SECRET`. Production still requires approved provider credentials, backups, and HTTPS.
