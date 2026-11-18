// Purpose: Autopilot. For every connected account it fills the free daily slots with products
// (matching the account category, in stock, with an image where the platform needs one, never posted to that account before),
// makes a post from the product data, and schedules it. Limits and duplicate rules are enforced here and again by the database queries.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { query } from './db.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { createNotification } from './notifications.js'
import { getContentProvider } from './ai.js'
import { autoApprovesContent, freeSlots } from './autopilot.js'

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
type Deliver = (tenantId: string, jobId: string) => Promise<{ status: string; message: string }>
type Language = 'english' | 'urdu' | 'roman_urdu'

export type AutopilotResult = { scheduled: number; draftsWaitingApproval: number; sent: number; notes: string[] }

const runSchema = z.object({ days: z.number().int().min(1).max(7).default(1), accountId: z.string().uuid().optional(), language: z.enum(['english', 'urdu', 'roman_urdu']).optional() })
const settingsSchema = z.object({ enabled: z.boolean(), language: z.enum(['english', 'urdu', 'roman_urdu']).default('roman_urdu') })

export async function runAutopilot(tenantId: string, userId: string | null, options: { days: number; accountId?: string; language?: Language; approve?: boolean }, deliver: Deliver): Promise<AutopilotResult> {
  const result: AutopilotResult = { scheduled: 0, draftsWaitingApproval: 0, sent: 0, notes: [] }
  const settings = (await query<{ autonomy_mode: string; autopilot_language: Language }>('SELECT autonomy_mode, autopilot_language FROM tenant_settings WHERE tenant_id = $1', [tenantId])).rows[0]
  const mode = settings?.autonomy_mode ?? 'approval'
  const language = options.language ?? settings?.autopilot_language ?? 'roman_urdu'
  const approveNow = options.approve === true || autoApprovesContent(mode)
  const tz = config.BUSINESS_TIMEZONE

  const accounts = (await query<{ id: string; platform: string; category: string | null; daily_limit: number; display_name: string }>(
    "SELECT id, platform, category, daily_limit, display_name FROM social_accounts WHERE tenant_id = $1 AND status = 'connected' AND daily_limit > 0 AND ($2::uuid IS NULL OR id = $2::uuid) ORDER BY created_at",
    [tenantId, options.accountId ?? null],
  )).rows
  if (accounts.length === 0) result.notes.push('No connected account with a daily limit above 0. Connect Buffer or TikTok and sync channels first.')

  const allowance = await query<{ ai_action_limit: number; used_actions: number }>(
    `SELECT p.ai_action_limit, (SELECT COALESCE(SUM(quantity), 0)::int FROM usage_events WHERE tenant_id = s.tenant_id AND kind = 'ai_content_generation' AND created_at >= date_trunc('month', now())) AS used_actions
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1 AND s.status IN ('trialing', 'active')`,
    [tenantId],
  )
  let aiLeft = allowance.rows[0] ? allowance.rows[0].ai_action_limit - allowance.rows[0].used_actions : 0
  const provider = getContentProvider()

  for (const account of accounts) {
    for (let offset = 0; offset < options.days; offset += 1) {
      const day = (await query<{ day: string }>("SELECT to_char((now() AT TIME ZONE $1)::date + $2::int, 'YYYY-MM-DD') AS day", [tz, offset])).rows[0].day
      const used = (await query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM publishing_jobs WHERE tenant_id = $1 AND social_account_id = $2 AND status NOT IN ('cancelled', 'failed') AND (scheduled_for AT TIME ZONE $3)::date = $4::date",
        [tenantId, account.id, tz, day],
      )).rows[0].count
      for (const slot of freeSlots(account.daily_limit, used)) {
        const when = (await query<{ ts: string }>('SELECT (($1::date + make_time($2::int, $3::int, 0)) AT TIME ZONE $4) AS ts', [day, slot.hour, slot.minute, tz])).rows[0].ts
        if (new Date(when).getTime() < Date.now() + 5 * 60_000) continue

        const product = (await query<{ id: string; name: string; category: string; selling_price: string; description: string | null }>(
          `SELECT p.id, p.name, p.category, p.selling_price, p.description FROM products p
           WHERE p.tenant_id = $1 AND p.stock > 0 AND p.is_advance_payment = false AND ($2::text IS NULL OR p.category = $2)
             AND ($3::text NOT IN ('instagram', 'tiktok') OR p.image_url IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM publishing_jobs j JOIN content_drafts d ON d.id = j.content_draft_id WHERE d.product_id = p.id AND j.social_account_id = $4 AND j.status NOT IN ('cancelled', 'failed'))
             AND NOT EXISTS (SELECT 1 FROM content_drafts d WHERE d.product_id = p.id AND d.platform = $3 AND d.status = 'draft')
           ORDER BY (SELECT MAX(j.scheduled_for) FROM publishing_jobs j JOIN content_drafts d ON d.id = j.content_draft_id WHERE d.product_id = p.id) ASC NULLS FIRST, p.created_at DESC
           LIMIT 1`,
          [tenantId, account.category, account.platform, account.id],
        )).rows[0]
        if (!product) { result.notes.push(`${account.display_name}: no more eligible products (in stock, matching category${['instagram', 'tiktok'].includes(account.platform) ? ', with an image' : ''}, not posted here before).`); break }

        let draftId = (await query<{ id: string }>("SELECT id FROM content_drafts WHERE tenant_id = $1 AND product_id = $2 AND platform = $3 AND status = 'approved' ORDER BY created_at DESC LIMIT 1", [tenantId, product.id, account.platform])).rows[0]?.id
        if (!draftId) {
          if (aiLeft <= 0) { result.notes.push('Monthly content limit of your plan is used up. Upgrade the plan or wait for next month.'); return finish(result, tenantId, userId) }
          try {
            const content = await provider.generate({ productName: product.name, category: product.category, platform: account.platform as 'facebook', language, price: Number(product.selling_price), description: product.description ?? undefined })
            const inserted = await query<{ id: string }>(
              'INSERT INTO content_drafts (tenant_id, product_id, platform, language, content, status, created_by, reviewed_at) VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::boolean THEN now() END) RETURNING id',
              [tenantId, product.id, account.platform, language, JSON.stringify(content), approveNow ? 'approved' : 'draft', userId, approveNow],
            )
            await query("INSERT INTO usage_events (tenant_id, kind) VALUES ($1, 'ai_content_generation')", [tenantId])
            aiLeft -= 1
            if (!approveNow) { result.draftsWaitingApproval += 1; continue }
            draftId = inserted.rows[0].id
          } catch (error) {
            result.notes.push(`Could not write a post for ${product.name}: ${error instanceof Error ? error.message : 'unknown error'}`)
            continue
          }
        }
        const job = await query<{ id: string }>('INSERT INTO publishing_jobs (tenant_id, content_draft_id, social_account_id, scheduled_for) VALUES ($1,$2,$3,$4) RETURNING id', [tenantId, draftId, account.id, when])
        result.scheduled += 1
        const delivery = await deliver(tenantId, job.rows[0].id)
        if (['scheduled_in_buffer', 'submitted_to_tiktok', 'scheduled_local', 'published'].includes(delivery.status)) result.sent += 1
        else result.notes.push(`${account.display_name}: ${delivery.message}`)
      }
    }
  }
  return finish(result, tenantId, userId)
}

