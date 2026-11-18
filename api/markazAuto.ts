// Purpose: Markaz auto mode. The app reads NEW products from your saved Markaz links by itself, adds your profit,
// saves them, and Autopilot writes the posts (name, price, details) and sends them to your connected accounts.
// It runs every 3 hours while the app is running, or when you press "Run now". A post counts as sent only when the service confirms it.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { query } from './db.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { applyProfit, type ProfitConfig, type SourcingRules } from './sourcing.js'
import { guessCategory, isMarkazUrl, MarkazError, productIdFromUrl, scrapeMarkaz } from './markaz.js'
import { runAutopilot, type AutopilotResult } from './autopilotRoutes.js'

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
type Deliver = (tenantId: string, jobId: string) => Promise<{ status: string; message: string }>
type Deps = {
  sourcingSettings: (tenantId: string) => Promise<{ rules: SourcingRules; profit: ProfitConfig }>
  planLimits: (tenantId: string) => Promise<{ product_limit: number; social_account_limit: number } | null>
  deliver: Deliver
}

export type MarkazAutoResult = { imported: number; failures: number; autopilot: AutopilotResult | null; message: string }

const RUN_EVERY_HOURS = 3
const running = new Set<string>()

const settingsSchema = z.object({
  enabled: z.boolean(),
  urls: z.array(z.string().url().max(500).refine(isMarkazUrl, 'Only https://www.markaz.app links')).max(10),
  perRun: z.number().int().min(1).max(10).default(5),
})

type Row = { markaz_auto_enabled: boolean; markaz_auto_urls: string[]; markaz_auto_per_run: number; markaz_auto_last_run: string | null; markaz_auto_last_message: string | null }
const loadRow = async (tenantId: string) => (await query<Row>('SELECT markaz_auto_enabled, markaz_auto_urls, markaz_auto_per_run, markaz_auto_last_run, markaz_auto_last_message FROM tenant_settings WHERE tenant_id = $1', [tenantId])).rows[0]

async function saveRun(tenantId: string, message: string) {
  await query('INSERT INTO tenant_settings (tenant_id, markaz_auto_last_run, markaz_auto_last_message) VALUES ($1, now(), $2) ON CONFLICT (tenant_id) DO UPDATE SET markaz_auto_last_run = now(), markaz_auto_last_message = EXCLUDED.markaz_auto_last_message', [tenantId, message.slice(0, 500)])
}

