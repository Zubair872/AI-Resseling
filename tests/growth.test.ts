// Public comment replies, WhatsApp templates, marketplace CSV import (pure logic, mocked fetch).
import assert from 'node:assert/strict'
import test from 'node:test'
import { MetaClient, PUBLIC_ACK_TEXT, checkPublicReply, parseCommentReplyMode, toPublicReply } from '../api/meta.js'
import { WhatsAppClient, buildCreateTemplatePayload, buildSendTemplatePayload, canSendTemplate, normalizeTemplates, parseTemplateStatusWebhook, renderTemplate, sanitizeTemplateParam, validateSendParams, validateTemplateDefinition } from '../api/whatsapp.js'
import { evaluateMarketCandidate, parseCount, parseCsvRecords, parseMarketplaceCsv, parseMoney, parseRating } from '../api/marketplaceCsv.js'

test('public reply guard blocks personal data, links and payment details', () => {
  assert.equal(checkPublicReply('Price is Rs. 1,150 and it is in stock.').ok, true)
  for (const bad of ['Call 0300 1234567', 'mail me a@b.com', 'see www.shop.com', 'send money to easypaisa', 'Please send your address here', 'x'.repeat(401), '  ']) assert.equal(checkPublicReply(bad).ok, false, bad)
  assert.equal(checkPublicReply(PUBLIC_ACK_TEXT).ok, true)
})

test('toPublicReply keeps the longest safe prefix and never cuts a price', () => {
  assert.equal(toPublicReply('Football is available at Rs. 1,150. Delivery is confirmed by our team. Please send your address and phone number.'), 'Football is available at Rs. 1,150. Delivery is confirmed by our team.')
  assert.equal(toPublicReply('Call 0300 1234567 now.'), null)
  assert.equal(parseCommentReplyMode('both'), 'both')
  assert.equal(parseCommentReplyMode('weird'), 'private')
})

test('MetaClient public replies use the right endpoint per platform and need confirmation', async () => {
  const urls: string[] = []
  const ok = async (url: string) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ id: 'r1' }) } }
  const client = new MetaClient('T', ok as never)
  await client.replyToComment('facebook', 'c1', 'hi')
  await client.replyToComment('instagram', 'c2', 'hi')
  assert.ok(urls[0].endsWith('/c1/comments'))
  assert.ok(urls[1].endsWith('/c2/replies'))
  const none = new MetaClient('T', (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never)
  await assert.rejects(() => none.replyToComment('facebook', 'c', 'x'), /did not confirm/)
})

const def = { name: 'order_update', language: 'en', category: 'UTILITY' as const, bodyText: 'Hello {{1}}, your order {{2}} has shipped. Thank you!', examples: ['Ali', 'ORD-1'] }

test('template validation', () => {
  assert.equal(validateTemplateDefinition(def).ok, true)
  assert.equal(validateTemplateDefinition({ ...def, name: 'Bad Name' }).ok, false)
  assert.equal(validateTemplateDefinition({ ...def, bodyText: 'Hi {{1}} and {{3}}!', examples: ['a', 'b'] }).ok, false) // gap
  assert.equal(validateTemplateDefinition({ ...def, examples: ['Ali'] }).ok, false) // example count
  assert.equal(validateTemplateDefinition({ ...def, bodyText: 'x'.repeat(1025), examples: [] }).ok, false)
  assert.ok(validateTemplateDefinition({ ...def, bodyText: '{{1}} shipped {{2}}', examples: ['a', 'b'] }).warnings.length > 0) // starts with a variable
})

