# Security

- Passwords are hashed with bcrypt; plaintext passwords are never persisted.
- JWTs are signed with a server-only secret and expire quickly.
- Fastify Helmet, CORS, and rate limiting are enabled on the API.
- Request bodies are validated with Zod before database writes.
- SQL uses parameterized queries.
- Product reads and writes are scoped to the authenticated tenant.
- OAuth tokens, payment credentials, and provider secrets must be stored encrypted before integrations are enabled.
- Production must use HTTPS, a managed secret store, database backups, audit-log retention, and a restricted CORS origin.

Run `npm audit --omit=dev` during release checks. Current dependency review reports a Zod advisory that requires a breaking major-version upgrade; it must be handled with compatibility testing before production release.
