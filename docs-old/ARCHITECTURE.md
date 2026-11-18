# Architecture

Orbitly starts as a modular monolith so tenant isolation and business workflows remain easy to reason about while usage grows.

## Runtime layers

- `src/`: React/Vite workspace UI and prototype interaction layer.
- `api/`: Fastify HTTP API, configuration, authentication, and database access.
- `db/`: ordered PostgreSQL migrations.
- Redis/BullMQ: reserved for durable import, content, publishing, and notification jobs.
- Provider adapters: isolated modules for suppliers, social networks, payment processors, and LLMs.

## Tenant isolation

Every tenant-owned row carries `tenant_id`. Authenticated requests derive the tenant from the verified JWT rather than accepting a tenant identifier from the client. Every repository query must include that tenant boundary.

## Sensitive workflows

Payment verification, refunds, supplier purchases, and publishing are approval-aware workflows. They must never be treated as successful until the external provider confirms the operation.
