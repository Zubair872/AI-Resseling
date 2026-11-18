import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { checkApiReachable } from './reachability.js'
import { config } from './config.js'
import { comparePassword, createRefreshToken, hashPassword, hashRefreshToken, signToken, verifyToken, type AuthUser } from './auth.js'
import { query } from './db.js'
import { calculatePrice } from './pricing.js'
import { AIProviderError, getContentProvider } from './ai.js'
import { AuthorizationRequiredSupplier, ManualPaymentProvider } from './providers.js'
import { enqueueWorkflow } from './queue.js'
import { parseProductCsv, type ProductImportRow } from './csv.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { applyMigration } from './migration.js'
import { validatePublish } from './scheduler.js'
import { checkLimit } from './limits.js'
import { createOneTimeToken, hashOneTimeToken, tokenTtlMinutes, type AuthTokenKind } from './tokens.js'
import { mailer } from './mailer.js'
import { createNotification } from './notifications.js'
import { toCsv } from './csvExport.js'
import { createHash } from 'node:crypto'
import { decryptSecret, encryptSecret, secretHint } from './secrets.js'
import { applyProfit, defaultProfit, defaultSourcingRules, evaluateCandidate, parseSourcingCsv, type ProfitConfig, type SourcingRules } from './sourcing.js'
import { BufferClient, BufferError } from './buffer.js'
import { PUBLIC_ACK_TEXT, checkPublicReply, parseCommentReplyMode, toPublicReply, COMMENT_REPLY_WINDOW_MS, MetaClient, MetaError, customerKey, isCommentThread, isWithinReplyWindow, parseMetaWebhook, verifyMetaSignature, type InboundChatEvent } from './meta.js'
import { composeReply, composeWithLlm, type CatalogProduct, type ProductVariant } from './support.js'
import { autoOrderFromChat, createOrderFromChat, markazSummaryText, recentInboundTexts } from './chatOrder.js'
import { canTransition, orderStatuses, type OrderStatus } from './orderStatus.js'
import { registerBillingRoutes } from './billingRoutes.js'
import { createReferralCode } from './billing.js'
import { registerPlatformRoutes } from './platformRoutes.js'
import { freshTikTokToken, registerGrowthRoutes } from './growthRoutes.js'
import { registerAutopilotRoutes } from './autopilotRoutes.js'
import { deliverTikTok, registerExtraRoutes, sendWhatsAppText, testExtraProvider } from './extraRoutes.js'
import { WHATSAPP_WINDOW_MS, parseWhatsAppWebhook, type InboundWhatsApp } from './whatsapp.js'
import { deliverFreeChannel, registerLocalRoutes } from './localRoutes.js'
import { registerMarkazAutoRoutes } from './markazAuto.js'
import { isFreeProvider } from './freeChannels.js'
import { parseMarkazExport, type ExportFieldKey } from './markazExport.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

export const app = Fastify({ logger: config.NODE_ENV !== 'test' })
await app.register(cors, {
  origin: [config.CORS_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
})
await app.register(helmet)
await app.register(rateLimit, { max: process.env.NODE_ENV === 'test' ? 100000 : 120, timeWindow: '1 minute' })

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128) })
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(200) })
const productSchema = z.object({
  name: z.string().min(2).max(180),
  description: z.string().max(10000).optional(),
  category: z.enum(['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other']),
  wholesalePrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
  supplierUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
})
const productPatchSchema = productSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one product field is required')
const productImportSchema = z.object({ csv: z.string().min(1).max(5_000_000) })
const sourceSchema = z.object({ name: z.string().min(2).max(120), kind: z.enum(['aliexpress', 'temu', 'daraz', 'markaz', 'hhc', 'zaroori', 'google_sheets', 'google_drive', 'url', 'csv', 'excel']), sourceUrl: z.string().url().optional() })
const orderSchema = z.object({
  customer: z.object({ name: z.string().min(2).max(160), phone: z.string().min(7).max(40), city: z.string().max(100).optional(), address: z.string().max(500).optional() }),
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(1000),
  paymentMethod: z.enum(['cod', 'bank_transfer', 'easypaisa', 'jazzcash', 'other']).default('cod'),
})
const pricingSchema = z.object({ wholesalePrice: z.number().nonnegative(), profitAmount: z.number().nonnegative().optional(), profitPercent: z.number().nonnegative().optional(), shippingCost: z.number().nonnegative().optional(), paymentFeePercent: z.number().nonnegative().max(100).optional(), discount: z.number().nonnegative().optional() })
const contentSchema = z.object({ description: z.string().max(2000).optional(), productId: z.string().uuid().optional(), productName: z.string().min(2).max(180), category: z.string().min(2).max(80), platform: z.enum(['facebook', 'instagram', 'tiktok', 'whatsapp', 'bluesky', 'mastodon', 'discord']), language: z.enum(['english', 'urdu', 'roman_urdu']), price: z.number().nonnegative().optional(), brandVoice: z.string().max(500).optional() })
const categoryEnum = z.enum(['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other'])
const socialAccountSchema = z.object({ platform: z.enum(['facebook', 'instagram', 'tiktok', 'whatsapp', 'bluesky', 'mastodon', 'discord']), displayName: z.string().min(2).max(160), externalAccountId: z.string().max(180).optional(), category: categoryEnum.optional(), dailyLimit: z.number().int().min(0).max(100).default(3) })
const orderStatusSchema = z.object({ status: z.enum(orderStatuses) })
const paymentSchema = z.object({ orderId: z.string().uuid(), method: z.enum(['bank_transfer', 'easypaisa', 'jazzcash', 'other']), amount: z.number().positive(), reference: z.string().max(180).optional(), proofUrl: z.string().url().optional() })
const supplierSchema = z.object({ orderId: z.string().uuid(), supplierKind: z.enum(['markaz', 'hhc', 'aliexpress', 'temu', 'daraz']) })
const emailOnlySchema = z.object({ email: z.string().email() })
const oneTimeTokenSchema = z.object({ token: z.string().min(20).max(200) })
const resetPasswordSchema = oneTimeTokenSchema.extend({ password: z.string().min(8).max(128) })
const decisionSchema = z.object({ decision: z.enum(['approved', 'rejected']) })
const conversationSchema = z.object({ customer: z.object({ name: z.string().min(2).max(160), phone: z.string().min(7).max(40), city: z.string().max(100).optional(), address: z.string().max(500).optional() }), channel: z.enum(['manual', 'whatsapp', 'instagram', 'facebook', 'email']).default('manual') })
const messageSchema = z.object({ body: z.string().min(1).max(10000), direction: z.enum(['inbound', 'outbound']).default('inbound'), status: z.enum(['draft', 'approved', 'sent']).default('draft') })
const publishSchema = z.object({ contentDraftId: z.string().uuid(), socialAccountId: z.string().uuid(), scheduledFor: z.string().datetime() })
const jobSchema = z.object({ jobType: z.enum(['product-import', 'content-generation', 'publishing', 'supplier-order', 'notification']), resourceId: z.string().uuid().optional(), payload: z.record(z.string(), z.unknown()).optional(), idempotencyKey: z.string().min(8).max(180) })

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Authentication required' })
  try {
    request.user = verifyToken(header.slice(7))
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired authentication token' })
  }
}

function uuidParam(request: FastifyRequest, name = 'id') {
  const parsed = z.string().uuid().safeParse((request.params as Record<string, string | undefined>)[name])
  return parsed.success ? parsed.data : null
}

export async function planLimits(tenantId: string) {
  const result = await query<{ product_limit: number; social_account_limit: number }>(
    "SELECT p.product_limit, p.social_account_limit FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1 AND s.status IN ('trialing', 'active')",
    [tenantId],
  )
  return result.rows[0] ?? null
}

async function issueAuthToken(userId: string, kind: AuthTokenKind) {
  const token = createOneTimeToken()
  await query('INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4::int))', [userId, kind, hashOneTimeToken(token), tokenTtlMinutes[kind]])
  return token
}

async function consumeAuthToken(token: string, kind: AuthTokenKind) {
  const result = await query<{ id: string; user_id: string }>(
    'UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now() RETURNING id, user_id',
    [hashOneTimeToken(token), kind],
  )
  return result.rows[0] ?? null
}

async function sendVerificationEmail(userId: string, email: string) {
  try {
    const token = await issueAuthToken(userId, 'email_verification')
    await mailer.send({ to: email, subject: 'Verify your Orbitly email', text: `Open this link within 24 hours to verify your email: ${config.APP_URL}/?verify=${token}` })
  } catch (error) {
    app.log.error(error)
  }
}

const integrationKey = () => config.INTEGRATION_ENCRYPTION_KEY ?? createHash('sha256').update(`${config.JWT_SECRET}:integrations`).digest('hex')
const integrationColumns = 'id, provider, label, base_url, config, secret_hint, connected_via, token_expires_at, enabled, status, status_message, last_checked_at, created_at, updated_at'

async function bufferClientFor(tenantId: string) {
  const row = await query<{ encrypted_secret: string | null }>("SELECT encrypted_secret FROM integrations WHERE tenant_id = $1 AND provider = 'buffer' AND enabled = true AND encrypted_secret IS NOT NULL ORDER BY created_at LIMIT 1", [tenantId])
  if (!row.rows[0]?.encrypted_secret) return null
  return new BufferClient(decryptSecret(row.rows[0].encrypted_secret, integrationKey()))
}

// Sends a validated publishing job to Buffer. Status becomes scheduled_in_buffer ONLY after Buffer confirms the post.
export async function deliverJob(tenantId: string, jobId: string): Promise<{ status: string; message: string }> {
  const found = await query<{ scheduled_for: string; provider: string | null; platform: string; external_account_id: string | null; content: { caption: string; hashtags: string[] }; image_url: string | null }>(
    'SELECT j.scheduled_for, a.provider, a.platform, a.external_account_id, d.content, p.image_url FROM publishing_jobs j JOIN social_accounts a ON a.id = j.social_account_id JOIN content_drafts d ON d.id = j.content_draft_id LEFT JOIN products p ON p.id = d.product_id WHERE j.id = $1 AND j.tenant_id = $2',
    [jobId, tenantId],
  )
  const job = found.rows[0]
  if (!job) return { status: 'failed', message: 'Job not found' }
  if (job.provider === 'tiktok') return deliverTikTok(tenantId, jobId)
  if (job.provider && isFreeProvider(job.provider)) return deliverFreeChannel(tenantId, jobId)
  if (job.provider !== 'buffer' || !job.external_account_id) return { status: 'queued', message: 'Recorded only. This account is not a Buffer or TikTok channel, so nothing was sent.' }
  let client: BufferClient | null
  try {
    client = await bufferClientFor(tenantId)
  } catch {
    client = null
  }
  if (!client) return { status: 'queued', message: 'Recorded only. Add and enable a Buffer API key in Integrations to send posts.' }
  const text = `${job.content.caption}${job.content.hashtags.length ? `\n\n${job.content.hashtags.join(' ')}` : ''}`
  try {
    const post = await client.createPost({ channelId: job.external_account_id, text, imageUrl: job.image_url ?? undefined, dueAt: new Date(job.scheduled_for).toISOString(), service: job.platform })
    await query("UPDATE publishing_jobs SET status = 'scheduled_in_buffer', provider = 'buffer', external_post_id = $1, attempts = attempts + 1, last_error = NULL WHERE id = $2 AND tenant_id = $3", [post.id, jobId, tenantId])
    return { status: 'scheduled_in_buffer', message: 'Buffer confirmed the post.' }
  } catch (error) {
    const message = error instanceof BufferError ? error.message : 'Unexpected error while sending to Buffer'
    await query("UPDATE publishing_jobs SET status = 'failed', provider = 'buffer', attempts = attempts + 1, last_error = $1 WHERE id = $2 AND tenant_id = $3", [message, jobId, tenantId])
    await createNotification(tenantId, 'publishing_failed', 'Post could not be sent to Buffer', message)
    return { status: 'failed', message }
  }
}

export async function sourcingSettings(tenantId: string): Promise<{ rules: SourcingRules; profit: ProfitConfig }> {
  const result = await query<{ min_rating: string; min_reviews: number; min_sold: number; profit_amount: string; profit_percent: string | null }>('SELECT min_rating, min_reviews, min_sold, profit_amount, profit_percent FROM tenant_settings WHERE tenant_id = $1', [tenantId])
  const row = result.rows[0]
  if (!row) return { rules: defaultSourcingRules, profit: defaultProfit }
  return { rules: { minRating: Number(row.min_rating), minReviews: row.min_reviews, minSold: row.min_sold }, profit: { fixed: Number(row.profit_amount), percent: row.profit_percent === null ? null : Number(row.profit_percent) } }
}

app.get('/health', async () => ({ status: 'ok', service: 'orbitly-api', timestamp: new Date().toISOString() }))

