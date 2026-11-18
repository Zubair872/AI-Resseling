// Purpose (round 12): OAuth "Connect" for Meta + TikTok, WhatsApp templates, LLM tool-calling agent, Temu/AliExpress/Daraz CSV import.
// Every external call is an official API adapter that is NOT verified against a live account in the authoring session.
// Written without being able to run Fastify/PGlite here (no npm registry): run `npm run verify` locally and send me any error.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { pool, query } from './db.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { createNotification } from './notifications.js'
import { decryptSecret, encryptSecret, secretHint } from './secrets.js'
import { integrationKey } from './integrationKey.js'
import { OAUTH_SELECTION_TTL_MINUTES, OAUTH_STATE_TTL_MINUTES, MetaOAuth, OAuthError, TikTokOAuth, appRedirect, buildMetaAuthUrl, buildTikTokAuthUrl, defaultMetaScopes, defaultTikTokScopes, generateOAuthState, hashOAuthValue, needsRefresh, oauthCallbackUrl, parseScopes, type MetaPage, type OAuthProvider } from './oauth.js'
import { MetaError } from './meta.js'
import { TikTokClient, TikTokError } from './tiktok.js'
import { WhatsAppClient, buildCreateTemplatePayload, canSendTemplate, renderTemplate, templateCategories, validateSendParams, validateTemplateDefinition, type TemplateCategory } from './whatsapp.js'
import { LlmError, estimateCost, openAiToolChat, runToolAgent } from './llmAgent.js'
import { buildAgentTools, shouldAutoApply, type Proposal, type ToolDeps } from './llmTools.js'
import { categories, type AutonomyMode } from './agents.js'
import { checkLimit } from './limits.js'
import { applyProfit, type ProfitConfig, type SourcingRules } from './sourcing.js'
import { evaluateMarketCandidate, fieldKeys, marketplacePresets, marketplaces, parseMarketplaceCsv, type Marketplace } from './marketplaceCsv.js'

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
export type GrowthDeps = {
  sourcingSettings(tenantId: string): Promise<{ rules: SourcingRules; profit: ProfitConfig }>
  planLimits(tenantId: string): Promise<{ product_limit: number; social_account_limit: number } | null>
}
const uuid = z.string().uuid()
const idParam = (request: FastifyRequest) => uuid.safeParse((request.params as Record<string, string | undefined>).id)

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------
const metaConfigured = () => Boolean(config.META_APP_ID && config.META_APP_SECRET && config.PUBLIC_API_URL)
const tiktokConfigured = () => Boolean(config.TIKTOK_CLIENT_KEY && config.TIKTOK_CLIENT_SECRET && config.PUBLIC_API_URL)
const metaScopes = () => parseScopes(config.META_OAUTH_SCOPES, defaultMetaScopes)
const tiktokScopes = () => parseScopes(config.TIKTOK_OAUTH_SCOPES, defaultTikTokScopes)
const metaOAuth = () => new MetaOAuth(config.META_APP_ID as string, config.META_APP_SECRET as string, oauthCallbackUrl(config.PUBLIC_API_URL as string, 'meta'), undefined, config.META_GRAPH_VERSION)
const tiktokOAuth = () => new TikTokOAuth(config.TIKTOK_CLIENT_KEY as string, config.TIKTOK_CLIENT_SECRET as string, oauthCallbackUrl(config.PUBLIC_API_URL as string, 'tiktok'))

type TikTokRow = { id: string; tenant_id: string; encrypted_secret: string | null; encrypted_refresh_secret: string | null; token_expires_at: string | null; refresh_expires_at: string | null; connected_via: string }

// Returns a usable TikTok access token. OAuth-connected tokens last ~24 hours: refresh them shortly before they expire.
// Tokens pasted by hand (connected_via = 'manual') are returned as stored.
export async function freshTikTokToken(row: TikTokRow): Promise<string> {
  if (!row.encrypted_secret) throw new TikTokError('No TikTok token stored')
  const current = decryptSecret(row.encrypted_secret, integrationKey())
  if (row.connected_via !== 'oauth' || !needsRefresh(row.token_expires_at)) return current
  if (!row.encrypted_refresh_secret || !tiktokConfigured()) throw new TikTokError('TikTok login expired. Press "Connect TikTok" again.')
  if (row.refresh_expires_at && new Date(row.refresh_expires_at).getTime() < Date.now()) throw new TikTokError('TikTok login expired. Press "Connect TikTok" again.')
  try {
    const t = await tiktokOAuth().refresh(decryptSecret(row.encrypted_refresh_secret, integrationKey()))
    await query(
      "UPDATE integrations SET encrypted_secret = $1, secret_hint = $2, encrypted_refresh_secret = $3, token_expires_at = $4, refresh_expires_at = $5, status = 'verified', status_message = 'Token refreshed automatically', updated_at = now() WHERE id = $6 AND tenant_id = $7",
      [encryptSecret(t.accessToken, integrationKey()), secretHint(t.accessToken), encryptSecret(t.refreshToken, integrationKey()), t.expiresAt.toISOString(), t.refreshExpiresAt.toISOString(), row.id, row.tenant_id],
    )
    return t.accessToken
  } catch (error) {
    const message = error instanceof OAuthError ? error.message : 'TikTok token refresh failed'
    await query("UPDATE integrations SET status = 'failed', status_message = $1, last_checked_at = now() WHERE id = $2 AND tenant_id = $3", [message, row.id, row.tenant_id])
    await createNotification(row.tenant_id, 'account_disconnected', 'TikTok connection needs attention', `${message}. Press "Connect TikTok" in Integrations.`)
    throw new TikTokError(`${message}. Press "Connect TikTok" again.`)
  }
}

