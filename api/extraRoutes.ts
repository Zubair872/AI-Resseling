// Purpose: WhatsApp Business chat, TikTok publishing, Stripe checkout + webhook, Google Sheets sync, extra CSV/Excel exports, payment-proof OCR.
// Every external call is an official API adapter that is NOT verified against a live account in the authoring session (no credentials there).
import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { query } from './db.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { createNotification } from './notifications.js'
import { decryptSecret } from './secrets.js'
import { verifyMetaSignature, MetaError } from './meta.js'
import { applyTemplateStatus, freshTikTokToken } from './growthRoutes.js'
import { WhatsAppClient, parseTemplateStatusWebhook, parseWhatsAppWebhook, whatsappCustomerKey, type InboundWhatsApp } from './whatsapp.js'
import { TikTokClient, TikTokError } from './tiktok.js'
import { StripeError, StripeProvider, settledInvoiceFromEvent, verifyStripeSignature } from './stripe.js'
import { GoogleSheetsClient, SheetsError, parseServiceAccount } from './sheets.js'
import { ocrImageText } from './ocr.js'
import { toCsv, toExcelXml } from './csvExport.js'
import { composeReply, composeWithLlm, type CatalogProduct } from './support.js'
import { autoOrderFromChat, recentInboundTexts } from './chatOrder.js'
import { settleInvoice } from './billingRoutes.js'

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
const uuid = z.string().uuid()
const integrationKey = () => config.INTEGRATION_ENCRYPTION_KEY ?? createHash('sha256').update(`${config.JWT_SECRET}:integrations`).digest('hex')

type IntegrationRow = { id: string; tenant_id: string; encrypted_secret: string | null; encrypted_refresh_secret: string | null; token_expires_at: string | null; refresh_expires_at: string | null; connected_via: string; config: Record<string, string>; enabled: boolean }
async function integrationOf(tenantId: string, provider: string) {
  const r = await query<IntegrationRow>('SELECT id, tenant_id, encrypted_secret, encrypted_refresh_secret, token_expires_at, refresh_expires_at, connected_via, config, enabled FROM integrations WHERE tenant_id = $1 AND provider = $2 AND enabled = true ORDER BY created_at LIMIT 1', [tenantId, provider])
  const row = r.rows[0]
  if (!row?.encrypted_secret) return null
  // OAuth-connected TikTok tokens last about a day: refresh before use.
  const secret = provider === 'tiktok' ? await freshTikTokToken(row) : decryptSecret(row.encrypted_secret, integrationKey())
  return { id: row.id, config: row.config, secret }
}

// ---------- WhatsApp ----------
export async function sendWhatsAppText(tenantId: string, to: string, text: string) {
  const integration = await integrationOf(tenantId, 'whatsapp')
  if (!integration?.config.phoneNumberId) throw new MetaError('Add and enable a WhatsApp integration (phone number id + token) in Integrations to send replies.')
  return new WhatsAppClient(integration.secret, integration.config.phoneNumberId, undefined, config.META_GRAPH_VERSION).sendText(to, text)
}