app.post('/api/auth/register', async (request, reply) => {
  const parsed = credentialsSchema.extend({ workspaceName: z.string().min(2).max(100), referralCode: z.string().min(4).max(16).optional() }).safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid registration data', details: parsed.error.flatten() })
  const { email, password, workspaceName } = parsed.data
  const client = await (await import('./db.js')).pool.connect()
  try {
    await client.query('BEGIN')
    const tenant = await client.query<{ id: string }>('INSERT INTO tenants (name, referral_code, referred_by) VALUES ($1, $2, (SELECT id FROM tenants WHERE referral_code = $3)) RETURNING id', [workspaceName, createReferralCode(), parsed.data.referralCode?.toUpperCase() ?? null])
    const passwordHash = await hashPassword(password)
    const user = await client.query<{ id: string; role: string }>(
      'INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, role',
      [tenant.rows[0].id, email.toLowerCase(), passwordHash, 'owner'],
    )
    await client.query(
      'INSERT INTO subscriptions (tenant_id, plan_id) SELECT $1, id FROM plans WHERE code = $2',
      [tenant.rows[0].id, 'starter'],
    )
    await client.query('COMMIT')
    const authUser: AuthUser = { id: user.rows[0].id, tenantId: tenant.rows[0].id, email: email.toLowerCase(), role: user.rows[0].role }
    const refreshToken = createRefreshToken()
    await query(
      'INSERT INTO refresh_sessions (user_id, tenant_id, token_hash, expires_at) VALUES ($1,$2,$3,now() + interval \'30 days\')',
      [authUser.id, authUser.tenantId, hashRefreshToken(refreshToken)],
    )
    await sendVerificationEmail(authUser.id, authUser.email)
    return reply.code(201).send({ user: authUser, token: signToken(authUser), refreshToken })
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.includes('users_email_key')) return reply.code(409).send({ error: 'Email is already registered' })
    request.log.error(error)
    return reply.code(500).send({ error: 'Unable to create workspace' })
  } finally {
    client.release()
  }
})

app.post('/api/auth/login', async (request, reply) => {
  const parsed = credentialsSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid credentials' })
  const result = await query<{ id: string; tenant_id: string; email: string; password_hash: string; role: string }>(
    "SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = $1 AND u.is_active = true AND t.status = 'active'",
    [parsed.data.email.toLowerCase()],
  )
  const row = result.rows[0]
  if (!row || !(await comparePassword(parsed.data.password, row.password_hash))) return reply.code(401).send({ error: 'Email or password is incorrect' })
  const user: AuthUser = { id: row.id, tenantId: row.tenant_id, email: row.email, role: row.role }
  const refreshToken = createRefreshToken()
  await query(
    'INSERT INTO refresh_sessions (user_id, tenant_id, token_hash, expires_at) VALUES ($1,$2,$3,now() + interval \'30 days\')',
    [user.id, user.tenantId, hashRefreshToken(refreshToken)],
  )
  return { user, token: signToken(user), refreshToken }
})

app.post('/api/auth/refresh', async (request, reply) => {
  const parsed = refreshSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(401).send({ error: 'Invalid refresh session' })
  const currentHash = hashRefreshToken(parsed.data.refreshToken)
  const result = await query<{ id: string; user_id: string; tenant_id: string; email: string; role: string }>(
    'SELECT r.id, r.user_id, r.tenant_id, u.email, u.role FROM refresh_sessions r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1 AND r.revoked_at IS NULL AND r.expires_at > now() AND u.is_active = true',
    [currentHash],
  )
  const session = result.rows[0]
  if (!session) return reply.code(401).send({ error: 'Refresh session expired. Please sign in again.' })
  const nextRefreshToken = createRefreshToken()
  await query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [session.id])
  await query(
    'INSERT INTO refresh_sessions (user_id, tenant_id, token_hash, expires_at) VALUES ($1,$2,$3,now() + interval \'30 days\')',
    [session.user_id, session.tenant_id, hashRefreshToken(nextRefreshToken)],
  )
  const user: AuthUser = { id: session.user_id, tenantId: session.tenant_id, email: session.email, role: session.role }
  return { user, token: signToken(user), refreshToken: nextRefreshToken }
})

app.post('/api/auth/logout', { preHandler: requireAuth }, async (request) => {
  await query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL', [request.user!.id, request.user!.tenantId])
  return { success: true }
})

app.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
  const parsed = emailOnlySchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'A valid email is required' })
  const user = await query<{ id: string; email: string }>(
    "SELECT u.id, u.email FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = $1 AND u.is_active = true AND t.status = 'active'",
    [parsed.data.email.toLowerCase()],
  )
  if (user.rows[0]) {
    const token = await issueAuthToken(user.rows[0].id, 'password_reset')
    await mailer.send({ to: user.rows[0].email, subject: 'Reset your Orbitly password', text: `Open this link within 60 minutes to choose a new password: ${config.APP_URL}/?reset=${token}\nIf you did not ask for this, ignore this email.` })
  }
  return reply.code(202).send({ message: 'If that email is registered, a reset link has been sent.' })
})

app.post('/api/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const parsed = resetPasswordSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid reset request' })
  const used = await consumeAuthToken(parsed.data.token, 'password_reset')
  if (!used) return reply.code(400).send({ error: 'This reset link is invalid or has expired' })
  const owner = await query<{ tenant_id: string }>('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING tenant_id', [await hashPassword(parsed.data.password), used.user_id])
  await query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [used.user_id])
  await writeAuditLog({ tenantId: owner.rows[0].tenant_id, userId: used.user_id, action: 'auth.password_reset', entityType: 'user', entityId: used.user_id })
  return { success: true }
})

app.post('/api/auth/verify-email', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const parsed = oneTimeTokenSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid verification request' })
  const used = await consumeAuthToken(parsed.data.token, 'email_verification')
  if (!used) return reply.code(400).send({ error: 'This verification link is invalid or has expired' })
  await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [used.user_id])
  return { verified: true }
})

app.post('/api/auth/resend-verification', { preHandler: requireAuth, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request, reply) => {
  const row = await query<{ email_verified_at: string | null }>('SELECT email_verified_at FROM users WHERE id = $1 AND tenant_id = $2', [request.user!.id, request.user!.tenantId])
  if (!row.rows[0]) return reply.code(404).send({ error: 'User not found' })
  if (row.rows[0].email_verified_at) return reply.code(409).send({ error: 'Email is already verified' })
  await sendVerificationEmail(request.user!.id, request.user!.email)
  return reply.code(202).send({ message: 'Verification email requested.' })
})

app.get('/api/me', { preHandler: requireAuth }, async (request) => {
  const row = await query<{ email_verified_at: string | null }>('SELECT email_verified_at FROM users WHERE id = $1 AND tenant_id = $2', [request.user!.id, request.user!.tenantId])
  return { user: request.user, emailVerified: Boolean(row.rows[0]?.email_verified_at) }
})

app.get('/api/products', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT id, name, description, category, wholesale_price, selling_price, stock, status, supplier_url, image_url, rating, review_count, sold_count, source_kind, created_at FROM products WHERE tenant_id = $1 ORDER BY created_at DESC', [request.user!.tenantId])
  return { products: result.rows }
})

app.post('/api/products', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = productSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid product data', details: parsed.error.flatten() })
  const data = parsed.data
  const limits = await planLimits(request.user!.tenantId)
  if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
  const productCount = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [request.user!.tenantId])
  if (!checkLimit(productCount.rows[0].count, limits.product_limit).allowed) return reply.code(429).send({ error: 'Product limit reached for your plan', usage: { used: productCount.rows[0].count, limit: limits.product_limit } })
  const result = await query<{ id: string }>(
    'INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [request.user!.tenantId, data.name, data.description ?? null, data.category, data.wholesalePrice, data.sellingPrice, data.stock, data.supplierUrl ?? null, data.imageUrl ?? null],
  )
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'product.created', entityType: 'product', entityId: result.rows[0].id })
  return reply.code(201).send({ product: result.rows[0] })
})

app.patch('/api/products/:id', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const productId = z.string().uuid().safeParse((request.params as { id?: string }).id)
  const parsed = productPatchSchema.safeParse(request.body)
  if (!productId.success || !parsed.success) return reply.code(400).send({ error: 'Invalid product update', details: parsed.success ? undefined : parsed.error.flatten() })
  const data = parsed.data
  const fields: string[] = []
  const values: unknown[] = []
  const mapping: Record<string, string> = { name: 'name', description: 'description', category: 'category', wholesalePrice: 'wholesale_price', sellingPrice: 'selling_price', stock: 'stock', supplierUrl: 'supplier_url', imageUrl: 'image_url' }
  for (const [key, column] of Object.entries(mapping)) {
    if (data[key as keyof typeof data] !== undefined) {
      values.push(data[key as keyof typeof data])
      fields.push(`${column} = $${values.length}`)
    }
  }
  values.push(new Date(), productId.data, request.user!.tenantId)
  const result = await query(
    `UPDATE products SET ${fields.join(', ')}, updated_at = $${values.length - 2} WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
    values,
  )
  if (!result.rows[0]) return reply.code(404).send({ error: 'Product not found' })
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'product.updated', entityType: 'product', entityId: productId.data, metadata: { fields: Object.keys(data) } })
  return { product: result.rows[0] }
})

app.delete('/api/products/:id', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
  const productId = z.string().uuid().safeParse((request.params as { id?: string }).id)
  if (!productId.success) return reply.code(400).send({ error: 'Invalid product id' })
  const result = await query<{ id: string }>('DELETE FROM products WHERE id = $1 AND tenant_id = $2 RETURNING id', [productId.data, request.user!.tenantId])
  if (!result.rows[0]) return reply.code(404).send({ error: 'Product not found' })
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'product.deleted', entityType: 'product', entityId: productId.data })
  return reply.code(204).send()
})

app.post('/api/products/import/csv', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const parsed = productImportSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid CSV import request', details: parsed.error.flatten() })
  let rows: ProductImportRow[]
  try {
    rows = parseProductCsv(parsed.data.csv)
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid CSV' })
  }
  const limits = await planLimits(request.user!.tenantId)
  if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
  const existingCount = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [request.user!.tenantId])
  if (!checkLimit(existingCount.rows[0].count, limits.product_limit, rows.length).allowed) return reply.code(429).send({ error: 'Import would exceed the product limit for your plan', usage: { used: existingCount.rows[0].count, limit: limits.product_limit, rows: rows.length } })
  const client = await (await import('./db.js')).pool.connect()
  const imported: string[] = []
  const skipped: { row: number; reason: string }[] = []
  try {
    await client.query('BEGIN')
    for (const [index, row] of rows.entries()) {
      const duplicate = await client.query('SELECT id FROM products WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1', [request.user!.tenantId, row.name])
      if (duplicate.rows[0]) {
        skipped.push({ row: index + 2, reason: 'Duplicate product name' })
        continue
      }
      const result = await client.query<{ id: string }>(
        'INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [request.user!.tenantId, row.name, row.description ?? null, row.category, row.wholesalePrice, row.sellingPrice, row.stock, row.supplierUrl ?? null],
      )
      imported.push(result.rows[0].id)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    request.log.error(error)
    return reply.code(500).send({ error: 'CSV import failed and was rolled back' })
  } finally {
    client.release()
  }
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'products.imported', entityType: 'product_import', metadata: { imported: imported.length, skipped } })
  return reply.code(201).send({ importedCount: imported.length, skipped })
})

app.post('/api/pricing/calculate', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = pricingSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid pricing data', details: parsed.error.flatten() })
  return { pricing: calculatePrice(parsed.data) }
})

app.get('/api/sources', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT id, name, kind, source_url, status, last_import_at, created_at FROM sources WHERE tenant_id = $1 ORDER BY created_at DESC', [request.user!.tenantId])
  return { sources: result.rows }
})

app.post('/api/sources', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = sourceSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid source data', details: parsed.error.flatten() })
  const result = await query('INSERT INTO sources (tenant_id, name, kind, source_url) VALUES ($1,$2,$3,$4) RETURNING *', [request.user!.tenantId, parsed.data.name, parsed.data.kind, parsed.data.sourceUrl ?? null])
  return reply.code(201).send({ source: result.rows[0] })
})

app.post('/api/orders', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = orderSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid order data', details: parsed.error.flatten() })
  const client = await (await import('./db.js')).pool.connect()
  try {
    await client.query('BEGIN')
    const product = await client.query<{ id: string; selling_price: string; stock: number }>('SELECT id, selling_price, stock FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [parsed.data.productId, request.user!.tenantId])
    const productRow = product.rows[0]
    if (!productRow) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'Product not found' })
    }
    if (productRow.stock < parsed.data.quantity) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: 'Insufficient stock' })
    }
    const customer = await client.query<{ id: string }>(
      'INSERT INTO customers (tenant_id, name, phone, city, address) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, address = EXCLUDED.address RETURNING id',
      [request.user!.tenantId, parsed.data.customer.name, parsed.data.customer.phone, parsed.data.customer.city ?? null, parsed.data.customer.address ?? null],
    )
    const total = Number(productRow.selling_price) * parsed.data.quantity
    const order = await client.query(
      'INSERT INTO orders (tenant_id, customer_id, product_id, quantity, total_amount, payment_method) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [request.user!.tenantId, customer.rows[0].id, parsed.data.productId, parsed.data.quantity, total, parsed.data.paymentMethod],
    )
    await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [parsed.data.quantity, parsed.data.productId, request.user!.tenantId])
    await client.query('COMMIT')
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'order.created', entityType: 'order', entityId: order.rows[0].id, metadata: { quantity: parsed.data.quantity } })
    await createNotification(request.user!.tenantId, 'new_order', 'New order', `Order #${String(order.rows[0].id).slice(0, 8).toUpperCase()} for Rs. ${total.toLocaleString()}`)
    if (productRow.stock - parsed.data.quantity <= 5) await createNotification(request.user!.tenantId, 'low_stock', 'Low stock', `Only ${productRow.stock - parsed.data.quantity} units left after order #${String(order.rows[0].id).slice(0, 8).toUpperCase()}`)
    return reply.code(201).send({ order: order.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    request.log.error(error)
    return reply.code(500).send({ error: 'Unable to create order' })
  } finally {
    client.release()
  }
})

app.get('/api/orders', { preHandler: requireAuth }, async (request) => {
  const result = await query(
    'SELECT o.id, o.quantity, o.total_amount, o.payment_method, o.status, o.created_at, c.name AS customer_name, c.phone, p.name AS product_name FROM orders o JOIN customers c ON c.id = o.customer_id JOIN products p ON p.id = o.product_id WHERE o.tenant_id = $1 ORDER BY o.created_at DESC',
    [request.user!.tenantId],
  )
  return { orders: result.rows }
})

app.patch('/api/orders/:id/status', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const orderId = uuidParam(request)
  const parsed = orderStatusSchema.safeParse(request.body)
  if (!orderId || !parsed.success) return reply.code(400).send({ error: 'Invalid order status update' })
  const client = await (await import('./db.js')).pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ status: string; product_id: string; quantity: number }>('SELECT status, product_id, quantity FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [orderId, request.user!.tenantId])
    const row = current.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'Order not found' })
    }
    const from = row.status as OrderStatus
    if (!orderStatuses.includes(from) || !canTransition(from, parsed.data.status)) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: `Cannot change order from ${row.status} to ${parsed.data.status}` })
    }
    await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [parsed.data.status, orderId, request.user!.tenantId])
    if (parsed.data.status === 'cancelled') {
      await client.query('UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [row.quantity, row.product_id, request.user!.tenantId])
    }
    await client.query('COMMIT')
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'order.status_changed', entityType: 'order', entityId: orderId, metadata: { from, to: parsed.data.status } })
    return { order: { id: orderId, status: parsed.data.status } }
  } catch (error) {
    await client.query('ROLLBACK')
    request.log.error(error)
    return reply.code(500).send({ error: 'Unable to update order status' })
  } finally {
    client.release()
  }
})

