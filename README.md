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

## Local development

1. Copy `.env.example` to `.env`.
2. Start infrastructure: `docker compose up -d`.
3. Apply the schema: `npm run db:migrate`.
4. Start the API: `npm run api:dev`.
5. In another terminal, start the UI: `npm run dev`.

The UI runs on `http://localhost:5173` and the API runs on `http://localhost:4000`.

Set `VITE_API_URL` before building the frontend when the API is hosted elsewhere:

```powershell
$env:VITE_API_URL = "https://api.example.com"
npm run build
```

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

## Verification

```powershell
npm run build
npm run api:build
npm run test:pricing
```

Production deployment must provide a strong `JWT_SECRET`, managed PostgreSQL, Redis, approved provider credentials, backups, and HTTPS.