async function processInboundWhatsApp(event: InboundWhatsApp) {
  const found = await query<{ tenant_id: string; config: Record<string, string> }>("SELECT tenant_id, config FROM integrations WHERE provider = 'whatsapp' AND enabled = true AND config->>'phoneNumberId' = $1 ORDER BY created_at LIMIT 1", [event.phoneNumberId])
  const integration = found.rows[0]
  if (!integration) return
  const tenantId = integration.tenant_id
  const customer = await query<{ id: string }>('INSERT INTO customers (tenant_id, name, phone) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id', [tenantId, event.senderName ?? 'WhatsApp customer', whatsappCustomerKey(event.from)])
  let conversation = (await query<{ id: string; human_takeover: boolean }>("SELECT id, human_takeover FROM conversations WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_thread_id = $2 AND status <> 'closed' ORDER BY created_at DESC LIMIT 1", [tenantId, event.from])).rows[0]
  if (!conversation) conversation = (await query<{ id: string; human_takeover: boolean }>("INSERT INTO conversations (tenant_id, customer_id, channel, external_thread_id, last_inbound_at) VALUES ($1,$2,'whatsapp',$3, now()) RETURNING id, human_takeover", [tenantId, customer.rows[0].id, event.from])).rows[0]
  const history = await recentInboundTexts(tenantId, conversation.id, 6)
  const previous = { rows: history.length ? [{ body: history[history.length - 1] }] : [] }
  const inserted = await query<{ id: string }>("INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, external_message_id) VALUES ($1,$2,'inbound',$3,'sent',$4) ON CONFLICT DO NOTHING RETURNING id", [tenantId, conversation.id, event.text, event.messageId])
  if (!inserted.rows[0]) return
  await query("UPDATE conversations SET last_inbound_at = now(), status = 'open', updated_at = now() WHERE id = $1 AND tenant_id = $2", [conversation.id, tenantId])
  await createNotification(tenantId, 'new_message', 'New whatsapp message', event.text.slice(0, 120))
  const aiMode = integration.config.aiMode ?? 'approval'
  if (conversation.human_takeover || aiMode === 'manual') return
  const catalog = await query<CatalogProduct>('SELECT id, name, category, selling_price, stock, description FROM products WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 300', [tenantId])
  let reply = composeReply(event.text, catalog.rows, { priorText: previous.rows[0]?.body, history })
  // Auto mode: every order detail present -> order is created here and the owner gets the Markaz text.
  const autoOrder = aiMode === 'auto' ? await autoOrderFromChat(tenantId, conversation.id, catalog.rows) : null
  if (autoOrder) reply = { text: autoOrder.text, needsHuman: false, productIds: [], allowedNumbers: [] }
  else if (config.AI_PROVIDER === 'openai' && config.AI_API_KEY) reply = await composeWithLlm(event.text, catalog.rows, reply, { baseUrl: config.AI_BASE_URL, apiKey: config.AI_API_KEY, model: config.AI_MODEL })
  const draft = await query<{ id: string }>("INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, ai_generated) VALUES ($1,$2,'outbound',$3,'draft', true) RETURNING id", [tenantId, conversation.id, reply.text])
  if (reply.needsHuman) await createNotification(tenantId, 'chat_needs_human', 'A customer chat needs you', 'The assistant cannot answer this safely (delivery cost, order confirmation or unknown product).')
  if (aiMode === 'auto' && !reply.needsHuman) {
    try {
      await sendWhatsAppText(tenantId, event.from, reply.text)
      await query("UPDATE conversation_messages SET status = 'sent', sent_at = now() WHERE id = $1 AND tenant_id = $2", [draft.rows[0].id, tenantId])
    } catch (error) {
      await query('UPDATE conversation_messages SET last_error = $1 WHERE id = $2 AND tenant_id = $3', [error instanceof Error ? error.message : 'send failed', draft.rows[0].id, tenantId])
    }
  }
}

// ---------- TikTok ----------
export async function deliverTikTok(tenantId: string, jobId: string): Promise<{ status: string; message: string }> {
  const found = await query<{ content: { caption: string; hashtags: string[] }; image_url: string | null; name: string | null }>(
    'SELECT d.content, p.image_url, p.name FROM publishing_jobs j JOIN content_drafts d ON d.id = j.content_draft_id LEFT JOIN products p ON p.id = d.product_id WHERE j.id = $1 AND j.tenant_id = $2', [jobId, tenantId])
  const job = found.rows[0]
  if (!job) return { status: 'failed', message: 'Job not found' }
  let integration: Awaited<ReturnType<typeof integrationOf>> = null
  try {
    integration = await integrationOf(tenantId, 'tiktok')
  } catch (error) {
    // An expired/revoked TikTok login must fail loudly, not look like "not configured".
    const message = error instanceof TikTokError ? error.message : 'The stored TikTok token cannot be used. Connect TikTok again.'
    await query("UPDATE publishing_jobs SET status = 'failed', provider = 'tiktok', attempts = attempts + 1, last_error = $1 WHERE id = $2 AND tenant_id = $3", [message, jobId, tenantId])
    await createNotification(tenantId, 'publishing_failed', 'Post could not be sent to TikTok', message)
    return { status: 'failed', message }
  }
  if (!integration) return { status: 'queued', message: 'Recorded only. Add and enable a TikTok integration (access token) in Integrations to send posts.' }
  if (!job.image_url) {
    await query("UPDATE publishing_jobs SET status = 'failed', provider = 'tiktok', attempts = attempts + 1, last_error = $1 WHERE id = $2 AND tenant_id = $3", ['TikTok photo posts need a product image URL', jobId, tenantId])
    return { status: 'failed', message: 'TikTok photo posts need a product image URL' }
  }
  const text = `${job.content.caption}${job.content.hashtags.length ? `\n\n${job.content.hashtags.join(' ')}` : ''}`
  try {
    const result = await new TikTokClient(integration.secret).publishPhotos({ title: job.name ?? job.content.caption.slice(0, 80), description: text, imageUrls: [job.image_url], privacyLevel: integration.config.privacyLevel ?? 'SELF_ONLY' })
    await query("UPDATE publishing_jobs SET status = 'submitted_to_tiktok', provider = 'tiktok', external_post_id = $1, attempts = attempts + 1, last_error = NULL WHERE id = $2 AND tenant_id = $3", [result.publishId, jobId, tenantId])
    return { status: 'submitted_to_tiktok', message: 'TikTok accepted the post (publish id received). Final publishing happens on TikTok; check status in the queue.' }
  } catch (error) {
    const message = error instanceof TikTokError ? error.message : 'Unexpected error while sending to TikTok'
    await query("UPDATE publishing_jobs SET status = 'failed', provider = 'tiktok', attempts = attempts + 1, last_error = $1 WHERE id = $2 AND tenant_id = $3", [message, jobId, tenantId])
    await createNotification(tenantId, 'publishing_failed', 'Post could not be sent to TikTok', message)
    return { status: 'failed', message }
  }
}

