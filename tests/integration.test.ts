// Phase 0 gate: tenant isolation, stock, approvals, audit, publishing rules.
// Runs on in-memory PGlite. Needs `npm ci` first. Not executed yet in the authoring session.
import assert from 'node:assert/strict'
import test, { before } from 'node:test'
import { createHmac } from 'node:crypto'

process.env.NODE_ENV = 'test'
process.env.META_APP_SECRET = 'test-meta-secret'
process.env.META_VERIFY_TOKEN = 'verify-token-123'
process.env.LOCAL_DB_PATH = 'memory://'
delete process.env.DATABASE_URL
delete process.env.REDIS_URL
process.env.AI_API_KEY = ''
process.env.AI_PROVIDER = 'template'

const { app } = await import('../api/app.js')
const { query } = await import('../api/db.js')

type Session = { token: string; tenantId: string }
async function register(name: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `${name}@example.com`, password: 'password123', workspaceName: `${name} shop` } })
  assert.equal(res.statusCode, 201)
  const body = res.json()
  return { token: body.token, tenantId: body.user.tenantId }
}
const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` })
async function call(s: Session, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: auth(s), payload: payload as object | undefined })
}
const productPayload = { name: 'Football', category: 'Sports', wholesalePrice: 1000, sellingPrice: 1150, stock: 5 }

let a: Session
let b: Session
before(async () => {
  a = await register('alice')
  b = await register('bob')
})

test('requires authentication', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/products' })).statusCode, 401)
})

test('tenant isolation: products and orders are not visible or editable across tenants', async () => {
  const created = await call(a, 'POST', '/api/products', productPayload)
  assert.equal(created.statusCode, 201)
  const productId = created.json().product.id
  assert.equal((await call(b, 'GET', '/api/products')).json().products.length, 0)
  assert.equal((await call(b, 'PATCH', `/api/products/${productId}`, { name: 'Hacked' })).statusCode, 404)
  assert.equal((await call(b, 'DELETE', `/api/products/${productId}`)).statusCode, 404)
  const order = await call(b, 'POST', '/api/orders', { customer: { name: 'Eve Buyer', phone: '03001234567' }, productId, quantity: 1 })
  assert.equal(order.statusCode, 404)
  assert.equal((await call(b, 'PATCH', '/api/products/not-a-uuid', { name: 'xx' })).statusCode, 400)
})

test('stock: orders reserve stock, overselling is rejected, cancel restores stock, audit is written', async () => {
  const productId = (await call(a, 'POST', '/api/products', { ...productPayload, name: 'Stock Item', stock: 5 })).json().product.id
  const customer = { name: 'Ali Khan', phone: '03111234567', city: 'Lahore' }
  const first = await call(a, 'POST', '/api/orders', { customer, productId, quantity: 3 })
  assert.equal(first.statusCode, 201)
  assert.equal((await call(a, 'POST', '/api/orders', { customer, productId, quantity: 3 })).statusCode, 409)
  const stockOf = async () => Number((await query('SELECT stock FROM products WHERE id = $1', [productId])).rows[0].stock)
  assert.equal(await stockOf(), 2)
  const orderId = first.json().order.id
  assert.equal((await call(a, 'PATCH', `/api/orders/${orderId}/status`, { status: 'delivered' })).statusCode, 409)
  assert.equal((await call(a, 'PATCH', `/api/orders/${orderId}/status`, { status: 'cancelled' })).statusCode, 200)
  assert.equal(await stockOf(), 5)
  const audit = await query('SELECT action FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2', [a.tenantId, orderId])
  const actions = audit.rows.map((r) => r.action)
  assert.ok(actions.includes('order.created') && actions.includes('order.status_changed'))
})

test('payment approval is tenant-scoped, one-time, and audited', async () => {
  const productId = (await call(a, 'POST', '/api/products', { ...productPayload, name: 'Pay Item' })).json().product.id
  const orderId = (await call(a, 'POST', '/api/orders', { customer: { name: 'Sara Ahmed', phone: '03221234567' }, productId, quantity: 1, paymentMethod: 'easypaisa' })).json().order.id
  const ver = await call(a, 'POST', '/api/payments/verification-requests', { orderId, method: 'easypaisa', amount: 1150, reference: 'TX123' })
  assert.equal(ver.statusCode, 201)
  const id = ver.json().verification.id
  assert.equal((await call(b, 'POST', `/api/payments/verification-requests/${id}/decision`, { decision: 'approved' })).statusCode, 404)
  assert.equal((await call(a, 'POST', `/api/payments/verification-requests/${id}/decision`, { decision: 'approved' })).statusCode, 200)
  assert.equal((await call(a, 'POST', `/api/payments/verification-requests/${id}/decision`, { decision: 'rejected' })).statusCode, 404)
  const audit = await query('SELECT action FROM audit_logs WHERE entity_id = $1', [id])
  assert.deepEqual(audit.rows.map((r) => r.action), ['payment.approved'])
})

test('publishing rules: connected account, category match, duplicate and daily limit', async () => {
  const productId = (await call(a, 'POST', '/api/products', { ...productPayload, name: 'Post Item', imageUrl: 'https://example.com/post-item.jpg' })).json().product.id
  const account = (await call(a, 'POST', '/api/social-accounts', { platform: 'instagram', displayName: 'Beauty IG', externalAccountId: 'ig-1', category: 'Beauty', dailyLimit: 1 })).json().account
  const makeDraft = async () => {
    const draft = await call(a, 'POST', '/api/content/generate', { productId, productName: 'Post Item', category: 'Sports', platform: 'instagram', language: 'english', price: 1150 })
    assert.equal(draft.statusCode, 201)
    const id = draft.json().draft.id
    assert.equal((await call(a, 'POST', `/api/content/drafts/${id}/decision`, { decision: 'approved' })).statusCode, 200)
    return id as string
  }
  const when = new Date(Date.now() + 86_400_000).toISOString()
  const draft1 = await makeDraft()
  const job = (draftId: string) => call(a, 'POST', '/api/publishing/jobs', { contentDraftId: draftId, socialAccountId: account.id, scheduledFor: when })
  let res = await job(draft1)
  assert.equal(res.statusCode, 409)
  assert.ok(res.json().reasons.includes('Account is not connected'))
  await query("UPDATE social_accounts SET status = 'connected' WHERE id = $1", [account.id])
  res = await job(draft1)
  assert.ok(res.json().reasons.includes('Product category does not match the account category'))
  await query("UPDATE social_accounts SET category = 'Sports' WHERE id = $1", [account.id])
  const created = await job(draft1)
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().delivery.status, 'queued')
  assert.equal((await job(draft1)).statusCode, 409)
  const draft2 = await makeDraft()
  res = await job(draft2)
  assert.ok(res.json().reasons.includes('Daily posting limit reached'))
})

test('suspended tenants cannot log in; super admin routes are forbidden to owners', async () => {
  assert.equal((await call(a, 'GET', '/api/admin/tenants')).statusCode, 403)
  await query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [b.tenantId])
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'bob@example.com', password: 'password123' } })
  assert.equal(login.statusCode, 401)
})

test('email verification and password reset: single-use tokens, sessions revoked', async () => {
  const { testOutbox } = await import('../api/mailer.js')
  const carol = await register('carol')
  const verifyMail = testOutbox.find((m) => m.to === 'carol@example.com' && m.subject.includes('Verify'))
  assert.ok(verifyMail)
  assert.equal((await call(carol, 'GET', '/api/me')).json().emailVerified, false)
  const verifyToken = /verify=([\w-]+)/.exec(verifyMail.text)![1]
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: verifyToken } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: verifyToken } })).statusCode, 400)
  assert.equal((await call(carol, 'GET', '/api/me')).json().emailVerified, true)

  const before = testOutbox.length
  const unknown = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'nobody@example.com' } })
  assert.equal(unknown.statusCode, 202)
  assert.equal(testOutbox.length, before)
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'carol@example.com' } })).statusCode, 202)
  const resetMail = testOutbox[testOutbox.length - 1]
  const resetToken = /reset=([\w-]+)/.exec(resetMail.text)![1]
  const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: resetToken, password: 'newpassword456' } })
  assert.equal(reset.statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: resetToken, password: 'anotherpass789' } })).statusCode, 400)
  const oldLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carol@example.com', password: 'password123' } })
  assert.equal(oldLogin.statusCode, 401)
  const newLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carol@example.com', password: 'newpassword456' } })
  assert.equal(newLogin.statusCode, 200)
})

test('notifications, analytics and CSV export are tenant-scoped', async () => {
  const dave = await register('dave')
  const mine = (await call(a, 'GET', '/api/notifications')).json()
  assert.ok(mine.notifications.some((n: { kind: string }) => n.kind === 'new_order'))
  assert.ok(mine.unread > 0)
  assert.equal((await call(dave, 'GET', '/api/notifications')).json().notifications.length, 0)
  const id = mine.notifications[0].id
  assert.equal((await call(dave, 'POST', `/api/notifications/${id}/read`)).statusCode, 404)
  assert.equal((await call(a, 'POST', `/api/notifications/${id}/read`)).statusCode, 200)
  const summary = (await call(a, 'GET', '/api/analytics/summary')).json().summary
  assert.ok(summary.orders >= 1)
  assert.equal((await call(dave, 'GET', '/api/analytics/summary')).json().summary.orders, 0)
  const csv = await call(a, 'GET', '/api/exports/orders.csv')
  assert.equal(csv.statusCode, 200)
  assert.ok(String(csv.headers['content-type']).startsWith('text/csv'))
  assert.ok(csv.body.startsWith('order_id,created_at,customer'))
  assert.equal((await call(dave, 'GET', '/api/exports/orders.csv')).body.trim().split('\n').length, 1)
})

test('integrations: keys are encrypted, never returned, tenant-scoped, and removable', async () => {
  const erin = await register('erin')
  const frank = await register('frank')
  assert.equal((await call(erin, 'POST', '/api/integrations', { provider: 'buffer', label: 'Buffer' })).statusCode, 400)
  const created = await call(erin, 'POST', '/api/integrations', { provider: 'custom', label: 'My supplier API', baseUrl: 'https://api.example.com', secret: 'super-secret-key-9876' })
  assert.equal(created.statusCode, 201)
  const integration = created.json().integration
  assert.equal(integration.secret_hint, '9876')
  assert.ok(!JSON.stringify(created.json()).includes('super-secret'))
  assert.ok(!JSON.stringify((await call(erin, 'GET', '/api/integrations')).json()).includes('super-secret'))
  const stored = await query('SELECT encrypted_secret FROM integrations WHERE id = $1', [integration.id])
  assert.ok(!String(stored.rows[0].encrypted_secret).includes('super-secret'))
  assert.equal((await call(frank, 'GET', '/api/integrations')).json().integrations.length, 0)
  assert.equal((await call(frank, 'DELETE', `/api/integrations/${integration.id}`)).statusCode, 404)
  const tested = await call(erin, 'POST', `/api/integrations/${integration.id}/test`); assert.equal(tested.statusCode, 200); assert.notEqual(tested.json().status, 'verified')
  const patched = await call(erin, 'PATCH', `/api/integrations/${integration.id}`, { label: 'Renamed', enabled: false, secret: 'another-secret-key-1111' })
  assert.equal(patched.json().integration.secret_hint, '1111')
  assert.equal(patched.json().integration.enabled, false)
  assert.equal((await call(erin, 'POST', '/api/integrations', { provider: 'buffer', label: 'Buffer', secret: 'buffer-key-123456' })).statusCode, 201)
  assert.equal((await call(erin, 'POST', '/api/integrations', { provider: 'buffer', label: 'Buffer 2', secret: 'buffer-key-654321' })).statusCode, 409)
  assert.equal((await call(erin, 'DELETE', `/api/integrations/${integration.id}`)).statusCode, 204)
})

test('markaz sourcing: only high-quality products are imported and your profit is added', async () => {
  const gina = await register('gina')
  const csv = [
    'name,category,wholesale_price,stock,rating,review_count,sold_count,image_url',
    'Great Lamp,Home & Kitchen,1000,10,4.8,300,1500,https://example.com/lamp.jpg',
    'Weak Lamp,Home & Kitchen,900,10,4.0,12,30,',
    'Great Lamp,Home & Kitchen,1000,10,4.9,500,2500,',
  ].join('\n')
  const preview = await call(gina, 'POST', '/api/sourcing/markaz/import', { csv, dryRun: true })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.json().eligible.length, 1)
  assert.equal(preview.json().eligible[0].sellingPrice, 1150)
  assert.equal((await call(gina, 'GET', '/api/products')).json().products.length, 0)
  const imported = await call(gina, 'POST', '/api/sourcing/markaz/import', { csv })
  assert.equal(imported.statusCode, 201)
  assert.equal(imported.json().imported, 1)
  assert.equal(imported.json().rejected.length, 2)
  const products = (await call(gina, 'GET', '/api/products')).json().products
  assert.equal(products.length, 1)
  assert.equal(Number(products[0].selling_price), 1150)
  assert.equal(products[0].source_kind, 'markaz')
  assert.equal((await call(gina, 'POST', '/api/sourcing/markaz/import', { csv })).json().imported, 0)
  const settings = await call(gina, 'PUT', '/api/sourcing/settings', { minRating: 4, minReviews: 10, minSold: 20, profitAmount: 200, profitPercent: null })
  assert.equal(settings.json().settings.profit.fixed, 200)
  const manual = await call(gina, 'POST', '/api/sourcing/products', { name: 'My Own Pick', category: 'Beauty', wholesalePrice: 500 })
  assert.equal(Number(manual.json().product.selling_price), 700)
  const custom = await call(gina, 'POST', '/api/sourcing/products', { name: 'Custom Profit', category: 'Beauty', wholesalePrice: 500, profitAmount: 100 })
  assert.equal(Number(custom.json().product.selling_price), 600)
  const history = (await call(gina, 'GET', '/api/sourcing/imports')).json().imports
  assert.ok(history.length >= 1)
})

test('client mistakes keep their 4xx status instead of a fake 500', async () => {
  const hank = await register('hank')
  const emptyJson = await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: { ...auth(hank), 'content-type': 'application/json' } })
  assert.ok(emptyJson.statusCode >= 400 && emptyJson.statusCode < 500)
  const badJson = await app.inject({ method: 'POST', url: '/api/products', headers: { ...auth(hank), 'content-type': 'application/json' }, payload: '{not json' })
  assert.equal(badJson.statusCode, 400)
  assert.equal((await call(hank, 'POST', '/api/notifications/read-all')).statusCode, 200)
})

test('Meta customer chat: signature, tenant routing, idempotency, grounded AI draft, takeover, order from chat', async () => {
  const { createHmac } = await import('node:crypto')
  const iris = await register('iris')
  assert.equal((await call(iris, 'POST', '/api/products', { name: 'Smart Desk Lamp', category: 'Home & Kitchen', wholesalePrice: 1000, sellingPrice: 1150, stock: 3 })).statusCode, 201)
  assert.equal((await call(iris, 'POST', '/api/integrations', { provider: 'meta', label: 'Meta', secret: 'page-token-123456' })).statusCode, 400)
  const created = await call(iris, 'POST', '/api/integrations', { provider: 'meta', label: 'Meta', secret: 'page-token-123456', config: { pageId: 'PAGE1', aiMode: 'approval' } })
  assert.equal(created.statusCode, 201)
  assert.ok(!JSON.stringify(created.json()).includes('page-token-123456'))
  const handshake = await app.inject({ method: 'GET', url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-123&hub.challenge=abc123' })
  assert.equal(handshake.body, 'abc123')
  assert.equal((await app.inject({ method: 'GET', url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123' })).statusCode, 403)
  const hook = (text: string, mid: string) => JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', time: Date.now(), messaging: [{ sender: { id: 'USER1' }, timestamp: Date.now(), message: { mid, text } }] }] })
  const sign = (body: string) => `sha256=${createHmac('sha256', 'test-meta-secret').update(body).digest('hex')}`
  const post = (body: string, signature = sign(body)) => app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: body })
  const first = hook('Smart desk lamp ki qeemat kya hai?', 'mid.1')
  assert.equal((await post(first, 'sha256=00')).statusCode, 401)
  assert.equal((await post(first)).statusCode, 200)
  assert.equal((await post(first)).statusCode, 200) // Meta retry: must not duplicate
  const conversations = (await call(iris, 'GET', '/api/conversations')).json().conversations
  assert.equal(conversations.length, 1)
  assert.equal(conversations[0].channel, 'facebook')
  assert.equal((await call(b, 'GET', '/api/conversations')).json().conversations.length, 0)
  const id = conversations[0].id as string
  const messages = (await call(iris, 'GET', `/api/conversations/${id}/messages`)).json().messages as { direction: string; body: string; status: string; ai_generated: boolean }[]
  assert.equal(messages.length, 2)
  const draft = messages.find((m) => m.direction === 'outbound')!
  assert.ok(draft.ai_generated && draft.status === 'draft' && draft.body.includes('1,150'))
  const draftId = ((await call(iris, 'GET', `/api/conversations/${id}/messages`)).json().messages as { id: string; direction: string }[]).find((m) => m.direction === 'outbound')!.id
  await query("UPDATE conversations SET last_inbound_at = now() - interval '2 days' WHERE id = $1", [id])
  assert.equal((await call(iris, 'POST', `/api/conversations/${id}/messages/${draftId}/send`)).statusCode, 409) // 24 hour window closed
  assert.equal((await call(iris, 'PATCH', `/api/conversations/${id}`, { humanTakeover: true })).statusCode, 200)
  assert.equal((await post(hook('Aur koi rang hai?', 'mid.2'))).statusCode, 200)
  assert.equal(((await call(iris, 'GET', `/api/conversations/${id}/messages`)).json().messages as unknown[]).length, 3) // no new AI draft after takeover
  const products = (await call(iris, 'GET', '/api/products')).json().products as { id: string; stock: number }[]
  const orderRes = await call(iris, 'POST', `/api/conversations/${id}/create-order`, { productId: products[0].id, quantity: 2, name: 'Ali Khan', phone: '03001234567', city: 'Lahore', address: 'House 5, Street 2', paymentMethod: 'cod' })
  assert.equal(orderRes.statusCode, 201)
  assert.equal(((await call(iris, 'GET', '/api/products')).json().products as { stock: number }[])[0].stock, 1)
  const summary = (await call(iris, 'GET', `/api/orders/${orderRes.json().order.id}/markaz-summary`)).json()
  assert.ok(summary.summary.includes('Smart Desk Lamp') && summary.summary.includes('Lahore') && summary.note.includes('Nothing was submitted'))
  assert.equal((await call(b, 'GET', `/api/orders/${orderRes.json().order.id}/markaz-summary`)).statusCode, 404)
})

// ---- Billing and team (written in round 9, NOT run yet: needs npm ci) ----
test('billing: paid plan creates a pending invoice and switches only after Super Admin confirms', async () => {
  const owner = await register('priya')
  const changed = await call(owner, 'POST', '/api/billing/change-plan', { planCode: 'professional', cycle: 'monthly' })
  assert.equal(changed.statusCode, 201)
  assert.equal(changed.json().applied, false)
  const invoiceId = changed.json().invoice.id
  const planCode = async () => (await call(owner, 'GET', '/api/subscription')).json().subscription.code
  assert.equal(await planCode(), 'starter')
  assert.equal((await call(owner, 'POST', `/api/admin/invoices/${invoiceId}/mark-paid`, { reference: 'TXN12345' })).statusCode, 403)
  await query("UPDATE users SET role = 'super_admin' WHERE email = 'priya@example.com'")
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'priya@example.com', password: 'password123' } })
  const superSession: Session = { token: login.json().token, tenantId: owner.tenantId }
  assert.equal((await call(superSession, 'POST', `/api/admin/invoices/${invoiceId}/mark-paid`, { reference: 'TXN12345' })).statusCode, 200)
  assert.equal(await planCode(), 'professional')
  assert.equal((await call(superSession, 'POST', `/api/admin/invoices/${invoiceId}/mark-paid`, { reference: 'TXN12345' })).statusCode, 409)
})

test('billing: coupon applies once per workspace and enterprise is not self-serve', async () => {
  const dave = await register('omar')
  await query("UPDATE users SET role = 'super_admin' WHERE email = 'alice@example.com'")
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'alice@example.com', password: 'password123' } })
  const root: Session = { token: login.json().token, tenantId: a.tenantId }
  assert.equal((await call(root, 'POST', '/api/admin/coupons', { code: 'HALF', percentOff: 50 })).statusCode, 201)
  const quote = await call(dave, 'POST', '/api/billing/quote', { planCode: 'professional', cycle: 'monthly', couponCode: 'half' })
  assert.equal(quote.json().total, 1499.5)
  assert.equal((await call(dave, 'POST', '/api/billing/quote', { planCode: 'enterprise', cycle: 'monthly' })).statusCode, 400)
  assert.equal((await call(dave, 'POST', '/api/billing/quote', { planCode: 'professional', cycle: 'monthly', couponCode: 'nope' })).statusCode, 400)
})

test('team: invite is limited by plan, accepted once, and tenants stay isolated', async () => {
  const erin = await register('sana')
  const first = await call(erin, 'POST', '/api/team/invites', { email: 'newbie@example.com', role: 'manager' })
  assert.equal(first.statusCode, 429) // Starter allows 1 seat (the owner)
  await query("UPDATE plans SET team_member_limit = 5 WHERE code = 'starter'")
  const invited = await call(erin, 'POST', '/api/team/invites', { email: 'newbie@example.com', role: 'manager' })
  assert.equal(invited.statusCode, 201)
  const { testOutbox } = await import('../api/mailer.js')
  const mail = testOutbox.filter((m) => m.to === 'newbie@example.com').at(-1)!
  const token = /invite=([\w-]+)/.exec(mail.text)![1]
  const accepted = await app.inject({ method: 'POST', url: '/api/team/accept', payload: { token, password: 'password123' } })
  assert.equal(accepted.statusCode, 201)
  assert.equal(accepted.json().user.role, 'manager')
  assert.equal((await app.inject({ method: 'POST', url: '/api/team/accept', payload: { token, password: 'password123' } })).statusCode, 400)
  const newbie: Session = { token: accepted.json().token, tenantId: erin.tenantId }
  assert.equal((await call(newbie, 'POST', '/api/team/invites', { email: 'x@example.com', role: 'staff' })).statusCode, 403) // manager cannot invite
  assert.equal((await call(b, 'GET', '/api/team')).json().members.some((m: { email: string }) => m.email === 'newbie@example.com'), false)
  await query("UPDATE plans SET team_member_limit = 1 WHERE code = 'starter'")
})

// ---- Agents, uploads, social account edit/delete (round 10, NOT run yet: needs npm ci) ----
test('agents: autonomy decides whether classification applies; price changes always wait for approval', async () => {
  const lena = await register('lena')
  const productId = (await call(lena, 'POST', '/api/products', { name: 'Glow Vitamin C Serum', category: 'Other', wholesalePrice: 1000, sellingPrice: 1000, stock: 10 })).json().product.id
  const first = await call(lena, 'POST', '/api/agents/run', { agent: 'classification', productId })
  assert.equal(first.json().run.status, 'awaiting_approval') // default mode = approval
  const runs = (await call(lena, 'GET', '/api/agents/runs')).json().runs as { id: string }[]
  assert.equal((await call(lena, 'POST', `/api/agents/runs/${runs[0].id}/decision`, { decision: 'approved' })).statusCode, 200)
  assert.equal((await call(lena, 'GET', '/api/products')).json().products[0].category, 'Beauty')
  assert.equal((await call(lena, 'PUT', '/api/agents/mode', { mode: 'full' })).statusCode, 200)
  const price = await call(lena, 'POST', '/api/agents/run', { agent: 'pricing', productId })
  assert.equal(price.json().run.status, 'awaiting_approval')
  assert.equal(price.json().run.output.suggestedPrice, 1150)
  assert.equal((await call(b, 'POST', '/api/agents/run', { agent: 'classification', productId })).statusCode, 404)
  const pay = await call(lena, 'POST', '/api/agents/run', { agent: 'payment_review', text: 'TID: AB1234567 Rs. 1,150' })
  assert.equal(pay.json().run.output.verified, false)
})

test('uploads: only real images, proofs are private, images are public by link', async () => {
  const mia = await register('mia')
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]).toString('base64')
  assert.equal((await call(mia, 'POST', '/api/uploads', { kind: 'product_image', contentType: 'image/png', dataBase64: Buffer.from('<html>').toString('base64') })).statusCode, 400)
  const image = await call(mia, 'POST', '/api/uploads', { kind: 'product_image', contentType: 'image/png', dataBase64: png })
  assert.equal(image.statusCode, 201)
  const imageId = image.json().id
  assert.equal((await app.inject({ method: 'GET', url: `/files/${imageId}` })).statusCode, 200)
  const proof = (await call(mia, 'POST', '/api/uploads', { kind: 'payment_proof', contentType: 'image/png', dataBase64: png })).json().id
  assert.equal((await app.inject({ method: 'GET', url: `/files/${proof}` })).statusCode, 404)
  assert.equal((await call(b, 'GET', `/api/uploads/${proof}`)).statusCode, 404)
  assert.equal((await call(mia, 'GET', `/api/uploads/${proof}`)).statusCode, 200)
})

test('social accounts: edit and delete are tenant-scoped; accounts with history are kept', async () => {
  const noor = await register('noor')
  const id = (await call(noor, 'POST', '/api/social-accounts', { platform: 'instagram', displayName: 'Shop IG', dailyLimit: 3 })).json().account.id
  assert.equal((await call(b, 'PATCH', `/api/social-accounts/${id}`, { dailyLimit: 9 })).statusCode, 404)
  const patched = await call(noor, 'PATCH', `/api/social-accounts/${id}`, { category: 'Sports', dailyLimit: 5 })
  assert.equal(patched.json().account.category, 'Sports')
  assert.equal(patched.json().account.daily_limit, 5)
  assert.equal((await call(noor, 'DELETE', `/api/social-accounts/${id}`)).statusCode, 204)
  assert.equal((await call(noor, 'GET', '/api/publishing/calendar')).statusCode, 200)
})

// ---- Round 11 (written, NOT run in the authoring session: no npm registry) ----
test('integrations accept meta/whatsapp/tiktok (migration 008 widened the CHECK) and hide secrets', async () => {
  const zed = await register('zed')
  assert.equal((await call(zed, 'POST', '/api/integrations', { provider: 'whatsapp', label: 'WhatsApp', secret: 'wa-token-123456' })).statusCode, 400) // phone number id missing
  const wa = await call(zed, 'POST', '/api/integrations', { provider: 'whatsapp', label: 'WhatsApp', secret: 'wa-token-123456', config: { phoneNumberId: 'PN1', aiMode: 'approval' } })
  assert.equal(wa.statusCode, 201)
  assert.ok(!JSON.stringify(wa.json()).includes('wa-token-123456'))
  assert.equal((await call(zed, 'POST', '/api/integrations', { provider: 'tiktok', label: 'TikTok', secret: 'tt-token-123456' })).statusCode, 201)
})

test('whatsapp webhook: signature required, message becomes a conversation with a draft reply, retries are ignored', async () => {
  const wen = await register('wen')
  await call(wen, 'POST', '/api/products', { name: 'Steel Water Bottle', category: 'Home & Kitchen', wholesalePrice: 1000, sellingPrice: 1150, stock: 4 })
  await call(wen, 'POST', '/api/integrations', { provider: 'whatsapp', label: 'WhatsApp', secret: 'wa-token-123456', config: { phoneNumberId: 'PN-WEN', aiMode: 'approval' } })
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN-WEN' }, contacts: [{ wa_id: '923001112233', profile: { name: 'Ali' } }], messages: [{ id: 'wamid.T1', from: '923001112233', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Steel Water Bottle price?' } }] } }] }] })
  const sig = `sha256=${createHmac('sha256', 'test-meta-secret').update(body).digest('hex')}`
  const send = (s: string) => app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': s }, payload: body })
  assert.equal((await send('sha256=bad')).statusCode, 401)
  assert.equal((await send(sig)).statusCode, 200)
  assert.equal((await send(sig)).statusCode, 200) // Meta retry
  const conversations = (await call(wen, 'GET', '/api/conversations')).json().conversations as { id: string; channel: string }[]
  assert.equal(conversations.filter((c) => c.channel === 'whatsapp').length, 1)
  const messages = (await call(wen, 'GET', `/api/conversations/${conversations[0].id}/messages`)).json().messages as { direction: string; status: string; body: string }[]
  assert.equal(messages.filter((m) => m.direction === 'inbound').length, 1)
  const draft = messages.find((m) => m.direction === 'outbound')
  assert.equal(draft?.status, 'draft')
  assert.ok(draft?.body.includes('1,150') || draft?.body.includes('1150'))
})

test('stripe webhook: bad signature rejected, paid session activates the plan once, amount mismatch does not', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration_1'
  const { config } = await import('../api/config.js')
  ;(config as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET = 'whsec_integration_1'
  const sam = await register('sam')
  const change = await call(sam, 'POST', '/api/billing/change-plan', { planCode: 'professional', cycle: 'monthly' })
  assert.ok([200, 201].includes(change.statusCode))
  const invoice = (await query<{ id: string; total: string; tenant_id: string }>("SELECT id, total, tenant_id FROM invoices WHERE tenant_id = $1 AND status = 'pending'", [sam.tenantId])).rows[0]
  assert.ok(invoice)
  const event = (amount: number) => JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_t', payment_status: 'paid', payment_intent: 'pi_t', amount_total: amount, currency: 'pkr', metadata: { invoice_id: invoice.id } } } })
  const hook = (body: string, secret = 'whsec_integration_1') => { const t = Math.floor(Date.now() / 1000); return app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}` }, payload: body }) }
  assert.equal((await hook(event(Math.round(Number(invoice.total) * 100)), 'wrong')).statusCode, 400)
  await hook(event(100)) // wrong amount
  assert.equal((await query<{ status: string }>('SELECT status FROM invoices WHERE id = $1', [invoice.id])).rows[0].status, 'pending')
  assert.equal((await hook(event(Math.round(Number(invoice.total) * 100)))).statusCode, 200)
  assert.equal((await query<{ status: string }>('SELECT status FROM invoices WHERE id = $1', [invoice.id])).rows[0].status, 'paid')
  assert.equal((await hook(event(Math.round(Number(invoice.total) * 100)))).statusCode, 200) // replay is harmless
})

