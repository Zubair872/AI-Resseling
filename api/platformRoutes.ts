// Purpose: AI agent dashboard backend, image/proof uploads, social account edit/delete, publishing calendar, payment text parsing.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { query } from './db.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { getObjectStorage } from './storage.js'
import { applyLlmRun } from './growthRoutes.js'
import { autonomyModes, canAutoApply, categories, classifyProduct, maxUploadBytes, parsePaymentText, suggestPrice, validateImageBase64, type AutonomyMode } from './agents.js'

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
const uuid = z.string().uuid()

export const agentCatalog = [
  { key: 'classification', name: 'Product Classification Agent', runnable: true, note: 'Rule-based keyword classifier (no LLM).' },
  { key: 'pricing', name: 'Pricing Agent', runnable: true, note: 'Suggests a selling price from wholesale price + profit.' },
  { key: 'reporting', name: 'Reporting Agent', runnable: true, note: 'Summarises live numbers from the database.' },
  { key: 'payment_review', name: 'Payment Review Assistant', runnable: true, note: 'Extracts fields from payment text. It can NEVER verify a payment.' },
  { key: 'llm_assistant', name: 'AI Assistant (LLM, tool-calling)', runnable: false, note: 'Real LLM agent: reads your data with tools and records proposals. Use the AI Assistant card below. Needs AI_PROVIDER=openai + AI_API_KEY.' },
  { key: 'product_import', name: 'Product Import Agent', runnable: false, note: 'Use Integrations > Markaz sourcing (CSV). Automatic import needs an approved supplier feed.' },
  { key: 'content', name: 'Content Generation Agent', runnable: false, note: 'Use Content Studio.' },
  { key: 'publishing', name: 'Social Publishing Agent', runnable: false, note: 'Use Publishing (Buffer needs your account).' },
  { key: 'support', name: 'Customer Support Agent', runnable: false, note: 'Use Customers (Meta needs your app).' },
  { key: 'order_processing', name: 'Order Processing Agent', runnable: false, note: 'Orders are created from chat or manually; supplier submission is manual.' },
] as const

const runSchema = z.object({ agent: z.enum(['classification', 'pricing', 'reporting', 'payment_review']), productId: z.string().uuid().optional(), text: z.string().max(4000).optional(), profitAmount: z.number().nonnegative().optional(), profitPercent: z.number().nonnegative().max(1000).optional() })
const uploadSchema = z.object({ kind: z.enum(['product_image', 'payment_proof']), contentType: z.string().max(40), dataBase64: z.string().min(8).max(Math.ceil(maxUploadBytes * 1.4)) })
const accountPatchSchema = z.object({ displayName: z.string().min(2).max(160).optional(), category: z.enum(categories).nullable().optional(), dailyLimit: z.number().int().min(0).max(100).optional() }).refine((v) => Object.keys(v).length > 0, 'Nothing to change')

async function getMode(tenantId: string): Promise<AutonomyMode> {
  const row = (await query<{ autonomy_mode: AutonomyMode }>('SELECT autonomy_mode FROM tenant_settings WHERE tenant_id = $1', [tenantId])).rows[0]
  return row?.autonomy_mode ?? 'approval'
}