test('template payloads and rendering', () => {
  const create = buildCreateTemplatePayload({ ...def, footerText: 'Orbitly shop' })
  assert.equal(create.components.length, 2)
  assert.deepEqual((create.components[0] as { example: { body_text: string[][] } }).example.body_text, [['Ali', 'ORD-1']])
  const send = buildSendTemplatePayload('923001234567', 'order_update', 'en', ['Ali\nKhan', 'ORD-1'])
  assert.equal(send.type, 'template')
  assert.deepEqual((send.template as { components: { parameters: { text: string }[] }[] }).components[0].parameters.map((p) => p.text), ['Ali Khan', 'ORD-1'])
  assert.equal(renderTemplate(def.bodyText, ['Ali', 'ORD-1']), 'Hello Ali, your order ORD-1 has shipped. Thank you!')
  assert.equal(sanitizeTemplateParam('a\t\tb   c'), 'a b c')
  assert.equal(validateSendParams(2, ['a']).length > 0, true)
  assert.equal(validateSendParams(2, ['a', ' ']).length > 0, true)
  assert.equal(validateSendParams(2, ['a', 'b']).length, 0)
})

test('who may receive a template', () => {
  assert.equal(canSendTemplate({ status: 'PENDING', category: 'UTILITY', optIn: true, hasInboundHistory: true }).ok, false)
  assert.equal(canSendTemplate({ status: 'APPROVED', category: 'MARKETING', optIn: false, hasInboundHistory: true }).ok, false)
  assert.equal(canSendTemplate({ status: 'APPROVED', category: 'MARKETING', optIn: true, hasInboundHistory: false }).ok, true)
  assert.equal(canSendTemplate({ status: 'APPROVED', category: 'UTILITY', optIn: false, hasInboundHistory: true }).ok, true)
  assert.equal(canSendTemplate({ status: 'APPROVED', category: 'UTILITY', optIn: false, hasInboundHistory: false }).ok, false)
})

test('Graph list/webhook parsing', () => {
  const t = normalizeTemplates({ data: [{ id: '1', name: 'a', status: 'approved', category: 'utility', language: 'en', components: [{ type: 'HEADER', text: 'H' }, { type: 'BODY', text: 'Hi {{1}}, ok' }] }, { id: '2', name: 'nobody', language: 'en', category: 'UTILITY', components: [] }, { id: '3', name: 'weird', language: 'en', category: 'OTHER', components: [{ type: 'BODY', text: 'x' }] }] })
  assert.equal(t.length, 1)
  assert.deepEqual([t[0].status, t[0].variableCount, t[0].headerText], ['APPROVED', 1, 'H'])
  const w = parseTemplateStatusWebhook({ object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field: 'message_template_status_update', value: { event: 'REJECTED', message_template_id: 55, message_template_name: 'a', reason: 'INVALID_FORMAT' } }, { field: 'messages', value: {} }] }] })
  assert.deepEqual(w, [{ wabaId: 'WABA1', metaId: '55', name: 'a', language: undefined, status: 'REJECTED', reason: 'INVALID_FORMAT' }])
})

