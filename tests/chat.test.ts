import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { COMMENT_REPLY_WINDOW_MS, MetaClient, MetaError, customerKey, isCommentThread, isWithinReplyWindow, parseMetaWebhook, verifyMetaSignature } from '../api/meta.js'
import { composeReply, composeWithLlm, detectIntent, extractOrderDetails, formatPrice, matchProducts, missingOrderFields, replyUsesOnlyKnownNumbers, type CatalogProduct } from '../api/support.js'

const products: CatalogProduct[] = [
  { id: 'p1', name: 'Smart LED Desk Lamp', category: 'Home & Kitchen', selling_price: '1150.00', stock: 4 },
  { id: 'p2', name: 'Cotton Baby Blanket', category: 'Baby Products', selling_price: '899.50', stock: 0 },
]

test('signature verification accepts only the right HMAC', () => {
  const body = '{"object":"page"}'
  const sig = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`
  assert.equal(verifyMetaSignature(body, sig, 'secret'), true)
  assert.equal(verifyMetaSignature(body + ' ', sig, 'secret'), false)
  assert.equal(verifyMetaSignature(body, sig, 'other'), false)
  assert.equal(verifyMetaSignature(body, undefined, 'secret'), false)
  assert.equal(verifyMetaSignature(body, 'sha256=zz', 'secret'), false)
})

test('webhook parser keeps customer text and skips echoes, empty and own messages', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE', time: 1, messaging: [
    { sender: { id: 'U1' }, timestamp: 5, message: { mid: 'm1', text: ' lamp ki qeemat? ' } },
    { sender: { id: 'PAGE' }, message: { mid: 'm2', text: 'echo', is_echo: true } },
    { sender: { id: 'U2' }, message: { mid: 'm3' } },
    { sender: { id: 'U3' }, message: { mid: 'm4', text: '   ' } },
  ] }] }
  const events = parseMetaWebhook(body)
  assert.equal(events.length, 1)
  assert.deepEqual([events[0].channel, events[0].accountId, events[0].senderId, events[0].text], ['facebook', 'PAGE', 'U1', 'lamp ki qeemat?'])
  assert.equal(parseMetaWebhook({ object: 'instagram', entry: [{ id: 'IG', messaging: [{ sender: { id: 'X' }, message: { mid: 'a', text: 'hi' } }] }] })[0].channel, 'instagram')
  assert.deepEqual(parseMetaWebhook({ object: 'other' }), [])
  assert.deepEqual(parseMetaWebhook(null), [])
  assert.equal(customerKey('facebook', '123'), 'fb:123')
})

test('24 hour reply window', () => {
  const now = Date.parse('2026-11-04T12:00:00Z')
  assert.equal(isWithinReplyWindow('2026-11-04T01:00:00Z', now), true)
  assert.equal(isWithinReplyWindow('2026-11-03T11:00:00Z', now), false)
  assert.equal(isWithinReplyWindow(null, now), false)
})

test('replies use database price and stock only', () => {
  assert.equal(formatPrice('1150.00'), 'Rs. 1,150')
  assert.equal(formatPrice('899.5'), 'Rs. 899.50')
  assert.equal(detectIntent('lamp ki qeemat kya hai'), 'price')
  assert.equal(detectIntent('Salam'), 'greeting')
  assert.equal(matchProducts('desk lamp chahiye', products)[0].id, 'p1')
  const price = composeReply('Desk lamp ki qeemat kya hai?', products)
  assert.ok(price.text.includes('Rs. 1,150') && price.text.includes('available'))
  const out = composeReply('baby blanket price?', products)
  assert.ok(out.text.includes('Rs. 899.50') && out.text.includes('stock mein nahi'))
  const delivery = composeReply('delivery charges kitne hain', products)
  assert.equal(delivery.needsHuman, true)
  assert.ok(!/\d/.test(delivery.text))
})

test('order intake never confirms an order by itself', () => {
  const ask = composeReply('desk lamp order karna hai', products)
  assert.ok(ask.text.includes('naam') && ask.text.includes('address'))
  assert.equal(ask.needsHuman, false)
  const details = extractOrderDetails('Name: Ali Khan\nPhone: 0300-1234567\nCity: Lahore\nAddress: House 5, Street 2\nQty: 2')
  assert.deepEqual(missingOrderFields(details), [])
  const done = composeReply('desk lamp order\nName: Ali Khan\nPhone: 03001234567\nCity: Lahore\nAddress: House 5\nQty: 2', products)
  assert.equal(done.needsHuman, true)
  assert.ok(done.text.includes('confirm'))
  const stockOut = composeReply('baby blanket order karna hai', products)
  assert.ok(stockOut.text.includes('stock mein nahi') && stockOut.needsHuman)
})

test('LLM replies with invented numbers are rejected', async () => {
  const baseline = composeReply('desk lamp ki qeemat', products)
  assert.equal(replyUsesOnlyKnownNumbers('Lamp Rs. 1,150 ka hai', baseline.allowedNumbers), true)
  assert.equal(replyUsesOnlyKnownNumbers('Lamp sirf Rs. 999 ka hai', baseline.allowedNumbers), false)
  const ai = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
  const good = await composeWithLlm('desk lamp ki qeemat', products, baseline, ai, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Ji, lamp Rs. 1,150 mein available hai.' } }] }) }))
  assert.ok(good.text.includes('1,150') && good.text !== baseline.text)
  const bad = await composeWithLlm('desk lamp ki qeemat', products, baseline, ai, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Special offer Rs. 500 only!' } }] }) }))
  assert.equal(bad.text, baseline.text)
  const down = await composeWithLlm('x', products, baseline, ai, async () => { throw new Error('offline') })
  assert.equal(down.text, baseline.text)
})

test('Meta client sends with bearer token and reports honestly', async () => {
  const seen: { url?: string; headers?: Record<string, string>; body?: string } = {}
  const ok = new MetaClient('tok', async (url, init) => { seen.url = url; seen.headers = init.headers; seen.body = init.body; return { ok: true, status: 200, json: async () => ({ message_id: 'm.1' }) } })
  assert.equal((await ok.sendText('U1', 'hello')).id, 'm.1')
  assert.ok(seen.url?.endsWith('/me/messages') && seen.headers?.Authorization === 'Bearer tok')
  assert.deepEqual(JSON.parse(seen.body ?? '{}').recipient, { id: 'U1' })
  await assert.rejects(new MetaClient('t', async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Outside allowed window' } }) })).sendText('U', 'x'), /Outside allowed window/)
  await assert.rejects(new MetaClient('t', async () => ({ ok: true, status: 200, json: async () => ({}) })).sendText('U', 'x'), (e: MetaError) => e.message.includes('did not confirm'))
  await assert.rejects(new MetaClient('t', (async () => { throw new Error('x') }) as never).getIdentity(), (e: MetaError) => e.retryable)
})

test('comments become events and get a 7 day private reply window', async () => {
  const fb = parseMetaWebhook({ object: 'page', entry: [{ id: 'PAGE', time: 1, changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', message: 'price?', from: { id: 'U9', name: 'Sana' }, created_time: 100 } },
    { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'c2', message: 'x', from: { id: 'U9' } } },
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c3', message: 'own', from: { id: 'PAGE' } } },
    { field: 'feed', value: { item: 'reaction', verb: 'add' } },
  ] }] })
  assert.equal(fb.length, 1)
  assert.deepEqual([fb[0].kind, fb[0].messageId, fb[0].senderName, fb[0].timestamp], ['comment', 'c1', 'Sana', 100000])
  const ig = parseMetaWebhook({ object: 'instagram', entry: [{ id: 'IG', changes: [{ field: 'comments', value: { id: 'ic1', text: 'kitne ka hai', from: { id: 'U5', username: 'ali' } } }] }] })
  assert.deepEqual([ig[0].kind, ig[0].channel, ig[0].senderName], ['comment', 'instagram', 'ali'])
  const now = Date.parse('2026-11-10T00:00:00Z')
  assert.equal(isWithinReplyWindow('2026-11-05T00:00:00Z', now, COMMENT_REPLY_WINDOW_MS), true)
  assert.equal(isWithinReplyWindow('2026-11-05T00:00:00Z', now), false)
  assert.equal(isCommentThread('c:123'), true)
  assert.equal(isCommentThread('USER1'), false)
  let body = ''
  const client = new MetaClient('t', async (_url, init) => { body = init.body ?? ''; return { ok: true, status: 200, json: async () => ({ message_id: 'm.9' }) } })
  assert.equal((await client.sendPrivateReply('c1', 'Rs. 1,150')).id, 'm.9')
  assert.deepEqual(JSON.parse(body).recipient, { comment_id: 'c1' })
})
