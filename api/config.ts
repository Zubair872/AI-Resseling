import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

function localServiceUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  } catch {
    return false
  }
}

function developmentSecret() {
  const path = resolve('.orbitly/dev-secret')
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  mkdirSync(dirname(path), { recursive: true })
  const secret = randomBytes(32).toString('hex')
  writeFileSync(path, secret, { encoding: 'utf8', mode: 0o600 })
  return secret
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  LOCAL_DB_PATH: z.string().min(1).default('.orbitly/pglite'),
  JWT_SECRET: z.string().min(32).default(developmentSecret()),
  JWT_EXPIRES_IN: z.string().default('15m'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  INTEGRATION_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters').optional(),
  BUSINESS_TIMEZONE: z.string().min(3).default('Asia/Karachi'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  AI_PROVIDER: z.enum(['template', 'openai']).default('template'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  META_APP_ID: z.string().regex(/^\d{5,30}$/, 'must be the numeric Meta App ID').optional(),
  META_APP_SECRET: z.string().min(8).optional(),
  META_OAUTH_SCOPES: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().min(5).optional(),
  TIKTOK_CLIENT_SECRET: z.string().min(8).optional(),
  TIKTOK_OAUTH_SCOPES: z.string().optional(),
  AI_PRICE_INPUT_PER_1M: z.coerce.number().nonnegative().optional(),
  AI_PRICE_OUTPUT_PER_1M: z.coerce.number().nonnegative().optional(),
  META_VERIFY_TOKEN: z.string().min(8).optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  MAIL_PROVIDER: z.enum(['none', 'resend']).default('none'),
  RESEND_API_KEY: z.string().min(8).optional(),
  MAIL_FROM: z.string().min(3).default('Orbitly <no-reply@example.com>'),
  STRIPE_SECRET_KEY: z.string().min(8).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(8).optional(),
  STORAGE_PROVIDER: z.enum(['database', 's3']).default('database'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(20).optional(),
  OCR_PROVIDER: z.enum(['none', 'openai_vision']).default('none'),
  OCR_MODEL: z.string().min(1).default('gpt-4o-mini'),
})

const environment = { ...process.env }
for (const key of ['META_APP_ID', 'META_OAUTH_SCOPES', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_OAUTH_SCOPES', 'AI_PRICE_INPUT_PER_1M', 'AI_PRICE_OUTPUT_PER_1M', 'PUBLIC_API_URL', 'DATABASE_URL', 'REDIS_URL', 'AI_API_KEY', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
  if (environment[key] === '') delete environment[key]
}
if ((environment.NODE_ENV ?? 'development') !== 'production') {
  if (localServiceUrl(environment.DATABASE_URL)) delete environment.DATABASE_URL
  if (localServiceUrl(environment.REDIS_URL)) delete environment.REDIS_URL
}

const parsed = configSchema.safeParse(environment)
if (!parsed.success) throw new Error(`Invalid environment configuration: ${parsed.error.message}`)

export const config = parsed.data

if (config.NODE_ENV === 'production' && (!process.env.JWT_SECRET || !config.DATABASE_URL || !config.REDIS_URL || !config.INTEGRATION_ENCRYPTION_KEY)) {
  throw new Error('Production requires explicit JWT_SECRET, DATABASE_URL, REDIS_URL, and INTEGRATION_ENCRYPTION_KEY')
}