test('exports: every dataset downloads as csv and xls, tenant-scoped; sheets sync is refused without setup', async () => {
  const eva = await register('eva')
  await call(eva, 'POST', '/api/products', { name: '=cmd|calc', category: 'Other', wholesalePrice: 10, sellingPrice: 20, stock: 1 })
  for (const dataset of ['orders', 'products', 'customers', 'payments', 'supplier_orders', 'profit']) {
    assert.equal((await call(eva, 'GET', `/api/exports/${dataset}`)).statusCode, 200, dataset)
  }
  const csv = (await call(eva, 'GET', '/api/exports/products')).body
  assert.ok(csv.includes("'=cmd|calc")) // formula neutralised
  assert.ok(!csv.includes('alice'))
  assert.ok((await call(eva, 'GET', '/api/exports/products?format=xls')).body.includes('<Workbook'))
  assert.equal((await call(eva, 'GET', '/api/exports/secrets')).statusCode, 404)
  assert.equal((await call(eva, 'POST', '/api/exports/sheets', { dataset: 'orders', spreadsheetId: 'abcdefghij123', tab: 'Orders' })).statusCode, 503)
})

test('checkout and OCR refuse politely when not configured', async () => {
  const gus = await register('gus')
  assert.equal((await call(gus, 'POST', '/api/billing/checkout')).statusCode, 503)
  assert.equal((await call(gus, 'POST', '/api/uploads/00000000-0000-4000-8000-000000000000/ocr')).statusCode, 503)
})

