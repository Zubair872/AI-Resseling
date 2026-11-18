// Purpose: team management, subscription billing (plan change, coupons, invoices, cancel), referrals.
// Payments are NOT collected online here: an invoice stays "pending" until a Super Admin confirms the
// money really arrived (bank transfer / Easypaisa / JazzCash). Nothing is ever marked paid by guesswork.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from './config.js'
import { pool, query } from './db.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'
import { createNotification } from './notifications.js'
import { mailer } from './mailer.js'
import { createOneTimeToken, hashOneTimeToken } from './tokens.js'
import { createRefreshToken, hashPassword, hashRefreshToken, signToken, type AuthUser } from './auth.js'
import { applyCoupon, canAssignRole, canManageMember, createReferralCode, downgradeBlockers, formatInvoiceNumber, nextPeriodEnd, planPrice, round2, type BillingCycle, type CouponRule } from './billing.js'

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
type PlanRow = { id: string; code: string; name: string; monthly_price: string; annual_price: string; product_limit: number; social_account_limit: number; team_member_limit: number }
type CouponRow = CouponRule & { id: string; code: string }
type InvoiceRow = { id: string; tenant_id: string; number: string; plan_code: string; billing_cycle: BillingCycle; subtotal: string; discount: string; total: string; currency: string; coupon_id: string | null; status: string; payment_reference: string | null; paid_at: string | null; created_at: string }

const uuid = z.string().uuid()
const quoteSchema = z.object({ planCode: z.string().min(2).max(40), cycle: z.enum(['monthly', 'annual']), couponCode: z.string().min(2).max(40).optional() })
const inviteSchema = z.object({ email: z.string().email(), role: z.enum(['admin', 'manager', 'staff', 'support_agent']) })
const acceptSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) })
const memberPatchSchema = z.object({ role: z.enum(['admin', 'manager', 'staff', 'support_agent']).optional(), isActive: z.boolean().optional() }).refine((v) => v.role !== undefined || v.isActive !== undefined, 'Nothing to change')
const couponSchema = z.object({
  code: z.string().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  percentOff: z.number().gt(0).max(100).optional(),
  amountOff: z.number().gt(0).optional(),
  planCode: z.string().min(2).max(40).optional(),
  maxRedemptions: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
}).refine((v) => (v.percentOff === undefined) !== (v.amountOff === undefined), 'Give either percentOff or amountOff, not both')
const markPaidSchema = z.object({ reference: z.string().min(3).max(180) })

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

async function findPlan(code: string) {
  return (await query<PlanRow>('SELECT id, code, name, monthly_price, annual_price, product_limit, social_account_limit, team_member_limit FROM plans WHERE code = $1', [code])).rows[0] ?? null
}

async function findCoupon(code: string) {
  return (await query<CouponRow>('SELECT id, code, percent_off, amount_off, plan_code, max_redemptions, redeemed_count, expires_at, active FROM coupons WHERE lower(code) = lower($1)', [code])).rows[0] ?? null
}

async function usageOf(tenantId: string) {
  const r = await query<{ products: number; social: number; members: number; invites: number }>(
    `SELECT (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1) AS products,
            (SELECT COUNT(*)::int FROM social_accounts WHERE tenant_id = $1) AS social,
            (SELECT COUNT(*)::int FROM users WHERE tenant_id = $1 AND is_active = true) AS members,
            (SELECT COUNT(*)::int FROM team_invites WHERE tenant_id = $1 AND accepted_at IS NULL AND expires_at > now()) AS invites`,
    [tenantId],
  )
  const row = r.rows[0]
  return { products: row.products, socialAccounts: row.social, teamMembers: row.members, pendingInvites: row.invites }
}

async function currentPlan(tenantId: string) {
  return (await query<PlanRow & { cycle: string; status: string }>(
    'SELECT p.id, p.code, p.name, p.monthly_price, p.annual_price, p.product_limit, p.social_account_limit, p.team_member_limit, s.billing_cycle AS cycle, s.status FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1',
    [tenantId],
  )).rows[0] ?? null
}

type RunSql = (text: string, values: unknown[]) => Promise<unknown>
async function applyPlan(run: RunSql, tenantId: string, planCode: string, cycle: BillingCycle) {
  await run(
    "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = $2), status = 'active', billing_cycle = $3, current_period_end = $4, cancel_at_period_end = false WHERE tenant_id = $1",
    [tenantId, planCode, cycle, nextPeriodEnd(new Date(), cycle).toISOString()],
  )
}