app.get('/api/admin/tenants', { preHandler: [requireAuth, requireRole('super_admin')] }, async () => {
  const result = await query(
    `SELECT t.id, t.name, t.status, t.created_at, p.code AS plan_code, s.status AS subscription_status,
      (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS users,
      (SELECT COUNT(*)::int FROM products pr WHERE pr.tenant_id = t.id) AS products,
      (SELECT COUNT(*)::int FROM orders o WHERE o.tenant_id = t.id) AS orders
     FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN plans p ON p.id = s.plan_id
     ORDER BY t.created_at DESC`,
  )
  return { tenants: result.rows }
})

app.post('/api/admin/tenants/:id/status', { preHandler: [requireAuth, requireRole('super_admin')] }, async (request, reply) => {
  const tenantId = uuidParam(request)
  const parsed = z.object({ status: z.enum(['active', 'suspended']) }).safeParse(request.body)
  if (!tenantId || !parsed.success) return reply.code(400).send({ error: 'Invalid tenant status update' })
  const result = await query<{ id: string; status: string }>('UPDATE tenants SET status = $1 WHERE id = $2 RETURNING id, status', [parsed.data.status, tenantId])
  if (!result.rows[0]) return reply.code(404).send({ error: 'Tenant not found' })
  if (parsed.data.status === 'suspended') await query('UPDATE refresh_sessions SET revoked_at = now() WHERE tenant_id = $1 AND revoked_at IS NULL', [tenantId])
  await writeAuditLog({ tenantId, userId: request.user!.id, action: `tenant.${parsed.data.status}`, entityType: 'tenant', entityId: tenantId })
  return { tenant: result.rows[0] }
})

app.get('/api/notifications', { preHandler: requireAuth }, async (request) => {
  const rows = await query('SELECT id, kind, title, body, read_at, created_at FROM notifications WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50', [request.user!.tenantId])
  const unread = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM notifications WHERE tenant_id = $1 AND read_at IS NULL', [request.user!.tenantId])
  return { notifications: rows.rows, unread: unread.rows[0].count }
})

app.post('/api/notifications/read-all', { preHandler: requireAuth }, async (request) => {
  await query('UPDATE notifications SET read_at = now() WHERE tenant_id = $1 AND read_at IS NULL', [request.user!.tenantId])
  return { success: true }
})

app.post('/api/notifications/:id/read', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid notification id' })
  const result = await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, request.user!.tenantId])
  if (!result.rows[0]) return reply.code(404).send({ error: 'Notification not found' })
  return { success: true }
})

app.get('/api/analytics/summary', { preHandler: requireAuth }, async (request) => {
  const tenantId = request.user!.tenantId
  const totals = await query<Record<string, string | number>>(
    `SELECT
      (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1) AS products,
      (SELECT COUNT(*)::int FROM social_accounts WHERE tenant_id = $1) AS social_accounts,
      (SELECT COUNT(*)::int FROM conversations WHERE tenant_id = $1) AS conversations,
      (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1) AS orders,
      (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status IN ('new','pending_confirmation','payment_pending','payment_verified','processing','submitted_to_supplier','shipped')) AS open_orders,
      (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status = 'delivered') AS completed_orders,
      (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status = 'cancelled') AS cancelled_orders,
      COALESCE((SELECT SUM(total_amount) FROM orders WHERE tenant_id = $1 AND status = 'delivered'), 0) AS revenue,
      COALESCE((SELECT SUM(p.wholesale_price * o.quantity) FROM orders o JOIN products p ON p.id = o.product_id WHERE o.tenant_id = $1 AND o.status = 'delivered'), 0) AS wholesale_cost`,
    [tenantId],
  )
  const row = totals.rows[0]
  const revenue = Number(row.revenue)
  const wholesaleCost = Number(row.wholesale_cost)
  const categories = await query<{ category: string; orders: number; revenue: string }>(
    "SELECT p.category, COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_amount), 0) AS revenue FROM orders o JOIN products p ON p.id = o.product_id WHERE o.tenant_id = $1 AND o.status = 'delivered' GROUP BY p.category ORDER BY revenue DESC",
    [tenantId],
  )
  return {
    summary: {
      products: Number(row.products), socialAccounts: Number(row.social_accounts), conversations: Number(row.conversations),
      orders: Number(row.orders), openOrders: Number(row.open_orders), completedOrders: Number(row.completed_orders), cancelledOrders: Number(row.cancelled_orders),
      revenue, wholesaleCost, grossProfit: revenue - wholesaleCost,
      note: 'Counts delivered orders only. Gross profit is before delivery cost, payment fees, refunds and other expenses, which are not tracked yet.',
    },
    byCategory: categories.rows.map((c) => ({ category: c.category, orders: c.orders, revenue: Number(c.revenue) })),
  }
})

app.get('/api/exports/orders.csv', { preHandler: requireAuth }, async (request, reply) => {
  const result = await query(
    'SELECT o.id, o.created_at, c.name AS customer, c.phone, c.city, p.name AS product, o.quantity, o.total_amount, o.payment_method, o.status FROM orders o JOIN customers c ON c.id = o.customer_id JOIN products p ON p.id = o.product_id WHERE o.tenant_id = $1 ORDER BY o.created_at DESC',
    [request.user!.tenantId],
  )
  const csv = toCsv(['order_id', 'created_at', 'customer', 'phone', 'city', 'product', 'quantity', 'total_amount', 'payment_method', 'status'], result.rows.map((r) => [r.id, r.created_at, r.customer, r.phone, r.city, r.product, r.quantity, r.total_amount, r.payment_method, r.status]))
  return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="orders.csv"').send(csv)
})

const integrationSchema = z.object({
  provider: z.enum(['buffer', 'markaz', 'meta', 'whatsapp', 'tiktok', 'custom']),
  label: z.string().min(2).max(120),
  baseUrl: z.string().url().optional(),
  config: z.record(z.string(), z.string().max(500)).optional(),
  secret: z.string().min(8).max(500).optional(),
  enabled: z.boolean().optional(),
})
const integrationPatchSchema = integrationSchema.omit({ provider: true }).partial()
const sourcingSettingsSchema = z.object({ minRating: z.number().min(0).max(5), minReviews: z.number().int().min(0), minSold: z.number().int().min(0), profitAmount: z.number().min(0), profitPercent: z.number().min(0).max(500).nullable() })
const markazImportSchema = z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(false) })
const manualSourcedProductSchema = z.object({
  name: z.string().min(2).max(180), category: categoryEnum, wholesalePrice: z.number().positive(), profitAmount: z.number().min(0).optional(),
  stock: z.number().int().min(0).default(0), imageUrl: z.string().url().optional(), productUrl: z.string().url().optional(), description: z.string().max(10000).optional(),
  rating: z.number().min(0).max(5).optional(), reviewCount: z.number().int().min(0).optional(), soldCount: z.number().int().min(0).optional(),
})

app.get('/api/integrations', { preHandler: requireAuth }, async (request) => {
  const result = await query(`SELECT ${integrationColumns} FROM integrations WHERE tenant_id = $1 ORDER BY created_at`, [request.user!.tenantId])
  return { integrations: result.rows }
})

app.post('/api/integrations', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
  const parsed = integrationSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid integration data', details: parsed.error.flatten() })
  const data = parsed.data
  if (data.provider === 'buffer' && !data.secret) return reply.code(400).send({ error: 'Buffer needs an API key' })
  if (data.provider === 'meta' && (!data.secret || !data.config?.pageId)) return reply.code(400).send({ error: 'Meta needs a Page access token and a Page ID' })
  if (data.provider === 'whatsapp' && (!data.secret || !data.config?.phoneNumberId)) return reply.code(400).send({ error: 'WhatsApp needs a permanent access token and the phone number ID' })
  if (data.provider === 'tiktok' && !data.secret) return reply.code(400).send({ error: 'TikTok needs a user access token' })
  if (data.provider !== 'custom') {
    const existing = await query('SELECT id FROM integrations WHERE tenant_id = $1 AND provider = $2', [request.user!.tenantId, data.provider])
    if (existing.rows[0]) return reply.code(409).send({ error: 'This integration already exists. Edit it instead.' })
  }
  const result = await query(
    `INSERT INTO integrations (tenant_id, provider, label, base_url, config, encrypted_secret, secret_hint, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${integrationColumns}`,
    [request.user!.tenantId, data.provider, data.label, data.baseUrl ?? null, JSON.stringify(data.config ?? {}), data.secret ? encryptSecret(data.secret, integrationKey()) : null, data.secret ? secretHint(data.secret) : null, data.enabled ?? true],
  )
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'integration.created', entityType: 'integration', entityId: result.rows[0].id as string, metadata: { provider: data.provider } })
  return reply.code(201).send({ integration: result.rows[0] })
})

app.patch('/api/integrations/:id', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
  const id = uuidParam(request)
  const parsed = integrationPatchSchema.safeParse(request.body)
  if (!id || !parsed.success) return reply.code(400).send({ error: 'Invalid integration update' })
  const current = await query<{ label: string; base_url: string | null; config: Record<string, string>; enabled: boolean }>('SELECT label, base_url, config, enabled FROM integrations WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])
  const row = current.rows[0]
  if (!row) return reply.code(404).send({ error: 'Integration not found' })
  const data = parsed.data
  const result = await query(
    `UPDATE integrations SET label = $1, base_url = $2, config = $3, enabled = $4,
      encrypted_secret = COALESCE($5::text, encrypted_secret), secret_hint = COALESCE($6::text, secret_hint),
      status = CASE WHEN $5::text IS NULL THEN status ELSE 'unverified' END,
      status_message = CASE WHEN $5::text IS NULL THEN status_message ELSE NULL END,
      updated_at = now() WHERE id = $7 AND tenant_id = $8 RETURNING ${integrationColumns}`,
    [data.label ?? row.label, data.baseUrl ?? row.base_url, JSON.stringify(data.config ?? row.config), data.enabled ?? row.enabled, data.secret ? encryptSecret(data.secret, integrationKey()) : null, data.secret ? secretHint(data.secret) : null, id, request.user!.tenantId],
  )
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'integration.updated', entityType: 'integration', entityId: id, metadata: { fields: Object.keys(data).filter((key) => key !== 'secret'), secretChanged: Boolean(data.secret) } })
  return { integration: result.rows[0] }
})

app.delete('/api/integrations/:id', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid integration id' })
  const result = await query<{ provider: string }>('DELETE FROM integrations WHERE id = $1 AND tenant_id = $2 RETURNING provider', [id, request.user!.tenantId])
  if (!result.rows[0]) return reply.code(404).send({ error: 'Integration not found' })
  if (result.rows[0].provider === 'buffer') await query("UPDATE social_accounts SET status = 'disconnected' WHERE tenant_id = $1 AND provider = 'buffer'", [request.user!.tenantId])
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'integration.deleted', entityType: 'integration', entityId: id, metadata: { provider: result.rows[0].provider } })
  return reply.code(204).send()
})

