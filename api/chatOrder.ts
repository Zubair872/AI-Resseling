// Purpose: turn a finished customer chat into a real order and prepare the text that goes to Markaz.
// Markaz has no public order API, so nothing is submitted there: the owner gets a ready summary (customer name, phone, city, address) to place the order.
import { pool, query } from './db.js'
import { writeAuditLog } from './audit.js'
import { createNotification } from './notifications.js'
import { detectAutoOrder, formatPrice, type CatalogProduct } from './support.js'

export type ChatOrderInput = {
  productId: string
  quantity: number
  name: string
  phone: string
  city: string
  address: string
  paymentMethod: 'cod' | 'bank_transfer' | 'easypaisa' | 'jazzcash' | 'other'
  notes?: string
  variantId?: string
  variantSku?: string
  variantTitle?: string
}

export type ChatOrderResult =
  | { ok: true; order: { id: string; total_amount: string } & Record<string, unknown> }
  | { ok: false; status: number; error: string }

// Stock is locked, the customer is saved with the real phone/address, stock is reduced, all in one transaction.
export async function createOrderFromChat(tenantId: string, conversationId: string, d: ChatOrderInput, userId: string | null, source: 'conversation' | 'ai_auto' = 'conversation'): Promise<ChatOrderResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const product = await client.query<{ selling_price: string; stock: number }>('SELECT selling_price, stock FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [d.productId, tenantId])
    const row = product.rows[0]
    if (!row) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: 'Product not found' } }
    if (row.stock < d.quantity) { await client.query('ROLLBACK'); return { ok: false, status: 409, error: 'Insufficient stock' } }

    let variantSku = d.variantSku ?? null
    let variantTitle = d.variantTitle ?? null
    let unitPrice = Number(row.selling_price)
    if (d.variantId) {
      const vRes = await client.query<{ sku: string; title: string | null; selling_price: string }>('SELECT sku, title, selling_price FROM product_variants WHERE id = $1 AND product_id = $2 AND tenant_id = $3', [d.variantId, d.productId, tenantId])
      if (vRes.rows[0]) {
        variantSku = vRes.rows[0].sku
        variantTitle = vRes.rows[0].title
        if (Number(vRes.rows[0].selling_price) > 0) unitPrice = Number(vRes.rows[0].selling_price)
      }
    }

    const customer = await client.query<{ id: string }>('INSERT INTO customers (tenant_id, name, phone, city, address) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, address = EXCLUDED.address RETURNING id', [tenantId, d.name, d.phone, d.city, d.address])
    const total = unitPrice * d.quantity
    const order = await client.query<{ id: string; total_amount: string }>(
      'INSERT INTO orders (tenant_id, customer_id, product_id, variant_id, variant_sku, variant_title, quantity, total_amount, payment_method, status, conversation_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [tenantId, customer.rows[0].id, d.productId, d.variantId ?? null, variantSku, variantTitle, d.quantity, total, d.paymentMethod, 'ready for Markaz', conversationId, d.notes ?? null]
    )
    await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [d.quantity, d.productId, tenantId])
    await client.query('COMMIT')
    await writeAuditLog({ tenantId, userId, action: 'order.created', entityType: 'order', entityId: order.rows[0].id, metadata: { quantity: d.quantity, source, variantSku } })
    await createNotification(tenantId, 'new_order', 'New order from chat', `Order #${String(order.rows[0].id).slice(0, 8).toUpperCase()} for Rs. ${total.toLocaleString()}`)
    return { ok: true, order: order.rows[0] }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(JSON.stringify({ event: 'chat_order.failed', error: error instanceof Error ? error.message : String(error) }))
    return { ok: false, status: 500, error: 'Unable to create order' }
  } finally {
    client.release()
  }
}

