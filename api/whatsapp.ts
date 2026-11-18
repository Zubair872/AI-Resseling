// Purpose: WhatsApp Business Cloud API (Meta) helpers: webhook parsing, 24-hour customer-service window, text sending.
// Not verified against a live WhatsApp Business account. Needs a Meta app with the WhatsApp product, a phone number id and a permanent token.
import { MetaError } from './meta.js'

export type InboundWhatsApp = { phoneNumberId: string; from: string; senderName?: string; messageId: string; text: string; timestamp: number }

// Webhook shape: { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id }, contacts: [{ wa_id, profile: { name } }], messages: [{ id, from, timestamp, type, text: { body } }] } }] }] }
export function parseWhatsAppWebhook(body: unknown): InboundWhatsApp[] {
  const out: InboundWhatsApp[] = []
  const root = body as { object?: string; entry?: { changes?: { field?: string; value?: { metadata?: { phone_number_id?: string }; contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }[] } }[] }[] } | null
  if (!root || root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return out
  for (const entry of root.entry) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field !== 'messages') continue
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId || !Array.isArray(value?.messages)) continue
      for (const message of value.messages) {
        if (message.type !== 'text' || !message.id || !message.from || typeof message.text?.body !== 'string' || !message.text.body.trim()) continue
        const contact = value.contacts?.find((c) => c.wa_id === message.from)
        const seconds = Number(message.timestamp)
        out.push({ phoneNumberId, from: message.from, senderName: contact?.profile?.name, messageId: message.id, text: message.text.body.trim().slice(0, 4000), timestamp: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now() })
      }
    }
  }
  return out
}

// WhatsApp free-form replies are allowed only within 24 hours of the customer's last message.
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000
export const whatsappCustomerKey = (waId: string) => `wa:${waId}`

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class WhatsAppClient {
  constructor(private readonly token: string, private readonly phoneNumberId: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike, private readonly version = 'v23.0') {}

  private async call<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
    let response
    try {
      response = await this.fetchImpl(`https://graph.facebook.com/${this.version}/${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch {
      throw new MetaError('Could not reach WhatsApp. Check the connection and try again.', true)
    }
    const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
    if (!response.ok || data?.error) throw new MetaError(data?.error?.message ?? `WhatsApp returned HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status)
    if (!data) throw new MetaError('WhatsApp returned an unreadable response', true)
    return data
  }

  getIdentity() {
    return this.call<{ id: string; display_phone_number?: string; verified_name?: string }>(`${this.phoneNumberId}?fields=id,display_phone_number,verified_name`, 'GET')
  }

  // Returns the message id ONLY when WhatsApp accepts the message.
  async sendText(to: string, text: string) {
    const result = await this.call<{ messages?: { id?: string }[] }>(`${this.phoneNumberId}/messages`, 'POST', { messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000), preview_url: false } })
    const id = result.messages?.[0]?.id
    if (!id) throw new MetaError('WhatsApp did not confirm the message')
    return { id }
  }

  async sendImage(to: string, link: string, caption?: string) {
    const result = await this.call<{ messages?: { id?: string }[] }>(`${this.phoneNumberId}/messages`, 'POST', { messaging_product: 'whatsapp', to, type: 'image', image: { link, caption: caption?.slice(0, 1000) } })
    const id = result.messages?.[0]?.id
    if (!id) throw new MetaError('WhatsApp did not confirm the image')
    return { id }
  }
  // ---------- Templates (need the WhatsApp Business Account id, not the phone number id) ----------
  async listTemplates(wabaId: string) {
    const rows: unknown[] = []
    let after: string | undefined
    for (let i = 0; i < 5; i += 1) {
      const body = await this.call<{ data?: unknown[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${encodeURIComponent(wabaId)}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, 'GET')
      rows.push(...(Array.isArray(body.data) ? body.data : []))
      after = body.paging?.next ? body.paging.cursors?.after : undefined
      if (!after) break
    }
    return normalizeTemplates({ data: rows })
  }

  // Creates a template for Meta's review. The result is PENDING/APPROVED/REJECTED as decided by Meta, never assumed here.
  async createTemplate(wabaId: string, def: TemplateDefinition) {
    const result = await this.call<{ id?: string; status?: string; category?: string }>(`${encodeURIComponent(wabaId)}/message_templates`, 'POST', buildCreateTemplatePayload(def))
    if (!result.id) throw new MetaError('WhatsApp did not confirm the template')
    return { id: result.id, status: (result.status ?? 'PENDING').toUpperCase() }
  }

  async deleteTemplate(wabaId: string, name: string) {
    const result = await this.call<{ success?: boolean }>(`${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`, 'DELETE')
    if (result.success !== true) throw new MetaError('WhatsApp did not confirm the deletion')
  }

  // Returns the message id ONLY when WhatsApp accepts the template message.
  async sendTemplate(to: string, name: string, language: string, bodyParams: string[]) {
    const result = await this.call<{ messages?: { id?: string }[] }>(`${this.phoneNumberId}/messages`, 'POST', buildSendTemplatePayload(to, name, language, bodyParams))
    const id = result.messages?.[0]?.id
    if (!id) throw new MetaError('WhatsApp did not confirm the template message')
    return { id }
  }
}