app.post('/api/integrations/:id/test', { preHandler: [requireAuth, requireRole('admin')], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid integration id' })
  const found = await query<{ provider: string; encrypted_secret: string | null; config: Record<string, string>; base_url: string | null }>('SELECT provider, encrypted_secret, config, base_url FROM integrations WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])
  const row = found.rows[0]
  if (!row) return reply.code(404).send({ error: 'Integration not found' })
  if (row.provider === 'custom' || row.provider === 'markaz') {
    let secret: string | null = null
    try { secret = row.encrypted_secret ? decryptSecret(row.encrypted_secret, integrationKey()) : null } catch { /* unreadable key: tested without it */ }
    const outcome = await checkApiReachable(row.provider === 'markaz' ? 'https://www.markaz.app' : row.base_url, row.provider === 'markaz' ? null : secret)
    await query('UPDATE integrations SET status = $1, status_message = $2, last_checked_at = now() WHERE id = $3 AND tenant_id = $4', [outcome.status, outcome.message, id, request.user!.tenantId])
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'integration.tested', entityType: 'integration', entityId: id, metadata: { status: outcome.status } })
    return outcome
  }
  if (row.provider === 'whatsapp' || row.provider === 'tiktok') {
    let outcome: { status: string; message: string }
    try {
      if (!row.encrypted_secret) throw new Error('No token stored')
      let secret = decryptSecret(row.encrypted_secret, integrationKey())
      if (row.provider === 'tiktok') {
        const full = (await query<{ id: string; tenant_id: string; encrypted_secret: string | null; encrypted_refresh_secret: string | null; token_expires_at: string | null; refresh_expires_at: string | null; connected_via: string }>('SELECT id, tenant_id, encrypted_secret, encrypted_refresh_secret, token_expires_at, refresh_expires_at, connected_via FROM integrations WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])).rows[0]
        secret = await freshTikTokToken(full)
      }
      outcome = await testExtraProvider(row.provider, secret, row.config)
    } catch {
      outcome = { status: 'failed', message: 'Stored token cannot be used. Enter the token again.' }
    }
    await query('UPDATE integrations SET status = $1, status_message = $2, last_checked_at = now() WHERE id = $3 AND tenant_id = $4', [outcome.status, outcome.message, id, request.user!.tenantId])
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'integration.tested', entityType: 'integration', entityId: id, metadata: { status: outcome.status } })
    return outcome
  }
  if (row.provider !== 'buffer' && row.provider !== 'meta') return reply.code(400).send({ error: 'Automatic testing exists only for Buffer, Meta, WhatsApp and TikTok. This provider has no verified adapter, so it stays unverified.' })
  let status = 'failed'
  let message: string
  if (row.provider === 'meta') {
    try {
      if (!row.encrypted_secret) throw new MetaError('No Page access token stored')
      const identity = await new MetaClient(decryptSecret(row.encrypted_secret, integrationKey()), undefined, config.META_GRAPH_VERSION).getIdentity()
      status = 'verified'
      message = `Connected to Meta. Page: ${identity.name ?? identity.id}`
    } catch (error) {
      message = error instanceof MetaError ? error.message : 'Stored token cannot be used. Enter the token again.'
    }
    await query('UPDATE integrations SET status = $1, status_message = $2, last_checked_at = now() WHERE id = $3 AND tenant_id = $4', [status, message, id, request.user!.tenantId])
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'integration.tested', entityType: 'integration', entityId: id, metadata: { status } })
    return { status, message }
  }
  try {
    if (!row.encrypted_secret) throw new BufferError('No API key stored')
    const organizations = await new BufferClient(decryptSecret(row.encrypted_secret, integrationKey())).listOrganizations()
    status = 'verified'
    message = `Connected to Buffer. Organizations: ${organizations.map((o) => o.name).join(', ') || 'none'}`
  } catch (error) {
    message = error instanceof BufferError ? error.message : 'Stored key cannot be used. Enter the API key again.'
  }
  await query('UPDATE integrations SET status = $1, status_message = $2, last_checked_at = now() WHERE id = $3 AND tenant_id = $4', [status, message, id, request.user!.tenantId])
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'integration.tested', entityType: 'integration', entityId: id, metadata: { status } })
  return { status, message }
})

app.post('/api/integrations/:id/sync-channels', { preHandler: [requireAuth, requireRole('admin')], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid integration id' })
  const found = await query<{ provider: string; enabled: boolean; encrypted_secret: string | null; config: Record<string, string> }>('SELECT provider, enabled, encrypted_secret, config FROM integrations WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])
  const row = found.rows[0]
  if (!row) return reply.code(404).send({ error: 'Integration not found' })
  if (row.provider !== 'buffer' || !row.enabled || !row.encrypted_secret) return reply.code(400).send({ error: 'Channel sync needs an enabled Buffer integration with an API key' })
  const tenantId = request.user!.tenantId
  try {
    const client = new BufferClient(decryptSecret(row.encrypted_secret, integrationKey()))
    const organizations = await client.listOrganizations()
    // A typed-in Organization ID is used only when Buffer really lists it; otherwise the first organization of this key is used.
    const organizationId = organizations.find((o) => o.id === row.config.organizationId)?.id ?? organizations[0]?.id
    if (!organizationId) return reply.code(400).send({ error: 'No Buffer organization found for this API key' })
    const channels = await client.listChannels(organizationId)
    const limits = await planLimits(tenantId)
    const count = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM social_accounts WHERE tenant_id = $1', [tenantId])
    let total = count.rows[0].count
    let created = 0
    let updated = 0
    const skipped: string[] = []
    for (const channel of channels) {
      const platform = String(channel.service ?? '').toLowerCase()
      if (!platform) {
        skipped.push(`${channel.name ?? channel.id} (unknown platform)`)
        continue
      }
      const existing = await query('SELECT id FROM social_accounts WHERE tenant_id = $1 AND platform = $2 AND external_account_id = $3', [tenantId, platform, channel.id])
      const name = channel.displayName || channel.name
      if (existing.rows[0]) {
        await query("UPDATE social_accounts SET display_name = $1, status = 'connected', provider = 'buffer' WHERE id = $2 AND tenant_id = $3", [name, existing.rows[0].id, tenantId])
        updated += 1
      } else if (!limits || !checkLimit(total, limits.social_account_limit).allowed) {
        skipped.push(name)
      } else {
        await query("INSERT INTO social_accounts (tenant_id, platform, display_name, external_account_id, status, provider) VALUES ($1,$2,$3,$4,'connected','buffer')", [tenantId, platform, name, channel.id])
        total += 1
        created += 1
      }
    }
    await query("UPDATE integrations SET status = 'verified', status_message = $1, last_checked_at = now() WHERE id = $2 AND tenant_id = $3", [`Synced ${channels.length} channel(s)`, id, tenantId])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'integration.channels_synced', entityType: 'integration', entityId: id, metadata: { created, updated, skipped: skipped.length } })
    return { organizationId, created, updated, skipped, note: skipped.length ? 'Some channels were skipped because your plan social account limit is reached.' : undefined }
  } catch (error) {
    if (error instanceof BufferError) return reply.code(502).send({ error: error.message })
    throw error
  }
})

app.get('/api/sourcing/settings', { preHandler: requireAuth }, async (request) => ({ settings: await sourcingSettings(request.user!.tenantId) }))

app.put('/api/sourcing/settings', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
  const parsed = sourcingSettingsSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid sourcing settings', details: parsed.error.flatten() })
  const d = parsed.data
  await query(
    'INSERT INTO tenant_settings (tenant_id, min_rating, min_reviews, min_sold, profit_amount, profit_percent) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id) DO UPDATE SET min_rating = EXCLUDED.min_rating, min_reviews = EXCLUDED.min_reviews, min_sold = EXCLUDED.min_sold, profit_amount = EXCLUDED.profit_amount, profit_percent = EXCLUDED.profit_percent, updated_at = now()',
    [request.user!.tenantId, d.minRating, d.minReviews, d.minSold, d.profitAmount, d.profitPercent],
  )
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'sourcing.settings_updated', entityType: 'tenant_settings', metadata: d })
  return { settings: await sourcingSettings(request.user!.tenantId) }
})

app.post('/api/sourcing/markaz/import', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const parsed = markazImportSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid import request', details: parsed.error.flatten() })
  let file: ReturnType<typeof parseSourcingCsv>
  try {
    file = parseSourcingCsv(parsed.data.csv)
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid CSV' })
  }
  const tenantId = request.user!.tenantId
  const settings = await sourcingSettings(tenantId)
  const existing = await query<{ name: string }>('SELECT lower(name) AS name FROM products WHERE tenant_id = $1', [tenantId])
  const seen = new Set(existing.rows.map((r) => r.name))
  const rejected: { row: number; name?: string; reasons: string[] }[] = file.errors.map((e) => ({ row: e.row, reasons: [e.reason] }))
  const accepted: { row: number; sellingPrice: number; candidate: (typeof file.rows)[number]['candidate'] }[] = []
  for (const { row, candidate } of file.rows) {
    const verdict = evaluateCandidate(candidate, settings.rules)
    if (!verdict.eligible) rejected.push({ row, name: candidate.name, reasons: verdict.reasons })
    else if (seen.has(candidate.name.toLowerCase())) rejected.push({ row, name: candidate.name, reasons: ['Already in your catalog'] })
    else {
      seen.add(candidate.name.toLowerCase())
      accepted.push({ row, candidate, sellingPrice: applyProfit(candidate.wholesalePrice, settings.profit, candidate.profit) })
    }
  }
  const preview = accepted.map((a) => ({ row: a.row, name: a.candidate.name, wholesalePrice: a.candidate.wholesalePrice, sellingPrice: a.sellingPrice, profit: Math.round((a.sellingPrice - a.candidate.wholesalePrice) * 100) / 100, rating: a.candidate.rating, reviewCount: a.candidate.reviewCount, soldCount: a.candidate.soldCount }))
  if (parsed.data.dryRun) return { dryRun: true, total: file.rows.length + file.errors.length, eligible: preview, rejected, rules: settings.rules }
  const limits = await planLimits(tenantId)
  if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
  const count = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [tenantId])
  if (!checkLimit(count.rows[0].count, limits.product_limit, accepted.length).allowed) return reply.code(429).send({ error: 'Import would exceed the product limit for your plan', usage: { used: count.rows[0].count, limit: limits.product_limit, eligible: accepted.length } })
  const client = await (await import('./db.js')).pool.connect()
  const ids: string[] = []
  try {
    await client.query('BEGIN')
    for (const a of accepted) {
      const c = a.candidate
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url, image_url, rating, review_count, sold_count, source_kind, profit_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'markaz',$13) RETURNING id",
        [tenantId, c.name, c.description ?? null, c.category, c.wholesalePrice, a.sellingPrice, c.stock, c.productUrl ?? null, c.imageUrl ?? null, c.rating, c.reviewCount, c.soldCount, Math.round((a.sellingPrice - c.wholesalePrice) * 100) / 100],
      )
      ids.push(inserted.rows[0].id)
    }
    await client.query('INSERT INTO import_runs (tenant_id, source, total, imported, rejected, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [tenantId, 'markaz', file.rows.length + file.errors.length, ids.length, JSON.stringify(rejected), request.user!.id])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    request.log.error(error)
    return reply.code(500).send({ error: 'Import failed and was rolled back' })
  } finally {
    client.release()
  }
  await writeAuditLog({ tenantId, userId: request.user!.id, action: 'sourcing.markaz_imported', entityType: 'import_run', metadata: { imported: ids.length, rejected: rejected.length } })
  await createNotification(tenantId, 'import_summary', 'Markaz import finished', `${ids.length} products added as drafts, ${rejected.length} rejected by quality rules or errors.`)
  return reply.code(201).send({ dryRun: false, imported: ids.length, productIds: ids, rejected, note: 'Products are saved as drafts. Check stock and images before publishing.' })
})

const markazExportImportSchema = z.object({
  csv: z.string().min(10, 'CSV content is required'),
  dryRun: z.boolean().default(true),
  priceStrategy: z.enum(['profit_rule', 'file_price']).default('profit_rule'),
  mapping: z.record(z.string(), z.string().nullable()).optional(),
})

