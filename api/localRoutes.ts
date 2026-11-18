// Purpose: the "Markaz -> post -> customer" flow that runs fully on your own PC with free services:
//   * /api/markaz/scrape      read products from markaz.app pages, add your profit, save to the catalog
//   * /api/channels           connect Bluesky / Mastodon / Discord (checked live before saving)
//   * /api/products/:id/post  write the post from the product data and send it now or at a chosen time
//   * a 30-second timer sends posts that are due (while the app is running)
// A post is "published" only when the service returned an id. Nothing here pretends a call worked.
import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { query } from './db.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { createNotification } from './notifications.js'
import { decryptSecret, encryptSecret, secretHint } from './secrets.js'
import { getContentProvider } from './ai.js'
import { checkLimit } from './limits.js'
import { applyProfit, evaluateCandidate, type ProfitConfig, type SourcingRules } from './sourcing.js'
import { guessCategory, MarkazError, productIdFromUrl, scrapeMarkaz } from './markaz.js'
import { ChannelError, clientFor, freeProviders, isFreeProvider, platformLabel, type FreeProvider } from './freeChannels.js'

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
const integrationKey = () => config.INTEGRATION_ENCRYPTION_KEY ?? createHash('sha256').update(`${config.JWT_SECRET}:integrations`).digest('hex')
const uuid = z.string().uuid()
const FREE_SQL = "('bluesky','mastodon','discord')"
const categories = ['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other'] as const

export type DeliverResult = { status: string; message: string }

// ---------------------------------------------------------------- sending
async function secretFor(tenantId: string, provider: string) {
  const row = (await query<{ encrypted_secret: string | null; config: Record<string, string> }>('SELECT encrypted_secret, config FROM integrations WHERE tenant_id = $1 AND provider = $2 AND enabled = true ORDER BY created_at LIMIT 1', [tenantId, provider])).rows[0]
  if (!row?.encrypted_secret) return null
  return { secret: decryptSecret(row.encrypted_secret, integrationKey()), config: row.config }
}

async function failJob(tenantId: string, jobId: string, provider: string, message: string) {
  await query("UPDATE publishing_jobs SET status = 'failed', provider = $1, attempts = attempts + 1, last_error = $2 WHERE id = $3 AND tenant_id = $4", [provider, message, jobId, tenantId])
  await createNotification(tenantId, 'publishing_failed', `Post could not be sent to ${platformLabel[provider as FreeProvider] ?? provider}`, message)
}

// Sends one job to Bluesky/Mastodon/Discord. A future time is kept as 'scheduled_local' and sent by the timer when due.
export async function deliverFreeChannel(tenantId: string, jobId: string, options: { ignoreTime?: boolean } = {}): Promise<DeliverResult> {
  const found = await query<{ scheduled_for: string; status: string; provider: string | null; content: { caption: string; hashtags: string[] }; image_url: string | null }>(
    'SELECT j.scheduled_for, j.status, a.provider, d.content, p.image_url FROM publishing_jobs j JOIN social_accounts a ON a.id = j.social_account_id JOIN content_drafts d ON d.id = j.content_draft_id LEFT JOIN products p ON p.id = d.product_id WHERE j.id = $1 AND j.tenant_id = $2',
    [jobId, tenantId],
  )
  const job = found.rows[0]
  if (!job) return { status: 'failed', message: 'Job not found' }
  if (!job.provider || !isFreeProvider(job.provider)) return { status: 'failed', message: 'Not a free-channel job' }
  const provider = job.provider
  const credentials = await secretFor(tenantId, provider).catch(() => null)
  if (!credentials) return { status: 'queued', message: `Recorded only. Connect ${platformLabel[provider]} in Channels first.` }
  const due = new Date(job.scheduled_for).getTime() <= Date.now() + 45_000
  if (!due && !options.ignoreTime) {
    await query("UPDATE publishing_jobs SET status = 'scheduled_local', provider = $1, last_error = NULL WHERE id = $2 AND tenant_id = $3 AND status IN ('queued','failed','scheduled_local')", [provider, jobId, tenantId])
    return { status: 'scheduled_local', message: `Waiting. It will be sent automatically at ${new Date(job.scheduled_for).toLocaleString('en-GB', { timeZone: config.BUSINESS_TIMEZONE })} while this app is running.` }
  }
  const claimed = await query("UPDATE publishing_jobs SET status = 'sending' WHERE id = $1 AND tenant_id = $2 AND status IN ('queued','failed','scheduled_local') RETURNING id", [jobId, tenantId])
  if (!claimed.rows[0]) return { status: job.status, message: 'This post is already being sent or was sent.' }
  try {
    const client = clientFor(provider, credentials.secret, credentials.config)
    const sent = await client.send({ text: job.content.caption, hashtags: job.content.hashtags, imageUrl: job.image_url })
    await query("UPDATE publishing_jobs SET status = 'published', provider = $1, external_post_id = $2, attempts = attempts + 1, last_error = $3 WHERE id = $4 AND tenant_id = $5", [provider, sent.url ?? sent.id, sent.note ?? null, jobId, tenantId])
    return { status: 'published', message: `${platformLabel[provider]} confirmed the post.${sent.url ? ` ${sent.url}` : ''}${sent.note ? ` (${sent.note})` : ''}` }
  } catch (error) {
    const message = error instanceof ChannelError ? error.message : 'Unexpected error while sending the post'
    await failJob(tenantId, jobId, provider, message)
    return { status: 'failed', message }
  }
}