// Settles a pending invoice in one transaction (plan switch + coupon redemption). Used by the Super Admin and by verified provider webhooks.
export async function settleInvoice(invoiceId: string, reference: string, actorUserId: string | null): Promise<{ kind: 'paid'; invoice: InvoiceRow } | { kind: 'not_pending' } | { kind: 'error'; error: unknown }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<InvoiceRow>("UPDATE invoices SET status = 'paid', paid_at = now(), payment_reference = $2 WHERE id = $1 AND status = 'pending' RETURNING *", [invoiceId, reference])
    const invoice = found.rows[0]
    if (!invoice) { await client.query('ROLLBACK'); return { kind: 'not_pending' } }
    await applyPlan((text, values) => client.query(text, values), invoice.tenant_id, invoice.plan_code, invoice.billing_cycle)
    if (invoice.coupon_id) {
      const inserted = await client.query('INSERT INTO coupon_redemptions (coupon_id, tenant_id, invoice_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [invoice.coupon_id, invoice.tenant_id, invoice.id])
      if (inserted.rows[0]) await client.query('UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = $1', [invoice.coupon_id])
    }
    await client.query('COMMIT')
    await writeAuditLog({ tenantId: invoice.tenant_id, userId: actorUserId, action: 'billing.invoice_paid', entityType: 'invoice', entityId: invoice.id, metadata: { reference, total: invoice.total } })
    await createNotification(invoice.tenant_id, 'subscription', 'Payment confirmed', `Invoice ${invoice.number} is paid. Your ${invoice.plan_code} plan is active.`).catch(() => undefined)
    return { kind: 'paid', invoice }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return { kind: 'error', error }
  } finally {
    client.release()
  }
}

async function nextInvoiceNumber() {
  const r = await query<{ n: string }>("SELECT nextval('invoice_number_seq')::text AS n")
  return formatInvoiceNumber(Number(r.rows[0].n))
}

// Moves cancelled or unpaid-expired subscriptions to the free Starter plan. Existing data is kept;
// only creating new items is limited by the plan again. Safe to run repeatedly.
export async function sweepExpiredSubscriptions() {
  const due = await query<{ tenant_id: string; cancelled: boolean }>(
    "SELECT s.tenant_id, s.cancel_at_period_end AS cancelled FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE p.code <> 'starter' AND s.current_period_end < now()",
  )
  for (const row of due.rows) {
    await applyPlan((text, values) => query(text, values), row.tenant_id, 'starter', 'monthly')
    await createNotification(row.tenant_id, 'subscription', row.cancelled ? 'Subscription ended' : 'Subscription expired', 'Your workspace moved to the free Starter plan. Your data is kept. Renew from Billing to restore your limits.').catch(() => undefined)
    await writeAuditLog({ tenantId: row.tenant_id, action: row.cancelled ? 'subscription.ended' : 'subscription.expired', entityType: 'subscription' })
  }
  return due.rows.length
}