// ---- Round 12 (written, NOT run in the authoring session: no npm registry) ----
test('oauth: start is refused when the provider is not configured; unknown state redirects with an error and no token', async () => {
  const start = await call(a, 'POST', '/api/oauth/meta/start')
  assert.equal(start.statusCode, 503)
  const cb = await app.inject({ method: 'GET', url: '/api/oauth/meta/callback?state=nope&code=x' })
  assert.equal(cb.statusCode, 302)
  const location = String(cb.headers.location)
  assert.ok(location.includes('status=error'))
  assert.ok(!location.includes('access_token'))
})

test('marketplace import: dry run previews, import saves drafts, a second import skips duplicates, restricted items are rejected', async () => {
  const csv = 'Product Id,Product Desc,Sale Price,Currency,Volume,Evaluate Rate,Product Detail Url\n501,Wireless Earbuds Bluetooth,10,USD,900,95%,https://www.aliexpress.com/item/501.html\n502,Hunting Gun Replica,9,USD,900,95%,https://x.com/502'
  const body = { marketplace: 'aliexpress', csv, exchangeRates: { USD: 280 }, shippingPerItem: 100, defaultStock: 4 }
  const dry = await call(b, 'POST', '/api/sourcing/marketplace/import', { ...body, dryRun: true })
  assert.equal(dry.statusCode, 200)
  assert.equal(dry.json().eligible.length, 1)
  assert.equal(dry.json().eligible[0].wholesalePrice, 2900)
  assert.equal(dry.json().rejected.length, 1)
  const real = await call(b, 'POST', '/api/sourcing/marketplace/import', body)
  assert.equal(real.statusCode, 201)
  assert.equal(real.json().imported, 1)
  const again = await call(b, 'POST', '/api/sourcing/marketplace/import', body)
  assert.equal(again.json().imported, 0)
  const mine = await query<{ source_kind: string; external_id: string }>('SELECT source_kind, external_id FROM products WHERE tenant_id = $1 AND external_id = $2', [b.tenantId, '501'])
  assert.deepEqual(mine.rows[0], { source_kind: 'aliexpress', external_id: '501' })
  const other = await query('SELECT 1 FROM products WHERE tenant_id = $1 AND external_id = $2', [a.tenantId, '501'])
  assert.equal(other.rows.length, 0) // tenant isolation
})