export function registerPlatformRoutes(app: FastifyInstance, requireAuth: Auth) {
  const manager = [requireAuth, requireRole('manager')]
  const admin = [requireAuth, requireRole('admin')]

  // ---------- Agents ----------
  app.get('/api/agents', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.user!.tenantId
    const stats = await query<{ agent: string; runs: number; last_run: string | null }>('SELECT agent, COUNT(*)::int AS runs, MAX(created_at) AS last_run FROM agent_runs WHERE tenant_id = $1 GROUP BY agent', [tenantId])
    const byAgent = new Map(stats.rows.map((row) => [row.agent, row]))
    return { mode: await getMode(tenantId), agents: agentCatalog.map((agent) => ({ ...agent, runs: byAgent.get(agent.key)?.runs ?? 0, lastRun: byAgent.get(agent.key)?.last_run ?? null })), note: 'Sensitive actions (payments, refunds, supplier purchases) always need a person, in every mode.' }
  })

  app.put('/api/agents/mode', { preHandler: admin }, async (request, reply) => {
    const parsed = z.object({ mode: z.enum(autonomyModes as [AutonomyMode, ...AutonomyMode[]]) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid autonomy mode' })
    const tenantId = request.user!.tenantId
    await query('INSERT INTO tenant_settings (tenant_id, autonomy_mode) VALUES ($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET autonomy_mode = EXCLUDED.autonomy_mode, updated_at = now()', [tenantId, parsed.data.mode])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'agents.mode_changed', entityType: 'tenant_settings', metadata: { mode: parsed.data.mode } })
    return { mode: parsed.data.mode }
  })

  app.get('/api/agents/runs', { preHandler: requireAuth }, async (request) => {
    const result = await query('SELECT id, agent, status, autonomy_mode, input, output, error, tokens_used, cost_estimate, created_at, decided_at FROM agent_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50', [request.user!.tenantId])
    return { runs: result.rows }
  })

  app.post('/api/agents/run', { preHandler: manager }, async (request, reply) => {
    const parsed = runSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid agent run', details: parsed.error.flatten() })
    const d = parsed.data
    const tenantId = request.user!.tenantId
    const mode = await getMode(tenantId)
    let status: 'completed' | 'awaiting_approval' | 'applied' = 'completed'
    let output: Record<string, unknown> = {}
    const input: Record<string, unknown> = { productId: d.productId, text: d.text ? d.text.slice(0, 200) : undefined, profitAmount: d.profitAmount, profitPercent: d.profitPercent }

    if (d.agent === 'classification' || d.agent === 'pricing') {
      if (!d.productId) return reply.code(400).send({ error: 'productId is required for this agent' })
      const product = (await query<{ id: string; name: string; description: string | null; category: string; image_url: string | null; wholesale_price: string; selling_price: string; stock: number }>('SELECT id, name, description, category, image_url, wholesale_price, selling_price, stock FROM products WHERE id = $1 AND tenant_id = $2', [d.productId, tenantId])).rows[0]
      if (!product) return reply.code(404).send({ error: 'Product not found' })
      if (d.agent === 'classification') {
        const result = classifyProduct({ name: product.name, description: product.description, imageUrl: product.image_url, sellingPrice: Number(product.selling_price), stock: product.stock })
        output = { productName: product.name, currentCategory: product.category, suggestedCategory: result.category, confidence: result.confidence, matched: result.matched, missing: result.missing, restrictedFlags: result.restrictedFlags }
        const changes = result.category !== product.category && result.confidence >= 0.65 && result.restrictedFlags.length === 0
        if (changes) {
          if (canAutoApply(mode, 'low')) { await query('UPDATE products SET category = $1 WHERE id = $2 AND tenant_id = $3', [result.category, product.id, tenantId]); status = 'applied' } else status = 'awaiting_approval'
        }
      } else {
        const suggestion = suggestPrice({ wholesalePrice: Number(product.wholesale_price), profitAmount: d.profitAmount, profitPercent: d.profitPercent })
        output = { productName: product.name, wholesalePrice: Number(product.wholesale_price), currentPrice: Number(product.selling_price), suggestedPrice: suggestion.sellingPrice, profit: suggestion.profit }
        // Price changes are customer-facing, so they always wait for a person (never auto-applied).
        status = suggestion.sellingPrice !== Number(product.selling_price) ? 'awaiting_approval' : 'completed'
      }
    } else if (d.agent === 'reporting') {
      const r = await query<Record<string, string | number>>(
        `SELECT (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1) AS products,
                (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1 AND stock <= 5) AS low_stock,
                (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1) AS orders,
                (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND status IN ('new','pending_confirmation','payment_pending')) AS needs_attention,
                (SELECT COUNT(*)::int FROM payment_verifications WHERE tenant_id = $1 AND status = 'pending') AS payments_waiting,
                (SELECT COUNT(*)::int FROM publishing_jobs WHERE tenant_id = $1 AND status = 'failed') AS failed_posts`,
        [tenantId],
      )
      output = { ...r.rows[0], note: 'Live counts from your database.' }
    } else {
      if (!d.text) return reply.code(400).send({ error: 'text is required for the payment review assistant' })
      output = parsePaymentText(d.text)
    }

    const run = await query<{ id: string }>('INSERT INTO agent_runs (tenant_id, agent, status, autonomy_mode, input, output, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [tenantId, d.agent, status, mode, JSON.stringify(input), JSON.stringify(output), request.user!.id])
    await query('INSERT INTO usage_events (tenant_id, kind, metadata) VALUES ($1,$2,$3)', [tenantId, 'agent_run', JSON.stringify({ agent: d.agent })])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: `agent.${d.agent}`, entityType: 'agent_run', entityId: run.rows[0].id, metadata: { status, mode } })
    return reply.code(201).send({ run: { id: run.rows[0].id, agent: d.agent, status, autonomy_mode: mode, output } })
  })

  app.post('/api/agents/runs/:id/decision', { preHandler: manager }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    const parsed = z.object({ decision: z.enum(['approved', 'rejected']) }).safeParse(request.body)
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'Invalid decision' })
    const tenantId = request.user!.tenantId
    const run = (await query<{ agent: string; input: { productId?: string }; output: Record<string, unknown>; status: string }>('SELECT agent, input, output, status FROM agent_runs WHERE id = $1 AND tenant_id = $2', [id.data, tenantId])).rows[0]
    if (!run) return reply.code(404).send({ error: 'Run not found' })
    if (run.status !== 'awaiting_approval') return reply.code(409).send({ error: 'This run is not waiting for approval' })
    if (parsed.data.decision === 'approved' && run.agent === 'llm_assistant') await applyLlmRun(tenantId, id.data)
    else if (parsed.data.decision === 'approved' && run.input.productId) {
      if (run.agent === 'classification') await query('UPDATE products SET category = $1 WHERE id = $2 AND tenant_id = $3', [run.output.suggestedCategory, run.input.productId, tenantId])
      else if (run.agent === 'pricing') await query('UPDATE products SET selling_price = $1 WHERE id = $2 AND tenant_id = $3', [run.output.suggestedPrice, run.input.productId, tenantId])
    }
    await query('UPDATE agent_runs SET status = $1, decided_at = now() WHERE id = $2', [parsed.data.decision === 'approved' ? 'applied' : 'rejected', id.data])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: `agent.run_${parsed.data.decision}`, entityType: 'agent_run', entityId: id.data })
    return { status: parsed.data.decision === 'approved' ? 'applied' : 'rejected' }
  })

  app.post('/api/payments/parse-text', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ text: z.string().min(3).max(4000) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Text is required' })
    return { parsed: parsePaymentText(parsed.data.text), note: 'OCR is not connected: paste the text from the screenshot. Verification stays a human decision.' }
  })

  // ---------- Uploads ----------
  app.post('/api/uploads', { preHandler: requireAuth, bodyLimit: 5_000_000, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = uploadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid upload' })
    const check = validateImageBase64(parsed.data.dataBase64, parsed.data.contentType)
    if (!check.ok) return reply.code(400).send({ error: check.reason })
    const storage = getObjectStorage()
    if (config.STORAGE_PROVIDER === 's3' && !storage) return reply.code(503).send({ error: 'Object storage is selected but not fully configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).' })
    if (storage && parsed.data.kind === 'product_image' && !config.S3_PUBLIC_BASE_URL) return reply.code(503).send({ error: 'Product images in object storage need S3_PUBLIC_BASE_URL (a public bucket or CDN URL) so customers and social platforms can load them.' })
    const row = await query<{ id: string }>('INSERT INTO uploads (tenant_id, kind, content_type, size_bytes, data_base64, storage, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [request.user!.tenantId, parsed.data.kind, parsed.data.contentType, check.bytes, storage ? null : parsed.data.dataBase64, storage ? 's3' : 'database', request.user!.id])
    let storedUrl: string | null = null
    if (storage) {
      const key = `${request.user!.tenantId}/${parsed.data.kind}/${row.rows[0].id}`
      try {
        await storage.put(key, Buffer.from(parsed.data.dataBase64, 'base64'), parsed.data.contentType)
      } catch (error) {
        await query('DELETE FROM uploads WHERE id = $1 AND tenant_id = $2', [row.rows[0].id, request.user!.tenantId])
        return reply.code(502).send({ error: error instanceof Error ? error.message : 'Storage upload failed' })
      }
      await query('UPDATE uploads SET storage_key = $1 WHERE id = $2 AND tenant_id = $3', [key, row.rows[0].id, request.user!.tenantId])
      if (parsed.data.kind === 'product_image') storedUrl = `${config.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${key}`
    }
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'upload.created', entityType: 'upload', entityId: row.rows[0].id, metadata: { kind: parsed.data.kind, bytes: check.bytes } })
    const path = parsed.data.kind === 'product_image' ? `/files/${row.rows[0].id}` : `/api/uploads/${row.rows[0].id}`
    return reply.code(201).send({ id: row.rows[0].id, url: storedUrl ?? `${config.PUBLIC_API_URL ?? `${request.protocol}://${request.headers.host}`}${path}`, kind: parsed.data.kind, note: parsed.data.kind === 'payment_proof' ? 'Payment proofs are private: only signed-in members of your workspace can open them.' : 'Product images are public by link (the link is unguessable).' })
  })

  // Public, unguessable link: product images only (needed so customers and social platforms can load them).
  app.get('/files/:id', async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(404).send({ error: 'Not found' })
    const row = (await query<{ content_type: string; data_base64: string | null; storage_key: string | null }>("SELECT content_type, data_base64, storage_key FROM uploads WHERE id = $1 AND kind = 'product_image'", [id.data])).rows[0]
    if (!row) return reply.code(404).send({ error: 'Not found' })
    if (!row.data_base64) return row.storage_key && config.S3_PUBLIC_BASE_URL ? reply.redirect(`${config.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${row.storage_key}`) : reply.code(404).send({ error: 'Not found' })
    return reply.header('Cross-Origin-Resource-Policy', 'cross-origin').header('Cache-Control', 'public, max-age=86400').type(row.content_type).send(Buffer.from(row.data_base64, 'base64'))
  })

  app.get('/api/uploads/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(404).send({ error: 'Not found' })
    const row = (await query<{ content_type: string; data_base64: string | null; storage_key: string | null }>('SELECT content_type, data_base64, storage_key FROM uploads WHERE id = $1 AND tenant_id = $2', [id.data, request.user!.tenantId])).rows[0]
    if (!row) return reply.code(404).send({ error: 'Not found' })
    if (!row.data_base64) {
      const storage = getObjectStorage()
      if (!storage || !row.storage_key) return reply.code(404).send({ error: 'Not found' })
      return reply.header('Cache-Control', 'private, no-store').redirect(storage.signedUrl(row.storage_key, 300)) // 5-minute signed link
    }
    return reply.header('Cache-Control', 'private, no-store').type(row.content_type).send(Buffer.from(row.data_base64, 'base64'))
  })

  // ---------- Social accounts: edit / delete ----------
  app.patch('/api/social-accounts/:id', { preHandler: manager }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    const parsed = accountPatchSchema.safeParse(request.body)
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'Invalid account update' })
    const d = parsed.data
    const result = await query(
      `UPDATE social_accounts SET display_name = COALESCE($3, display_name),
        category = CASE WHEN $4::boolean THEN $5 ELSE category END,
        daily_limit = COALESCE($6::int, daily_limit)
       WHERE id = $1 AND tenant_id = $2 RETURNING id, platform, display_name, category, daily_limit, status`,
      [id.data, request.user!.tenantId, d.displayName ?? null, d.category !== undefined, d.category ?? null, d.dailyLimit ?? null],
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'Account not found' })
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'social_account.updated', entityType: 'social_account', entityId: id.data, metadata: d })
    return { account: result.rows[0] }
  })

  app.delete('/api/social-accounts/:id', { preHandler: admin }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid account id' })
    const tenantId = request.user!.tenantId
    const jobs = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM publishing_jobs WHERE social_account_id = $1 AND tenant_id = $2', [id.data, tenantId])
    if (jobs.rows[0].count > 0) return reply.code(409).send({ error: 'This account has publishing history, so it is kept for your records. Set its daily limit to 0 to stop posting.' })
    const result = await query('DELETE FROM social_accounts WHERE id = $1 AND tenant_id = $2 RETURNING id', [id.data, tenantId])
    if (!result.rows[0]) return reply.code(404).send({ error: 'Account not found' })
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'social_account.deleted', entityType: 'social_account', entityId: id.data })
    return reply.code(204).send()
  })

  // ---------- Calendar ----------
  app.get('/api/publishing/calendar', { preHandler: requireAuth }, async (request, reply) => {
    const q = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'from and to must be ISO date-times' })
    const from = q.data.from ?? new Date(Date.now() - 7 * 86400000).toISOString()
    const to = q.data.to ?? new Date(Date.now() + 30 * 86400000).toISOString()
    const result = await query(
      `SELECT j.id, j.scheduled_for, j.status, a.display_name AS account, a.platform, to_char(j.scheduled_for AT TIME ZONE $4, 'YYYY-MM-DD') AS day
       FROM publishing_jobs j JOIN social_accounts a ON a.id = j.social_account_id
       WHERE j.tenant_id = $1 AND j.scheduled_for >= $2 AND j.scheduled_for < $3 ORDER BY j.scheduled_for LIMIT 500`,
      [request.user!.tenantId, from, to, config.BUSINESS_TIMEZONE],
    )
    return { timezone: config.BUSINESS_TIMEZONE, jobs: result.rows }
  })
}