app.post('/api/sourcing/markaz/export-import', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const parsed = markazExportImportSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid export import request', details: parsed.error.flatten() })

  let parsedExport: ReturnType<typeof parseMarkazExport>
  try {
    const customMap = parsed.data.mapping ? (Object.fromEntries(Object.entries(parsed.data.mapping).filter(([, v]) => typeof v === 'string')) as Partial<Record<ExportFieldKey, string>>) : undefined
    parsedExport = parseMarkazExport(parsed.data.csv, customMap)
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : 'Could not parse export file' })
  }

  const tenantId = request.user!.tenantId
  const settings = await sourcingSettings(tenantId)
  const existingProducts = await query<{ id: string; name: string; sku: string | null }>(
    'SELECT id, lower(name) AS name, sku FROM products WHERE tenant_id = $1',
    [tenantId]
  )
  const existingByName = new Map(existingProducts.rows.map((r) => [r.name, r.id]))
  const existingBySku = new Map(existingProducts.rows.filter((r) => r.sku).map((r) => [r.sku!.toLowerCase(), r.id]))

  const rejected: { row: number; name?: string; sku?: string; reasons: string[] }[] = parsedExport.errors.map((e) => ({
    row: e.row,
    reasons: [e.reason],
  }))

  const accepted: {
    product: (typeof parsedExport.products)[number]
    existingId: string | null
    sellingPrice: number
    profit: number
  }[] = []

  for (const prod of parsedExport.products) {
    const reasons: string[] = []

    // 1. Image check
    if (!prod.mainImageUrl && prod.images.length === 0) {
      reasons.push('No image found in file')
    }

    // 2. Price check
    if (!prod.wholesalePrice || prod.wholesalePrice <= 0) {
      reasons.push('Missing or non-positive Markaz cost price')
    }

    // 3. Quality rules: ONLY evaluate if file actually contains quality metrics
    if (prod.hasQualityData) {
      const verdict = evaluateCandidate(
        { rating: prod.rating, reviewCount: prod.reviewCount, soldCount: prod.soldCount },
        settings.rules
      )
      if (!verdict.eligible) reasons.push(...verdict.reasons)
    }

    if (reasons.length > 0) {
      rejected.push({
        row: prod.rawRows[0] ?? 0,
        name: prod.name,
        sku: prod.skuRoot,
        reasons,
      })
      continue
    }

    // Calculate selling price based on chosen strategy
    let sellingPrice: number
    if (parsed.data.priceStrategy === 'file_price' && prod.fileSellingPrice !== null && prod.fileSellingPrice > prod.wholesalePrice) {
      sellingPrice = prod.fileSellingPrice
    } else {
      sellingPrice = applyProfit(prod.wholesalePrice, settings.profit)
    }

    const profit = Math.round((sellingPrice - prod.wholesalePrice) * 100) / 100
    const matchedExistingId = (prod.skuRoot && existingBySku.get(prod.skuRoot.toLowerCase())) || existingByName.get(prod.name.toLowerCase()) || null

    accepted.push({
      product: prod,
      existingId: matchedExistingId,
      sellingPrice,
      profit,
    })
  }

  const previewList = accepted.map((a) => ({
    handle: a.product.handle,
    name: a.product.name,
    skuRoot: a.product.skuRoot,
    wholesalePrice: a.product.wholesalePrice,
    fileSellingPrice: a.product.fileSellingPrice,
    sellingPrice: a.sellingPrice,
    profit: a.profit,
    variantsCount: a.product.variants.length,
    isAdvancePayment: a.product.isAdvancePayment,
    imagesCount: a.product.images.length,
    mainImageUrl: a.product.mainImageUrl,
    isUpdate: Boolean(a.existingId),
    rawRows: a.product.rawRows,
  }))

  if (parsed.data.dryRun) {
    return {
      dryRun: true,
      layout: parsedExport.layout,
      detectedHeaders: parsedExport.detectedHeaders,
      mapping: parsedExport.mapping,
      totalGrouped: parsedExport.products.length,
      eligible: previewList,
      rejected,
      priceStrategy: parsed.data.priceStrategy,
      qualityRulesNotice: 'Quality rules (rating, reviews, orders) only filter rows if that data is present in your file.',
    }
  }

  // --- Live Import Execution ---
  const limits = await planLimits(tenantId)
  if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })

  const newProductsCount = accepted.filter((a) => !a.existingId).length
  if (newProductsCount > 0) {
    const currentCount = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [tenantId])
    if (!checkLimit(currentCount.rows[0].count, limits.product_limit, newProductsCount).allowed) {
      return reply.code(429).send({
        error: 'Import would exceed the product limit for your plan',
        usage: { used: currentCount.rows[0].count, limit: limits.product_limit, eligible: newProductsCount },
      })
    }
  }

  const client = await (await import('./db.js')).pool.connect()
  const importedIds: string[] = []
  const updatedIds: string[] = []

  try {
    await client.query('BEGIN')
    for (const item of accepted) {
      const p = item.product
      let productId = item.existingId

      if (productId) {
        // Update existing product price, variants, and stock
        await client.query(
          `UPDATE products SET 
            wholesale_price = $1, 
            selling_price = $2, 
            profit_amount = $3, 
            stock = $4,
            image_url = COALESCE(image_url, $5),
            images = $6,
            is_advance_payment = $7,
            updated_at = now() 
           WHERE id = $8 AND tenant_id = $9`,
          [p.wholesalePrice, item.sellingPrice, item.profit, p.totalStock, p.mainImageUrl, p.images, p.isAdvancePayment, productId, tenantId]
        )
        updatedIds.push(productId)
      } else {
        // Insert new product
        const res = await client.query<{ id: string }>(
          `INSERT INTO products (
            tenant_id, name, description, category, wholesale_price, selling_price,
            stock, image_url, source_kind, profit_amount, sku, is_advance_payment, images, external_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'markaz_export',$9,$10,$11,$12,$13) RETURNING id`,
          [
            tenantId,
            p.name,
            p.description || null,
            p.category,
            p.wholesalePrice,
            item.sellingPrice,
            p.totalStock,
            p.mainImageUrl,
            item.profit,
            p.skuRoot || null,
            p.isAdvancePayment,
            p.images,
            p.skuRoot || null,
          ]
        )
        productId = res.rows[0].id
        importedIds.push(productId)
      }

      // Upsert variants into product_variants table
      for (const v of p.variants) {
        let vSellingPrice: number
        if (parsed.data.priceStrategy === 'file_price' && v.fileSellingPrice !== null && v.fileSellingPrice > v.wholesalePrice) {
          vSellingPrice = v.fileSellingPrice
        } else {
          vSellingPrice = applyProfit(v.wholesalePrice, settings.profit)
        }

        await client.query(
          `INSERT INTO product_variants (
            tenant_id, product_id, sku, title, option1_name, option1_value,
            option2_name, option2_value, wholesale_price, selling_price, stock, image_url, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
          ON CONFLICT (tenant_id, sku) DO UPDATE SET
            wholesale_price = EXCLUDED.wholesale_price,
            selling_price = EXCLUDED.selling_price,
            stock = EXCLUDED.stock,
            image_url = COALESCE(EXCLUDED.image_url, product_variants.image_url),
            updated_at = now()`,
          [
            tenantId,
            productId,
            v.sku,
            v.option1Value ? `${v.option1Value}${v.option2Value ? ` / ${v.option2Value}` : ''}` : p.name,
            v.option1Name || null,
            v.option1Value || null,
            v.option2Name || null,
            v.option2Value || null,
            v.wholesalePrice,
            vSellingPrice,
            v.stock,
            v.imageUrl || p.mainImageUrl || null,
          ]
        )
      }
    }

    await client.query(
      'INSERT INTO import_runs (tenant_id, source, total, imported, rejected, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [tenantId, 'markaz_export', parsedExport.products.length, importedIds.length + updatedIds.length, JSON.stringify(rejected), request.user!.id]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    request.log.error(err)
    return reply.code(500).send({ error: 'Export import failed and was rolled back' })
  } finally {
    client.release()
  }

  await writeAuditLog({
    tenantId,
    userId: request.user!.id,
    action: 'sourcing.markaz_export_imported',
    entityType: 'import_run',
    metadata: { new: importedIds.length, updated: updatedIds.length, rejected: rejected.length },
  })

  await createNotification(
    tenantId,
    'import_summary',
    'Markaz export import finished',
    `${importedIds.length} new products saved, ${updatedIds.length} existing products updated with latest prices, ${rejected.length} rows rejected.`
  )

  return reply.code(201).send({
    dryRun: false,
    newCount: importedIds.length,
    updatedCount: updatedIds.length,
    rejected,
    note: 'Markaz export products saved with all variants and root SKUs.',
  })
})

app.post('/api/sourcing/products', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const parsed = manualSourcedProductSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid product data', details: parsed.error.flatten() })
  const tenantId = request.user!.tenantId
  const d = parsed.data
  const settings = await sourcingSettings(tenantId)
  const sellingPrice = applyProfit(d.wholesalePrice, settings.profit, d.profitAmount)
  const limits = await planLimits(tenantId)
  if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
  const count = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [tenantId])
  if (!checkLimit(count.rows[0].count, limits.product_limit).allowed) return reply.code(429).send({ error: 'Product limit reached for your plan' })
  const result = await query(
    "INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url, image_url, rating, review_count, sold_count, source_kind, profit_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual',$13) RETURNING id, name, wholesale_price, selling_price, profit_amount",
    [tenantId, d.name, d.description ?? null, d.category, d.wholesalePrice, sellingPrice, d.stock, d.productUrl ?? null, d.imageUrl ?? null, d.rating ?? null, d.reviewCount ?? null, d.soldCount ?? null, Math.round((sellingPrice - d.wholesalePrice) * 100) / 100],
  )
  await writeAuditLog({ tenantId, userId: request.user!.id, action: 'product.created_manual_sourced', entityType: 'product', entityId: result.rows[0].id as string })
  return reply.code(201).send({ product: result.rows[0] })
})

app.get('/api/sourcing/imports', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT id, source, total, imported, rejected, created_at FROM import_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20', [request.user!.tenantId])
  return { imports: result.rows }
})

app.post('/api/publishing/jobs/:id/retry', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid job id' })
  const job = await query<{ status: string }>('SELECT status FROM publishing_jobs WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])
  if (!job.rows[0]) return reply.code(404).send({ error: 'Job not found' })
  if (!['failed', 'queued'].includes(job.rows[0].status)) return reply.code(409).send({ error: 'Only failed or queued jobs can be retried' })
  const delivery = await deliverJob(request.user!.tenantId, id)
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'publishing_job.retried', entityType: 'publishing_job', entityId: id, metadata: { status: delivery.status } })
  return { delivery }
})

app.get('/api/publishing/jobs', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT j.id, j.scheduled_for, j.status, j.attempts, j.last_error, j.external_post_id, a.display_name AS account, a.platform FROM publishing_jobs j JOIN social_accounts a ON a.id = j.social_account_id WHERE j.tenant_id = $1 ORDER BY j.scheduled_for DESC LIMIT 50', [request.user!.tenantId])
  return { jobs: result.rows }
})

app.get('/api/plans', async () => {
  const result = await query('SELECT code, name, monthly_price, annual_price, product_limit, social_account_limit, ai_action_limit FROM plans ORDER BY monthly_price ASC')
  return { plans: result.rows }
})

app.get('/api/subscription', { preHandler: requireAuth }, async (request, reply) => {
  const result = await query(
    `SELECT s.status, s.billing_cycle, s.current_period_end, p.code, p.name,
      p.product_limit, p.social_account_limit, p.ai_action_limit,
      COALESCE((
        SELECT SUM(quantity)::int FROM usage_events
        WHERE tenant_id = s.tenant_id AND kind = $2
        AND created_at >= date_trunc('month', now())
      ), 0)::int AS used_ai_actions
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = $1`,
    [request.user!.tenantId, 'ai_content_generation'],
  )
  if (!result.rows[0]) return reply.code(404).send({ error: 'No subscription configured' })
  return { subscription: result.rows[0] }
})

app.post('/api/content/generate', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = contentSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid content request', details: parsed.error.flatten() })
  const allowance = await query<{ ai_action_limit: number; used_actions: number }>(
    `SELECT p.ai_action_limit,
      (SELECT COALESCE(SUM(quantity), 0)::int FROM usage_events
       WHERE tenant_id = s.tenant_id AND kind = $2
       AND created_at >= date_trunc('month', now())) AS used_actions
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = $1 AND s.status IN ('trialing', 'active')`,
    [request.user!.tenantId, 'ai_content_generation'],
  )
  if (!allowance.rows[0]) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
  if (allowance.rows[0].used_actions >= allowance.rows[0].ai_action_limit) {
    return reply.code(429).send({
      error: 'Monthly AI action limit reached',
      usage: { used: allowance.rows[0].used_actions, limit: allowance.rows[0].ai_action_limit },
    })
  }
  // Facts come from the database, never from the browser: a wrong price on the page must not end up in a public post.
  let contentRequest = parsed.data
  if (parsed.data.productId) {
    const product = await query<{ name: string; category: string; selling_price: string; description: string | null }>('SELECT name, category, selling_price, description FROM products WHERE id = $1 AND tenant_id = $2', [parsed.data.productId, request.user!.tenantId])
    if (!product.rows[0]) return reply.code(404).send({ error: 'Product not found' })
    const row = product.rows[0]
    contentRequest = { ...parsed.data, productName: row.name, category: row.category, price: Number(row.selling_price), description: row.description ?? undefined }
  }
  const provider = getContentProvider()
  const content = await provider.generate(contentRequest)
  const result = await query(
    'INSERT INTO content_drafts (tenant_id, product_id, platform, language, content, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, platform, language, content, status, created_at',
    [request.user!.tenantId, parsed.data.productId ?? null, parsed.data.platform, parsed.data.language, JSON.stringify(content), request.user!.id],
  )
  await query('INSERT INTO usage_events (tenant_id, kind) VALUES ($1, $2)', [request.user!.tenantId, 'ai_content_generation'])
  return reply.code(201).send({ draft: result.rows[0] })
})

app.post('/api/workflows/enqueue', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = jobSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid workflow job', details: parsed.error.flatten() })
  const safeIdempotencyKey = `${request.user!.tenantId}:${parsed.data.idempotencyKey}`
  const job = await enqueueWorkflow(parsed.data.jobType, {
    tenantId: request.user!.tenantId,
    userId: request.user!.id,
    resourceId: parsed.data.resourceId,
    payload: parsed.data.payload,
  }, safeIdempotencyKey)
  return reply.code(202).send({ job: { id: job.id, name: job.name, status: 'queued' } })
})

app.get('/api/content/drafts', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT id, product_id, platform, language, content, status, created_at FROM content_drafts WHERE tenant_id = $1 ORDER BY created_at DESC', [request.user!.tenantId])
  return { drafts: result.rows }
})

app.post('/api/content/drafts/:id/decision', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const parsed = decisionSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid content draft decision', details: parsed.error.flatten() })
  const draftId = uuidParam(request)
  if (!draftId) return reply.code(400).send({ error: 'Invalid draft id' })
  const params = { id: draftId }
  const result = await query(
    'UPDATE content_drafts SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3 AND tenant_id = $4 AND status = $5 RETURNING id, product_id, platform, language, content, status, created_at',
    [parsed.data.decision, request.user!.id, params.id, request.user!.tenantId, 'draft'],
  )
  if (!result.rows[0]) return reply.code(404).send({ error: 'Draft not found or already reviewed' })
  await writeAuditLog({
    tenantId: request.user!.tenantId,
    userId: request.user!.id,
    action: `content_draft.${parsed.data.decision}`,
    entityType: 'content_draft',
    entityId: params.id,
    metadata: { status: parsed.data.decision },
  })
  return { draft: result.rows[0] }
})