let recovered = false
// Timer entry: send every due 'scheduled_local' post. Posts left in 'sending' by a crash are marked failed so you can retry them.
export async function dispatchDueLocalJobs() {
  if (!recovered) {
    recovered = true
    await query("UPDATE publishing_jobs SET status = 'failed', last_error = 'The app stopped while sending. Check the channel before you retry, the post may already be visible.' WHERE status = 'sending'")
  }
  const due = await query<{ id: string; tenant_id: string }>("SELECT id, tenant_id FROM publishing_jobs WHERE status = 'scheduled_local' AND scheduled_for <= now() ORDER BY scheduled_for LIMIT 10")
  for (const job of due.rows) await deliverFreeChannel(job.tenant_id, job.id, { ignoreTime: true })
  return due.rows.length
}

// ---------------------------------------------------------------- routes
type Deps = {
  sourcingSettings: (tenantId: string) => Promise<{ rules: SourcingRules; profit: ProfitConfig }>
  planLimits: (tenantId: string) => Promise<{ product_limit: number; social_account_limit: number } | null>
  deliver: (tenantId: string, jobId: string) => Promise<DeliverResult>
}

const channelSchema = z.object({
  provider: z.enum(['bluesky', 'mastodon', 'discord']),
  secret: z.string().min(8).max(600),
  config: z.record(z.string(), z.string().max(300)).default({}),
})

const scrapeSchema = z.object({
  url: z.string().url().max(500),
  limit: z.number().int().min(1).max(30).default(10),
  pages: z.number().int().min(1).max(3).default(1),
  category: z.enum(categories).optional(),
  defaultStock: z.number().int().min(1).max(1000).default(10),
  profitAmount: z.number().min(0).max(1_000_000).optional(),
  applyQualityRules: z.boolean().default(false),
  dryRun: z.boolean().default(true),
})

const postSchema = z.object({
  accountIds: z.array(uuid).min(1).max(10),
  language: z.enum(['english', 'urdu', 'roman_urdu']).default('roman_urdu'),
  scheduledFor: z.string().datetime().optional(),
  repost: z.boolean().default(false),
})