// ---------- Template rules (pure, unit-tested) ----------
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
export const templateCategories: TemplateCategory[] = ['MARKETING', 'UTILITY', 'AUTHENTICATION']
export type TemplateDefinition = { name: string; language: string; category: TemplateCategory; bodyText: string; headerText?: string; footerText?: string; examples: string[] }
export type StoredTemplate = { metaId: string; name: string; language: string; category: string; status: string; bodyText: string; headerText?: string; footerText?: string; variableCount: number; rejectedReason?: string }

// {{1}} {{2}} ... placeholders in order of appearance.
export function templateVariables(text: string) {
  return [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
}

export function validateTemplateDefinition(def: TemplateDefinition) {
  const errors: string[] = []
  const warnings: string[] = []
  if (!/^[a-z0-9_]{1,100}$/.test(def.name)) errors.push('Name may contain only lowercase letters, numbers and underscores (max 100)')
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(def.language)) errors.push('Language must be a WhatsApp language code such as en, en_US or ur')
  if (!templateCategories.includes(def.category)) errors.push('Category must be MARKETING, UTILITY or AUTHENTICATION')
  const body = def.bodyText.trim()
  if (!body) errors.push('Body text is required')
  if (body.length > 1024) errors.push('Body text must be at most 1024 characters')
  const vars = templateVariables(body)
  const unique = [...new Set(vars)].sort((a, b) => a - b)
  if (unique.some((n, i) => n !== i + 1)) errors.push('Variables must be numbered {{1}}, {{2}}, {{3}} in order without gaps')
  if (def.examples.length !== unique.length) errors.push(`Provide exactly ${unique.length} example value(s), one for each variable (Meta requires examples)`)
  if (def.examples.some((e) => !e.trim())) errors.push('Example values cannot be empty')
  if (def.headerText && (def.headerText.length > 60 || templateVariables(def.headerText).length > 0)) errors.push('Header must be plain text of at most 60 characters (no variables here)')
  if (def.footerText && (def.footerText.length > 60 || templateVariables(def.footerText).length > 0)) errors.push('Footer must be plain text of at most 60 characters (no variables)')
  if (/^\s*\{\{/.test(body) || /\}\}\s*[.!?]?\s*$/.test(body)) warnings.push('Meta commonly rejects templates that start or end with a variable. Add words before and after it.')
  if (def.category === 'MARKETING' && /(100% (free|guaranteed)|guaranteed profit|limited time only!!)/i.test(body)) warnings.push('Promotional claims must be true. Do not promise guaranteed results or fake offers.')
  return { ok: errors.length === 0, errors, warnings, variableCount: unique.length }
}

export function buildCreateTemplatePayload(def: TemplateDefinition) {
  const components: Record<string, unknown>[] = []
  if (def.headerText?.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: def.headerText.trim() })
  const body: Record<string, unknown> = { type: 'BODY', text: def.bodyText.trim() }
  if (def.examples.length) body.example = { body_text: [def.examples.map((e) => e.trim())] }
  components.push(body)
  if (def.footerText?.trim()) components.push({ type: 'FOOTER', text: def.footerText.trim() })
  return { name: def.name, language: def.language, category: def.category, components }
}