app.get('/api/social-accounts', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT id, platform, display_name, external_account_id, category, daily_limit, status, created_at FROM social_accounts WHERE tenant_id = $1 ORDER BY created_at DESC', [request.user!.tenantId])
  return { accounts: result.rows }
})

app.post('/api/social-accounts', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = socialAccountSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid social account data', details: parsed.error.flatten() })
  const limits = await planLimits(request.user!.tenantId)
  if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
  const accountCount = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM social_accounts WHERE tenant_id = $1', [request.user!.tenantId])
  if (!checkLimit(accountCount.rows[0].count, limits.social_account_limit).allowed) return reply.code(429).send({ error: 'Social account limit reached for your plan', usage: { used: accountCount.rows[0].count, limit: limits.social_account_limit } })
  const result = await query(
    'INSERT INTO social_accounts (tenant_id, platform, display_name, external_account_id, category, daily_limit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, platform, display_name, external_account_id, category, daily_limit, status, created_at',
    [request.user!.tenantId, parsed.data.platform, parsed.data.displayName, parsed.data.externalAccountId ?? null, parsed.data.category ?? null, parsed.data.dailyLimit],
  )
  return reply.code(201).send({ account: result.rows[0], note: 'Account record created. OAuth connection is pending provider authorization.' })
})

app.post('/api/payments/verification-requests', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = paymentSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payment verification data', details: parsed.error.flatten() })
  const order = await query<{ id: string }>('SELECT id FROM orders WHERE id = $1 AND tenant_id = $2', [parsed.data.orderId, request.user!.tenantId])
  if (!order.rows[0]) return reply.code(404).send({ error: 'Order not found' })
  const provider = new ManualPaymentProvider()
  const verification = await provider.createVerificationRequest(parsed.data.reference ?? parsed.data.orderId, parsed.data.amount)
  const result = await query(
    'INSERT INTO payment_verifications (tenant_id, order_id, method, amount, reference, proof_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, created_at',
    [request.user!.tenantId, parsed.data.orderId, parsed.data.method, parsed.data.amount, verification.providerReference, parsed.data.proofUrl ?? null],
  )
  await createNotification(request.user!.tenantId, 'payment_verification', 'Payment needs review', `A ${parsed.data.method} payment of Rs. ${parsed.data.amount.toLocaleString()} is waiting for human verification`)
  return reply.code(201).send({ verification: result.rows[0], note: 'Payment remains pending until human verification.' })
})

app.get('/api/payments/verification-requests', { preHandler: requireAuth }, async (request) => {
  const result = await query(
    'SELECT v.id, v.order_id, v.method, v.amount, v.reference, v.proof_url, v.status, v.reviewed_at, v.created_at, c.name AS customer_name FROM payment_verifications v JOIN orders o ON o.id = v.order_id JOIN customers c ON c.id = o.customer_id WHERE v.tenant_id = $1 ORDER BY v.created_at DESC',
    [request.user!.tenantId],
  )
  return { verifications: result.rows }
})

app.post('/api/payments/verification-requests/:id/decision', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const parsed = decisionSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payment decision' })
  const result = await query<{ id: string; order_id: string; status: string }>(
    'UPDATE payment_verifications SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3 AND tenant_id = $4 AND status = $5 RETURNING id, order_id, status',
    [parsed.data.decision, request.user!.id, uuidParam(request), request.user!.tenantId, 'pending'],
  )
  if (!result.rows[0]) return reply.code(404).send({ error: 'Pending payment verification not found' })
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: `payment.${parsed.data.decision}`, entityType: 'payment_verification', entityId: result.rows[0].id, metadata: { orderId: result.rows[0].order_id } })
  return { verification: result.rows[0] }
})

app.post('/api/supplier-orders', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = supplierSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid supplier order data', details: parsed.error.flatten() })
  const order = await query<{ id: string }>('SELECT id FROM orders WHERE id = $1 AND tenant_id = $2', [parsed.data.orderId, request.user!.tenantId])
  if (!order.rows[0]) return reply.code(404).send({ error: 'Order not found' })
  const adapter = new AuthorizationRequiredSupplier(parsed.data.supplierKind)
  const submission = await adapter.submitOrder()
  const result = await query(
    'INSERT INTO supplier_orders (tenant_id, order_id, supplier_kind, status) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, order_id, supplier_kind) DO UPDATE SET status = EXCLUDED.status RETURNING id, status, supplier_order_id, created_at',
    [request.user!.tenantId, parsed.data.orderId, parsed.data.supplierKind, submission.status],
  )
  await createNotification(request.user!.tenantId, 'supplier_review', 'Supplier order needs review', `A ${parsed.data.supplierKind} order is pending authorization. Nothing was sent to the supplier.`)
  return reply.code(201).send({ supplierOrder: result.rows[0], note: 'Supplier submission requires an approved adapter and authorization.' })
})

app.get('/api/supplier-orders', { preHandler: requireAuth }, async (request) => {
  const result = await query(
    'SELECT s.id, s.order_id, s.supplier_kind, s.supplier_order_id, s.status, s.error_message, s.created_at, c.name AS customer_name, p.name AS product_name FROM supplier_orders s JOIN orders o ON o.id = s.order_id JOIN customers c ON c.id = o.customer_id JOIN products p ON p.id = o.product_id WHERE s.tenant_id = $1 ORDER BY s.created_at DESC',
    [request.user!.tenantId],
  )
  return { supplierOrders: result.rows }
})

app.post('/api/supplier-orders/:id/decision', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
  const parsed = decisionSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid supplier decision' })
  const status = parsed.data.decision === 'approved' ? 'approved_manual_review' : 'rejected'
  const result = await query<{ id: string; order_id: string; status: string }>(
    'UPDATE supplier_orders SET status = $1 WHERE id = $2 AND tenant_id = $3 AND status = $4 RETURNING id, order_id, status',
    [status, uuidParam(request), request.user!.tenantId, 'pending_authorization'],
  )
  if (!result.rows[0]) return reply.code(404).send({ error: 'Pending supplier order not found' })
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: `supplier.${parsed.data.decision}`, entityType: 'supplier_order', entityId: result.rows[0].id, metadata: { orderId: result.rows[0].order_id, externalOrderPlaced: false } })
  return { supplierOrder: result.rows[0], note: 'Approval records human intent only; no external supplier order was placed.' }
})

app.get('/api/conversations', { preHandler: requireAuth }, async (request) => {
  const result = await query(
    `SELECT c.id, c.customer_id, c.channel, c.status, c.human_takeover, c.last_inbound_at, c.external_thread_id, c.created_at, c.updated_at,
            u.name AS customer_name, u.phone,
            (SELECT body FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT o.id FROM orders o WHERE o.conversation_id = c.id ORDER BY o.created_at DESC LIMIT 1) AS order_id,
            (SELECT o.status FROM orders o WHERE o.conversation_id = c.id ORDER BY o.created_at DESC LIMIT 1) AS order_status,
            (SELECT count(*)::int FROM conversation_messages m WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS inbound_count
     FROM conversations c
     JOIN customers u ON u.id = c.customer_id
     WHERE c.tenant_id = $1
     ORDER BY c.updated_at DESC`,
    [request.user!.tenantId],
  )
  return { conversations: result.rows }
})

app.post('/api/conversations', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = conversationSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid conversation data' })
  const customer = await query<{ id: string }>(
    'INSERT INTO customers (tenant_id, name, phone, city, address) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, address = EXCLUDED.address RETURNING id',
    [request.user!.tenantId, parsed.data.customer.name, parsed.data.customer.phone, parsed.data.customer.city ?? null, parsed.data.customer.address ?? null],
  )
  const result = await query(
    'INSERT INTO conversations (tenant_id, customer_id, channel) VALUES ($1,$2,$3) RETURNING id, channel, status, created_at, updated_at',
    [request.user!.tenantId, customer.rows[0].id, parsed.data.channel],
  )
  return reply.code(201).send({ conversation: result.rows[0] })
})

app.get('/api/conversations/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid conversation id' })
  const owned = await query('SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])
  if (!owned.rows[0]) return reply.code(404).send({ error: 'Conversation not found' })
  const result = await query('SELECT id, direction, body, status, reply_mode, template_name, ai_generated, sent_at, last_error, created_by, created_at FROM conversation_messages WHERE conversation_id = $1 AND tenant_id = $2 ORDER BY created_at ASC', [id, request.user!.tenantId])
  return { messages: result.rows }
})

app.post('/api/conversations/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = messageSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid message data' })
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid conversation id' })
  const owned = await query('SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])
  if (!owned.rows[0]) return reply.code(404).send({ error: 'Conversation not found' })
  const result = await query(
    'INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, direction, body, status, created_at',
    [request.user!.tenantId, id, parsed.data.direction, parsed.data.body, parsed.data.direction === 'outbound' ? 'draft' : parsed.data.status, request.user!.id],
  )
  await query('UPDATE conversations SET updated_at = now() WHERE id = $1 AND tenant_id = $2', [id, request.user!.tenantId])
  return reply.code(201).send({ message: result.rows[0], note: parsed.data.direction === 'outbound' ? 'Outbound message remains a draft until a human approves and an official channel is connected.' : undefined })
})

app.post('/api/publishing/jobs', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = publishSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid publishing job data', details: parsed.error.flatten() })
  if (new Date(parsed.data.scheduledFor).getTime() < Date.now() - 60_000) return reply.code(400).send({ error: 'Scheduled time must be in the future' })
  const check = await query<{
    account_status: string; account_platform: string; account_category: string | null; daily_limit: number; posted_that_day: number
    draft_status: string; draft_platform: string; product_category: string | null; stock: number | null; image_url: string | null; duplicate: boolean
  }>(
    `SELECT a.status AS account_status, a.platform AS account_platform, a.category AS account_category, a.daily_limit,
      (SELECT COUNT(*)::int FROM publishing_jobs j WHERE j.social_account_id = a.id AND j.status NOT IN ('cancelled', 'failed')
        AND date_trunc('day', j.scheduled_for AT TIME ZONE $5) = date_trunc('day', $4::timestamptz AT TIME ZONE $5)) AS posted_that_day,
      d.status AS draft_status, d.platform AS draft_platform, p.category AS product_category, p.stock, p.image_url,
      EXISTS (SELECT 1 FROM publishing_jobs j WHERE j.content_draft_id = d.id AND j.social_account_id = a.id AND j.status NOT IN ('cancelled', 'failed')) AS duplicate
     FROM content_drafts d
     JOIN social_accounts a ON a.id = $2 AND a.tenant_id = d.tenant_id
     LEFT JOIN products p ON p.id = d.product_id AND p.tenant_id = d.tenant_id
     WHERE d.id = $1 AND d.tenant_id = $3`,
    [parsed.data.contentDraftId, parsed.data.socialAccountId, request.user!.tenantId, parsed.data.scheduledFor, config.BUSINESS_TIMEZONE],
  )
  const row = check.rows[0]
  if (!row) return reply.code(404).send({ error: 'Content draft or social account not found' })
  if (row.duplicate) return reply.code(409).send({ error: 'This content is already scheduled for this account' })
  const validation = validatePublish({
    account: { status: row.account_status, platform: row.account_platform, category: row.account_category, dailyLimit: row.daily_limit, postedToday: row.posted_that_day },
    product: row.product_category === null || row.stock === null ? null : { category: row.product_category, stock: row.stock, imageUrl: row.image_url },
    draft: { status: row.draft_status, platform: row.draft_platform },
    requireApproval: true,
  })
  if (!validation.ok) return reply.code(409).send({ error: 'Publishing validation failed', reasons: validation.errors })
  const result = await query(
    'INSERT INTO publishing_jobs (tenant_id, content_draft_id, social_account_id, scheduled_for) VALUES ($1,$2,$3,$4) RETURNING id, scheduled_for, status, created_at',
    [request.user!.tenantId, parsed.data.contentDraftId, parsed.data.socialAccountId, parsed.data.scheduledFor],
  )
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'publishing_job.created', entityType: 'publishing_job', entityId: result.rows[0].id as string })
  const delivery = await deliverJob(request.user!.tenantId, result.rows[0].id as string)
  return reply.code(201).send({ job: { ...result.rows[0], status: delivery.status }, delivery })
})


// ---------------------------------------------------------------------------
// Customer chat: Facebook Messenger + Instagram DM through the official Meta APIs.
// Not verified against a live Meta app in the authoring session. Setup: DEPLOYMENT.md ("Meta customer chat").
// ---------------------------------------------------------------------------
type MetaIntegrationRow = { tenant_id: string; encrypted_secret: string | null; config: Record<string, string> }

async function metaIntegrationForAccount(accountId: string) {
  const result = await query<MetaIntegrationRow>("SELECT tenant_id, encrypted_secret, config FROM integrations WHERE provider = 'meta' AND enabled = true AND (config->>'pageId' = $1 OR config->>'instagramId' = $1) ORDER BY created_at LIMIT 1", [accountId])
  return result.rows[0] ?? null
}