test('whatsapp template: an unapproved template cannot be sent; opt-in needs a recorded source', async () => {
  const customer = (await query<{ id: string }>("INSERT INTO customers (tenant_id, name, phone) VALUES ($1,'Sara','wa:923001112233') RETURNING id", [a.tenantId])).rows[0]
  const conv = (await query<{ id: string }>("INSERT INTO conversations (tenant_id, customer_id, channel, external_thread_id, last_inbound_at) VALUES ($1,$2,'whatsapp','923001112233', now() - interval '3 days') RETURNING id", [a.tenantId, customer.id])).rows[0]
  const tpl = (await query<{ id: string }>("INSERT INTO whatsapp_templates (tenant_id, name, language, category, status, body_text, variable_count) VALUES ($1,'promo_1','en','MARKETING','PENDING','Hello {{1}}, new stock arrived today!',1) RETURNING id", [a.tenantId])).rows[0]
  const refused = await call(a, 'POST', `/api/conversations/${conv.id}/send-template`, { templateId: tpl.id, params: ['Sara'] })
  assert.equal(refused.statusCode, 409)
  assert.ok(String(refused.json().error).includes('PENDING'))
  const noSource = await call(a, 'PUT', `/api/customers/${customer.id}/whatsapp-opt-in`, { optIn: true })
  assert.equal(noSource.statusCode, 400)
  const ok = await call(a, 'PUT', `/api/customers/${customer.id}/whatsapp-opt-in`, { optIn: true, source: 'Asked on WhatsApp chat' })
  assert.equal(ok.statusCode, 200)
  const otherTenant = await call(b, 'GET', '/api/whatsapp/templates')
  assert.equal(otherTenant.json().templates.length, 0)
})

