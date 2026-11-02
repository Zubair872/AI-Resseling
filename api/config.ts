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
  LOCAL_DB_PATH: z.string().min(1).default('.orbitly/local'),
  JWT_SECRET: z.string().min(32).default(developmentSecret()),
  JWT_EXPIRES_IN: z.string().default('15m'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  REDIS_URL: z.string().url().optional(),
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
})

const environment = { ...process.env }
for (const key of ['DATABASE_URL', 'REDIS_URL', 'AI_API_KEY']) {
  if (environment[key] === '') delete environment[key]
}
if ((environment.NODE_ENV ?? 'development') !== 'production') {
  if (localServiceUrl(environment.DATABASE_URL)) delete environment.DATABASE_URL
  if (localServiceUrl(environment.REDIS_URL)) delete environment.REDIS_URL
}

const parsed = configSchema.safeParse(environment)
if (!parsed.success) throw new Error(`Invalid environment configuration: ${parsed.error.message}`)

export const config = parsed.data

if (config.NODE_ENV === 'production' && (!process.env.JWT_SECRET || !config.DATABASE_URL || !config.REDIS_URL)) {
  throw new Error('Production requires explicit JWT_SECRET, DATABASE_URL, and REDIS_URL')
}