// The exact text to give Markaz: product link, quantity, customer name, phone, city, address, payment and the money.
export async function markazSummaryText(tenantId: string, orderId: string) {
  const result = await query<{
    id: string
    quantity: number
    total_amount: string
    payment_method: string
    status: string
    notes: string | null
    product: string
    wholesale_price: string
    supplier_url: string | null
    sku: string | null
    variant_sku: string | null
    variant_title: string | null
    customer: string
    phone: string
    city: string | null
    address: string | null
  }>(
    'SELECT o.id, o.quantity, o.total_amount, o.payment_method, o.status, o.notes, o.variant_sku, o.variant_title, p.name AS product, p.wholesale_price, p.supplier_url, p.sku, c.name AS customer, c.phone, c.city, c.address FROM orders o JOIN products p ON p.id = o.product_id JOIN customers c ON c.id = o.customer_id WHERE o.id = $1 AND o.tenant_id = $2',
    [orderId, tenantId],
  )
  const o = result.rows[0]
  if (!o) return null
  const profit = Number(o.total_amount) - Number(o.wholesale_price) * o.quantity
  const displaySku = o.variant_sku || o.sku
  return [
    `Order #${o.id.slice(0, 8).toUpperCase()}`,
    `Product: ${o.product}${displaySku ? ` [SKU: ${displaySku}]` : ''}${o.variant_title ? ` (${o.variant_title})` : ''}${o.supplier_url ? ` (${o.supplier_url})` : ''}`,
    `Quantity: ${o.quantity}`,
    `Customer: ${o.customer}`,
    `Phone: ${o.phone}`,
    `City: ${o.city ?? '-'}`,
    `Address: ${o.address ?? '-'}`,
    `Payment: ${o.payment_method.toUpperCase()}${o.payment_method === 'cod' ? ` - collect Rs. ${Number(o.total_amount).toLocaleString()}` : ''}`,
    `Status: ${o.status || 'ready for Markaz'}`,
    `Supplier price: Rs. ${(Number(o.wholesale_price) * o.quantity).toLocaleString()}`,
    `Your margin on this order: Rs. ${profit.toLocaleString()}`,
    ...(o.notes ? [`Notes: ${o.notes}`] : []),
  ].join('\n')
}

// Customer messages of this conversation, oldest first (the order details may arrive over several messages).
export async function recentInboundTexts(tenantId: string, conversationId: string, limit = 8) {
  const rows = await query<{ body: string }>("SELECT body FROM conversation_messages WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'inbound' ORDER BY created_at DESC LIMIT $3", [conversationId, tenantId, limit])
  return rows.rows.map((r) => r.body).reverse()
}

const paymentLabel: Record<string, string> = { cod: 'Cash on Delivery', bank_transfer: 'Bank transfer', easypaisa: 'Easypaisa', jazzcash: 'JazzCash' }

// Auto mode only. Creates the order when the customer gave every detail (name, phone, city, address, quantity) for an in-stock product,
// notifies the owner with the Markaz text, and returns the reply to send. Returns null when anything is missing, so the normal reply flow runs.
export async function autoOrderFromChat(tenantId: string, conversationId: string, catalog: CatalogProduct[]): Promise<{ orderId: string; text: string } | null> {
  const texts = await recentInboundTexts(tenantId, conversationId)
  const found = detectAutoOrder(texts, catalog)
  if (!found) return null
  const duplicate = await query("SELECT 1 FROM orders WHERE conversation_id = $1 AND tenant_id = $2 AND product_id = $3 AND created_at > now() - interval '1 day' LIMIT 1", [conversationId, tenantId, found.product.id])
  if (duplicate.rows[0]) return null
  const result = await createOrderFromChat(
    tenantId,
    conversationId,
    {
      productId: found.product.id,
      quantity: found.quantity,
      name: found.name,
      phone: found.phone,
      city: found.city,
      address: found.address,
      paymentMethod: found.paymentMethod,
      variantId: found.variant?.id,
      variantSku: found.variant?.sku,
      variantTitle: found.variant?.title ?? undefined,
    },
    null,
    'ai_auto',
  )
  if (!result.ok) return null
  const orderId = result.order.id
  const summary = await markazSummaryText(tenantId, orderId)
  if (summary) await createNotification(tenantId, 'order_for_markaz', 'Naya order: Markaz ko dene ke liye tayyar', summary)
  const total = Number(found.variant?.selling_price || found.product.selling_price) * found.quantity
  const variantNote = found.variant?.title ? ` [${found.variant.title}]` : ''
  const text = `Shukriya ${found.name}! Aap ka order darj ho gaya hai: ${found.product.name}${variantNote} x${found.quantity}, total ${formatPrice(total)} (${paymentLabel[found.paymentMethod]}). Delivery ki tafseel aur confirmation hamari team aap ko batayegi. Confirmation se pehle koi payment na karein.`
  return { orderId, text }
}