export async function runMarkazAuto(tenantId: string, userId: string | null, deps: Deps): Promise<MarkazAutoResult> {
  if (running.has(tenantId)) return { imported: 0, failures: 0, autopilot: null, message: 'Already running. Wait for it to finish.' }
  running.add(tenantId)
  try {
    const row = await loadRow(tenantId)
    const urls = row?.markaz_auto_urls ?? []
    if (urls.length === 0) {
      const message = 'No Markaz link saved. Add at least one Markaz category link.'
      await saveRun(tenantId, message)
      return { imported: 0, failures: 0, autopilot: null, message }
    }
    const perRun = row?.markaz_auto_per_run ?? 5
    const settings = await deps.sourcingSettings(tenantId)
    const existing = await query<{ name: string; supplier_url: string | null }>('SELECT lower(name) AS name, supplier_url FROM products WHERE tenant_id = $1', [tenantId])
    const knownIds = new Set(existing.rows.map((r) => (r.supplier_url ? productIdFromUrl(r.supplier_url)?.id : undefined)).filter((v): v is string => Boolean(v)))
    const knownNames = new Set(existing.rows.map((r) => r.name))
    const limits = await deps.planLimits(tenantId)
    let room = limits ? limits.product_limit - (await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [tenantId])).rows[0].count : 0
    let imported = 0
    let failures = 0
    const problems: string[] = []
    if (!limits) problems.push('No active subscription')
    for (const url of urls) {
      if (room <= 0) { problems.push('Product limit of your plan is reached'); break }
      let scraped
      try {
        scraped = await scrapeMarkaz({ url, limit: Math.min(perRun, room), pages: 5, skipIds: knownIds })
      } catch (error) {
        problems.push(error instanceof MarkazError ? error.message : 'Markaz could not be read')
        failures += 1
        continue
      }
      failures += scraped.failures.length
      for (const p of scraped.products) {
        if (room <= 0) break
        if (knownNames.has(p.name.toLowerCase())) continue
        const category = guessCategory(p.category, p.name)
        const sellingPrice = applyProfit(p.wholesalePrice, settings.profit)
        const profit = Math.round((sellingPrice - p.wholesalePrice) * 100) / 100
        const stock = p.stockLeft && p.stockLeft > 0 ? p.stockLeft : 10
        await query(
          "INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url, image_url, rating, review_count, sold_count, source_kind, profit_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,'markaz',$12)",
          [tenantId, p.name, p.description, category, p.wholesalePrice, sellingPrice, stock, p.productUrl, p.imageUrl, p.rating, p.reviewCount, profit],
        )
        knownIds.add(p.markazId)
        knownNames.add(p.name.toLowerCase())
        imported += 1
        room -= 1
      }
    }
    // The owner switched Markaz auto on: that is the approval, so posts are scheduled without waiting.
    let autopilot: AutopilotResult | null = null
    try {
      autopilot = await runAutopilot(tenantId, userId, { days: 1, approve: true }, deps.deliver)
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'Autopilot failed')
    }
    const parts = [`${imported} new product(s) from Markaz`, `${autopilot?.sent ?? 0} post(s) sent/scheduled`]
    if (autopilot && autopilot.notes.length) parts.push(autopilot.notes.slice(0, 2).join(' '))
    if (problems.length) parts.push(problems.slice(0, 2).join(' | '))
    const message = parts.join('. ')
    await saveRun(tenantId, message)
    if (imported > 0 || (autopilot?.scheduled ?? 0) > 0) await writeAuditLog({ tenantId, userId, action: 'markaz.auto_run', entityType: 'markaz_auto', metadata: { imported, scheduled: autopilot?.scheduled ?? 0 } })
    return { imported, failures, autopilot, message }
  } finally {
    running.delete(tenantId)
  }
}

// Timer entry: every workspace with Markaz auto on, at most once every few hours.
export async function runMarkazAutoForEnabledTenants(deps: Deps) {
  const tenants = await query<{ tenant_id: string }>(
    `SELECT ts.tenant_id FROM tenant_settings ts JOIN tenants t ON t.id = ts.tenant_id
     WHERE ts.markaz_auto_enabled = true AND t.status = 'active' AND (ts.markaz_auto_last_run IS NULL OR ts.markaz_auto_last_run < now() - make_interval(hours => $1::int))`,
    [RUN_EVERY_HOURS],
  )
  for (const row of tenants.rows) await runMarkazAuto(row.tenant_id, null, deps).catch(() => undefined)
  return tenants.rows.length
}

export function registerMarkazAutoRoutes(app: FastifyInstance, requireAuth: Auth, deps: Deps) {
  app.get('/api/markaz/auto', { preHandler: requireAuth }, async (request) => {
    const row = await loadRow(request.user!.tenantId)
    return { enabled: row?.markaz_auto_enabled ?? false, urls: row?.markaz_auto_urls ?? [], perRun: row?.markaz_auto_per_run ?? 5, lastRun: row?.markaz_auto_last_run ?? null, lastMessage: row?.markaz_auto_last_message ?? null }
  })

  app.put('/api/markaz/auto', { preHandler: [requireAuth, requireRole('manager')] }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid settings. Use links that start with https://www.markaz.app/' })
    const d = parsed.data
    if (d.enabled && d.urls.length === 0) return reply.code(400).send({ error: 'Add at least one Markaz link first' })
    await query('INSERT INTO tenant_settings (tenant_id, markaz_auto_enabled, markaz_auto_urls, markaz_auto_per_run) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET markaz_auto_enabled = EXCLUDED.markaz_auto_enabled, markaz_auto_urls = EXCLUDED.markaz_auto_urls, markaz_auto_per_run = EXCLUDED.markaz_auto_per_run, updated_at = now()', [request.user!.tenantId, d.enabled, d.urls, d.perRun])
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'markaz.auto_settings', entityType: 'tenant_settings', metadata: { enabled: d.enabled, links: d.urls.length } })
    return d
  })

  app.post('/api/markaz/auto/run', { preHandler: [requireAuth, requireRole('manager')], config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request) => runMarkazAuto(request.user!.tenantId, request.user!.id, deps))
}