// WhatsApp rejects parameters with line breaks, tabs or long runs of spaces.
export const sanitizeTemplateParam = (value: string) => value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 1024)

export function buildSendTemplatePayload(to: string, name: string, language: string, bodyParams: string[]) {
  const template: Record<string, unknown> = { name, language: { code: language } }
  if (bodyParams.length) template.components = [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: sanitizeTemplateParam(text) })) }]
  return { messaging_product: 'whatsapp', to, type: 'template', template }
}

export function renderTemplate(bodyText: string, params: string[]) {
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => sanitizeTemplateParam(params[Number(n) - 1] ?? ''))
}

export function validateSendParams(variableCount: number, params: string[]) {
  const errors: string[] = []
  if (params.length !== variableCount) errors.push(`This template needs exactly ${variableCount} value(s)`)
  if (params.some((p) => !sanitizeTemplateParam(p))) errors.push('Template values cannot be empty')
  return errors
}

// Business-initiated messages need an APPROVED template. Marketing also needs the customer's opt-in.
// Non-marketing templates (order updates) are allowed to a customer who has messaged this business before.
export function canSendTemplate(input: { status: string; category: string; optIn: boolean; hasInboundHistory: boolean }) {
  if (input.status !== 'APPROVED') return { ok: false, reason: `This template is ${input.status}. Only APPROVED templates can be sent.` }
  if (input.category === 'MARKETING' && !input.optIn) return { ok: false, reason: 'Marketing templates need the customer\u2019s recorded WhatsApp opt-in. Record consent first.' }
  if (input.category !== 'MARKETING' && !input.optIn && !input.hasInboundHistory) return { ok: false, reason: 'This customer has never messaged you on WhatsApp and has no recorded opt-in, so a business-initiated message is not allowed.' }
  return { ok: true as const }
}

export function normalizeTemplates(body: unknown): StoredTemplate[] {
  const data = (body as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const out: StoredTemplate[] = []
  for (const raw of data) {
    const t = raw as { id?: unknown; name?: unknown; status?: unknown; category?: unknown; language?: unknown; rejected_reason?: unknown; components?: { type?: unknown; text?: unknown }[] }
    if (typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.language !== 'string') continue
    const text = (type: string) => (Array.isArray(t.components) ? t.components.find((c) => typeof c.type === 'string' && c.type.toUpperCase() === type && typeof c.text === 'string')?.text : undefined) as string | undefined
    const bodyText = text('BODY')
    if (!bodyText) continue
    const category = typeof t.category === 'string' ? t.category.toUpperCase() : ''
    if (!templateCategories.includes(category as TemplateCategory)) continue
    out.push({ metaId: t.id, name: t.name, language: t.language, category, status: typeof t.status === 'string' ? t.status.toUpperCase() : 'PENDING', bodyText, headerText: text('HEADER'), footerText: text('FOOTER'), variableCount: new Set(templateVariables(bodyText)).size, rejectedReason: typeof t.rejected_reason === 'string' && t.rejected_reason !== 'NONE' ? t.rejected_reason : undefined })
  }
  return out
}

// Webhook field "message_template_status_update": entry.id is the WhatsApp Business Account id.
export function parseTemplateStatusWebhook(body: unknown) {
  const out: { wabaId: string; metaId: string; name: string; language?: string; status: string; reason?: string }[] = []
  const root = body as { object?: string; entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[] } | null
  if (!root || root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return out
  for (const entry of root.entry) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field !== 'message_template_status_update' || !entry.id) continue
      const v = change.value ?? {}
      const id = v.message_template_id
      const name = v.message_template_name
      if ((typeof id !== 'string' && typeof id !== 'number') || typeof name !== 'string' || typeof v.event !== 'string') continue
      out.push({ wabaId: String(entry.id), metaId: String(id), name, language: typeof v.message_template_language === 'string' ? v.message_template_language : undefined, status: v.event.toUpperCase(), reason: typeof v.reason === 'string' && v.reason !== 'NONE' ? v.reason : undefined })
    }
  }
  return out
}