// ---------------------------------------------------------------------------
// WhatsApp helpers
// ---------------------------------------------------------------------------
async function whatsappFor(tenantId: string) {
  const r = (await query<{ encrypted_secret: string | null; config: Record<string, string> }>("SELECT encrypted_secret, config FROM integrations WHERE tenant_id = $1 AND provider = 'whatsapp' AND enabled = true AND encrypted_secret IS NOT NULL ORDER BY created_at LIMIT 1", [tenantId])).rows[0]
  if (!r?.encrypted_secret) return null
  const phoneNumberId = r.config.phoneNumberId
  if (!phoneNumberId) return null
  return { client: new WhatsAppClient(decryptSecret(r.encrypted_secret, integrationKey()), phoneNumberId, undefined, config.META_GRAPH_VERSION), wabaId: r.config.wabaId ?? null }
}

// Called from the WhatsApp webhook (signed by Meta) when a template is approved, rejected, paused or disabled.
export async function applyTemplateStatus(update: { wabaId: string; metaId: string; name: string; status: string; reason?: string }) {
  const owner = (await query<{ tenant_id: string }>("SELECT tenant_id FROM integrations WHERE provider = 'whatsapp' AND config->>'wabaId' = $1 ORDER BY created_at LIMIT 1", [update.wabaId])).rows[0]
  if (!owner) return
  const changed = await query("UPDATE whatsapp_templates SET status = $1, rejected_reason = $2, updated_at = now() WHERE tenant_id = $3 AND (meta_template_id = $4 OR name = $5) RETURNING id", [update.status.slice(0, 20), update.reason ?? null, owner.tenant_id, update.metaId, update.name])
  if (changed.rows[0] && ['APPROVED', 'REJECTED', 'DISABLED', 'PAUSED'].includes(update.status)) await createNotification(owner.tenant_id, 'whatsapp_template', `WhatsApp template ${update.name}: ${update.status}`, update.reason)
}

// ---------------------------------------------------------------------------
// LLM agent: apply approved proposals (used by the decision route and by Full-mode auto-apply)
// ---------------------------------------------------------------------------
type StoredProposal = Proposal & { applied?: boolean; note?: string }