export async function testExtraProvider(provider: 'whatsapp' | 'tiktok', secret: string, cfg: Record<string, string>): Promise<{ status: 'verified' | 'failed'; message: string }> {
  try {
    if (provider === 'whatsapp') {
      if (!cfg.phoneNumberId) throw new MetaError('WhatsApp needs a phone number id')
      const id = await new WhatsAppClient(secret, cfg.phoneNumberId, undefined, config.META_GRAPH_VERSION).getIdentity()
      return { status: 'verified', message: `Connected to WhatsApp. Number: ${id.display_phone_number ?? id.id}${id.verified_name ? ` (${id.verified_name})` : ''}` }
    }
    const info = await new TikTokClient(secret).queryCreatorInfo()
    return { status: 'verified', message: `Connected to TikTok${info.creator_username ? ` as @${info.creator_username}` : ''}. Allowed privacy levels: ${(info.privacy_level_options ?? []).join(', ') || 'unknown'}` }
  } catch (error) {
    return { status: 'failed', message: error instanceof MetaError || error instanceof TikTokError ? error.message : 'Stored token cannot be used. Enter it again.' }
  }
}

// ---------- Exports ----------
const datasets = {
  products: { header: ['name', 'category', 'wholesale_price', 'selling_price', 'stock', 'status', 'supplier_url', 'created_at'], sql: 'SELECT name, category, wholesale_price, selling_price, stock, status, supplier_url, created_at FROM products WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20000' },
  customers: { header: ['name', 'phone', 'city', 'address', 'created_at'], sql: 'SELECT name, phone, city, address, created_at FROM customers WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20000' },
  orders: { header: ['order_id', 'created_at', 'customer', 'phone', 'city', 'product', 'quantity', 'total_amount', 'payment_method', 'status'], sql: 'SELECT o.id, o.created_at, c.name, c.phone, c.city, p.name, o.quantity, o.total_amount, o.payment_method, o.status FROM orders o JOIN customers c ON c.id = o.customer_id JOIN products p ON p.id = o.product_id WHERE o.tenant_id = $1 ORDER BY o.created_at DESC LIMIT 20000' },
  payments: { header: ['id', 'order_id', 'method', 'amount', 'reference', 'status', 'created_at'], sql: 'SELECT id, order_id, method, amount, reference, status, created_at FROM payment_verifications WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20000' },
  supplier_orders: { header: ['order_id', 'supplier', 'supplier_order_id', 'status', 'error', 'created_at'], sql: 'SELECT order_id, supplier_kind, supplier_order_id, status, error_message, created_at FROM supplier_orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20000' },
  profit: { header: ['order_id', 'created_at', 'product', 'quantity', 'revenue', 'supplier_cost', 'gross_profit', 'status'], sql: "SELECT o.id, o.created_at, p.name, o.quantity, o.total_amount, (p.wholesale_price * o.quantity), (o.total_amount - p.wholesale_price * o.quantity), o.status FROM orders o JOIN products p ON p.id = o.product_id WHERE o.tenant_id = $1 AND o.status NOT IN ('cancelled', 'returned', 'refunded') ORDER BY o.created_at DESC LIMIT 20000" },
} as const
type DatasetKey = keyof typeof datasets
const datasetEnum = z.enum(Object.keys(datasets) as [DatasetKey, ...DatasetKey[]])