test('llm agent: refuses to run without a configured provider; the agent list shows it', async () => {
  const run = await call(a, 'POST', '/api/agents/llm/run', { goal: 'Which products are low on stock?' })
  assert.equal(run.statusCode, 503)
  const list = await call(a, 'GET', '/api/agents')
  assert.ok(list.json().agents.some((x: { key: string }) => x.key === 'llm_assistant'))
})

// ---- Autopilot (round 13, NOT run yet: needs npm ci) ----
test('autopilot: respects category, daily limit and approval mode, never posts the same product twice to an account', async () => {
  const zara = await register('zara')
  await call(zara, 'POST', '/api/products', { name: 'Football Pro', category: 'Sports', wholesalePrice: 1000, sellingPrice: 1150, stock: 5, imageUrl: 'https://example.com/ball.jpg' })
  await call(zara, 'POST', '/api/products', { name: 'Face Serum', category: 'Beauty', wholesalePrice: 500, sellingPrice: 650, stock: 5, imageUrl: 'https://example.com/serum.jpg' })
  const accountId = (await call(zara, 'POST', '/api/social-accounts', { platform: 'instagram', displayName: 'Sports IG', category: 'Sports', dailyLimit: 3 })).json().account.id
  await query("UPDATE social_accounts SET status = 'connected' WHERE id = $1", [accountId])
  const first = (await call(zara, 'POST', '/api/autopilot/run', { days: 2 })).json()
  assert.equal(first.scheduled, 0)
  assert.equal(first.draftsWaitingApproval, 1) // only the Sports product qualifies; approval mode waits for a person
  await call(zara, 'PUT', '/api/agents/mode', { mode: 'full' })
  const draftIds = (await call(zara, 'GET', '/api/content/drafts')).json().drafts as { id: string }[]
  for (const d of draftIds) await call(zara, 'POST', `/api/content/drafts/${d.id}/decision`, { decision: 'approved' })
  const second = (await call(zara, 'POST', '/api/autopilot/run', { days: 2 })).json()
  assert.equal(second.scheduled, 1) // the same product is never scheduled twice for the same account
  const jobs = (await call(zara, 'GET', '/api/publishing/jobs')).json().jobs as { account: string }[]
  assert.equal(jobs.length, 1)
  const again = (await call(zara, 'POST', '/api/autopilot/run', { days: 2 })).json()
  assert.equal(again.scheduled, 0)
})