test('WhatsAppClient templates: create/send need confirmation ids', async () => {
  const sent: { url: string; body?: string; method: string }[] = []
  const f = async (url: string, init: { method: string; body?: string }) => { sent.push({ url, body: init.body, method: init.method }); return { ok: true, status: 200, json: async () => (url.includes('/messages') && !url.includes('message_templates') ? { messages: [{ id: 'wamid.1' }] } : { id: 'T1', status: 'PENDING' }) } }
  const c = new WhatsAppClient('tok', 'PHONE', f as never)
  assert.equal((await c.sendTemplate('9230', 'order_update', 'en', ['a', 'b'])).id, 'wamid.1')
  assert.equal((await c.createTemplate('WABA', def)).status, 'PENDING')
  assert.ok(sent[1].url.includes('WABA/message_templates'))
  const empty = new WhatsAppClient('tok', 'PHONE', (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never)
  await assert.rejects(() => empty.sendTemplate('1', 'n', 'en', []), /did not confirm/)
})

test('CSV records: quotes, embedded newlines, semicolons, BOM', () => {
  assert.deepEqual(parseCsvRecords('\uFEFFa,b\r\n"x, ""y""","line1\nline2"\n'), [['a', 'b'], ['x, "y"', 'line1\nline2']])
  assert.deepEqual(parseCsvRecords('a;b\n1;2'), [['a', 'b'], ['1', '2']])
})

test('money/count/rating parsers', () => {
  assert.deepEqual(parseMoney('Rs. 1,299'), { value: 1299, currency: 'PKR' })
  assert.deepEqual(parseMoney('US $12.99'), { value: 12.99, currency: 'USD' })
  assert.equal(parseMoney('free'), null)
  assert.equal(parseCount('10K+ sold'), 10000)
  assert.equal(parseCount('1,234'), 1234)
  assert.deepEqual(parseRating('96.5%'), { rating: 4.83, approximate: true })
  assert.deepEqual(parseRating('4.8'), { rating: 4.8, approximate: false })
})

const aliCsv = `Product Id,Product Desc,Sale Price,Currency,Volume,Evaluate Rate,Product Detail Url,Product Image Url
1,Wireless Earbuds Bluetooth,12.5,USD,"1,500",94.2%,https://www.aliexpress.com/item/1.html,https://ae01.alicdn.com/a.jpg
2,Hunting Gun Replica,9.99,USD,900,97%,https://x.com/2,
3,Kitchen Organizer,,USD,50,90%,,
4,Yoga Mat,8,EUR,3000,98%,https://x.com/4,`

test('AliExpress export: conversion, restricted flags, missing rate, quality modes', () => {
  const r = parseMarketplaceCsv(aliCsv, { marketplace: 'aliexpress', exchangeRates: { usd: 280 }, shippingPerItem: 150, dutyPercent: 10, defaultStock: 5 })
  assert.equal(r.rows.length, 2)
  assert.equal(r.rows[0].candidate.wholesalePrice, 4000) // 12.5*280*1.10 + 150
  assert.equal(r.rows[0].candidate.category, 'Mobile Accessories')
  assert.equal(r.rows[0].candidate.ratingApproximate, true)
  assert.deepEqual(r.rows[1].candidate.restrictedFlags, ['gun', 'replica'])
  assert.equal(r.errors.length, 2) // missing price, EUR without a rate
  assert.ok(r.errors.some((e) => /EUR/.test(e.reason)))
  const rules = { minRating: 4.5, minReviews: 50, minSold: 200 }
  assert.equal(evaluateMarketCandidate(r.rows[0].candidate, rules, 'skip_missing').eligible, true)
  assert.equal(evaluateMarketCandidate(r.rows[0].candidate, rules, 'strict').eligible, false)
  assert.equal(evaluateMarketCandidate({ rating: 3, reviewCount: null, soldCount: null }, rules, 'off').eligible, true)
  assert.equal(evaluateMarketCandidate({ rating: 3, reviewCount: null, soldCount: null }, rules, 'skip_missing').eligible, false)
})

test('Daraz sheet in PKR needs no rate; long titles are cut to 180; unknown headers give a helpful error', () => {
  const title = 'T'.repeat(250)
  const r = parseMarketplaceCsv(`Product Name,Special Price,Price,Rating,Reviews,Items Sold\n${title},"Rs. 1,000","Rs. 1,500",4.7,120,500`, { marketplace: 'daraz' })
  assert.equal(r.rows[0].candidate.name.length, 180)
  assert.equal(r.rows[0].candidate.wholesalePrice, 1000)
  assert.equal(r.rows[0].candidate.description, title)
  assert.throws(() => parseMarketplaceCsv('foo,bar\n1,2', { marketplace: 'temu' }), /Columns in your file: foo \| bar/)
  const mapped = parseMarketplaceCsv('Item,Cost\nMug,200', { marketplace: 'daraz', columnMap: { name: 'Item', price: 'Cost' } })
  assert.equal(mapped.rows[0].candidate.name, 'Mug')
})