async function finish(result: AutopilotResult, tenantId: string, userId: string | null) {
  if (result.draftsWaitingApproval > 0) await createNotification(tenantId, 'content_approval', `${result.draftsWaitingApproval} posts are waiting for your approval`, 'Autopilot wrote them from your product data. Approve them in Content Studio, then run Autopilot again to schedule them.')
  if (result.scheduled > 0 || result.draftsWaitingApproval > 0) await writeAuditLog({ tenantId, userId, action: 'autopilot.run', entityType: 'autopilot', metadata: { scheduled: result.scheduled, waiting: result.draftsWaitingApproval, sent: result.sent } })
  return result
}

// Used by the hourly timer: runs for every workspace that switched Autopilot on (today + tomorrow).
export async function runAutopilotForEnabledTenants(deliver: Deliver) {
  const tenants = await query<{ tenant_id: string }>("SELECT ts.tenant_id FROM tenant_settings ts JOIN tenants t ON t.id = ts.tenant_id WHERE ts.autopilot_enabled = true AND t.status = 'active'")
  for (const row of tenants.rows) await runAutopilot(row.tenant_id, null, { days: 2 }, deliver)
  return tenants.rows.length
}

export function registerAutopilotRoutes(app: FastifyInstance, requireAuth: Auth, deliver: Deliver) {
  app.get('/api/autopilot', { preHandler: requireAuth }, async (request) => {
    const row = (await query<{ autopilot_enabled: boolean; autopilot_language: string; autonomy_mode: string }>('SELECT autopilot_enabled, autopilot_language, autonomy_mode FROM tenant_settings WHERE tenant_id = $1', [request.user!.tenantId])).rows[0]
    return { enabled: row?.autopilot_enabled ?? false, language: row?.autopilot_language ?? 'roman_urdu', autonomyMode: row?.autonomy_mode ?? 'approval', note: 'In approval/manual mode Autopilot writes posts and waits for your approval. In hybrid/full mode it approves and schedules by itself. Sent only after Buffer/TikTok confirms.' }
  })

  app.put('/api/autopilot', { preHandler: [requireAuth, requireRole('admin')] }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid autopilot settings' })
    await query('INSERT INTO tenant_settings (tenant_id, autopilot_enabled, autopilot_language) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET autopilot_enabled = EXCLUDED.autopilot_enabled, autopilot_language = EXCLUDED.autopilot_language, updated_at = now()', [request.user!.tenantId, parsed.data.enabled, parsed.data.language])
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'autopilot.settings', entityType: 'tenant_settings', metadata: parsed.data })
    return parsed.data
  })

  app.post('/api/autopilot/run', { preHandler: [requireAuth, requireRole('manager')], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = runSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid autopilot run' })
    return runAutopilot(request.user!.tenantId, request.user!.id, parsed.data, deliver)
  })
}