async function loadDataset(tenantId: string, key: DatasetKey) {
  const d = datasets[key]
  const result = await query<Record<string, unknown>>(d.sql, [tenantId])
  return { header: [...d.header] as string[], rows: result.rows.map((r) => Object.values(r)) }
}

// ---------- Routes ----------
export function registerExtraRoutes(app: FastifyInstance, requireAuth: Auth) {
  const admin = [requireAuth, requireRole('admin')]
  const owner = [requireAuth, requireRole('owner')]
  const manager = [requireAuth, requireRole('manager')]

  app.get('/api/exports/:dataset', { preHandler: requireAuth }, async (request, reply) => {
    const key = datasetEnum.safeParse((request.params as Record<string, string>).dataset)
    if (!key.success) return reply.code(404).send({ error: `Unknown dataset. Use one of: ${Object.keys(datasets).join(', ')}` })
    const format = (request.query as Record<string, string>).format === 'xls' ? 'xls' : 'csv'
    const data = await loadDataset(request.user!.tenantId, key.data)
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'export.downloaded', entityType: 'export', metadata: { dataset: key.data, format, rows: data.rows.length } })
    if (format === 'xls') return reply.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8').header('Content-Disposition', `attachment; filename="${key.data}.xls"`).send(toExcelXml(key.data, data.header, data.rows))
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${key.data}.csv"`).send(toCsv(data.header, data.rows))
  })

  const sheetSchema = z.object({ dataset: datasetEnum, spreadsheetId: z.string().min(10).max(120).regex(/^[A-Za-z0-9_-]+$/), tab: z.string().min(1).max(80).regex(/^[A-Za-z0-9 _-]+$/) })
  app.post('/api/exports/sheets', { preHandler: admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = sheetSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Choose a dataset, the spreadsheet id (from its URL) and a tab name' })
    if (!config.GOOGLE_SERVICE_ACCOUNT_JSON) return reply.code(503).send({ error: 'Google Sheets sync is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on the server and share the sheet with the service account email (see DEPLOYMENT.md).' })
    const tenantId = request.user!.tenantId
    try {
      const data = await loadDataset(tenantId, parsed.data.dataset)
      const result = await new GoogleSheetsClient(parseServiceAccount(config.GOOGLE_SERVICE_ACCOUNT_JSON)).replaceTab(parsed.data.spreadsheetId, parsed.data.tab, data.header, data.rows)
      await query("INSERT INTO sheet_syncs (tenant_id, dataset, spreadsheet_id, tab, status, rows_written) VALUES ($1,$2,$3,$4,'succeeded',$5)", [tenantId, parsed.data.dataset, parsed.data.spreadsheetId, parsed.data.tab, result.rows])
      await writeAuditLog({ tenantId, userId: request.user!.id, action: 'export.sheets_synced', entityType: 'export', metadata: { dataset: parsed.data.dataset, rows: result.rows } })
      return { status: 'succeeded', rows: result.rows, note: 'Google confirmed the write.' }
    } catch (error) {
      const message = error instanceof SheetsError ? error.message : 'Unexpected error while syncing to Google Sheets'
      await query("INSERT INTO sheet_syncs (tenant_id, dataset, spreadsheet_id, tab, status, error) VALUES ($1,$2,$3,$4,'failed',$5)", [tenantId, parsed.data.dataset, parsed.data.spreadsheetId, parsed.data.tab, message])
      await createNotification(tenantId, 'sheets_failed', 'Google Sheets sync failed', message)
      return reply.code(502).send({ error: message })
    }
  })
  app.get('/api/exports/sheets/history', { preHandler: admin }, async (request) => ({ syncs: (await query('SELECT id, dataset, spreadsheet_id, tab, status, rows_written, error, created_at FROM sheet_syncs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50', [request.user!.tenantId])).rows }))

  // TikTok: after the integration test passes, register the account so the scheduler can use it.
  app.post('/api/integrations/:id/connect-tiktok-account', { preHandler: admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid integration id' })
    const tenantId = request.user!.tenantId
    const row = (await query<{ provider: string; encrypted_secret: string | null }>('SELECT provider, encrypted_secret FROM integrations WHERE id = $1 AND tenant_id = $2', [id.data, tenantId])).rows[0]
    if (!row || row.provider !== 'tiktok' || !row.encrypted_secret) return reply.code(404).send({ error: 'TikTok integration not found' })
    try {
      const info = await new TikTokClient(decryptSecret(row.encrypted_secret, integrationKey())).queryCreatorInfo()
      const handle = info.creator_username ?? 'tiktok-account'
      const existing = await query<{ id: string }>("SELECT id FROM social_accounts WHERE tenant_id = $1 AND platform = 'tiktok' AND external_account_id = $2", [tenantId, handle])
      const account = existing.rows[0]
        ? (await query("UPDATE social_accounts SET status = 'connected', provider = 'tiktok' WHERE id = $1 AND tenant_id = $2 RETURNING id, platform, display_name, status", [existing.rows[0].id, tenantId])).rows[0]
        : (await query("INSERT INTO social_accounts (tenant_id, platform, display_name, external_account_id, status, provider) VALUES ($1,'tiktok',$2,$3,'connected','tiktok') RETURNING id, platform, display_name, status", [tenantId, `@${handle}`, handle])).rows[0]
      await writeAuditLog({ tenantId, userId: request.user!.id, action: 'tiktok.account_connected', entityType: 'social_account', entityId: (account as { id: string }).id })
      return reply.code(201).send({ account, note: 'Until TikTok audits your app, posts can only be private (SELF_ONLY).' })
    } catch (error) {
      return reply.code(502).send({ error: error instanceof TikTokError ? error.message : 'Could not verify the TikTok token' })
    }
  })

  // Stripe Checkout for a pending invoice. The plan switches only from the signed webhook below.
  app.post('/api/billing/checkout', { preHandler: owner, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!config.STRIPE_SECRET_KEY) return reply.code(503).send({ error: 'Online card payment is not configured on this server. Pay the invoice by bank transfer, Easypaisa or JazzCash instead.' })
    const tenantId = request.user!.tenantId
    const invoice = (await query<{ id: string; number: string; plan_code: string; total: string; currency: string }>("SELECT id, number, plan_code, total, currency FROM invoices WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [tenantId])).rows[0]
    if (!invoice) return reply.code(404).send({ error: 'No pending invoice. Choose a plan first.' })
    const email = (await query<{ email: string }>('SELECT email FROM users WHERE id = $1 AND tenant_id = $2', [request.user!.id, tenantId])).rows[0]?.email
    if (!email) return reply.code(404).send({ error: 'User not found' })
    try {
      const session = await new StripeProvider(config.STRIPE_SECRET_KEY).createCheckout({ invoiceId: invoice.id, invoiceNumber: invoice.number, description: `Orbitly ${invoice.plan_code} plan`, amountMinor: Math.round(Number(invoice.total) * 100), currency: invoice.currency, customerEmail: email, successUrl: `${config.APP_URL}/?checkout=success`, cancelUrl: `${config.APP_URL}/?checkout=cancelled` })
      await query("UPDATE invoices SET provider = 'stripe', provider_session_id = $1 WHERE id = $2 AND tenant_id = $3 AND status = 'pending'", [session.providerSessionId, invoice.id, tenantId])
      await writeAuditLog({ tenantId, userId: request.user!.id, action: 'billing.checkout_started', entityType: 'invoice', entityId: invoice.id })
      return { url: session.url }
    } catch (error) {
      return reply.code(502).send({ error: error instanceof StripeError ? error.message : 'Could not start checkout' })
    }
  })

  // OCR hint for a payment proof. It NEVER verifies anything.
  app.post('/api/uploads/:id/ocr', { preHandler: manager, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid upload id' })
    if (config.OCR_PROVIDER !== 'openai_vision' || !config.AI_API_KEY) return reply.code(503).send({ error: 'OCR is not configured (set OCR_PROVIDER=openai_vision and AI_API_KEY). You can paste the screenshot text into the payment text parser instead.' })
    const row = (await query<{ content_type: string; data_base64: string | null; storage: string }>("SELECT content_type, data_base64, storage FROM uploads WHERE id = $1 AND tenant_id = $2 AND kind = 'payment_proof'", [id.data, request.user!.tenantId])).rows[0]
    if (!row) return reply.code(404).send({ error: 'Payment proof not found' })
    if (!row.data_base64) return reply.code(409).send({ error: 'This proof is stored in object storage; OCR currently reads database-stored proofs only.' })
    try {
      const result = await ocrImageText({ baseUrl: config.AI_BASE_URL, apiKey: config.AI_API_KEY, model: config.OCR_MODEL, contentType: row.content_type, dataBase64: row.data_base64 })
      await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'payment.ocr_requested', entityType: 'upload', entityId: id.data })
      return { text: result.text, extracted: result.extracted, verified: false, note: 'OCR text is a hint. A person must confirm the money arrived before approving.' }
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'OCR failed' })
    }
  })

  // Webhooks need the RAW body for signature checks, so they live in their own scope.
  void app.register(async (scope) => {
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

    scope.get('/webhooks/whatsapp', async (request, reply) => {
      const q = request.query as Record<string, string | undefined>
      if (config.META_VERIFY_TOKEN && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.META_VERIFY_TOKEN && q['hub.challenge']) return reply.type('text/plain').send(q['hub.challenge'])
      return reply.code(403).send({ error: 'Webhook verification failed' })
    })
    scope.post('/webhooks/whatsapp', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!config.META_APP_SECRET) return reply.code(503).send({ error: 'WhatsApp webhook is not configured (META_APP_SECRET missing)' })
      const raw = (request as FastifyRequest & { rawBody?: string }).rawBody ?? ''
      if (!verifyMetaSignature(raw, request.headers['x-hub-signature-256'] as string | undefined, config.META_APP_SECRET)) return reply.code(401).send({ error: 'Invalid signature' })
      const events = parseWhatsAppWebhook(request.body)
      const templateUpdates = parseTemplateStatusWebhook(request.body)
      const work = (async () => {
        for (const event of events) { try { await processInboundWhatsApp(event) } catch (error) { request.log.error(error) } }
        for (const update of templateUpdates) { try { await applyTemplateStatus(update) } catch (error) { request.log.error(error) } }
      })()
      if (config.NODE_ENV === 'test') await work
      return reply.code(200).send('EVENT_RECEIVED')
    })

    scope.post('/webhooks/stripe', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!config.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: 'Stripe webhook is not configured' })
      const raw = (request as FastifyRequest & { rawBody?: string }).rawBody ?? ''
      if (!verifyStripeSignature(raw, request.headers['stripe-signature'] as string | undefined, config.STRIPE_WEBHOOK_SECRET)) return reply.code(400).send({ error: 'Invalid signature' })
      const settled = settledInvoiceFromEvent(request.body)
      if (!settled || !uuid.safeParse(settled.invoiceId).success) return reply.code(200).send({ received: true })
      const invoice = (await query<{ tenant_id: string; total: string; currency: string; status: string }>('SELECT tenant_id, total, currency, status FROM invoices WHERE id = $1', [settled.invoiceId])).rows[0]
      if (!invoice) return reply.code(200).send({ received: true })
      // The paid amount must match the invoice exactly. A mismatch is never settled automatically.
      if (settled.amountMinor !== Math.round(Number(invoice.total) * 100) || settled.currency !== invoice.currency.toUpperCase()) {
        await createNotification(invoice.tenant_id, 'subscription', 'Payment amount mismatch', `Stripe reported a payment that does not match the invoice. Contact support with reference ${settled.reference}.`)
        await writeAuditLog({ tenantId: invoice.tenant_id, action: 'billing.payment_mismatch', entityType: 'invoice', entityId: settled.invoiceId, metadata: { reference: settled.reference } })
        return reply.code(200).send({ received: true })
      }
      const result = await settleInvoice(settled.invoiceId, settled.reference, null)
      if (result.kind === 'error') { request.log.error(result.error); return reply.code(500).send({ error: 'Could not settle invoice' }) } // Stripe will retry.
      return reply.code(200).send({ received: true })
    })
  })
}