// Re-checks everything at apply time: the product must still exist in this workspace, the category must be valid,
// and a price can never go below the CURRENT wholesale price.
export async function applyProposal(tenantId: string, proposal: StoredProposal): Promise<{ applied: boolean; note?: string }> {
  const product = (await query<{ id: string; wholesale_price: string }>('SELECT id, wholesale_price FROM products WHERE id = $1 AND tenant_id = $2', [proposal.productId, tenantId])).rows[0]
  if (!product) return { applied: false, note: 'Product no longer exists' }
  if (proposal.kind === 'category_change') {
    if (!(categories as readonly string[]).includes(proposal.to)) return { applied: false, note: 'Invalid category' }
    await query('UPDATE products SET category = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [proposal.to, proposal.productId, tenantId])
    return { applied: true }
  }
  if (!(proposal.to > 0) || proposal.to < Number(product.wholesale_price)) return { applied: false, note: 'Refused: price would be below the wholesale price' }
  await query('UPDATE products SET selling_price = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [proposal.to, proposal.productId, tenantId])
  return { applied: true }
}

export async function applyLlmRun(tenantId: string, runId: string) {
  const run = (await query<{ output: { proposals?: StoredProposal[] } & Record<string, unknown> }>('SELECT output FROM agent_runs WHERE id = $1 AND tenant_id = $2', [runId, tenantId])).rows[0]
  const proposals = run?.output.proposals ?? []
  for (const proposal of proposals) {
    if (proposal.applied) continue
    const result = await applyProposal(tenantId, proposal)
    proposal.applied = result.applied
    if (result.note) proposal.note = result.note
  }
  await query('UPDATE agent_runs SET output = $1 WHERE id = $2 AND tenant_id = $3', [JSON.stringify({ ...run?.output, proposals }), runId, tenantId])
  return proposals
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const whatsappTemplateSchema = z.object({
  name: z.string().min(1).max(100), language: z.string().min(2).max(10), category: z.enum(templateCategories as [TemplateCategory, ...TemplateCategory[]]),
  bodyText: z.string().min(1).max(1024), headerText: z.string().max(60).optional(), footerText: z.string().max(60).optional(), examples: z.array(z.string().min(1).max(200)).max(20).default([]),
})
const sendTemplateSchema = z.object({ templateId: uuid, params: z.array(z.string().max(1024)).max(20).default([]) })
const optInSchema = z.object({ optIn: z.boolean(), source: z.string().min(3).max(200).optional() })
const llmRunSchema = z.object({ goal: z.string().min(3).max(1000) })
const marketImportSchema = z.object({
  marketplace: z.enum(marketplaces as [Marketplace, ...Marketplace[]]),
  csv: z.string().min(1).max(5_000_000),
  dryRun: z.boolean().default(false),
  exchangeRates: z.record(z.string().regex(/^[A-Za-z]{3}$/), z.number().positive().max(100000)).default({}),
  shippingPerItem: z.number().nonnegative().max(1_000_000).default(0),
  dutyPercent: z.number().nonnegative().max(200).default(0),
  defaultStock: z.number().int().nonnegative().max(100000).default(0),
  qualityMode: z.enum(['strict', 'skip_missing', 'off']).default('skip_missing'),
  columnMap: z.partialRecord(z.enum(fieldKeys as [string, ...string[]]), z.string().max(120)).default({}),
})
const metaFinishSchema = z.object({ token: z.string().min(20).max(200), pageId: z.string().min(3).max(60), aiMode: z.enum(['manual', 'approval', 'auto']).default('approval'), commentReplyMode: z.enum(['private', 'public', 'both']).default('private') })

export function registerGrowthRoutes(app: FastifyInstance, requireAuth: Auth, deps: GrowthDeps) {
  const admin = [requireAuth, requireRole('admin')]
  const manager = [requireAuth, requireRole('manager')]

  // ======================= OAuth =======================
  app.get('/api/oauth/status', { preHandler: requireAuth }, async () => ({
    meta: { configured: metaConfigured(), redirectUri: config.PUBLIC_API_URL ? oauthCallbackUrl(config.PUBLIC_API_URL, 'meta') : null, scopes: metaScopes(), missing: [!config.META_APP_ID && 'META_APP_ID', !config.META_APP_SECRET && 'META_APP_SECRET', !config.PUBLIC_API_URL && 'PUBLIC_API_URL'].filter(Boolean) },
    tiktok: { configured: tiktokConfigured(), redirectUri: config.PUBLIC_API_URL ? oauthCallbackUrl(config.PUBLIC_API_URL, 'tiktok') : null, scopes: tiktokScopes(), missing: [!config.TIKTOK_CLIENT_KEY && 'TIKTOK_CLIENT_KEY', !config.TIKTOK_CLIENT_SECRET && 'TIKTOK_CLIENT_SECRET', !config.PUBLIC_API_URL && 'PUBLIC_API_URL'].filter(Boolean) },
  }))

  app.post('/api/oauth/:provider/start', { preHandler: admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const provider = z.enum(['meta', 'tiktok']).safeParse((request.params as Record<string, string>).provider)
    if (!provider.success) return reply.code(400).send({ error: 'Unknown provider' })
    const p: OAuthProvider = provider.data
    if (p === 'meta' ? !metaConfigured() : !tiktokConfigured()) return reply.code(503).send({ error: `${p === 'meta' ? 'Meta' : 'TikTok'} login is not configured on this server. Set ${p === 'meta' ? 'META_APP_ID, META_APP_SECRET' : 'TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET'} and PUBLIC_API_URL (see DEPLOYMENT.md).` })
    const { state, hash } = generateOAuthState()
    await query('INSERT INTO oauth_states (tenant_id, user_id, provider, state_hash, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5::int))', [request.user!.tenantId, request.user!.id, p, hash, OAUTH_STATE_TTL_MINUTES])
    const redirectUri = oauthCallbackUrl(config.PUBLIC_API_URL as string, p)
    const url = p === 'meta'
      ? buildMetaAuthUrl({ appId: config.META_APP_ID as string, redirectUri, state, scopes: metaScopes(), version: config.META_GRAPH_VERSION })
      : buildTikTokAuthUrl({ clientKey: config.TIKTOK_CLIENT_KEY as string, redirectUri, state, scopes: tiktokScopes() })
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'oauth.started', entityType: 'integration', metadata: { provider: p } })
    return { url }
  })

  // The provider sends the browser here. No login header exists on this request, so the one-time state value identifies the workspace and user.
  app.get('/api/oauth/:provider/callback', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const provider = z.enum(['meta', 'tiktok']).safeParse((request.params as Record<string, string>).provider)
    if (!provider.success) return reply.code(400).send({ error: 'Unknown provider' })
    const p: OAuthProvider = provider.data
    const q = request.query as Record<string, string | undefined>
    const back = (params: Record<string, string | undefined>) => reply.redirect(appRedirect(config.APP_URL, { oauth: p, ...params }))
    if (!q.state) return back({ status: 'error', message: 'Missing state. Start again from Integrations.' })
    const found = (await query<{ id: string; tenant_id: string; user_id: string }>('UPDATE oauth_states SET used_at = now() WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > now() RETURNING id, tenant_id, user_id', [hashOAuthValue(q.state), p])).rows[0]
    if (!found) return back({ status: 'error', message: 'This login link expired or was already used. Start again.' })
    if (q.error || !q.code) return back({ status: 'error', message: q.error === 'access_denied' || q.error_reason === 'user_denied' ? 'Permission was not granted.' : (q.error_description ?? 'The provider did not return a login code.') })
    const tenant = (await query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [found.tenant_id])).rows[0]
    if (!tenant || tenant.status !== 'active') return back({ status: 'error', message: 'This workspace is suspended.' })
    try {
      if (p === 'meta') {
        const oauth = metaOAuth()
        const userToken = await oauth.extendUserToken(await oauth.exchangeCode(q.code))
        const pages = await oauth.listPages(userToken)
        if (pages.length === 0) return back({ status: 'error', message: 'No Facebook Pages were granted. You must be an admin of the Page and tick it in the permission screen.' })
        const selection = generateOAuthState()
        await query("UPDATE oauth_states SET selection_hash = $1, selection_expires_at = now() + make_interval(mins => $2::int), pending_encrypted = $3 WHERE id = $4", [selection.hash, OAUTH_SELECTION_TTL_MINUTES, encryptSecret(JSON.stringify(pages), integrationKey()), found.id])
        return back({ status: 'select', token: selection.state })
      }
      const t = await tiktokOAuth().exchangeCode(q.code)
      const info = await new TikTokClient(t.accessToken).queryCreatorInfo()
      const handle = info.creator_username ?? t.openId
      const existing = (await query<{ id: string }>("SELECT id FROM integrations WHERE tenant_id = $1 AND provider = 'tiktok' ORDER BY created_at LIMIT 1", [found.tenant_id])).rows[0]
      const values = [encryptSecret(t.accessToken, integrationKey()), secretHint(t.accessToken), encryptSecret(t.refreshToken, integrationKey()), t.expiresAt.toISOString(), t.refreshExpiresAt.toISOString(), JSON.stringify({ openId: t.openId, username: handle, privacyLevel: 'SELF_ONLY' })]
      if (existing) {
        await query("UPDATE integrations SET encrypted_secret = $1, secret_hint = $2, encrypted_refresh_secret = $3, token_expires_at = $4, refresh_expires_at = $5, config = config || $6::jsonb, connected_via = 'oauth', enabled = true, status = 'verified', status_message = $7, last_checked_at = now(), updated_at = now() WHERE id = $8 AND tenant_id = $9", [...values, `Connected via TikTok login as @${handle}`, existing.id, found.tenant_id])
      } else {
        await query("INSERT INTO integrations (tenant_id, provider, label, config, encrypted_secret, secret_hint, encrypted_refresh_secret, token_expires_at, refresh_expires_at, connected_via, status, status_message, last_checked_at) VALUES ($1,'tiktok','TikTok',$7::jsonb,$2,$3,$4,$5,$6,'oauth','verified',$8, now())", [found.tenant_id, values[0], values[1], values[2], values[3], values[4], values[5], `Connected via TikTok login as @${handle}`])
      }
      const account = (await query<{ id: string }>("SELECT id FROM social_accounts WHERE tenant_id = $1 AND platform = 'tiktok' AND external_account_id = $2", [found.tenant_id, handle])).rows[0]
      if (account) await query("UPDATE social_accounts SET status = 'connected', provider = 'tiktok' WHERE id = $1 AND tenant_id = $2", [account.id, found.tenant_id])
      else await query("INSERT INTO social_accounts (tenant_id, platform, display_name, external_account_id, status, provider) VALUES ($1,'tiktok',$2,$3,'connected','tiktok')", [found.tenant_id, `@${handle}`, handle])
      await writeAuditLog({ tenantId: found.tenant_id, userId: found.user_id, action: 'oauth.tiktok_connected', entityType: 'integration', metadata: { username: handle, scope: t.scope } })
      return back({ status: 'success', message: `TikTok connected as @${handle}. Until TikTok audits your app, posts stay private.` })
    } catch (error) {
      request.log.error(error)
      const message = error instanceof OAuthError || error instanceof TikTokError ? error.message : 'Connection failed. Try again.'
      await writeAuditLog({ tenantId: found.tenant_id, userId: found.user_id, action: 'oauth.failed', entityType: 'integration', metadata: { provider: p } })
      return back({ status: 'error', message })
    }
  })

  // Step 2 for Meta: the browser asks which Pages were granted (names only, never tokens) and picks one.
  async function pendingRow(request: FastifyRequest, token: string) {
    return (await query<{ id: string; pending_encrypted: string | null }>('SELECT id, pending_encrypted FROM oauth_states WHERE selection_hash = $1 AND tenant_id = $2 AND user_id = $3 AND provider = $4 AND selection_expires_at > now() AND pending_encrypted IS NOT NULL', [hashOAuthValue(token), request.user!.tenantId, request.user!.id, 'meta'])).rows[0] ?? null
  }

  app.get('/api/oauth/pending', { preHandler: admin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = z.string().min(20).max(200).safeParse((request.query as Record<string, string | undefined>).token)
    if (!token.success) return reply.code(400).send({ error: 'Invalid token' })
    const row = await pendingRow(request, token.data)
    if (!row?.pending_encrypted) return reply.code(404).send({ error: 'This selection expired. Press "Connect Facebook / Instagram" again.' })
    const pages = JSON.parse(decryptSecret(row.pending_encrypted, integrationKey())) as MetaPage[]
    return { pages: pages.map((pg) => ({ id: pg.id, name: pg.name, instagramId: pg.instagramId ?? null, instagramUsername: pg.instagramUsername ?? null })) }
  })

  app.post('/api/oauth/meta/finish', { preHandler: admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = metaFinishSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() })
    const tenantId = request.user!.tenantId
    const row = await pendingRow(request, parsed.data.token)
    if (!row?.pending_encrypted) return reply.code(404).send({ error: 'This selection expired. Press "Connect Facebook / Instagram" again.' })
    const page = (JSON.parse(decryptSecret(row.pending_encrypted, integrationKey())) as MetaPage[]).find((pg) => pg.id === parsed.data.pageId)
    if (!page) return reply.code(404).send({ error: 'That Page was not part of the permission you granted.' })
    // A Page can feed only one workspace: webhooks are routed by Page id.
    const clash = (await query('SELECT 1 FROM integrations WHERE provider = $1 AND tenant_id <> $2 AND (config->>$3 = $4 OR config->>$5 = $4) LIMIT 1', ['meta', tenantId, 'pageId', page.id, 'instagramId'])).rows[0]
    if (clash) return reply.code(409).send({ error: 'This Page is already connected to another workspace.' })
    let subscribed = false
    let webhookNote = ''
    try {
      subscribed = await metaOAuth().subscribePage(page.id, page.accessToken)
      webhookNote = subscribed ? 'Facebook Page webhooks subscribed.' : 'Meta did not confirm the webhook subscription.'
    } catch (error) {
      webhookNote = `Webhook subscription failed: ${error instanceof OAuthError ? error.message : 'unknown error'}`
    }
    const cfg = { pageId: page.id, pageName: page.name, ...(page.instagramId ? { instagramId: page.instagramId, instagramUsername: page.instagramUsername ?? '' } : {}), aiMode: parsed.data.aiMode, commentReplyMode: parsed.data.commentReplyMode }
    const message = `Connected via Facebook login: ${page.name}${page.instagramUsername ? ` + Instagram @${page.instagramUsername}` : ''}. ${webhookNote}`
    const existing = (await query<{ id: string }>("SELECT id FROM integrations WHERE tenant_id = $1 AND provider = 'meta' ORDER BY created_at LIMIT 1", [tenantId])).rows[0]
    let integrationId: string
    if (existing) {
      await query("UPDATE integrations SET encrypted_secret = $1, secret_hint = $2, config = $3::jsonb, connected_via = 'oauth', enabled = true, status = 'verified', status_message = $4, last_checked_at = now(), updated_at = now() WHERE id = $5 AND tenant_id = $6", [encryptSecret(page.accessToken, integrationKey()), secretHint(page.accessToken), JSON.stringify(cfg), message, existing.id, tenantId])
      integrationId = existing.id
    } else {
      integrationId = (await query<{ id: string }>("INSERT INTO integrations (tenant_id, provider, label, config, encrypted_secret, secret_hint, connected_via, status, status_message, last_checked_at) VALUES ($1,'meta','Meta',$2::jsonb,$3,$4,'oauth','verified',$5, now()) RETURNING id", [tenantId, JSON.stringify(cfg), encryptSecret(page.accessToken, integrationKey()), secretHint(page.accessToken), message])).rows[0].id
    }
    await query('UPDATE oauth_states SET pending_encrypted = NULL, selection_hash = NULL WHERE id = $1', [row.id])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'oauth.meta_connected', entityType: 'integration', entityId: integrationId, metadata: { pageId: page.id, instagram: Boolean(page.instagramId), webhookSubscribed: subscribed } })
    return { integrationId, status: 'verified', message, webhookSubscribed: subscribed, note: page.instagramId ? 'Instagram webhooks (messages, comments) are switched on in the Meta app dashboard, not per Page. See DEPLOYMENT.md.' : 'No Instagram professional account is linked to this Page.' }
  })

  // ======================= WhatsApp templates =======================
  app.get('/api/whatsapp/templates', { preHandler: requireAuth }, async (request) => {
    const r = await query('SELECT id, name, language, category, status, body_text, header_text, footer_text, variable_count, rejected_reason, synced_at, created_at FROM whatsapp_templates WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200', [request.user!.tenantId])
    const wa = await whatsappFor(request.user!.tenantId)
    return { templates: r.rows, connected: Boolean(wa), wabaIdSet: Boolean(wa?.wabaId) }
  })

  app.post('/api/whatsapp/templates/sync', { preHandler: manager, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const tenantId = request.user!.tenantId
    const wa = await whatsappFor(tenantId)
    if (!wa) return reply.code(400).send({ error: 'Add and enable a WhatsApp integration first.' })
    if (!wa.wabaId) return reply.code(400).send({ error: 'Add your WhatsApp Business Account ID (WABA ID) to the WhatsApp integration to manage templates.' })
    try {
      const remote = await wa.client.listTemplates(wa.wabaId)
      for (const t of remote) {
        await query(
          `INSERT INTO whatsapp_templates (tenant_id, name, language, category, status, body_text, header_text, footer_text, variable_count, meta_template_id, rejected_reason, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
           ON CONFLICT (tenant_id, name, language) DO UPDATE SET category = EXCLUDED.category, status = EXCLUDED.status, body_text = EXCLUDED.body_text, header_text = EXCLUDED.header_text, footer_text = EXCLUDED.footer_text, variable_count = EXCLUDED.variable_count, meta_template_id = EXCLUDED.meta_template_id, rejected_reason = EXCLUDED.rejected_reason, synced_at = now(), updated_at = now()`,
          [tenantId, t.name, t.language, t.category, t.status.slice(0, 20), t.bodyText, t.headerText ?? null, t.footerText ?? null, t.variableCount, t.metaId, t.rejectedReason ?? null],
        )
      }
      await query('DELETE FROM whatsapp_templates WHERE tenant_id = $1 AND meta_template_id IS NOT NULL AND NOT (meta_template_id = ANY($2::text[]))', [tenantId, remote.map((t) => t.metaId)])
      await writeAuditLog({ tenantId, userId: request.user!.id, action: 'whatsapp.templates_synced', entityType: 'integration', metadata: { count: remote.length } })
      return { synced: remote.length, note: 'Only templates with status APPROVED can be sent. Text-only templates are supported here; templates with buttons or media headers can be listed but are not sendable yet.' }
    } catch (error) {
      return reply.code(502).send({ error: error instanceof MetaError ? error.message : 'Could not sync templates' })
    }
  })

  app.post('/api/whatsapp/templates', { preHandler: admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = whatsappTemplateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid template', details: parsed.error.flatten() })
    const tenantId = request.user!.tenantId
    const def = parsed.data
    const check = validateTemplateDefinition(def)
    if (!check.ok) return reply.code(400).send({ error: 'Template rules not met', reasons: check.errors, warnings: check.warnings })
    const wa = await whatsappFor(tenantId)
    if (!wa?.wabaId) return reply.code(400).send({ error: 'Add and enable a WhatsApp integration with your WhatsApp Business Account ID (WABA ID) first.' })
    try {
      const created = await wa.client.createTemplate(wa.wabaId, def)
      const row = (await query('INSERT INTO whatsapp_templates (tenant_id, name, language, category, status, body_text, header_text, footer_text, variable_count, meta_template_id, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now()) ON CONFLICT (tenant_id, name, language) DO UPDATE SET status = EXCLUDED.status, body_text = EXCLUDED.body_text, meta_template_id = EXCLUDED.meta_template_id, updated_at = now() RETURNING id, name, language, category, status', [tenantId, def.name, def.language, def.category, created.status.slice(0, 20), def.bodyText.trim(), def.headerText?.trim() || null, def.footerText?.trim() || null, check.variableCount, created.id])).rows[0]
      await writeAuditLog({ tenantId, userId: request.user!.id, action: 'whatsapp.template_created', entityType: 'whatsapp_template', entityId: (row as { id: string }).id, metadata: { name: def.name, category: def.category } })
      return reply.code(201).send({ template: row, warnings: check.warnings, note: 'Meta reviews every template. It can be sent only after the status becomes APPROVED (use Sync to refresh).' })
    } catch (error) {
      return reply.code(502).send({ error: error instanceof MetaError ? error.message : 'Could not create the template', payloadPreview: buildCreateTemplatePayload(def) })
    }
  })

  app.delete('/api/whatsapp/templates/:id', { preHandler: admin }, async (request, reply) => {
    const id = idParam(request)
    if (!id.success) return reply.code(400).send({ error: 'Invalid template id' })
    const tenantId = request.user!.tenantId
    const t = (await query<{ name: string; meta_template_id: string | null }>('SELECT name, meta_template_id FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2', [id.data, tenantId])).rows[0]
    if (!t) return reply.code(404).send({ error: 'Template not found' })
    const wa = await whatsappFor(tenantId)
    if (t.meta_template_id) {
      if (!wa?.wabaId) return reply.code(400).send({ error: 'Connect WhatsApp (with WABA ID) to delete this template at Meta.' })
      try { await wa.client.deleteTemplate(wa.wabaId, t.name) } catch (error) { return reply.code(502).send({ error: error instanceof MetaError ? error.message : 'Could not delete at Meta' }) }
    }
    await query('DELETE FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2', [id.data, tenantId])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'whatsapp.template_deleted', entityType: 'whatsapp_template', entityId: id.data })
    return reply.code(204).send()
  })

  app.put('/api/customers/:id/whatsapp-opt-in', { preHandler: manager }, async (request, reply) => {
    const id = idParam(request)
    const parsed = optInSchema.safeParse(request.body)
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'Invalid request' })
    if (parsed.data.optIn && !parsed.data.source) return reply.code(400).send({ error: 'Write how the customer agreed (for example "asked on WhatsApp chat on 4 Nov"). Consent must be real and recorded.' })
    const r = await query('UPDATE customers SET whatsapp_opt_in = $1, whatsapp_opt_in_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2 AND tenant_id = $3 RETURNING id, whatsapp_opt_in', [parsed.data.optIn, id.data, request.user!.tenantId])
    if (!r.rows[0]) return reply.code(404).send({ error: 'Customer not found' })
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: parsed.data.optIn ? 'customer.whatsapp_opt_in' : 'customer.whatsapp_opt_out', entityType: 'customer', entityId: id.data, metadata: { source: parsed.data.source } })
    return { customer: r.rows[0] }
  })

  // Business-initiated WhatsApp message with an APPROVED template (works after the 24-hour window has closed).
  app.post('/api/conversations/:id/send-template', { preHandler: manager, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const id = idParam(request)
    const parsed = sendTemplateSchema.safeParse(request.body)
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'Invalid request' })
    const tenantId = request.user!.tenantId
    const conv = (await query<{ channel: string; external_thread_id: string | null; customer_id: string; whatsapp_opt_in: boolean; inbound: number }>(
      "SELECT c.channel, c.external_thread_id, c.customer_id, cu.whatsapp_opt_in, (SELECT COUNT(*)::int FROM conversation_messages m WHERE m.conversation_id = c.id AND m.tenant_id = c.tenant_id AND m.direction = 'inbound') AS inbound FROM conversations c JOIN customers cu ON cu.id = c.customer_id WHERE c.id = $1 AND c.tenant_id = $2", [id.data, tenantId])).rows[0]
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' })
    if (conv.channel !== 'whatsapp' || !conv.external_thread_id) return reply.code(400).send({ error: 'Templates can only be sent in WhatsApp conversations.' })
    const tpl = (await query<{ name: string; language: string; category: string; status: string; body_text: string; header_text: string | null; variable_count: number }>('SELECT name, language, category, status, body_text, header_text, variable_count FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2', [parsed.data.templateId, tenantId])).rows[0]
    if (!tpl) return reply.code(404).send({ error: 'Template not found' })
    if (tpl.header_text && /\{\{/.test(tpl.header_text)) return reply.code(400).send({ error: 'Templates with header variables are not supported yet.' })
    const allowed = canSendTemplate({ status: tpl.status, category: tpl.category, optIn: conv.whatsapp_opt_in, hasInboundHistory: conv.inbound > 0 })
    if (!allowed.ok) return reply.code(409).send({ error: allowed.reason })
    const problems = validateSendParams(tpl.variable_count, parsed.data.params)
    if (problems.length) return reply.code(400).send({ error: 'Template values are wrong', reasons: problems })
    const wa = await whatsappFor(tenantId)
    if (!wa) return reply.code(400).send({ error: 'Add and enable a WhatsApp integration first.' })
    try {
      const sent = await wa.client.sendTemplate(conv.external_thread_id, tpl.name, tpl.language, parsed.data.params)
      const body = renderTemplate(tpl.body_text, parsed.data.params)
      // Stored only AFTER WhatsApp accepted it.
      const msg = (await query<{ id: string }>("INSERT INTO conversation_messages (tenant_id, conversation_id, direction, body, status, created_by, sent_at, template_name, external_message_id) VALUES ($1,$2,'outbound',$3,'sent',$4, now(), $5, $6) ON CONFLICT DO NOTHING RETURNING id", [tenantId, id.data, body, request.user!.id, tpl.name, sent.id])).rows[0]
      await query('UPDATE conversations SET updated_at = now() WHERE id = $1 AND tenant_id = $2', [id.data, tenantId])
      await writeAuditLog({ tenantId, userId: request.user!.id, action: 'whatsapp.template_sent', entityType: 'conversation_message', entityId: msg?.id, metadata: { template: tpl.name, category: tpl.category } })
      return reply.code(201).send({ messageId: msg?.id ?? null, body, note: 'WhatsApp accepted the message. Delivery to the phone is reported later by WhatsApp.' })
    } catch (error) {
      const message = error instanceof MetaError ? error.message : 'Unexpected error while sending to WhatsApp'
      await createNotification(tenantId, 'chat_send_failed', 'Template message could not be sent', message)
      return reply.code(502).send({ error: message })
    }
  })

  // ======================= LLM tool-calling agent =======================
  app.get('/api/agents/llm/status', { preHandler: requireAuth }, async () => ({
    enabled: config.AI_PROVIDER === 'openai' && Boolean(config.AI_API_KEY), model: config.AI_MODEL,
    note: config.AI_PROVIDER === 'openai' && config.AI_API_KEY ? 'The assistant calls your AI provider. It can read your data and record proposals; a person approves changes.' : 'Not configured: set AI_PROVIDER=openai and AI_API_KEY on the server.',
  }))

  app.post('/api/agents/llm/run', { preHandler: manager, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = llmRunSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Describe the task in 3-1000 characters' })
    if (config.AI_PROVIDER !== 'openai' || !config.AI_API_KEY) return reply.code(503).send({ error: 'The AI assistant is not configured. Set AI_PROVIDER=openai and AI_API_KEY on the server.' })
    const tenantId = request.user!.tenantId
    const allowance = (await query<{ ai_action_limit: number; used_actions: number }>(
      "SELECT p.ai_action_limit, (SELECT COALESCE(SUM(quantity), 0)::int FROM usage_events WHERE tenant_id = s.tenant_id AND kind = 'ai_content_generation' AND created_at >= date_trunc('month', now())) AS used_actions FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1 AND s.status IN ('trialing', 'active')", [tenantId])).rows[0]
    if (!allowance) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
    if (allowance.used_actions >= allowance.ai_action_limit) return reply.code(429).send({ error: 'Monthly AI action limit reached', usage: { used: allowance.used_actions, limit: allowance.ai_action_limit } })
    const mode = ((await query<{ autonomy_mode: AutonomyMode }>('SELECT autonomy_mode FROM tenant_settings WHERE tenant_id = $1', [tenantId])).rows[0]?.autonomy_mode ?? 'approval') as AutonomyMode

    const proposals: StoredProposal[] = []
    const rowToProduct = (r: { id: string; name: string; category: string; wholesale_price: string; selling_price: string; stock: number; status: string; description?: string | null }) => ({ id: r.id, name: r.name, category: r.category, wholesalePrice: Number(r.wholesale_price), sellingPrice: Number(r.selling_price), stock: r.stock, status: r.status, description: r.description })
    const toolDeps: ToolDeps = {
      searchProducts: async ({ query: text, category, limit }) => (await query<Parameters<typeof rowToProduct>[0]>(
        "SELECT id, name, category, wholesale_price, selling_price, stock, status FROM products WHERE tenant_id = $1 AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%') AND ($3::text IS NULL OR category = $3) ORDER BY updated_at DESC LIMIT $4", [tenantId, text ? text.replace(/[%_\\]/g, ' ') : null, category ?? null, limit])).rows.map(rowToProduct),
      getProduct: async (pid) => {
        const r = (await query<Parameters<typeof rowToProduct>[0]>('SELECT id, name, category, wholesale_price, selling_price, stock, status, description FROM products WHERE id = $1 AND tenant_id = $2', [pid, tenantId])).rows[0]
        return r ? rowToProduct(r) : null
      },
      businessSummary: async (days) => {
        const r = (await query<Record<string, string | number>>(
          "SELECT COUNT(*)::int AS orders, COALESCE(SUM(o.total_amount),0) AS revenue, COALESCE(SUM(p.wholesale_price * o.quantity),0) AS wholesale_cost FROM orders o JOIN products p ON p.id = o.product_id WHERE o.tenant_id = $1 AND o.created_at >= now() - make_interval(days => $2::int) AND o.status NOT IN ('cancelled', 'returned', 'refunded')", [tenantId, days])).rows[0]
        const revenue = Number(r.revenue)
        const cost = Number(r.wholesale_cost)
        return { days, orders: r.orders, revenue, wholesaleCost: cost, grossProfit: Math.round((revenue - cost) * 100) / 100, note: 'Gross profit only (before delivery, payment fees, refunds).' }
      },
      lowStock: async (threshold) => (await query<{ id: string; name: string; stock: number }>('SELECT id, name, stock FROM products WHERE tenant_id = $1 AND stock <= $2 ORDER BY stock ASC LIMIT 30', [tenantId, threshold])).rows,
      recordProposal: (proposal) => { if (proposals.length < 20) proposals.push(proposal) },
    }

    const chat = openAiToolChat({ baseUrl: config.AI_BASE_URL, apiKey: config.AI_API_KEY, model: config.AI_MODEL })
    let result: Awaited<ReturnType<typeof runToolAgent>>
    try {
      result = await runToolAgent({ chat, tools: buildAgentTools(toolDeps), goal: parsed.data.goal })
    } catch (error) {
      const message = error instanceof LlmError ? error.message : 'The AI assistant failed unexpectedly'
      request.log.error(error)
      await query("INSERT INTO agent_runs (tenant_id, agent, status, autonomy_mode, input, output, error, created_by) VALUES ($1,'llm_assistant','failed',$2,$3,'{}',$4,$5)", [tenantId, mode, JSON.stringify({ goal: parsed.data.goal }), message, request.user!.id])
      return reply.code(502).send({ error: message })
    }

    // Full mode may auto-apply ONLY a category change that the independent rule-based classifier also agrees with.
    const autoNotes: string[] = []
    for (const proposal of proposals) {
      if (proposal.kind !== 'category_change') continue
      const product = (await query<{ name: string; description: string | null }>('SELECT name, description FROM products WHERE id = $1 AND tenant_id = $2', [proposal.productId, tenantId])).rows[0]
      if (product && shouldAutoApply(mode, proposal, product)) {
        const applied = await applyProposal(tenantId, proposal)
        proposal.applied = applied.applied
        if (applied.applied) autoNotes.push(`Auto-applied (Full mode, rule check agreed): ${proposal.productName} \u2192 ${proposal.to}`)
      }
    }
    const pending = proposals.filter((p) => !p.applied)
    const status = proposals.length === 0 ? 'completed' : pending.length === 0 ? 'applied' : 'awaiting_approval'
    const tokens = result.usage.promptTokens + result.usage.completionTokens
    const cost = estimateCost(result.usage, { inputPer1M: config.AI_PRICE_INPUT_PER_1M, outputPer1M: config.AI_PRICE_OUTPUT_PER_1M })
    const output = { answer: result.finalText, stoppedBy: result.stoppedBy, llmCalls: result.llmCalls, trace: result.trace.map((t) => ({ step: t.step, tool: t.tool, kind: t.kind, ok: t.ok, args: t.args, result: t.result.slice(0, 300) })), proposals, autoApplied: autoNotes, model: config.AI_MODEL }
    const run = (await query<{ id: string }>('INSERT INTO agent_runs (tenant_id, agent, status, autonomy_mode, input, output, tokens_used, cost_estimate, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [tenantId, 'llm_assistant', status, mode, JSON.stringify({ goal: parsed.data.goal }), JSON.stringify(output), tokens, cost, request.user!.id])).rows[0]
    await query("INSERT INTO usage_events (tenant_id, kind, quantity, metadata) VALUES ($1,'ai_content_generation',$2,$3)", [tenantId, Math.max(1, result.llmCalls), JSON.stringify({ agent: 'llm_assistant', runId: run.id, tokens })])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'agent.llm_assistant', entityType: 'agent_run', entityId: run.id, metadata: { status, mode, proposals: proposals.length, tokens } })
    return reply.code(201).send({ run: { id: run.id, agent: 'llm_assistant', status, autonomy_mode: mode, output, tokens_used: tokens, cost_estimate: cost } })
  })

  // ======================= Marketplace CSV import (AliExpress / Temu / Daraz) =======================
  app.get('/api/sourcing/marketplaces', { preHandler: requireAuth }, async () => ({ marketplaces: marketplaces.map((key) => ({ key, ...marketplacePresets[key] })), fields: fieldKeys }))

  app.post('/api/sourcing/marketplace/import', { preHandler: manager, bodyLimit: 6_000_000, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = marketImportSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid import request', details: parsed.error.flatten() })
    const d = parsed.data
    let file: ReturnType<typeof parseMarketplaceCsv>
    try {
      file = parseMarketplaceCsv(d.csv, { marketplace: d.marketplace, exchangeRates: d.exchangeRates, shippingPerItem: d.shippingPerItem, dutyPercent: d.dutyPercent, defaultStock: d.defaultStock, columnMap: d.columnMap })
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid CSV' })
    }
    const tenantId = request.user!.tenantId
    const settings = await deps.sourcingSettings(tenantId)
    const existing = await query<{ name: string; supplier_url: string | null; external_id: string | null; source_kind: string }>('SELECT lower(name) AS name, supplier_url, external_id, source_kind FROM products WHERE tenant_id = $1', [tenantId])
    const names = new Set(existing.rows.map((r) => r.name))
    const urls = new Set(existing.rows.map((r) => r.supplier_url).filter((u): u is string => Boolean(u)))
    const ids = new Set(existing.rows.filter((r) => r.source_kind === d.marketplace && r.external_id).map((r) => r.external_id as string))
    const rejected: { row: number; name?: string; reasons: string[] }[] = file.errors.map((e) => ({ row: e.row, name: e.name, reasons: [e.reason] }))
    const accepted: { row: number; sellingPrice: number; candidate: (typeof file.rows)[number]['candidate'] }[] = []
    for (const { row, candidate } of file.rows) {
      const reasons: string[] = []
      if (candidate.restrictedFlags.length) reasons.push(`Restricted or suspicious product (${candidate.restrictedFlags.join(', ')}). Not imported.`)
      const quality = evaluateMarketCandidate(candidate, settings.rules, d.qualityMode)
      reasons.push(...quality.reasons)
      const lower = candidate.name.toLowerCase()
      if ((candidate.externalId && ids.has(candidate.externalId)) || (candidate.productUrl && urls.has(candidate.productUrl)) || names.has(lower)) reasons.push('Already in your catalog (or repeated in this file)')
      if (reasons.length) { rejected.push({ row, name: candidate.name, reasons }); continue }
      names.add(lower)
      if (candidate.productUrl) urls.add(candidate.productUrl)
      if (candidate.externalId) ids.add(candidate.externalId)
      accepted.push({ row, candidate, sellingPrice: applyProfit(candidate.wholesalePrice, settings.profit, candidate.profit) })
    }
    const preview = accepted.map((a) => ({ row: a.row, name: a.candidate.name, category: a.candidate.category, categoryFromRules: a.candidate.categoryFromRules, sourcePrice: a.candidate.sourcePrice, sourceCurrency: a.candidate.sourceCurrency, wholesalePrice: a.candidate.wholesalePrice, sellingPrice: a.sellingPrice, profit: Math.round((a.sellingPrice - a.candidate.wholesalePrice) * 100) / 100, rating: a.candidate.rating, ratingApproximate: a.candidate.ratingApproximate, reviewCount: a.candidate.reviewCount, soldCount: a.candidate.soldCount, stock: a.candidate.stock }))
    const notes = [
      'Wholesale price = source price \u00d7 your exchange rate (+ duty %) + shipping per item. Check it against a real landed cost before selling.',
      d.defaultStock === 0 ? 'Stock is 0 unless your file has a stock column: set real stock before publishing.' : null,
      accepted.some((a) => a.candidate.ratingApproximate) ? 'Some ratings were converted from a positive-feedback percentage (approximate).' : null,
      accepted.some((a) => a.candidate.categoryFromRules) ? 'Categories were guessed by keyword rules: review them.' : null,
    ].filter(Boolean)
    if (d.dryRun) return { dryRun: true, total: file.rows.length + file.errors.length, eligible: preview, rejected, rules: settings.rules, qualityMode: d.qualityMode, columns: file.columns, notes }

    const limits = await deps.planLimits(tenantId)
    if (!limits) return reply.code(409).send({ error: 'No active subscription is configured for this workspace' })
    const count = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM products WHERE tenant_id = $1', [tenantId])
    if (!checkLimit(count.rows[0].count, limits.product_limit, accepted.length).allowed) return reply.code(429).send({ error: 'Import would exceed the product limit for your plan', usage: { used: count.rows[0].count, limit: limits.product_limit, eligible: accepted.length } })
    const client = await pool.connect()
    const productIds: string[] = []
    try {
      await client.query('BEGIN')
      for (const a of accepted) {
        const c = a.candidate
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url, image_url, rating, review_count, sold_count, source_kind, profit_amount, external_id, source_currency, source_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id",
          [tenantId, c.name, c.description ?? null, c.category, c.wholesalePrice, a.sellingPrice, c.stock, c.productUrl ?? null, c.imageUrl ?? null, c.rating, c.reviewCount, c.soldCount, d.marketplace, Math.round((a.sellingPrice - c.wholesalePrice) * 100) / 100, c.externalId ?? null, c.sourceCurrency, c.sourcePrice],
        )
        productIds.push(inserted.rows[0].id)
      }
      await client.query('INSERT INTO import_runs (tenant_id, source, total, imported, rejected, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [tenantId, d.marketplace, file.rows.length + file.errors.length, productIds.length, JSON.stringify(rejected), request.user!.id])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      request.log.error(error)
      await createNotification(tenantId, 'import_failed', `${marketplacePresets[d.marketplace].label} import failed`, 'The import was rolled back. Nothing was added.')
      return reply.code(500).send({ error: 'Import failed and was rolled back' })
    } finally {
      client.release()
    }
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'sourcing.marketplace_imported', entityType: 'import_run', metadata: { marketplace: d.marketplace, imported: productIds.length, rejected: rejected.length } })
    await createNotification(tenantId, 'import_summary', `${marketplacePresets[d.marketplace].label} import finished`, `${productIds.length} products added as drafts, ${rejected.length} rejected.`)
    return reply.code(201).send({ dryRun: false, imported: productIds.length, productIds, rejected, notes })
  })
}