async function metaClientFor(tenantId: string) {
  const result = await query<{ encrypted_secret: string | null }>("SELECT encrypted_secret FROM integrations WHERE tenant_id = $1 AND provider = 'meta' AND enabled = true AND encrypted_secret IS NOT NULL ORDER BY created_at LIMIT 1", [tenantId])
  if (!result.rows[0]?.encrypted_secret) return null
  return new MetaClient(decryptSecret(result.rows[0].encrypted_secret, integrationKey()), undefined, config.META_GRAPH_VERSION)
}

// Sends one stored outbound message. Status becomes 'sent' ONLY after Meta confirms it.
async function sendChatMessage(tenantId: string, conversationId: string, messageId: string, userId: string | null): Promise<{ ok: boolean; status: number; message: string }> {
  const found = await query<{ body: string; direction: string; status: string; reply_mode: string; channel: string; external_thread_id: string | null; last_inbound_at: string | null }>(
    'SELECT m.body, m.direction, m.status, m.reply_mode, c.channel, c.external_thread_id, c.last_inbound_at FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1 AND m.conversation_id = $2 AND m.tenant_id = $3',
    [messageId, conversationId, tenantId],
  )
  const row = found.rows[0]
  if (!row) return { ok: false, status: 404, message: 'Message not found' }
  if (row.direction !== 'outbound') return { ok: false, status: 400, message: 'Only outbound replies can be sent' }
  if (row.status === 'sent') return { ok: false, status: 409, message: 'This message was already sent' }
  if (!['facebook', 'instagram', 'whatsapp'].includes(row.channel) || !row.external_thread_id) return { ok: false, status: 400, message: 'This conversation is not linked to Facebook, Instagram or WhatsApp, so nothing can be sent from here. Copy the reply manually.' }
  if (row.channel === 'whatsapp') {
    if (!isWithinReplyWindow(row.last_inbound_at, Date.now(), WHATSAPP_WINDOW_MS)) {
      await query("UPDATE conversations SET status = 'pending', updated_at = now() WHERE id = $1 AND tenant_id = $2", [conversationId, tenantId])
      return { ok: false, status: 409, message: 'WhatsApp allows free-form replies only within 24 hours of the customer’s last message. Needs template / manual reply.' }
    }
    try {
      await sendWhatsAppText(tenantId, row.external_thread_id, row.body)
      await query("UPDATE conversation_messages SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1 AND tenant_id = $2", [messageId, tenantId])
      if (userId) await query('UPDATE conversations SET human_takeover = true, updated_at = now() WHERE id = $1 AND tenant_id = $2', [conversationId, tenantId])
      else await query('UPDATE conversations SET updated_at = now() WHERE id = $1 AND tenant_id = $2', [conversationId, tenantId])
      await writeAuditLog({ tenantId, userId, action: 'chat.message_sent', entityType: 'conversation_message', entityId: messageId, metadata: { channel: 'whatsapp' } })
      return { ok: true, status: 200, message: 'WhatsApp confirmed the message.' }
    } catch (error) {
      const message = error instanceof MetaError ? error.message : 'Unexpected error while sending to WhatsApp'
      await query('UPDATE conversation_messages SET last_error = $1 WHERE id = $2 AND tenant_id = $3', [message, messageId, tenantId])
      await createNotification(tenantId, 'chat_send_failed', 'Reply could not be sent', message)
      return { ok: false, status: 502, message }
    }
  }
  const comment = isCommentThread(row.external_thread_id)
  if (!(comment && row.reply_mode !== 'private') && !isWithinReplyWindow(row.last_inbound_at, Date.now(), comment ? COMMENT_REPLY_WINDOW_MS : undefined)) {
    await query("UPDATE conversations SET status = 'pending', updated_at = now() WHERE id = $1 AND tenant_id = $2", [conversationId, tenantId])
    return { ok: false, status: 409, message: comment ? 'Meta allows a private reply to a comment only within 7 days. This window has closed.' : 'Meta allows replies only within 24 hours of the customer’s last message. Needs template / manual reply.' }
  }
  const client = await metaClientFor(tenantId)
  if (!client) return { ok: false, status: 400, message: 'Add and enable a Meta integration (Page token) in Integrations to send replies.' }
  const publicReply = comment && row.reply_mode !== 'private'
  if (publicReply) {
    // Public replies are visible to everybody: never personal data, payment details or links.
    const safe = checkPublicReply(row.body)
    if (!safe.ok) return { ok: false, status: 422, message: `This public reply cannot be sent: ${safe.reasons.join('; ')}. Edit it first.` }
    if (row.reply_mode === 'public_ack') {
      // The note says "we sent you a private message", so it goes out only after that private message was really confirmed.
      const privateSent = await query("SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'outbound' AND reply_mode = 'private' AND status = 'sent' LIMIT 1", [conversationId, tenantId])
      if (!privateSent.rows[0]) return { ok: false, status: 409, message: 'Send the private message first. This public note says a private message was sent.' }
    }
  }
  try {
    if (publicReply) await client.replyToComment(row.channel as 'facebook' | 'instagram', row.external_thread_id.slice(2), row.body)
    else if (comment) await client.sendPrivateReply(row.external_thread_id.slice(2), row.body)
    else await client.sendText(row.external_thread_id, row.body)
    await query("UPDATE conversation_messages SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1 AND tenant_id = $2", [messageId, tenantId])
    if (userId) await query('UPDATE conversations SET human_takeover = true, updated_at = now() WHERE id = $1 AND tenant_id = $2', [conversationId, tenantId])
    else await query('UPDATE conversations SET updated_at = now() WHERE id = $1 AND tenant_id = $2', [conversationId, tenantId])
    await writeAuditLog({ tenantId, userId, action: 'chat.message_sent', entityType: 'conversation_message', entityId: messageId, metadata: { channel: row.channel } })
    return { ok: true, status: 200, message: 'Meta confirmed the message.' }
  } catch (error) {
    const message = error instanceof MetaError ? error.message : 'Unexpected error while sending to Meta'
    await query('UPDATE conversation_messages SET last_error = $1 WHERE id = $2 AND tenant_id = $3', [message, messageId, tenantId])
    await createNotification(tenantId, 'chat_send_failed', 'Reply could not be sent', message)
    return { ok: false, status: 502, message }
  }
}

async function loadTenantCatalog(tenantId: string): Promise<CatalogProduct[]> {
  const catalogRes = await query<CatalogProduct>(
    'SELECT id, name, category, selling_price, stock, description, is_advance_payment, sku FROM products WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 300',
    [tenantId],
  )
  const variantsRes = await query<ProductVariant & { product_id: string }>(
    'SELECT id, product_id, sku, title, option1_name, option1_value, option2_name, option2_value, selling_price, stock FROM product_variants WHERE tenant_id = $1',
    [tenantId],
  )
  const variantsByProduct = new Map<string, ProductVariant[]>()
  for (const v of variantsRes.rows) {
    const list = variantsByProduct.get(v.product_id) ?? []
    list.push(v)
    variantsByProduct.set(v.product_id, list)
  }
  for (const p of catalogRes.rows) {
    p.variants = variantsByProduct.get(p.id) ?? []
  }
  return catalogRes.rows
}

async function processInboundChat(event: InboundChatEvent) {
  const integration = await metaIntegrationForAccount(event.accountId)
  if (!integration) return
  const tenantId = integration.tenant_id
  const label = event.senderName ?? (event.channel === 'facebook' ? 'Facebook customer' : 'Instagram customer')
  const threadId = event.kind === 'comment' ? `c:${event.messageId}` : event.senderId
  const customer = await query<{ id: string }>('INSERT INTO customers (tenant_id, name, phone) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id', [tenantId, label, customerKey(event.channel, event.senderId)])
  let conversation = (await query<{ id: string; human_takeover: boolean }>("SELECT id, human_takeover FROM conversations WHERE tenant_id = $1 AND channel = $2 AND external_thread_id = $3 AND status <> 'closed' ORDER BY created_at DESC LIMIT 1", [tenantId, event.channel, threadId])).rows[0]
  if (!conversation) conversation = (await query<{ id: string; human_takeover: boolean }>('INSERT INTO conversations (tenant_id, customer_id, channel, external_thread_id, last_inbound_at) VALUES ($1,$2,$3,$4, now()) RETURNING id, human_takeover', [tenantId, customer.rows[0].id, event.channel, threadId])).rows[0]
  const history = await recentInboundTexts(tenantId, conversation.id, 6)
  const previous = { rows: history.length ? [{ body: history[history.length - 1] }] : [] }
  const inserted = await query<{ id: string }>("INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, external_message_id) VALUES ($1,$2,'inbound',$3,'sent',$4) ON CONFLICT DO NOTHING RETURNING id", [tenantId, conversation.id, event.text, event.messageId])
  if (!inserted.rows[0]) return // Meta retried a message we already stored.
  await query("UPDATE conversations SET last_inbound_at = now(), status = 'open', updated_at = now() WHERE id = $1 AND tenant_id = $2", [conversation.id, tenantId])
  await query('UPDATE tenants SET meta_last_message_at = now() WHERE id = $1', [tenantId])
  await createNotification(tenantId, 'new_message', `New ${event.channel} ${event.kind}`, event.text.slice(0, 120))
  const aiMode = integration.config.aiMode ?? 'approval'
  if (conversation.human_takeover || aiMode === 'manual') return
  const catalog = await loadTenantCatalog(tenantId)
  let reply = composeReply(event.text, catalog, { priorText: previous.rows[0]?.body, history })
  // Auto mode: when the customer has given every order detail, the order is created here and the owner gets the Markaz text.
  const autoOrder = aiMode === 'auto' && event.kind !== 'comment' ? await autoOrderFromChat(tenantId, conversation.id, catalog) : null
  if (autoOrder) reply = { text: autoOrder.text, needsHuman: false, productIds: [], allowedNumbers: [] }
  else if (config.AI_PROVIDER === 'openai' && config.AI_API_KEY) reply = await composeWithLlm(event.text, catalog, reply, { baseUrl: config.AI_BASE_URL, apiKey: config.AI_API_KEY, model: config.AI_MODEL })
  const insertDraft = async (body: string, replyMode: 'private' | 'public' | 'public_ack') => (await query<{ id: string }>("INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, ai_generated, reply_mode) VALUES ($1,$2,'outbound',$3,'draft', true, $4) RETURNING id", [tenantId, conversation.id, body, replyMode])).rows[0].id
  const commentMode = event.kind === 'comment' ? parseCommentReplyMode(integration.config.commentReplyMode) : 'private'
  const drafts: string[] = []
  if (commentMode === 'public') {
    // Only a public-safe short version is allowed. If none exists, fall back to a private message so the customer is not ignored.
    const publicText = toPublicReply(reply.text)
    drafts.push(publicText ? await insertDraft(publicText, 'public') : await insertDraft(reply.text, 'private'))
  } else {
    drafts.push(await insertDraft(reply.text, 'private'))
    if (commentMode === 'both') drafts.push(await insertDraft(PUBLIC_ACK_TEXT, 'public_ack'))
  }
  if (reply.needsHuman) {
    await query("UPDATE conversations SET status = 'pending', updated_at = now() WHERE id = $1 AND tenant_id = $2", [conversation.id, tenantId])
    await createNotification(tenantId, 'chat_needs_human', 'A customer chat needs you', 'The assistant cannot answer this safely (delivery cost, order confirmation or unknown product).')
  }
  if (aiMode === 'auto' && !reply.needsHuman) {
    for (const draftId of drafts) {
      const sent = await sendChatMessage(tenantId, conversation.id, draftId, null)
      if (!sent.ok) break // never send the public note if the private message failed
    }
  }
}

