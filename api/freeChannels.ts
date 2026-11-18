// Purpose: post straight to FREE channels with their official APIs, no paid tool and no app review:
//   bluesky (AT Protocol), mastodon (any instance), discord (channel webhook).
// A post counts as sent ONLY when the service returns an id. Image URLs are used as they are (Discord) or downloaded and uploaded (Bluesky/Mastodon).
// Written without internet access in the authoring environment: tested with mocked responses only. Use "Test" in Integrations for the real answer.
export class ChannelError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = 'ChannelError'
  }
}

export type FreeProvider = 'bluesky' | 'mastodon' | 'discord'
export const freeProviders: FreeProvider[] = ['bluesky', 'mastodon', 'discord']
export const isFreeProvider = (value: string): value is FreeProvider => (freeProviders as string[]).includes(value)

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array | FormData; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; headers: { get(name: string): string | null } }>
const realFetch = fetch as unknown as FetchLike

export type PostInput = { text: string; hashtags: string[]; imageUrl?: string | null }
export type SendResult = { id: string; url?: string; note?: string }
export type Identity = { externalId: string; displayName: string; message: string }

export function composeText(input: PostInput, limit: number) {
  const tags = input.hashtags.filter(Boolean).join(' ')
  const full = tags ? `${input.text}\n\n${tags}` : input.text
  if (full.length <= limit) return full
  // keep the caption whole when possible: drop hashtags first, then cut the caption
  if (input.text.length <= limit) return input.text
  return `${input.text.slice(0, limit - 1).trimEnd()}…`
}

const timeout = () => AbortSignal.timeout(25_000)

function isPrivateHost(hostname: string) {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/.test(h)
}

// Downloads a public image (http/https, not a private address, max 8 MB, must be an image).
export async function downloadImage(url: string, fetchImpl: FetchLike = realFetch) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ChannelError('The product image link is not a valid URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHost(parsed.hostname)) throw new ChannelError('The product image link is not a public web address')
  let response
  try {
    response = await fetchImpl(parsed.toString(), { signal: timeout() })
  } catch {
    throw new ChannelError('Could not download the product image', true)
  }
  if (!response.ok) throw new ChannelError(`Product image download failed (HTTP ${response.status})`)
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > 8_000_000) throw new ChannelError('The product image is empty or larger than 8 MB')
  const sniff = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 ? 'image/webp' : null
  const mime = sniff ?? (type.startsWith('image/') ? type : null)
  if (!mime) throw new ChannelError('The product image link did not return an image')
  return { bytes, mime }
}

// ---------------- Bluesky ----------------
export class BlueskyClient {
  private session: { accessJwt: string; did: string; handle: string } | null = null
  constructor(private readonly handle: string, private readonly appPassword: string, private readonly service = 'https://bsky.social', private readonly fetchImpl: FetchLike = realFetch) {}

  private async xrpc<T>(path: string, init: { body?: string | Uint8Array; contentType?: string; auth?: boolean }): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': init.contentType ?? 'application/json' }
    if (init.auth) headers.Authorization = `Bearer ${this.session!.accessJwt}`
    let response
    try {
      response = await this.fetchImpl(`${this.service}/xrpc/${path}`, { method: 'POST', headers, body: init.body, signal: timeout() })
    } catch {
      throw new ChannelError('Could not reach Bluesky. Check the internet connection.', true)
    }
    const data = (await response.json().catch(() => null)) as (T & { message?: string; error?: string }) | null
    if (!response.ok || !data) throw new ChannelError(`Bluesky: ${data?.message ?? data?.error ?? `HTTP ${response.status}`}`, response.status >= 500 || response.status === 429)
    return data
  }

  private async login() {
    if (this.session) return this.session
    this.session = await this.xrpc<{ accessJwt: string; did: string; handle: string }>('com.atproto.server.createSession', { body: JSON.stringify({ identifier: this.handle, password: this.appPassword }) })
    return this.session
  }

  async identify(): Promise<Identity> {
    const session = await this.login()
    return { externalId: session.did, displayName: `@${session.handle}`, message: `Connected to Bluesky as @${session.handle}.` }
  }

  async send(input: PostInput): Promise<SendResult> {
    const session = await this.login()
    const text = composeText(input, 300)
    const record: Record<string, unknown> = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), langs: ['en'] }
    let note: string | undefined
    if (input.imageUrl) {
      try {
        const image = await downloadImage(input.imageUrl, this.fetchImpl)
        if (image.bytes.length > 950_000) note = 'Posted without the image: Bluesky accepts images up to about 1 MB and this one is larger.'
        else {
          const uploaded = await this.xrpc<{ blob: unknown }>('com.atproto.repo.uploadBlob', { body: image.bytes, contentType: image.mime, auth: true })
          record.embed = { $type: 'app.bsky.embed.images', images: [{ alt: input.text.split('\n')[0].slice(0, 200), image: uploaded.blob }] }
        }
      } catch (error) {
        if (error instanceof ChannelError && error.retryable) throw error
        note = `Posted without the image: ${error instanceof Error ? error.message : 'image problem'}`
      }
    }
    const created = await this.xrpc<{ uri: string }>('com.atproto.repo.createRecord', { body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }), auth: true })
    const rkey = created.uri.split('/').pop()
    return { id: created.uri, url: `https://bsky.app/profile/${session.handle}/post/${rkey}`, note }
  }
}

