// Purpose: Meta (Facebook Messenger + Instagram DM) helpers. Pure functions are unit-tested; MetaClient talks to graph.facebook.com.
// NOT verified against a live Meta app in the authoring session. Check META_GRAPH_VERSION against developers.facebook.com before production.
import { createHmac, timingSafeEqual } from 'node:crypto'

export class MetaError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?: number) {
    super(message)
    this.name = 'MetaError'
  }
}

export type InboundChatEvent = { kind: 'message' | 'comment'; channel: 'facebook' | 'instagram'; accountId: string; senderId: string; senderName?: string; messageId: string; text: string; timestamp: number }

// Meta signs the raw request body: header "X-Hub-Signature-256: sha256=<hex hmac of body using the App Secret>".
export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string) {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const given = header.slice('sha256='.length)
  if (given.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

// Extracts customer text messages. Echoes (messages sent by the page itself), non-text events and malformed items are skipped.
export function parseMetaWebhook(body: unknown): InboundChatEvent[] {
  const events: InboundChatEvent[] = []
  const root = body as { object?: string; entry?: { id?: string; time?: number; messaging?: Record<string, unknown>[]; changes?: { field?: string; value?: Record<string, unknown> }[] }[] } | null
  if (!root || (root.object !== 'page' && root.object !== 'instagram') || !Array.isArray(root.entry)) return events
  const channel = root.object === 'page' ? 'facebook' : 'instagram'
  for (const entry of root.entry) {
    if (!entry?.id) continue
    // Comments on the Page's posts (Facebook field "feed") or Instagram media (field "comments"). Only brand-new comments from other people.
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const v = change.value ?? {}
      const from = v.from as { id?: string; name?: string; username?: string } | undefined
      const isFacebook = change.field === 'feed' && v.item === 'comment' && v.verb === 'add'
      const isInstagram = change.field === 'comments'
      const commentId = isFacebook ? v.comment_id : v.id
      const text = isFacebook ? v.message : v.text
      if (!(isFacebook || isInstagram) || !from?.id || from.id === entry.id || typeof commentId !== 'string' || typeof text !== 'string' || !text.trim()) continue
      events.push({ kind: 'comment', channel, accountId: String(entry.id), senderId: String(from.id), senderName: from.name ?? from.username, messageId: commentId, text: text.trim().slice(0, 4000), timestamp: typeof v.created_time === 'number' ? v.created_time * 1000 : (entry.time ?? Date.now()) })
    }
    if (!Array.isArray(entry.messaging)) continue
    for (const item of entry.messaging) {
      const sender = (item.sender as { id?: string } | undefined)?.id
      const message = item.message as { mid?: string; text?: string; is_echo?: boolean } | undefined
      if (!sender || !message || message.is_echo || !message.mid || typeof message.text !== 'string' || !message.text.trim()) continue
      if (sender === entry.id) continue
      events.push({ kind: 'message', channel, accountId: String(entry.id), senderId: String(sender), messageId: message.mid, text: message.text.trim().slice(0, 4000), timestamp: typeof item.timestamp === 'number' ? item.timestamp : (entry.time ?? Date.now()) })
    }
  }
  return events
}

// Messenger / Instagram standard messaging: a business may reply only within 24 hours of the customer's last message.
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000
// A private reply to a public comment is allowed within 7 days of the comment (one private reply per comment).
export const COMMENT_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export function isWithinReplyWindow(lastInboundAt: Date | string | null | undefined, now = Date.now(), windowMs = REPLY_WINDOW_MS) {
  if (!lastInboundAt) return false
  const time = new Date(lastInboundAt).getTime()
  return Number.isFinite(time) && now - time < windowMs
}
export const isCommentThread = (threadId: string | null | undefined) => Boolean(threadId?.startsWith('c:'))

export const customerKey = (channel: 'facebook' | 'instagram', senderId: string) => `${channel === 'facebook' ? 'fb' : 'ig'}:${senderId}`

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class MetaClient {
  constructor(private readonly pageToken: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike, private readonly version = 'v23.0') {}

  private async call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    let response
    try {
      response = await this.fetchImpl(`https://graph.facebook.com/${this.version}/${path}`, { method, headers: { Authorization: `Bearer ${this.pageToken}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch {
      throw new MetaError('Could not reach Meta. Check the connection and try again.', true)
    }
    const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null
    if (!response.ok || data?.error) {
      const message = data?.error?.message ?? `Meta returned HTTP ${response.status}`
      throw new MetaError(message, response.status >= 500 || response.status === 429, response.status)
    }
    if (!data) throw new MetaError('Meta returned an unreadable response', true)
    return data
  }

  // Confirms the Page token works. Returns the Page id and name.
  getIdentity() {
    return this.call<{ id: string; name?: string }>('me?fields=id,name', 'GET')
  }

  // Private reply to a public comment: opens a direct message with the commenter.
  async sendPrivateReply(commentId: string, text: string) {
    const result = await this.call<{ message_id?: string }>('me/messages', 'POST', { recipient: { comment_id: commentId }, message: { text: text.slice(0, 1900) } })
    if (!result.message_id) throw new MetaError('Meta did not confirm the private reply')
    return { id: result.message_id }
  }

  // PUBLIC reply under a comment. Facebook: POST /{comment-id}/comments (needs pages_manage_engagement).
  // Instagram: POST /{ig-comment-id}/replies (needs instagram_manage_comments). Returns the id ONLY when Meta confirms.
  async replyToComment(channel: 'facebook' | 'instagram', commentId: string, text: string) {
    const path = channel === 'instagram' ? `${encodeURIComponent(commentId)}/replies` : `${encodeURIComponent(commentId)}/comments`
    const result = await this.call<{ id?: string }>(path, 'POST', { message: text.slice(0, 2000) })
    if (!result.id) throw new MetaError('Meta did not confirm the public reply')
    return { id: result.id }
  }

  // Sends a text reply inside the 24-hour window. Returns Meta's message id ONLY when Meta confirms.
  async sendText(recipientId: string, text: string) {
    const result = await this.call<{ message_id?: string }>('me/messages', 'POST', { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1900) } })
    if (!result.message_id) throw new MetaError('Meta did not confirm the message')
    return { id: result.message_id }
  }
}

// ---------- Public comment replies ----------
// A public reply is visible to everybody, so it must never carry personal data, payment details or links.
export type CommentReplyMode = 'private' | 'public' | 'both'
export const commentReplyModes: CommentReplyMode[] = ['private', 'public', 'both']
export const parseCommentReplyMode = (value: string | undefined): CommentReplyMode => (commentReplyModes as string[]).includes(value ?? '') ? (value as CommentReplyMode) : 'private'
export const PUBLIC_REPLY_MAX_CHARS = 400

export function checkPublicReply(text: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const t = text.trim()
  if (!t) reasons.push('Reply is empty')
  if (t.length > PUBLIC_REPLY_MAX_CHARS) reasons.push(`Public replies must be at most ${PUBLIC_REPLY_MAX_CHARS} characters`)
  if (/\+?\d[\d\s().-]{7,}\d/.test(t)) reasons.push('Contains a phone or account number')
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) reasons.push('Contains an email address')
  if (/(https?:\/\/|www\.)/i.test(t)) reasons.push('Contains a link')
  if (/(iban|account\s*(no|number|#)|easypaisa|jazzcash|cnic|password|\botp\b)/i.test(t)) reasons.push('Mentions payment or identity details')
  if (/(send|share|give|provide|drop).{0,40}(address|phone|number|cnic)/i.test(t)) reasons.push('Asks the customer to post personal details in public')
  return { ok: reasons.length === 0, reasons }
}

// Short public note used together with a private message ("both" mode). It is only sent AFTER the private message was confirmed.
export const PUBLIC_ACK_TEXT = 'Thank you for your comment! We have sent you the details in a private message. Please check your inbox (or message requests).'

// Public-safe version of a grounded reply: first sentences only, cut at a sentence boundary, then checked by the guard.
export function toPublicReply(replyText: string): string | null {
  const clean = replyText.replace(/\s+/g, ' ').replace(/Rs\. ?/g, 'Rs.\u00a0').trim() // keep "Rs. 1,150" in one piece
  if (!clean) return null
  let out = ''
  for (const sentence of clean.match(/[^.!?]+[.!?]*/g) ?? []) {
    const candidate = (out + sentence).trim()
    if (candidate.length > 300 || !checkPublicReply(candidate).ok) break // keep the longest safe prefix
    out += sentence
  }
  out = out.trim()
  if (/Rs\.$/.test(out)) return null // never cut a price in half
  return out ? out.replace(/\u00a0/g, ' ') : null
}