export function registerBillingRoutes(app: FastifyInstance, requireAuth: Auth) {
  const adminOnly = [requireAuth, requireRole('admin')]
  const ownerOnly = [requireAuth, requireRole('owner')]
  const superOnly = [requireAuth, requireRole('super_admin')]

  // ---------- Team ----------
  app.get('/api/team', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.user!.tenantId
    const members = await query('SELECT id, email, role, is_active, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at', [tenantId])
    const invites = await query("SELECT id, email, role, expires_at, created_at FROM team_invites WHERE tenant_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC", [tenantId])
    const plan = await currentPlan(tenantId)
    return { members: members.rows, invites: invites.rows, memberLimit: plan?.team_member_limit ?? 1 }
  })

  app.post('/api/team/invites', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = inviteSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid invite', details: parsed.error.flatten() })
    const actor = request.user!
    if (!canAssignRole(actor.role, parsed.data.role)) return reply.code(403).send({ error: 'You cannot invite someone to that role' })
    const email = parsed.data.email.toLowerCase()
    if ((await query('SELECT 1 FROM users WHERE email = $1', [email])).rows[0]) return reply.code(409).send({ error: 'That email already has an account' })
    const plan = await currentPlan(actor.tenantId)
    const usage = await usageOf(actor.tenantId)
    if (!plan || usage.teamMembers + usage.pendingInvites >= plan.team_member_limit) return reply.code(429).send({ error: 'Team member limit reached for your plan', usage: { used: usage.teamMembers + usage.pendingInvites, limit: plan?.team_member_limit ?? 0 } })
    await query('DELETE FROM team_invites WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL', [actor.tenantId, email])
    const token = createOneTimeToken()
    const created = await query<{ id: string; expires_at: string }>(
      "INSERT INTO team_invites (tenant_id, email, role, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '7 days') RETURNING id, expires_at",
      [actor.tenantId, email, parsed.data.role, hashOneTimeToken(token), actor.id],
    )
    const mail = await mailer.send({ to: email, subject: 'You are invited to join an Orbitly workspace', text: `Open this link within 7 days to set your password and join: ${config.APP_URL}/?invite=${token}` }).catch(() => ({ delivered: false }))
    await writeAuditLog({ tenantId: actor.tenantId, userId: actor.id, action: 'team.invite', entityType: 'team_invite', entityId: created.rows[0].id, metadata: { email, role: parsed.data.role } })
    return reply.code(201).send({ invite: { id: created.rows[0].id, email, role: parsed.data.role, expires_at: created.rows[0].expires_at }, emailDelivered: mail.delivered, note: mail.delivered ? 'Invitation email sent.' : 'No email provider is connected, so the invitation email was NOT sent. In development the link is printed in the server log.' })
  })

  app.delete('/api/team/invites/:id', { preHandler: adminOnly }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid invite id' })
    const result = await query('DELETE FROM team_invites WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL RETURNING id', [id.data, request.user!.tenantId])
    if (!result.rows[0]) return reply.code(404).send({ error: 'Invite not found' })
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'team.invite_revoked', entityType: 'team_invite', entityId: id.data })
    return reply.code(204).send()
  })

  app.post('/api/team/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = acceptSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid invitation data' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const invite = await client.query<{ tenant_id: string; email: string; role: string }>(
        "UPDATE team_invites SET accepted_at = now() WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = tenant_id AND t.status = 'active') RETURNING tenant_id, email, role",
        [hashOneTimeToken(parsed.data.token)],
      )
      const row = invite.rows[0]
      if (!row) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'This invitation is invalid or has expired' }) }
      const passwordHash = await hashPassword(parsed.data.password)
      const user = await client.query<{ id: string }>('INSERT INTO users (tenant_id, email, password_hash, role, email_verified_at) VALUES ($1,$2,$3,$4, now()) RETURNING id', [row.tenant_id, row.email, passwordHash, row.role])
      await client.query('COMMIT')
      const authUser: AuthUser = { id: user.rows[0].id, tenantId: row.tenant_id, email: row.email, role: row.role }
      const refreshToken = createRefreshToken()
      await query("INSERT INTO refresh_sessions (user_id, tenant_id, token_hash, expires_at) VALUES ($1,$2,$3,now() + interval '30 days')", [authUser.id, authUser.tenantId, hashRefreshToken(refreshToken)])
      await writeAuditLog({ tenantId: row.tenant_id, userId: authUser.id, action: 'team.invite_accepted', entityType: 'user', entityId: authUser.id, metadata: { role: row.role } })
      return reply.code(201).send({ user: authUser, token: signToken(authUser), refreshToken })
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (error instanceof Error && error.message.includes('users_email_key')) return reply.code(409).send({ error: 'That email already has an account' })
      request.log.error(error)
      return reply.code(500).send({ error: 'Unable to accept invitation' })
    } finally {
      client.release()
    }
  })

  app.patch('/api/team/:id', { preHandler: adminOnly }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    const parsed = memberPatchSchema.safeParse(request.body)
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'Invalid team update' })
    const actor = request.user!
    if (id.data === actor.id) return reply.code(400).send({ error: 'You cannot change your own role or access' })
    const target = (await query<{ id: string; role: string; is_active: boolean }>('SELECT id, role, is_active FROM users WHERE id = $1 AND tenant_id = $2', [id.data, actor.tenantId])).rows[0]
    if (!target) return reply.code(404).send({ error: 'Team member not found' })
    if (!canManageMember(actor.role, target.role)) return reply.code(403).send({ error: 'You cannot manage a member with an equal or higher role' })
    if (parsed.data.role && !canAssignRole(actor.role, parsed.data.role)) return reply.code(403).send({ error: 'You cannot assign that role' })
    const updated = await query<{ id: string; role: string; is_active: boolean }>(
      'UPDATE users SET role = COALESCE($3, role), is_active = COALESCE($4, is_active) WHERE id = $1 AND tenant_id = $2 RETURNING id, role, is_active',
      [id.data, actor.tenantId, parsed.data.role ?? null, parsed.data.isActive ?? null],
    )
    if (parsed.data.isActive === false) await query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id.data])
    await writeAuditLog({ tenantId: actor.tenantId, userId: actor.id, action: 'team.member_updated', entityType: 'user', entityId: id.data, metadata: { from: { role: target.role, active: target.is_active }, to: parsed.data } })
    return { member: updated.rows[0] }
  })

  // ---------- Billing (workspace side) ----------
  app.get('/api/billing', { preHandler: adminOnly }, async (request) => {
    const tenantId = request.user!.tenantId
    const sub = await query(
      'SELECT s.status, s.billing_cycle, s.current_period_end, s.cancel_at_period_end, p.code, p.name, p.product_limit, p.social_account_limit, p.team_member_limit FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1',
      [tenantId],
    )
    const invoices = await query('SELECT id, number, plan_code, billing_cycle, subtotal, discount, total, currency, status, payment_reference, paid_at, created_at FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100', [tenantId])
    const plans = await query('SELECT code, name, monthly_price, annual_price, product_limit, social_account_limit, ai_action_limit, team_member_limit FROM plans ORDER BY monthly_price')
    return { subscription: sub.rows[0] ?? null, invoices: invoices.rows, plans: plans.rows, usage: await usageOf(tenantId), paymentNote: 'Online card payments are not connected. After you request a plan, pay the invoice by bank transfer, Easypaisa or JazzCash and send the reference. The plan switches on only after the platform owner confirms the payment.' }
  })

  async function buildQuote(tenantId: string, input: z.infer<typeof quoteSchema>) {
    const plan = await findPlan(input.planCode)
    if (!plan) return { error: 'Plan not found' as const, status: 404 }
    if (plan.code === 'enterprise') return { error: 'Enterprise is custom priced. Contact sales to agree limits and price.' as const, status: 400 }
    const subtotal = planPrice(plan, input.cycle)
    let discount = 0
    let couponId: string | null = null
    if (input.couponCode) {
      const coupon = await findCoupon(input.couponCode)
      const result = applyCoupon(subtotal, plan.code, coupon)
      if (!result.ok) return { error: result.reason, status: 400 }
      const used = await query('SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 AND tenant_id = $2', [coupon!.id, tenantId])
      if (used.rows[0]) return { error: 'You have already used this coupon', status: 400 }
      discount = result.discount
      couponId = coupon!.id
    }
    return { plan, subtotal, discount, total: round2(subtotal - discount), couponId, status: 200 }
  }

  app.post('/api/billing/quote', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = quoteSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid quote request' })
    const quote = await buildQuote(request.user!.tenantId, parsed.data)
    if ('error' in quote) return reply.code(quote.status).send({ error: quote.error })
    return { planCode: quote.plan.code, cycle: parsed.data.cycle, subtotal: quote.subtotal, discount: quote.discount, total: quote.total, currency: 'PKR' }
  })

  app.post('/api/billing/change-plan', { preHandler: ownerOnly }, async (request, reply) => {
    const parsed = quoteSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid plan change' })
    const tenantId = request.user!.tenantId
    const current = await currentPlan(tenantId)
    if (current && current.code === parsed.data.planCode && current.cycle === parsed.data.cycle) return reply.code(400).send({ error: 'You are already on this plan and billing cycle' })
    const quote = await buildQuote(tenantId, parsed.data)
    if ('error' in quote) return reply.code(quote.status).send({ error: quote.error })
    const usage = await usageOf(tenantId)
    const blockers = downgradeBlockers(usage, quote.plan)
    if (blockers.length > 0) return reply.code(409).send({ error: 'Reduce your usage before switching to this plan', reasons: blockers })
    const number = await nextInvoiceNumber()
    await query("UPDATE invoices SET status = 'void' WHERE tenant_id = $1 AND status = 'pending'", [tenantId])
    const free = quote.total === 0
    const invoice = (await query<InvoiceRow>(
      "INSERT INTO invoices (tenant_id, number, plan_code, billing_cycle, subtotal, discount, total, coupon_id, status, payment_reference, paid_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [tenantId, number, quote.plan.code, parsed.data.cycle, quote.subtotal, quote.discount, quote.total, quote.couponId, free ? 'paid' : 'pending', free ? 'nothing-to-pay' : null, free ? new Date().toISOString() : null],
    )).rows[0]
    if (free) {
      await applyPlan((text, values) => query(text, values), tenantId, quote.plan.code, parsed.data.cycle)
      if (quote.couponId) {
        const inserted = await query('INSERT INTO coupon_redemptions (coupon_id, tenant_id, invoice_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [quote.couponId, tenantId, invoice.id])
        if (inserted.rows[0]) await query('UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = $1', [quote.couponId])
      }
    }
    await writeAuditLog({ tenantId, userId: request.user!.id, action: free ? 'billing.plan_changed' : 'billing.invoice_created', entityType: 'invoice', entityId: invoice.id, metadata: { plan: quote.plan.code, cycle: parsed.data.cycle, total: quote.total } })
    await createNotification(tenantId, 'subscription', free ? 'Plan changed' : `Invoice ${invoice.number} created`, free ? `You are now on ${quote.plan.name}.` : `Pay Rs. ${quote.total.toLocaleString()} and send the payment reference. ${quote.plan.name} starts after payment is confirmed.`).catch(() => undefined)
    return reply.code(201).send({ invoice, applied: free, note: free ? `Plan changed to ${quote.plan.name}.` : 'Invoice created. Your plan changes only after the platform owner confirms your payment.' })
  })

  app.post('/api/billing/cancel', { preHandler: ownerOnly }, async (request, reply) => {
    const tenantId = request.user!.tenantId
    const plan = await currentPlan(tenantId)
    if (!plan || plan.code === 'starter') return reply.code(400).send({ error: 'The free Starter plan has nothing to cancel' })
    await query('UPDATE subscriptions SET cancel_at_period_end = true WHERE tenant_id = $1', [tenantId])
    await writeAuditLog({ tenantId, userId: request.user!.id, action: 'billing.cancel_requested', entityType: 'subscription' })
    return { cancelAtPeriodEnd: true, note: 'Your plan stays active until the end of the paid period, then moves to Starter.' }
  })

  app.post('/api/billing/resume', { preHandler: ownerOnly }, async (request) => {
    await query('UPDATE subscriptions SET cancel_at_period_end = false WHERE tenant_id = $1', [request.user!.tenantId])
    await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'billing.cancel_reverted', entityType: 'subscription' })
    return { cancelAtPeriodEnd: false }
  })

  app.get('/api/invoices/:id/document', { preHandler: adminOnly }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid invoice id' })
    const row = (await query<InvoiceRow & { workspace: string }>('SELECT i.*, t.name AS workspace FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.id = $1 AND i.tenant_id = $2', [id.data, request.user!.tenantId])).rows[0]
    if (!row) return reply.code(404).send({ error: 'Invoice not found' })
    const money = (v: string) => `${row.currency} ${Number(v).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(row.number)}</title><style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;color:#1c1b2e}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #e6e9f0}.r{text-align:right}h1{margin:0}</style></head><body><h1>Invoice ${escapeHtml(row.number)}</h1><p>Orbitly &middot; ${escapeHtml(row.workspace)}<br>Date: ${new Date(row.created_at).toISOString().slice(0, 10)}<br>Status: <strong>${escapeHtml(row.status.toUpperCase())}</strong>${row.payment_reference ? `<br>Payment reference: ${escapeHtml(row.payment_reference)}` : ''}</p><table><tr><td>${escapeHtml(row.plan_code)} plan (${escapeHtml(row.billing_cycle)})</td><td class="r">${money(row.subtotal)}</td></tr><tr><td>Discount</td><td class="r">- ${money(row.discount)}</td></tr><tr><td><strong>Total</strong></td><td class="r"><strong>${money(row.total)}</strong></td></tr></table></body></html>`
    return reply.type('text/html; charset=utf-8').send(html)
  })

  // ---------- Referrals ----------
  app.get('/api/referrals', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.user!.tenantId
    let code = (await query<{ referral_code: string | null }>('SELECT referral_code FROM tenants WHERE id = $1', [tenantId])).rows[0]?.referral_code ?? null
    if (!code) {
      const updated = await query<{ referral_code: string }>('UPDATE tenants SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL RETURNING referral_code', [tenantId, createReferralCode()])
      code = updated.rows[0]?.referral_code ?? (await query<{ referral_code: string }>('SELECT referral_code FROM tenants WHERE id = $1', [tenantId])).rows[0].referral_code
    }
    const referred = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM tenants WHERE referred_by = $1', [tenantId])
    return { code, link: `${config.APP_URL}/?ref=${code}`, referredWorkspaces: referred.rows[0].count, note: 'Rewards are not automatic. The platform owner can create a coupon for you when your referrals sign up.' }
  })

  // ---------- Super Admin ----------
  app.get('/api/admin/invoices', { preHandler: superOnly }, async (request) => {
    const status = z.enum(['pending', 'paid', 'void']).safeParse((request.query as Record<string, string>).status)
    const result = await query(
      `SELECT i.id, i.number, i.plan_code, i.billing_cycle, i.total, i.currency, i.status, i.payment_reference, i.created_at, t.name AS workspace
       FROM invoices i JOIN tenants t ON t.id = i.tenant_id ${status.success ? 'WHERE i.status = $1' : ''} ORDER BY i.created_at DESC LIMIT 200`,
      status.success ? [status.data] : [],
    )
    return { invoices: result.rows }
  })

  app.post('/api/admin/invoices/:id/mark-paid', { preHandler: superOnly }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    const parsed = markPaidSchema.safeParse(request.body)
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'A payment reference is required' })
    const settled = await settleInvoice(id.data, parsed.data.reference, request.user!.id)
    if (settled.kind === 'not_pending') return reply.code(409).send({ error: 'Invoice not found or not pending' })
    if (settled.kind === 'error') { request.log.error(settled.error); return reply.code(500).send({ error: 'Unable to confirm payment' }) }
    return { invoice: settled.invoice }
  })

  app.post('/api/admin/invoices/:id/void', { preHandler: superOnly }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    if (!id.success) return reply.code(400).send({ error: 'Invalid invoice id' })
    const result = await query<{ tenant_id: string }>("UPDATE invoices SET status = 'void' WHERE id = $1 AND status = 'pending' RETURNING tenant_id", [id.data])
    if (!result.rows[0]) return reply.code(409).send({ error: 'Invoice not found or not pending' })
    await writeAuditLog({ tenantId: result.rows[0].tenant_id, userId: request.user!.id, action: 'billing.invoice_voided', entityType: 'invoice', entityId: id.data })
    return { success: true }
  })

  app.get('/api/admin/coupons', { preHandler: superOnly }, async () => ({ coupons: (await query('SELECT id, code, percent_off, amount_off, plan_code, max_redemptions, redeemed_count, expires_at, active, created_at FROM coupons ORDER BY created_at DESC')).rows }))

  app.post('/api/admin/coupons', { preHandler: superOnly }, async (request, reply) => {
    const parsed = couponSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid coupon', details: parsed.error.flatten() })
    const d = parsed.data
    try {
      const result = await query('INSERT INTO coupons (code, percent_off, amount_off, plan_code, max_redemptions, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, code, percent_off, amount_off, plan_code, max_redemptions, redeemed_count, expires_at, active', [d.code.toUpperCase(), d.percentOff ?? null, d.amountOff ?? null, d.planCode ?? null, d.maxRedemptions ?? null, d.expiresAt ?? null])
      await writeAuditLog({ tenantId: request.user!.tenantId, userId: request.user!.id, action: 'coupon.created', entityType: 'coupon', metadata: { code: d.code.toUpperCase() } })
      return reply.code(201).send({ coupon: result.rows[0] })
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('coupons_code_key')) return reply.code(409).send({ error: 'A coupon with this code already exists' })
      throw error
    }
  })

  app.patch('/api/admin/coupons/:id', { preHandler: superOnly }, async (request, reply) => {
    const id = uuid.safeParse((request.params as Record<string, string>).id)
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body)
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'Invalid coupon update' })
    const result = await query('UPDATE coupons SET active = $2 WHERE id = $1 RETURNING id, code, active', [id.data, parsed.data.active])
    if (!result.rows[0]) return reply.code(404).send({ error: 'Coupon not found' })
    return { coupon: result.rows[0] }
  })

  app.post('/api/admin/subscriptions/sweep', { preHandler: superOnly }, async () => ({ moved: await sweepExpiredSubscriptions() }))
}
