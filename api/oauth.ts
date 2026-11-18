// Purpose: "Connect with Facebook/Instagram" and "Connect TikTok" (OAuth 2.0 authorization-code flow).
// Pure URL builders + small clients with an injectable fetch, so they are unit-tested with mocked responses.
// NOT verified against a live Meta/TikTok developer app (no credentials in the authoring session).
// Which permissions Meta/TikTok actually grant depends on App Review / app audit: see EXTERNAL_TODO.md.
import { createHash, randomBytes } from 'node:crypto'

export class OAuthError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?: number) {
    super(message)
    this.name = 'OAuthError'
  }
}

type FetchLike = (url: string, init?: { method: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

// ---------- state (CSRF protection): random value in the URL, only its hash in the database ----------
export function generateOAuthState() {
  const state = randomBytes(32).toString('base64url')
  return { state, hash: hashOAuthValue(state) }
}
export const hashOAuthValue = (value: string) => createHash('sha256').update(value).digest('hex')
export const OAUTH_STATE_TTL_MINUTES = 10
export const OAUTH_SELECTION_TTL_MINUTES = 15

export type OAuthProvider = 'meta' | 'tiktok'
export const oauthCallbackUrl = (publicApiUrl: string, provider: OAuthProvider) => `${publicApiUrl.replace(/\/+$/, '')}/api/oauth/${provider}/callback`

// Meta permissions the platform uses. Several need Meta App Review before customers who are not app roles can grant them.
// pages_messaging: Messenger replies; pages_manage_metadata: webhook subscription; pages_read_engagement + pages_manage_engagement: read and answer comments;
// instagram_manage_messages / instagram_manage_comments: Instagram DMs and comments; pages_show_list + instagram_basic: list Pages and linked Instagram accounts.
export const defaultMetaScopes = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement', 'pages_manage_engagement', 'instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments']
export const defaultTikTokScopes = ['user.info.basic', 'video.publish']

export function parseScopes(value: string | undefined, fallback: string[]) {
  const scopes = (value ?? '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9_.:-]{2,80}$/.test(s))
  return scopes.length ? [...new Set(scopes)] : fallback
}

export function buildMetaAuthUrl(input: { appId: string; redirectUri: string; state: string; scopes: string[]; version: string }) {
  const url = new URL(`https://www.facebook.com/${input.version}/dialog/oauth`)
  url.searchParams.set('client_id', input.appId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('scope', input.scopes.join(','))
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

export function buildTikTokAuthUrl(input: { clientKey: string; redirectUri: string; state: string; scopes: string[] }) {
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/')
  url.searchParams.set('client_key', input.clientKey)
  url.searchParams.set('scope', input.scopes.join(','))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  return url.toString()
}

// ---------- Meta ----------
export type MetaPage = { id: string; name: string; accessToken: string; instagramId?: string; instagramUsername?: string; tasks?: string[] }

export function parseMetaPages(body: unknown): MetaPage[] {
  const data = (body as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const pages: MetaPage[] = []
  for (const raw of data) {
    const p = raw as { id?: unknown; name?: unknown; access_token?: unknown; tasks?: unknown; instagram_business_account?: { id?: unknown; username?: unknown } }
    if (typeof p.id !== 'string' || typeof p.access_token !== 'string' || !p.access_token) continue // a Page without a token cannot be used
    pages.push({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : p.id,
      accessToken: p.access_token,
      instagramId: typeof p.instagram_business_account?.id === 'string' ? p.instagram_business_account.id : undefined,
      instagramUsername: typeof p.instagram_business_account?.username === 'string' ? p.instagram_business_account.username : undefined,
      tasks: Array.isArray(p.tasks) ? p.tasks.filter((t): t is string => typeof t === 'string') : undefined,
    })
  }
  return pages
}

export class MetaOAuth {
  constructor(private readonly appId: string, private readonly appSecret: string, private readonly redirectUri: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike, private readonly version = 'v23.0') {}

  private async get<T>(path: string, params: Record<string, string>, bearer?: string): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return this.send<T>(url.toString(), { method: 'GET', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} })
  }

  private async send<T>(url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<T> {
    let response
    try {
      response = await this.fetchImpl(url, init)
    } catch {
      throw new OAuthError('Could not reach Meta. Try again in a minute.', true)
    }
    const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
    if (!response.ok || data?.error) throw new OAuthError(data?.error?.message ?? `Meta returned HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status)
    if (!data) throw new OAuthError('Meta returned an unreadable response', true)
    return data
  }

  // Step 1: the one-time code from the redirect becomes a short-lived user token.
  async exchangeCode(code: string) {
    const r = await this.get<{ access_token?: string }>('oauth/access_token', { client_id: this.appId, client_secret: this.appSecret, redirect_uri: this.redirectUri, code })
    if (!r.access_token) throw new OAuthError('Meta did not return an access token')
    return r.access_token
  }

  // Step 2: short-lived -> long-lived user token (about 60 days). Page tokens read with it do not expire.
  async extendUserToken(shortToken: string) {
    const r = await this.get<{ access_token?: string; expires_in?: number }>('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: this.appId, client_secret: this.appSecret, fb_exchange_token: shortToken })
    if (!r.access_token) throw new OAuthError('Meta did not return a long-lived token')
    return r.access_token
  }

  // Step 3: Pages this person manages (with their Page tokens and linked Instagram professional accounts). Follows paging, max 5 pages of results.
  async listPages(userToken: string) {
    const pages: MetaPage[] = []
    let after: string | undefined
    for (let i = 0; i < 5; i += 1) {
      const params: Record<string, string> = { fields: 'id,name,access_token,tasks,instagram_business_account{id,username}', limit: '50' }
      if (after) params.after = after
      const body = await this.get<{ data?: unknown[]; paging?: { cursors?: { after?: string }; next?: string } }>('me/accounts', params, userToken)
      pages.push(...parseMetaPages(body))
      after = body.paging?.next ? body.paging.cursors?.after : undefined
      if (!after) break
    }
    return pages
  }

  // Facebook Page webhooks must be subscribed per Page. Instagram webhooks are subscribed in the app dashboard (see DEPLOYMENT.md).
  async subscribePage(pageId: string, pageToken: string, fields = ['messages', 'messaging_postbacks', 'feed']) {
    const r = await this.send<{ success?: boolean }>(`https://graph.facebook.com/${this.version}/${encodeURIComponent(pageId)}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ subscribed_fields: fields.join(',') }).toString() })
    return r.success === true
  }
}

// ---------- TikTok ----------
export type TikTokTokens = { accessToken: string; refreshToken: string; openId: string; expiresAt: Date; refreshExpiresAt: Date; scope: string }

export function parseTikTokTokens(body: unknown, now = Date.now()): TikTokTokens {
  const b = body as { access_token?: unknown; refresh_token?: unknown; open_id?: unknown; expires_in?: unknown; refresh_expires_in?: unknown; scope?: unknown; error?: unknown; error_description?: unknown } | null
  if (!b || typeof b.error === 'string' && b.error) throw new OAuthError(typeof b?.error_description === 'string' ? b.error_description : 'TikTok rejected the request')
  if (typeof b.access_token !== 'string' || typeof b.refresh_token !== 'string' || typeof b.open_id !== 'string') throw new OAuthError('TikTok returned an incomplete token response')
  const seconds = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)
  return { accessToken: b.access_token, refreshToken: b.refresh_token, openId: b.open_id, expiresAt: new Date(now + seconds(b.expires_in, 86400) * 1000), refreshExpiresAt: new Date(now + seconds(b.refresh_expires_in, 365 * 86400) * 1000), scope: typeof b.scope === 'string' ? b.scope : '' }
}

export class TikTokOAuth {
  constructor(private readonly clientKey: string, private readonly clientSecret: string, private readonly redirectUri: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  private async token(form: Record<string, string>) {
    let response
    try {
      response = await this.fetchImpl('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' }, body: new URLSearchParams({ client_key: this.clientKey, client_secret: this.clientSecret, ...form }).toString() })
    } catch {
      throw new OAuthError('Could not reach TikTok. Try again in a minute.', true)
    }
    const data = await response.json().catch(() => null)
    if (!response.ok && !(data as { error?: unknown } | null)?.error) throw new OAuthError(`TikTok returned HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status)
    return parseTikTokTokens(data)
  }

  exchangeCode(code: string) {
    return this.token({ code, grant_type: 'authorization_code', redirect_uri: this.redirectUri })
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }
}

// Refresh a little BEFORE the token dies. A missing expiry on an OAuth-connected token is treated as "refresh now".
export function needsRefresh(expiresAt: Date | string | null | undefined, now = Date.now(), skewMs = 5 * 60 * 1000) {
  if (!expiresAt) return true
  const time = new Date(expiresAt).getTime()
  return !Number.isFinite(time) || time - now <= skewMs
}

// Where the browser lands after the provider redirect. Only a short, URL-encoded status travels in the URL (never tokens).
export function appRedirect(appUrl: string, params: Record<string, string | undefined>) {
  const url = new URL(appUrl.replace(/\/+$/, '') + '/')
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value.slice(0, 200))
  return url.toString()
}
