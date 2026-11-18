import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptSecret, encryptSecret, secretHint } from '../api/secrets.js'
import { applyProfit, defaultProfit, defaultSourcingRules, evaluateCandidate, parseSourcingCsv } from '../api/sourcing.js'
import { BufferClient, BufferError, gqlString } from '../api/buffer.js'

const key = 'a'.repeat(64)

test('secrets round-trip, differ each time, and fail when tampered', () => {
  const a = encryptSecret('sk-live-1234567890', key)
  assert.notEqual(a, encryptSecret('sk-live-1234567890', key))
  assert.ok(!a.includes('sk-live'))
  assert.equal(decryptSecret(a, key), 'sk-live-1234567890')
  assert.throws(() => decryptSecret(a.slice(0, -2) + 'xx', key))
  assert.throws(() => decryptSecret(a, 'b'.repeat(64)))
  assert.equal(secretHint('sk-live-1234567890'), '7890')
  assert.equal(secretHint('short'), '')
})

test('profit is added to the supplier price (Rs. 1,000 + Rs. 150 = Rs. 1,150)', () => {
  assert.equal(applyProfit(1000, defaultProfit), 1150)
  assert.equal(applyProfit(1000, { fixed: 100, percent: 10 }), 1200)
  assert.equal(applyProfit(1000, defaultProfit, 300), 1300)
  assert.equal(applyProfit(1000, defaultProfit, -50), 1000)
})

test('only high rated, well reviewed, high selling products pass', () => {
  assert.equal(evaluateCandidate({ rating: 4.8, reviewCount: 300, soldCount: 1500 }, defaultSourcingRules).eligible, true)
  const low = evaluateCandidate({ rating: 4.1, reviewCount: 10, soldCount: 20 }, defaultSourcingRules)
  assert.equal(low.eligible, false)
  assert.equal(low.reasons.length, 3)
  assert.equal(evaluateCandidate({ rating: null, reviewCount: null, soldCount: null }, defaultSourcingRules).reasons.length, 3)
})

test('sourcing CSV parsing keeps good rows and reports bad ones', () => {
  const csv = 'name,category,wholesale_price,stock,rating,review_count,sold_count,image_url,profit\nLamp,Home & Kitchen,1000,10,4.8,120,900,https://x.com/a.jpg,200\nBad,Nope,500,1,4.9,10,10,,\nFree,Beauty,0,1,5,5,5,,'
  const { rows, errors } = parseSourcingCsv(csv)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].candidate, { name: 'Lamp', category: 'Home & Kitchen', wholesalePrice: 1000, stock: 10, rating: 4.8, reviewCount: 120, soldCount: 900, imageUrl: 'https://x.com/a.jpg', profit: 200 })
  assert.equal(errors.length, 2)
  assert.throws(() => parseSourcingCsv('name,price\nA,1'), /missing required column: category/)
})

function fakeFetch(response: { status?: number; body?: unknown }, seen: { init?: { body: string; headers: Record<string, string> } } = {}) {
  return async (_url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    seen.init = init
    return { ok: (response.status ?? 200) < 400, status: response.status ?? 200, json: async () => response.body }
  }
}

test('buffer client lists organizations and sends the bearer key', async () => {
  const seen: { init?: { body: string; headers: Record<string, string> } } = {}
  const client = new BufferClient('key-123', fakeFetch({ body: { data: { account: { organizations: [{ id: 'o1', name: 'Shop' }] } } } }, seen))
  assert.deepEqual(await client.listOrganizations(), [{ id: 'o1', name: 'Shop' }])
  assert.equal(seen.init!.headers.Authorization, 'Bearer key-123')
})

test('buffer createPost builds a scheduled image mutation and returns the post id', async () => {
  const seen: { init?: { body: string; headers: Record<string, string> } } = {}
  const client = new BufferClient('k', fakeFetch({ body: { data: { createPost: { post: { id: 'p1' } } } } }, seen))
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString()
  const result = await client.createPost({ channelId: 'c1', text: 'Hi "there"\nline', imageUrl: 'https://x.com/a.jpg', dueAt: due })
  assert.deepEqual(result, { id: 'p1' })
  const query = JSON.parse(seen.init!.body).query as string
  assert.ok(query.includes('mode: customScheduled'))
  assert.ok(query.includes(`dueAt: "${due}"`))
  assert.ok(query.includes('assets: [{ image: { url: "https://x.com/a.jpg" } }]'))
  assert.ok(query.includes(gqlString('Hi "there"\nline')))
})

test('buffer: a time that is now or past is sent with shareNow, never as customScheduled', async () => {
  const seen: { init?: { body: string; headers: Record<string, string> } } = {}
  await new BufferClient('k', fakeFetch({ body: { data: { createPost: { post: { id: 'p2' } } } } }, seen)).createPost({ channelId: 'c1', text: 'Hi', dueAt: new Date().toISOString() })
  const query = JSON.parse(seen.init!.body).query as string
  assert.ok(query.includes('mode: shareNow'))
  assert.ok(!query.includes('customScheduled'))
})

test('buffer: Facebook and Instagram posts carry the required post type', async () => {
  for (const [service, expected] of [['facebook', 'metadata: { facebook: { type: post } }'], ['instagram', 'metadata: { instagram: { type: post, shouldShareToFeed: true } }'], ['twitter', '']] as const) {
    const seen: { init?: { body: string; headers: Record<string, string> } } = {}
    await new BufferClient('k', fakeFetch({ body: { data: { createPost: { post: { id: 'p3' } } } } }, seen)).createPost({ channelId: 'c1', text: 'Hi', service })
    const query = JSON.parse(seen.init!.body).query as string
    if (expected) assert.ok(query.includes(expected)); else assert.ok(!query.includes('metadata'))
  }
})

test('buffer errors are reported honestly', async () => {
  await assert.rejects(new BufferClient('k', fakeFetch({ status: 401 })).listOrganizations(), (e: BufferError) => e.message.includes('rejected') && !e.retryable)
  await assert.rejects(new BufferClient('k', fakeFetch({ status: 429 })).listOrganizations(), (e: BufferError) => e.retryable)
  await assert.rejects(new BufferClient('k', fakeFetch({ body: { data: { createPost: { message: 'Channel is disconnected' } } } })).createPost({ channelId: 'c', text: 't' }), /Channel is disconnected/)
  await assert.rejects(new BufferClient('k', fakeFetch({ body: { errors: [{ message: 'Bad query' }] } })).listChannels('o'), /Bad query/)
  await assert.rejects(new BufferClient('k', (async () => { throw new Error('offline') }) as never).listOrganizations(), /Could not reach Buffer/)
})
