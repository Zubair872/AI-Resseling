// OAuth helpers (pure + mocked fetch). Nothing here talks to Meta or TikTok.
import assert from 'node:assert/strict'
import test from 'node:test'
import { MetaOAuth, OAuthError, TikTokOAuth, appRedirect, buildMetaAuthUrl, buildTikTokAuthUrl, defaultMetaScopes, generateOAuthState, hashOAuthValue, needsRefresh, oauthCallbackUrl, parseMetaPages, parseScopes, parseTikTokTokens } from '../api/oauth.js'

const json = (body: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => body })

test('state is random, only its hash is stored', () => {
  const a = generateOAuthState(); const b = generateOAuthState()
  assert.notEqual(a.state, b.state)
  assert.equal(a.hash, hashOAuthValue(a.state))
  assert.equal(a.hash.length, 64)
})

test('auth URLs carry client id, redirect, state and scopes', () => {
  const u = new URL(buildMetaAuthUrl({ appId: '123456', redirectUri: oauthCallbackUrl('https://api.example.com/', 'meta'), state: 'st', scopes: defaultMetaScopes, version: 'v23.0' }))
  assert.equal(u.origin + u.pathname, 'https://www.facebook.com/v23.0/dialog/oauth')
  assert.equal(u.searchParams.get('redirect_uri'), 'https://api.example.com/api/oauth/meta/callback')
  assert.equal(u.searchParams.get('state'), 'st')
  assert.ok(u.searchParams.get('scope')!.includes('pages_messaging'))
  const t = new URL(buildTikTokAuthUrl({ clientKey: 'ck', redirectUri: 'https://api.example.com/api/oauth/tiktok/callback', state: 's2', scopes: ['user.info.basic', 'video.publish'] }))
  assert.equal(t.origin + t.pathname, 'https://www.tiktok.com/v2/auth/authorize/')
  assert.equal(t.searchParams.get('client_key'), 'ck')
  assert.equal(t.searchParams.get('scope'), 'user.info.basic,video.publish')
})

test('scopes: bad characters are dropped, empty falls back', () => {
  assert.deepEqual(parseScopes('a_b, c.d evil<script>', ['x']), ['a_b', 'c.d'])
  assert.deepEqual(parseScopes('', ['x']), ['x'])
})

test('Meta: code -> long-lived token -> pages (pages without a token are skipped)', async () => {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    if (url.includes('grant_type=fb_exchange_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'LONG' }) }
    if (url.includes('oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'SHORT' }) }
    return { ok: true, status: 200, json: async () => ({ data: [{ id: '1', name: 'Shop', access_token: 'PT', instagram_business_account: { id: '9', username: 'shop_ig' } }, { id: '2', name: 'NoToken' }] }) }
  }
  const oauth = new MetaOAuth('111111', 'secret', 'https://x/cb', fetchImpl)
  const long = await oauth.extendUserToken(await oauth.exchangeCode('CODE'))
  assert.equal(long, 'LONG')
  assert.ok(calls[0].includes('code=CODE'))
  const pages = await oauth.listPages(long)
  assert.equal(pages.length, 1)
  assert.deepEqual([pages[0].id, pages[0].instagramId, pages[0].instagramUsername], ['1', '9', 'shop_ig'])
})

test('Meta errors become OAuthError; 5xx is retryable', async () => {
  const oauth = new MetaOAuth('111111', 's', 'https://x/cb', json({ error: { message: 'Invalid code' } }, 400) as never)
  await assert.rejects(() => oauth.exchangeCode('bad'), (e: unknown) => e instanceof OAuthError && e.message === 'Invalid code' && !e.retryable)
  const down = new MetaOAuth('111111', 's', 'https://x/cb', json({}, 503) as never)
  await assert.rejects(() => down.exchangeCode('x'), (e: unknown) => e instanceof OAuthError && e.retryable)
})

test('Meta: Page webhook subscription is confirmed only on success:true', async () => {
  const yes = new MetaOAuth('111111', 's', 'https://x/cb', json({ success: true }) as never)
  const no = new MetaOAuth('111111', 's', 'https://x/cb', json({ success: false }) as never)
  assert.equal(await yes.subscribePage('1', 'PT'), true)
  assert.equal(await no.subscribePage('1', 'PT'), false)
})

test('TikTok tokens: parse, errors, refresh', async () => {
  const t = parseTikTokTokens({ access_token: 'a', refresh_token: 'r', open_id: 'o', expires_in: 86400, refresh_expires_in: 31536000, scope: 'user.info.basic' }, 1_000_000)
  assert.equal(t.expiresAt.getTime(), 1_000_000 + 86_400_000)
  assert.throws(() => parseTikTokTokens({ error: 'invalid_grant', error_description: 'Code expired' }), /Code expired/)
  assert.throws(() => parseTikTokTokens({ access_token: 'a' }), /incomplete/)
  let sentBody = ''
  const fetchImpl = async (_u: string, init?: { body?: string }) => { sentBody = init?.body ?? ''; return { ok: true, status: 200, json: async () => ({ access_token: 'a2', refresh_token: 'r2', open_id: 'o', expires_in: 86400 }) } }
  const refreshed = await new TikTokOAuth('ck', 'cs', 'https://x/cb', fetchImpl as never).refresh('r')
  assert.equal(refreshed.accessToken, 'a2')
  assert.ok(sentBody.includes('grant_type=refresh_token') && sentBody.includes('refresh_token=r'))
})

test('needsRefresh refreshes early and when expiry is unknown', () => {
  const now = 1_000_000_000
  assert.equal(needsRefresh(null, now), true)
  assert.equal(needsRefresh(new Date(now + 60_000), now), true)
  assert.equal(needsRefresh(new Date(now + 3_600_000), now), false)
})

test('redirect back to the app never carries tokens, only a short status', () => {
  const url = appRedirect('http://localhost:5173', { oauth: 'meta', status: 'select', token: 'abc', message: 'x'.repeat(500) })
  const u = new URL(url)
  assert.equal(u.searchParams.get('oauth'), 'meta')
  assert.equal(u.searchParams.get('message')!.length, 200)
})
