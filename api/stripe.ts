// Purpose: Stripe Checkout for SaaS subscription invoices (international cards) + webhook signature check. Needs a Stripe account.
// Pakistani wallets (JazzCash/Easypaisa) need their own merchant accounts and are added behind the same BillingProvider interface.
// Nothing is marked paid from the browser: only a signed Stripe webhook can settle an invoice.
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface BillingProvider {
  readonly name: string
  createCheckout(input: { invoiceId: string; invoiceNumber: string; description: string; amountMinor: number; currency: string; customerEmail: string; successUrl: string; cancelUrl: string }): Promise<{ url: string; providerSessionId: string }>
}

export class StripeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'StripeError'
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class StripeProvider implements BillingProvider {
  readonly name = 'stripe'
  constructor(private readonly secretKey: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  async createCheckout(input: Parameters<BillingProvider['createCheckout']>[0]) {
    const form = new URLSearchParams()
    form.set('mode', 'payment')
    form.set('success_url', input.successUrl)
    form.set('cancel_url', input.cancelUrl)
    form.set('customer_email', input.customerEmail)
    form.set('client_reference_id', input.invoiceId)
    form.set('metadata[invoice_id]', input.invoiceId)
    form.set('payment_intent_data[metadata][invoice_id]', input.invoiceId)
    form.set('line_items[0][quantity]', '1')
    form.set('line_items[0][price_data][currency]', input.currency.toLowerCase())
    form.set('line_items[0][price_data][unit_amount]', String(input.amountMinor))
    form.set('line_items[0][price_data][product_data][name]', `${input.description} (${input.invoiceNumber})`)
    let response
    try {
      response = await this.fetchImpl('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `invoice-${input.invoiceId}` }, body: form.toString() })
    } catch {
      throw new StripeError('Could not reach Stripe. Try again.')
    }
    const data = (await response.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null
    if (!response.ok || !data?.id || !data.url) throw new StripeError(data?.error?.message ?? `Stripe returned HTTP ${response.status}`, response.status)
    return { url: data.url, providerSessionId: data.id }
  }
}

// Stripe-Signature: "t=<unix>,v1=<hex hmac of `${t}.${rawBody}` with the webhook secret>[,v1=...]"
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, toleranceSeconds = 300, nowMs = Date.now()) {
  if (!header || !secret) return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const t = parts.find(([k]) => k === 't')?.[1]
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter(Boolean)
  if (!t || signatures.length === 0 || !/^\d+$/.test(t)) return false
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSeconds) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest()
  return signatures.some((sig) => {
    try {
      const given = Buffer.from(sig, 'hex')
      return given.length === expected.length && timingSafeEqual(given, expected)
    } catch {
      return false
    }
  })
}

// Only a completed AND paid Checkout Session settles an invoice.
export function settledInvoiceFromEvent(event: unknown): { invoiceId: string; reference: string; amountMinor: number; currency: string } | null {
  const e = event as { type?: string; data?: { object?: { id?: string; payment_status?: string; payment_intent?: string; amount_total?: number; currency?: string; metadata?: { invoice_id?: string } } } } | null
  if (!e || (e.type !== 'checkout.session.completed' && e.type !== 'checkout.session.async_payment_succeeded')) return null
  const s = e.data?.object
  if (!s || s.payment_status !== 'paid' || !s.metadata?.invoice_id || typeof s.amount_total !== 'number') return null
  return { invoiceId: s.metadata.invoice_id, reference: `stripe:${s.payment_intent ?? s.id ?? 'session'}`, amountMinor: s.amount_total, currency: String(s.currency ?? '').toUpperCase() }
}