// ---------------- Mastodon ----------------
export class MastodonClient {
  private readonly base: string
  constructor(instance: string, private readonly token: string, private readonly fetchImpl: FetchLike = realFetch) {
    this.base = instance.replace(/\/+$/, '')
  }

  private async call<T>(path: string, init: { method?: string; body?: string | FormData; headers?: Record<string, string> } = {}): Promise<T> {
    let response
    try {
      response = await this.fetchImpl(`${this.base}${path}`, { method: init.method ?? 'GET', headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) }, body: init.body, signal: timeout() })
    } catch {
      throw new ChannelError('Could not reach the Mastodon server. Check the instance address and internet.', true)
    }
    const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null
    if (!response.ok || !data) throw new ChannelError(`Mastodon: ${data?.error ?? `HTTP ${response.status}`}`, response.status >= 500 || response.status === 429)
    return data
  }

  async identify(): Promise<Identity> {
    const me = await this.call<{ id: string; acct: string; url: string }>('/api/v1/accounts/verify_credentials')
    return { externalId: me.id, displayName: `@${me.acct}`, message: `Connected to Mastodon as @${me.acct}.` }
  }

  async send(input: PostInput): Promise<SendResult> {
    const mediaIds: string[] = []
    let note: string | undefined
    if (input.imageUrl) {
      try {
        const image = await downloadImage(input.imageUrl, this.fetchImpl)
        const form = new FormData()
        form.set('file', new Blob([image.bytes], { type: image.mime }), 'product.jpg')
        form.set('description', input.text.split('\n')[0].slice(0, 400))
        const media = await this.call<{ id: string }>('/api/v2/media', { method: 'POST', body: form })
        mediaIds.push(media.id)
      } catch (error) {
        if (error instanceof ChannelError && error.retryable) throw error
        note = `Posted without the image: ${error instanceof Error ? error.message : 'image problem'}`
      }
    }
    const status = await this.call<{ id: string; url: string }>('/api/v1/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': globalThis.crypto.randomUUID() },
      body: JSON.stringify({ status: composeText(input, 480), visibility: 'public', ...(mediaIds.length ? { media_ids: mediaIds } : {}) }),
    })
    return { id: status.id, url: status.url, note }
  }
}

// ---------------- Discord (channel webhook) ----------------
export const isDiscordWebhook = (value: string) => /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(value.trim())

export class DiscordClient {
  constructor(private readonly webhookUrl: string, private readonly fetchImpl: FetchLike = realFetch) {
    if (!isDiscordWebhook(webhookUrl)) throw new ChannelError('That is not a Discord webhook URL (it looks like https://discord.com/api/webhooks/123/abc)')
  }

  async identify(): Promise<Identity> {
    let response
    try {
      response = await this.fetchImpl(this.webhookUrl.trim(), { signal: timeout() })
    } catch {
      throw new ChannelError('Could not reach Discord. Check the internet connection.', true)
    }
    const data = (await response.json().catch(() => null)) as { id?: string; name?: string; channel_id?: string; message?: string } | null
    if (!response.ok || !data?.id) throw new ChannelError(`Discord: ${data?.message ?? `HTTP ${response.status}`}`)
    return { externalId: data.id, displayName: `Discord: ${data.name ?? 'webhook'}`, message: `Webhook "${data.name ?? data.id}" is valid.` }
  }

  async send(input: PostInput): Promise<SendResult> {
    const body = { content: composeText(input, 2000), ...(input.imageUrl ? { embeds: [{ image: { url: input.imageUrl } }] } : {}), allowed_mentions: { parse: [] as string[] } }
    let response
    try {
      response = await this.fetchImpl(`${this.webhookUrl.trim()}?wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: timeout() })
    } catch {
      throw new ChannelError('Could not reach Discord. Check the internet connection.', true)
    }
    const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null
    if (!response.ok || !data?.id) throw new ChannelError(`Discord: ${data?.message ?? `HTTP ${response.status}`}`, response.status >= 500 || response.status === 429)
    return { id: data.id }
  }
}

export type ChannelConfig = Record<string, string>
export function clientFor(provider: FreeProvider, secret: string, config: ChannelConfig, fetchImpl?: FetchLike) {
  if (provider === 'bluesky') {
    if (!config.handle) throw new ChannelError('Bluesky needs your handle, for example name.bsky.social')
    return new BlueskyClient(config.handle.trim().replace(/^@/, ''), secret.trim(), (config.service || 'https://bsky.social').replace(/\/+$/, ''), fetchImpl)
  }
  if (provider === 'mastodon') {
    if (!/^https:\/\/[^/]+/.test(config.instance ?? '')) throw new ChannelError('Mastodon needs the instance address, for example https://mastodon.social')
    return new MastodonClient(config.instance.trim(), secret.trim(), fetchImpl)
  }
  return new DiscordClient(secret.trim(), fetchImpl)
}

// The platform name stored in social_accounts / content drafts for each free provider.
export const platformLabel: Record<FreeProvider, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', discord: 'Discord' }
