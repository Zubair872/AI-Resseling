import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { config } from './config.js'
import { comparePassword, hashPassword, signToken, verifyToken, type AuthUser } from './auth.js'
import { query } from './db.js'
import { calculatePrice } from './pricing.js'
import { getContentProvider } from './ai.js'
import { AuthorizationRequiredSupplier, ManualPaymentProvider } from './providers.js'
import { enqueueWorkflow } from './queue.js'
import { parseProductCsv, type ProductImportRow } from './csv.js'
import { requireRole } from './permissions.js'
import { writeAuditLog } from './audit.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

const app = Fastify({ logger: true })
await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true })
await app.register(helmet)
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' })

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128) })
const productSchema = z.object({
  name: z.string().min(2).max(180),
  description: z.string().max(10000).optional(),
  category: z.enum(['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other']),
  wholesalePrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
  supplierUrl: z.string().url().optional(),
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
const contentSchema = z.object({ productId: z.string().uuid().optional(), productName: z.string().min(2).max(180), category: z.string().min(2).max(80), platform: z.enum(['facebook', 'instagram', 'tiktok', 'whatsapp']), language: z.enum(['english', 'urdu', 'roman_urdu']), price: z.number().nonnegative().optional(), brandVoice: z.string().max(500).optional() })
const socialAccountSchema = z.object({ platform: z.enum(['facebook', 'instagram', 'tiktok', 'whatsapp']), displayName: z.string().min(2).max(160), externalAccountId: z.string().max(180).optional() })
const paymentSchema = z.object({ orderId: z.string().uuid(), method: z.enum(['bank_transfer', 'easypaisa', 'jazzcash', 'other']), amount: z.number().positive(), reference: z.string().max(180).optional(), proofUrl: z.string().url().optional() })
const supplierSchema = z.object({ orderId: z.string().uuid(), supplierKind: z.enum(['markaz', 'hhc', 'aliexpress', 'temu', 'daraz']) })
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

app.get('/health', async () => ({ status: 'ok', service: 'orbitly-api', timestamp: new Date().toISOString() }))

app.post('/api/auth/register', async (request, reply) => {
  const parsed = credentialsSchema.extend({ workspaceName: z.string().min(2).max(100) }).safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid registration data', details: parsed.error.flatten() })
  const { email, password, workspaceName } = parsed.data
  const client = await (await import('./db.js')).pool.connect()
  try {
    await client.query('BEGIN')
    const tenant = await client.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [workspaceName])
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
    return reply.code(201).send({ user: authUser, token: signToken(authUser) })
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
    'SELECT id, tenant_id, email, password_hash, role FROM users WHERE email = $1 AND is_active = true',
    [parsed.data.email.toLowerCase()],
  )
  const row = result.rows[0]
  if (!row || !(await comparePassword(parsed.data.password, row.password_hash))) return reply.code(401).send({ error: 'Email or password is incorrect' })
  const user: AuthUser = { id: row.id, tenantId: row.tenant_id, email: row.email, role: row.role }
  return { user, token: signToken(user) }
})

app.get('/api/me', { preHandler: requireAuth }, async (request) => ({ user: request.user }))

app.get('/api/products', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT id, name, description, category, wholesale_price, selling_price, stock, status, supplier_url, created_at FROM products WHERE tenant_id = $1 ORDER BY created_at DESC', [request.user!.tenantId])
  return { products: result.rows }
})

app.post('/api/products', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = productSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid product data', details: parsed.error.flatten() })
  const data = parsed.data
  const result = await query<{ id: string }>(
    'INSERT INTO products (tenant_id, name, description, category, wholesale_price, selling_price, stock, supplier_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [request.user!.tenantId, data.name, data.description ?? null, data.category, data.wholesalePrice, data.sellingPrice, data.stock, data.supplierUrl ?? null],
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
  const mapping: Record<string, string> = { name: 'name', description: 'description', category: 'category', wholesalePrice: 'wholesale_price', sellingPrice: 'selling_price', stock: 'stock', supplierUrl: 'supplier_url' }
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

app.get('/api/plans', async () => {
  const result = await query('SELECT code, name, monthly_price, annual_price, product_limit, social_account_limit, ai_action_limit FROM plans ORDER BY monthly_price ASC')
  return { plans: result.rows }
})

app.get('/api/subscription', { preHandler: requireAuth }, async (request, reply) => {
  const result = await query(
    'SELECT s.status, s.billing_cycle, s.current_period_end, p.code, p.name, p.product_limit, p.social_account_limit, p.ai_action_limit FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1',
    [request.user!.tenantId],
  )
  if (!result.rows[0]) return reply.code(404).send({ error: 'No subscription configured' })
  return { subscription: result.rows[0] }
})

app.post('/api/content/generate', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = contentSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid content request', details: parsed.error.flatten() })
  const provider = getContentProvider()
  const content = await provider.generate(parsed.data)
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

app.get('/api/social-accounts', { preHandler: requireAuth }, async (request) => {
  const result = await query('SELECT id, platform, display_name, external_account_id, status, created_at FROM social_accounts WHERE tenant_id = $1 ORDER BY created_at DESC', [request.user!.tenantId])
  return { accounts: result.rows }
})

app.post('/api/social-accounts', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = socialAccountSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid social account data', details: parsed.error.flatten() })
  const result = await query(
    'INSERT INTO social_accounts (tenant_id, platform, display_name, external_account_id) VALUES ($1,$2,$3,$4) RETURNING id, platform, display_name, external_account_id, status, created_at',
    [request.user!.tenantId, parsed.data.platform, parsed.data.displayName, parsed.data.externalAccountId ?? null],
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
  return reply.code(201).send({ verification: result.rows[0], note: 'Payment remains pending until human verification.' })
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
  return reply.code(201).send({ supplierOrder: result.rows[0], note: 'Supplier submission requires an approved adapter and authorization.' })
})

app.post('/api/publishing/jobs', { preHandler: requireAuth }, async (request, reply) => {
  const parsed = publishSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid publishing job data', details: parsed.error.flatten() })
  const owned = await query(
    'SELECT d.id AS draft_id, a.id AS account_id FROM content_drafts d JOIN social_accounts a ON a.tenant_id = d.tenant_id WHERE d.id = $1 AND a.id = $2 AND d.tenant_id = $3 AND d.status = $4 AND a.status = $5',
    [parsed.data.contentDraftId, parsed.data.socialAccountId, request.user!.tenantId, 'approved', 'connected'],
  )
  if (!owned.rows[0]) return reply.code(409).send({ error: 'Draft must be approved and account must be connected before scheduling' })
  const result = await query(
    'INSERT INTO publishing_jobs (tenant_id, content_draft_id, social_account_id, scheduled_for) VALUES ($1,$2,$3,$4) RETURNING id, scheduled_for, status, created_at',
    [request.user!.tenantId, parsed.data.contentDraftId, parsed.data.socialAccountId, parsed.data.scheduledFor],
  )
  return reply.code(201).send({ job: result.rows[0] })
})

app.setErrorHandler((error, request, reply) => {
  request.log.error(error)
  return reply.code(500).send({ error: 'Unexpected server error' })
})

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