export function registerLocalRoutes(app: FastifyInstance, requireAuth: Auth, deps: Deps) {
  // ---- channels
  app.get('/api/channels', { preHandler: requireAuth }, async (request) => {
    const rows = await query(
      `SELECT i.id, i.provider, i.label, i.config, i.secret_hint, i.enabled, i.status, i.status_message, i.last_checked_at, a.id AS account_id, a.display_name, a.daily_limit, a.category, a.status AS account_status
       FROM integrations i LEFT JOIN social_accounts a ON a.tenant_id = i.tenant_id AND a.provider = i.provider
       WHERE i.tenant_id = $1 AND i.provider IN ${FREE_SQL} ORDER BY i.created_at`,
      [request.user!.tenantId],
    )
    return { channels: rows.rows, available: freeProviders }
  })

  // Saves a channel ONLY after the service confirmed the credentials (bot is admin, login works, webhook exists...).
  app.post('/api/channels', { preHandler: [requireAuth, requireRole('admin')], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = channelSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid channel data', details: parsed.error.flatten() })
    const { provider, secret } = parsed.data
    const tenantId = request.user!.tenantId
    let identity
    try {
      identity = await clientFor(provider, secret, parsed.data.config).identify()
    } catch (error) {
      return reply.code(400).send({ error: error instanceof ChannelError ? error.message : `${platformLabel[provider]} could not be checked` })
    }
    const existingAccount = await query('SELECT id FROM social_accounts WHERE tenant_id = $1 AND platform = $2 AND external_account_id = $3', [tenantId, provider, identity.externalId])
    if (!existingAccount.rows[0]) {
      const limits = await deps.planLimits(tenantId)
      const count = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM social_accounts WHERE tenant_id = $1 AND status <> 'disconnected'", [tenantId])
      if (!limits || !checkLimit(count.rows[0].count, limits.social_account_limit).allowed) return reply.code(429).send({ error: 'Your plan social account limit is reached' })
    }
    const encrypted = encryptSecret(secret, integrationKey())
    const label = `${platformLabel[provider]}: ${identity.displayName}`.slice(0, 120)
    const existing = await query<{ id: string }>('SELECT id FROM integrations WHERE tenant_id = $1 AND provider = $2', [tenantId, provider])
    let integrationId = existing.rows[0]?.id
    if (integrationId) await query("UPDATE integrations SET label = $1, config = $2, encrypted_secret = $3, secret_hint = $4, enabled = true, status = 'verified', status_message = $5, last_checked_at = now(), updated_at = now() WHERE id = $6 AND tenant_id = $7", [label, JSON.stringify(parsed.data.config), encrypted, secretHint(secret), identity.message, integrationId, tenantId])
    else integrationId = (await query<{ id: string }>("INSERT INTO integrations (tenant_id, provider, label, config, encrypted_secret, secret_hint, enabled, status, status_message, last_checked_at) VALUES ($1,$2,$3,$4,$5,$6,true,'verified',$7, now()) RETURNING id", [tenantId, provider, label, JSON.stringify(parsed.data.config), encrypted, secretHint(secret), identity.message])).rows[0].id
    await query("UPDATE social_accounts SET status = 'disconnected' WHERE tenant_id = $1 AND provider = $2 AND external_account_id <> $3", [tenantId, provider, identity.externalId])
    const account = await query<{ id: string }>(
      "INSERT INTO social_accounts (tenant_id, platform, display_name, external_account_id, status, provider, daily_limit) VALUES ($1,$2,$3,$4,'connected',$2,5) ON CONFLICT (tenant_id, platform, external_account_id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'connected', provider = EXCLUDED.provider RETURNING id",
      [tenantId, provider, identity.displayName.slice(0, 160), identity.externalId],
    )
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'channel.connected', entityType: 'integration', entityId: integrationId, metadata: { provider } })
    return reply.code(201).send({ id: integrationId, accountId: account.rows[0].id, message: identity.message })
  })

  app.post('/api/channels/:id/test', { preHandler: [requireAuth, requireRole('admin')], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const id = uuid.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid channel id' })
    const row = (await query<{ provider: string; encrypted_secret: string | null; config: Record<string, string> }>(`SELECT provider, encrypted_secret, config FROM integrations WHERE id = $1 AND tenant_id = $2 AND provider IN ${FREE_SQL}`, [id.data, request.user!.tenantId])).rows[0]
    if (!row || !isFreeProvider(row.provider)) return reply.code(404).send({ error: 'Channel not found' })
    let status = 'failed'
    let message: string
    try {
      if (!row.encrypted_secret) throw new ChannelError('No key stored. Connect the channel again.')
      message = (await clientFor(row.provider, decryptSecret(row.encrypted_secret, integrationKey()), row.config).identify()).message
      status = 'verified'
    } catch (error) {
      message = error instanceof ChannelError ? error.message : 'The stored key cannot be used. Connect the channel again.'
    }
    await query('UPDATE integrations SET status = $1, status_message = $2, last_checked_at = now() WHERE id = $3 AND tenant_id = $4', [status, message, id.data, request.user!.tenantId])
    return { status, message }
  })

  app.delete('/api/channels/:id', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
    const id = uuid.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid channel id' })
    const removed = await query<{ provider: string }>(`DELETE FROM integrations WHERE id = $1 AND tenant_id = $2 AND provider IN ${FREE_SQL} RETURNING provider`, [id.data, request.user!.tenantId])
    if (!removed.rows[0]) return reply.code(404).send({ error: 'Channel not found' })
    await query("UPDATE social_accounts SET status = 'disconnected' WHERE tenant_id = $1 AND provider = $2", [request.user!.tenantId, removed.rows[0].provider])
    await query("UPDATE publishing_jobs SET status = 'cancelled' WHERE tenant_id = $1 AND status = 'scheduled_local' AND social_account_id IN (SELECT id FROM social_accounts WHERE tenant_id = $1 AND provider = $2)", [request.user!.tenantId, removed.rows[0].provider])
    return reply.code(204).send()
  })

  // ---- Markaz scraping
  app.post('/api/markaz/scrape', { preHandler: [requireAuth, requireRole('manager')], config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = scrapeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() })
    const d = parsed.data
    const tenantId = request.user!.tenantId
    const existing = await query<{ name: string; supplier_url: string | null }>('SELECT lower(name) AS name, supplier_url FROM products WHERE tenant_id = $1', [tenantId])
    const knownIds = new Set(existing.rows.map((r) => (r.supplier_url ? productIdFromUrl(r.supplier_url)?.id : undefined)).filter((v): v is string => Boolean(v)))
    const knownNames = new Set(existing.rows.map((r) => r.name))
    let scraped
    try {
      scraped = await scrapeMarkaz({ url: d.url, limit: d.limit, pages: d.pages, skipIds: knownIds })
    } catch (error) {
      if (error instanceof MarkazError) return reply.code(502).send({ error: error.message })
      throw error
    }
    const settings = await deps.sourcingSettings(tenantId)
    const items = scraped.products.map((product) => {
      const category = d.category ?? guessCategory(product.category, product.name)
      const sellingPrice = applyProfit(product.wholesalePrice, settings.profit, d.profitAmount)
      const reasons: string[] = []
      if (knownNames.has(product.name.toLowerCase())) reasons.push('A product with this name is already in your catalog')
      if (d.applyQualityRules) reasons.push(...evaluateCandidate({ rating: product.rating, reviewCount: product.reviewCount, soldCount: null }, { ...settings.rules, minSold: 0 }).reasons)
      return { product, category, sellingPrice, profit: Math.round((sellingPrice - product.wholesalePrice) * 100) / 100, reasons }
    })
    const accepted = items.filter((item) => item.reasons.length === 0)
    const rejected = items.filter((item) => item.reasons.length > 0).map((item) => ({ name: item.product.name, reasons: item.reasons }))
    const view = accepted.map((item) => ({ name: item.product.name, category: item.category, wholesalePrice: item.product.wholesalePrice, sellingPrice: item.sellingPrice, profit: item.profit, imageUrl: item.product.imageUrl, url: item.product.productUrl, stockLeft: item.product.stockLeft, readFrom: item.product.source }))
    const base = { linksFound: scraped.linksFound, failures: scraped.failures, notes: scraped.notes, rejected }
    if (d.dryRun) return { dryRun: true, products: view, ...base }
    const limits = await deps.planLimits(tenantId)
    if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
    const count = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [tenantId])
    if (!checkLimit(count.rows[0].count, limits.product_limit, accepted.length).allowed) return reply.code(429).send({ error: 'This would exceed the product limit of your plan', usage: { used: count.rows[0].count, limit: limits.product_limit, adding: accepted.length } })
    const ids: string[] = []
    for (const item of accepted) {
      const p = item.product
      const stock = p.stockLeft && p.stockLeft > 0 ? p.stockLeft : d.defaultStock
      const inserted = await query<{ id: string }>(
        "INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url, image_url, rating, review_count, sold_count, source_kind, profit_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,'markaz',$12) RETURNING id",
        [tenantId, p.name, p.description, item.category, p.wholesalePrice, item.sellingPrice, stock, p.productUrl, p.imageUrl, p.rating, p.reviewCount, item.profit],
      )
      ids.push(inserted.rows[0].id)
    }
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'sourcing.markaz_scraped', entityType: 'import_run', metadata: { imported: ids.length, failures: scraped.failures.length } })
    return reply.code(201).send({ dryRun: false, imported: ids.length, productIds: ids, products: view, ...base })
  })

  // ---- post a product now (or at a time) to chosen channels
  app.post('/api/products/:id/post', { preHandler: [requireAuth, requireRole('manager')], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const id = uuid.safeParse((request.params as { id?: string }).id)
    const parsed = postSchema.safeParse(request.body ?? {})
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'Invalid post request' })
    const tenantId = request.user!.tenantId
    const when = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : new Date()
    if (parsed.data.scheduledFor && when.getTime() < Date.now() - 60_000) return reply.code(400).send({ error: 'Scheduled time must be in the future' })
    const product = (await query<{ id: string; name: string; category: string; selling_price: string; stock: number; description: string | null; image_url: string | null }>('SELECT id, name, category, selling_price, stock, description, image_url FROM products WHERE id = $1 AND tenant_id = $2', [id.data, tenantId])).rows[0]
    if (!product) return reply.code(404).send({ error: 'Product not found' })
    if (product.stock <= 0) return reply.code(409).send({ error: 'This product is out of stock' })
    const provider = getContentProvider()
    const results: { accountId: string; account?: string; status: string; message: string }[] = []
    for (const accountId of parsed.data.accountIds) {
      const account = (await query<{ id: string; platform: string; provider: string | null; display_name: string; status: string; category: string | null; daily_limit: number }>('SELECT id, platform, provider, display_name, status, category, daily_limit FROM social_accounts WHERE id = $1 AND tenant_id = $2', [accountId, tenantId])).rows[0]
      if (!account) { results.push({ accountId, status: 'rejected', message: 'Account not found' }); continue }
      const fail = (message: string) => results.push({ accountId, account: account.display_name, status: 'rejected', message })
      if (account.status !== 'connected') { fail('Account is not connected'); continue }
      if (account.category && account.category !== product.category) { fail(`This account only posts ${account.category}`); continue }
      if (['instagram', 'tiktok'].includes(account.platform) && !product.image_url) { fail('This platform needs a product image'); continue }
      const used = (await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM publishing_jobs WHERE tenant_id = $1 AND social_account_id = $2 AND status NOT IN ('cancelled','failed') AND (scheduled_for AT TIME ZONE $3)::date = ($4::timestamptz AT TIME ZONE $3)::date", [tenantId, account.id, config.BUSINESS_TIMEZONE, when.toISOString()])).rows[0].count
      if (used >= account.daily_limit) { fail(`Daily limit of ${account.daily_limit} posts reached for that day`); continue }
      if (!parsed.data.repost) {
        const dup = await query("SELECT 1 FROM publishing_jobs j JOIN content_drafts d ON d.id = j.content_draft_id WHERE j.tenant_id = $1 AND j.social_account_id = $2 AND d.product_id = $3 AND j.status NOT IN ('cancelled','failed') LIMIT 1", [tenantId, account.id, product.id])
        if (dup.rows[0]) { fail('Already posted or scheduled here. Tick "post again" to repeat it.'); continue }
      }
      const allowance = await query<{ left: number }>(
        `SELECT (p.ai_action_limit - (SELECT COALESCE(SUM(quantity), 0)::int FROM usage_events WHERE tenant_id = s.tenant_id AND kind = 'ai_content_generation' AND created_at >= date_trunc('month', now())))::int AS left
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1 AND s.status IN ('trialing', 'active')`, [tenantId])
      if (!allowance.rows[0] || allowance.rows[0].left <= 0) { fail('Monthly content limit of your plan is used up'); continue }
      let content
      try {
        content = await provider.generate({ productName: product.name, category: product.category, platform: account.platform as 'facebook', language: parsed.data.language, price: Number(product.selling_price), description: product.description ?? undefined })
      } catch (error) {
        fail(`Could not write the post: ${error instanceof Error ? error.message : 'error'}`)
        continue
      }
      // The person pressed "Post": that click is the approval.
      const draft = await query<{ id: string }>("INSERT INTO content_drafts (tenant_id, product_id, platform, language, content, status, created_by, reviewed_by, reviewed_at) VALUES ($1,$2,$3,$4,$5,'approved',$6,$6, now()) RETURNING id", [tenantId, product.id, account.platform, parsed.data.language, JSON.stringify(content), request.user!.id])
      await query("INSERT INTO usage_events (tenant_id, kind) VALUES ($1, 'ai_content_generation')", [tenantId])
      const job = await query<{ id: string }>('INSERT INTO publishing_jobs (tenant_id, content_draft_id, social_account_id, scheduled_for) VALUES ($1,$2,$3,$4) RETURNING id', [tenantId, draft.rows[0].id, account.id, when.toISOString()])
      const delivery = await deps.deliver(tenantId, job.rows[0].id)
      results.push({ accountId, account: account.display_name, status: delivery.status, message: delivery.message })
    }
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'product.post', entityType: 'product', entityId: product.id, metadata: { accounts: parsed.data.accountIds.length, scheduled: Boolean(parsed.data.scheduledFor) } })
    return { results }
  })
}