async function processInboundWhatsApp(event: InboundWhatsApp) {
  const result = await query<MetaIntegrationRow>(
    "SELECT tenant_id, encrypted_secret, config FROM integrations WHERE provider = 'whatsapp' AND enabled = true AND (config->>'phoneNumberId' = $1) ORDER BY created_at LIMIT 1",
    [event.phoneNumberId],
  )
  const integration = result.rows[0]
  if (!integration) return
  const tenantId = integration.tenant_id
  const label = event.senderName ?? `WhatsApp ${event.from}`
  const customer = await query<{ id: string }>(
    'INSERT INTO customers (tenant_id, name, phone) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, phone) DO UPDATE SET name = COALESCE(NULLIF(EXCLUDED.name, $2), customers.name) RETURNING id',
    [tenantId, label, event.from],
  )
  let conversation = (
    await query<{ id: string; human_takeover: boolean }>(
      "SELECT id, human_takeover FROM conversations WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_thread_id = $2 AND status <> 'closed' ORDER BY created_at DESC LIMIT 1",
      [tenantId, event.from],
    )
  ).rows[0]
  if (!conversation) {
    conversation = (
      await query<{ id: string; human_takeover: boolean }>(
        "INSERT INTO conversations (tenant_id, customer_id, channel, external_thread_id, last_inbound_at) VALUES ($1,$2,'whatsapp',$3, now()) RETURNING id, human_takeover",
        [tenantId, customer.rows[0].id, event.from],
      )
    ).rows[0]
  }
  const history = await recentInboundTexts(tenantId, conversation.id, 6)
  const previous = { rows: history.length ? [{ body: history[history.length - 1] }] : [] }
  const inserted = await query<{ id: string }>(
    "INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, external_message_id) VALUES ($1,$2,'inbound',$3,'sent',$4) ON CONFLICT DO NOTHING RETURNING id",
    [tenantId, conversation.id, event.text, event.messageId],
  )
  if (!inserted.rows[0]) return // Deduplicated
  await query("UPDATE conversations SET last_inbound_at = now(), status = 'open', updated_at = now() WHERE id = $1 AND tenant_id = $2", [conversation.id, tenantId])
  await query('UPDATE tenants SET meta_last_message_at = now() WHERE id = $1', [tenantId])
  await createNotification(tenantId, 'new_message', 'New WhatsApp message', event.text.slice(0, 120))

  const aiMode = integration.config.aiMode ?? 'approval'
  if (conversation.human_takeover || aiMode === 'manual') return

  const catalog = await loadTenantCatalog(tenantId)
  let reply = composeReply(event.text, catalog, { priorText: previous.rows[0]?.body, history })
  const autoOrder = aiMode === 'auto' ? await autoOrderFromChat(tenantId, conversation.id, catalog) : null
  if (autoOrder) {
    reply = { text: autoOrder.text, needsHuman: false, productIds: [], allowedNumbers: [] }
  } else if (config.AI_PROVIDER === 'openai' && config.AI_API_KEY) {
    reply = await composeWithLlm(event.text, catalog, reply, { baseUrl: config.AI_BASE_URL, apiKey: config.AI_API_KEY, model: config.AI_MODEL })
  }

  const draftId = (
    await query<{ id: string }>(
      "INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, ai_generated, reply_mode) VALUES ($1,$2,'outbound',$3,'draft', true, 'private') RETURNING id",
      [tenantId, conversation.id, reply.text],
    )
  ).rows[0].id

  if (reply.needsHuman) {
    await query("UPDATE conversations SET status = 'pending', updated_at = now() WHERE id = $1 AND tenant_id = $2", [conversation.id, tenantId])
    await createNotification(tenantId, 'chat_needs_human', 'A customer chat needs you', 'The assistant cannot answer this safely (delivery cost, order confirmation or unknown product).')
  }

  if (aiMode === 'auto' && !reply.needsHuman) {
    await sendChatMessage(tenantId, conversation.id, draftId, null)
  }
}

await app.register(async (scope) => {
  // Meta signs the RAW body, so this scope keeps it. Only the webhook routes live here.
  scope.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    ;(request as FastifyRequest & { rawBody?: string }).rawBody = body as string
    try {
      done(null, body ? JSON.parse(body as string) : {})
    } catch {
      const failure = new Error('Invalid JSON') as Error & { statusCode: number }
      failure.statusCode = 400
      done(failure, undefined)
    }
  })
  scope.get('/webhooks/meta', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>
    if (q['hub.mode'] === 'subscribe' && q['hub.challenge']) {
      const token = q['hub.verify_token']
      if (!token) return reply.code(403).send({ error: 'Missing verify token' })
      let matched = false
      if (config.META_VERIFY_TOKEN && token === config.META_VERIFY_TOKEN) {
        matched = true
        await query('UPDATE tenants SET meta_webhook_verified = true, meta_last_webhook_at = now() WHERE meta_verify_token IS NULL')
      } else {
        const tenant = await query<{ id: string }>('SELECT id FROM tenants WHERE meta_verify_token = $1 LIMIT 1', [token])
        if (tenant.rows[0]) {
          matched = true
          await query('UPDATE tenants SET meta_webhook_verified = true, meta_last_webhook_at = now() WHERE id = $1', [tenant.rows[0].id])
        }
      }
      if (matched) return reply.type('text/plain').send(q['hub.challenge'])
    }
    return reply.code(403).send({ error: 'Webhook verification failed' })
  })
  scope.post('/webhooks/meta', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!config.META_APP_SECRET) return reply.code(503).send({ error: 'Meta webhook is not configured (META_APP_SECRET missing)' })
    const raw = (request as FastifyRequest & { rawBody?: string }).rawBody ?? ''
    const sigHeader = request.headers['x-hub-signature-256'] as string | undefined
    if (!verifyMetaSignature(raw, sigHeader, config.META_APP_SECRET)) {
      return reply.code(401).send({ error: 'Invalid signature' })
    }
    const body = request.body as Record<string, unknown> | null
    if (body?.object === 'whatsapp_business_account') {
      const events = parseWhatsAppWebhook(body)
      const work = (async () => {
        for (const event of events) {
          try { await processInboundWhatsApp(event) } catch (error) { request.log.error(error) }
        }
      })()
      if (config.NODE_ENV === 'test') await work
      return reply.code(200).send('EVENT_RECEIVED')
    }
    const events = parseMetaWebhook(request.body)
    const work = (async () => {
      for (const event of events) {
        try { await processInboundChat(event) } catch (error) { request.log.error(error) }
      }
    })()
    if (config.NODE_ENV === 'test') await work
    return reply.code(200).send('EVENT_RECEIVED')
  })
})

app.get('/api/chat/setup', { preHandler: requireAuth }, async (request) => {
  const tenant = (await query<{ public_api_url: string | null; meta_verify_token: string | null; meta_webhook_verified: boolean; meta_last_webhook_at: string | null; meta_last_message_at: string | null }>('SELECT public_api_url, meta_verify_token, meta_webhook_verified, meta_last_webhook_at, meta_last_message_at FROM tenants WHERE id = $1', [request.user!.tenantId])).rows[0]
  const base = (tenant?.public_api_url || config.PUBLIC_API_URL || config.APP_URL).replace(/\/+$/, '')
  return {
    callbackUrl: `${base}/webhooks/meta`,
    publicApiUrl: tenant?.public_api_url || config.PUBLIC_API_URL || '',
    verifyToken: tenant?.meta_verify_token || config.META_VERIFY_TOKEN || '',
    webhookVerified: Boolean(tenant?.meta_webhook_verified),
    lastWebhookAt: tenant?.meta_last_webhook_at,
    lastMessageAt: tenant?.meta_last_message_at,
  }
})

// The tool adds /webhooks/meta itself, so a pasted full callback URL is reduced to its base address.
const cleanPublicApiUrl = (value: string) => value.trim().replace(/\/webhooks\/meta\/?$/i, '').replace(/\/+$/, '')

const chatSetupPatchSchema = z.object({
  publicApiUrl: z.string().url().or(z.literal('')).optional(),
  verifyToken: z.string().min(8).max(120).optional(),
})

app.post('/api/chat/setup', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
  const parsed = chatSetupPatchSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid chat setup data', details: parsed.error.flatten() })
  await query(
    'UPDATE tenants SET public_api_url = COALESCE($1, public_api_url), meta_verify_token = COALESCE($2, meta_verify_token) WHERE id = $3',
    [parsed.data.publicApiUrl ? cleanPublicApiUrl(parsed.data.publicApiUrl) : null, parsed.data.verifyToken ?? null, request.user!.tenantId]
  )
  const tenant = (await query<{ public_api_url: string | null; meta_verify_token: string | null; meta_webhook_verified: boolean; meta_last_webhook_at: string | null; meta_last_message_at: string | null }>('SELECT public_api_url, meta_verify_token, meta_webhook_verified, meta_last_webhook_at, meta_last_message_at FROM tenants WHERE id = $1', [request.user!.tenantId])).rows[0]
  const base = (tenant?.public_api_url || config.PUBLIC_API_URL || config.APP_URL).replace(/\/+$/, '')
  return {
    callbackUrl: `${base}/webhooks/meta`,
    publicApiUrl: tenant?.public_api_url || config.PUBLIC_API_URL || '',
    verifyToken: tenant?.meta_verify_token || config.META_VERIFY_TOKEN || '',
    webhookVerified: Boolean(tenant?.meta_webhook_verified),
    lastWebhookAt: tenant?.meta_last_webhook_at,
    lastMessageAt: tenant?.meta_last_message_at,
  }
})

app.get('/api/conversations/:id/markaz-summary', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid conversation id' })
  const latestOrder = await query<{ id: string }>('SELECT id FROM orders WHERE conversation_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1', [id, request.user!.tenantId])
  if (!latestOrder.rows[0]) return reply.code(404).send({ error: 'No order found for this conversation' })
  const summary = await markazSummaryText(request.user!.tenantId, latestOrder.rows[0].id)
  if (!summary) return reply.code(404).send({ error: 'Order summary not available' })
  return { summary, orderId: latestOrder.rows[0].id }
})

const conversationPatchSchema = z.object({ humanTakeover: z.boolean().optional(), status: z.enum(['open', 'pending', 'closed']).optional() }).refine((v) => Object.keys(v).length > 0, 'Nothing to update')
const messagePatchSchema = z.object({ body: z.string().min(1).max(2000) })
const chatOrderSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  variantSku: z.string().max(120).optional(),
  variantTitle: z.string().max(180).optional(),
  quantity: z.number().int().positive().max(1000),
  name: z.string().min(2).max(160),
  phone: z.string().min(7).max(40),
  city: z.string().min(2).max(100),
  address: z.string().min(5).max(500),
  paymentMethod: z.enum(['cod', 'bank_transfer', 'easypaisa', 'jazzcash', 'other']).default('cod'),
  notes: z.string().max(500).optional(),
})

app.patch('/api/conversations/:id', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  const parsed = conversationPatchSchema.safeParse(request.body)
  if (!id || !parsed.success) return reply.code(400).send({ error: 'Invalid conversation update' })
  const result = await query('UPDATE conversations SET human_takeover = COALESCE($1::boolean, human_takeover), status = COALESCE($2::text, status), updated_at = now() WHERE id = $3 AND tenant_id = $4 RETURNING id, status, human_takeover', [parsed.data.humanTakeover ?? null, parsed.data.status ?? null, id, request.user!.tenantId])
  if (!result.rows[0]) return reply.code(404).send({ error: 'Conversation not found' })
  await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'conversation.updated', entityType: 'conversation', entityId: id, metadata: parsed.data })
  return { conversation: result.rows[0] }
})

app.patch('/api/conversations/:id/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  const messageId = uuidParam(request, 'messageId')
  const parsed = messagePatchSchema.safeParse(request.body)
  if (!id || !messageId || !parsed.success) return reply.code(400).send({ error: 'Invalid message update' })
  const result = await query("UPDATE conversation_messages SET body = $1 WHERE id = $2 AND conversation_id = $3 AND tenant_id = $4 AND direction = 'outbound' AND status <> 'sent' RETURNING id, body, status", [parsed.data.body, messageId, id, request.user!.tenantId])
  if (!result.rows[0]) return reply.code(404).send({ error: 'Editable draft not found (sent messages cannot be edited)' })
  return { message: result.rows[0] }
})

app.post('/api/conversations/:id/messages/:messageId/send', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
  const id = uuidParam(request)
  const messageId = uuidParam(request, 'messageId')
  if (!id || !messageId) return reply.code(400).send({ error: 'Invalid id' })
  const result = await sendChatMessage(request.user!.tenantId, id, messageId, request.user!.id)
  if (!result.ok) return reply.code(result.status).send({ error: result.message })
  return { status: 'sent', message: result.message }
})

app.post('/api/conversations/:id/create-order', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  const parsed = chatOrderSchema.safeParse(request.body)
  if (!id || !parsed.success) return reply.code(400).send({ error: 'Invalid order data', details: parsed.success ? undefined : parsed.error.flatten() })
  const tenantId = request.user!.tenantId
  const owned = await query('SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2', [id, tenantId])
  if (!owned.rows[0]) return reply.code(404).send({ error: 'Conversation not found' })
  const result = await createOrderFromChat(tenantId, id, parsed.data, request.user!.id)
  if (!result.ok) return reply.code(result.status).send({ error: result.error })
  return reply.code(201).send({ order: result.order })
})

// Prepared text for entering the order in the Markaz app by hand. Nothing is submitted to Markaz.
app.get('/api/orders/:id/markaz-summary', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid order id' })
  const summary = await markazSummaryText(request.user!.tenantId, id)
  if (!summary) return reply.code(404).send({ error: 'Order not found' })
  return { summary, note: 'Prepared for manual entry in Markaz. Nothing was submitted to Markaz.' }
})

app.get('/api/products/:id/variants', { preHandler: requireAuth }, async (request, reply) => {
  const id = uuidParam(request)
  if (!id) return reply.code(400).send({ error: 'Invalid product id' })
  const result = await query(
    'SELECT id, sku, title, option1_name, option1_value, option2_name, option2_value, selling_price, stock FROM product_variants WHERE product_id = $1 AND tenant_id = $2 ORDER BY created_at',
    [id, request.user!.tenantId],
  )
  return { variants: result.rows }
})

app.setErrorHandler((error, request, reply) => {
  // Client mistakes (bad JSON, empty body, rate limit...) keep their 4xx status instead of becoming a fake 500.
  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500
  if (statusCode >= 400 && statusCode < 500) return reply.code(statusCode).send({ error: error instanceof Error ? error.message : 'Request failed' })
  request.log.error(error)
  if (error instanceof AIProviderError) {
    return reply.code(error.statusCode).send({ error: error.message })
  }
  return reply.code(500).send({ error: 'Unexpected server error' })
})

registerBillingRoutes(app, requireAuth)
registerPlatformRoutes(app, requireAuth)
registerExtraRoutes(app, requireAuth)
registerAutopilotRoutes(app, requireAuth, deliverJob)
registerLocalRoutes(app, requireAuth, { sourcingSettings, planLimits, deliver: deliverJob })
registerMarkazAutoRoutes(app, requireAuth, { sourcingSettings, planLimits, deliver: deliverJob })
registerGrowthRoutes(app, requireAuth, { sourcingSettings, planLimits })

await applyMigration()
await app.ready()