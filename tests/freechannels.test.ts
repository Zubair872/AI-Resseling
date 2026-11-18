import assert from 'node:assert/strict'
import test from 'node:test'
import { BlueskyClient, ChannelError, DiscordClient, MastodonClient, composeText, downloadImage, isDiscordWebhook, type FetchLike } from '../api/freeChannels.js'

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => 'application/json' } })
const jpeg = () => {
  const bytes = new Uint8Array(2000)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  return { ok: true, status: 200, json: async () => ({}), text: async () => '', arrayBuffer: async () => bytes.buffer, headers: { get: () => 'image/jpeg' } }
}

test('composeText keeps hashtags when they fit and cuts safely when they do not', () => {
  assert.equal(composeText({ text: 'Hello', hashtags: ['#a', '#b'] }, 100), 'Hello\n\n#a #b')
  assert.equal(composeText({ text: 'Hello', hashtags: ['#aaaaaaaaaa'] }, 8), 'Hello')
  assert.equal(composeText({ text: 'abcdefghij', hashtags: [] }, 5), 'abcd…')
})

test('Bluesky: logs in, uploads the image and creates the post', async () => {
  const calls: Call[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('createSession')) return json({ accessJwt: 'jwt', did: 'did:plc:abc', handle: 'shop.bsky.social' })
    if (url.endsWith('uploadBlob')) return json({ blob: { $type: 'blob', ref: { $link: 'x' }, mimeType: 'image/jpeg', size: 2000 } })
    if (url.endsWith('createRecord')) return json({ uri: 'at://did:plc:abc/app.bsky.feed.post/3kabc', cid: 'c' })
    return jpeg()
  }
  const sent = await new BlueskyClient('shop.bsky.social', 'pw', 'https://bsky.social', fetchImpl).send({ text: 'Lamp', hashtags: ['#a'], imageUrl: 'https://cdn.example.com/a.jpg' })
  assert.equal(sent.url, 'https://bsky.app/profile/shop.bsky.social/post/3kabc')
  const record = JSON.parse(calls.find((c) => c.url.endsWith('createRecord'))!.init!.body as string)
  assert.equal(record.record.embed.$type, 'app.bsky.embed.images')
  assert.equal(record.repo, 'did:plc:abc')
})

test('Bluesky: a failed image does not block the text post but is reported', async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith('createSession')) return json({ accessJwt: 'j', did: 'did:plc:abc', handle: 'h.bsky.social' })
    if (url.endsWith('createRecord')) return json({ uri: 'at://did/app.bsky.feed.post/1' })
    return { ...json({}, 404) }
  }
  const sent = await new BlueskyClient('h', 'pw', 'https://bsky.social', fetchImpl).send({ text: 'Lamp', hashtags: [], imageUrl: 'https://cdn.example.com/a.jpg' })
  assert.match(sent.note ?? '', /without the image/)
})

test('Bluesky: wrong password gives a clear error', async () => {
  const fetchImpl: FetchLike = async () => json({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }, 401)
  await assert.rejects(() => new BlueskyClient('h', 'bad', 'https://bsky.social', fetchImpl).identify(), /Invalid identifier or password/)
})

test('Mastodon: uploads media then posts a public status with an idempotency key', async () => {
  const calls: Call[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/api/v2/media')) return json({ id: 'm1' })
    if (url.endsWith('/api/v1/statuses')) return json({ id: 's1', url: 'https://mastodon.social/@shop/s1' })
    return jpeg()
  }
  const sent = await new MastodonClient('https://mastodon.social/', 'tok', fetchImpl).send({ text: 'Lamp', hashtags: ['#a'], imageUrl: 'https://cdn.example.com/a.jpg' })
  assert.equal(sent.id, 's1')
  const status = calls.find((c) => c.url.endsWith('/api/v1/statuses'))!
  assert.ok(status.init!.headers!['Idempotency-Key'])
  assert.deepEqual(JSON.parse(status.init!.body as string).media_ids, ['m1'])
})

test('Discord: accepts only real webhook URLs and counts a post only with a message id', async () => {
  assert.equal(isDiscordWebhook('https://discord.com/api/webhooks/123/abc-DEF_1'), true)
  assert.equal(isDiscordWebhook('https://evil.com/api/webhooks/123/abc'), false)
  assert.throws(() => new DiscordClient('https://evil.com/x'), ChannelError)
  const ok: FetchLike = async () => json({ id: '999' })
  assert.equal((await new DiscordClient('https://discord.com/api/webhooks/1/a', ok).send({ text: 'x', hashtags: [] })).id, '999')
  const bad: FetchLike = async () => json({ message: 'Unknown Webhook' }, 404)
  await assert.rejects(() => new DiscordClient('https://discord.com/api/webhooks/1/a', bad).send({ text: 'x', hashtags: [] }), /Unknown Webhook/)
})

test('downloadImage rejects private addresses and non-images', async () => {
  await assert.rejects(() => downloadImage('http://127.0.0.1/a.jpg', async () => jpeg()), /public web address/)
  await assert.rejects(() => downloadImage('https://x.com/a', async () => ({ ...jpeg(), arrayBuffer: async () => new TextEncoder().encode('<html>').buffer, headers: { get: () => 'text/html' } })), /did not return an image/)
  const image = await downloadImage('https://x.com/a.jpg', async () => jpeg())
  assert.equal(image.mime, 'image/jpeg')
})
