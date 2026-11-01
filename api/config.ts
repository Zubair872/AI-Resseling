import 'dotenv/config'
import { z } from 'zod'

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('postgres://orbitly:orbitly@localhost:5432/orbitly'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters').default('development-only-secret-change-me-123456'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
})

const parsed = configSchema.safeParse(process.env)
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
}

export const config = parsed.data

if (config.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be explicitly configured with at least 32 characters in production')
}
