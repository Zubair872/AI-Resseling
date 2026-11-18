import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac, generateKeyPairSync, createVerify } from 'node:crypto'

process.env.NODE_ENV = 'test'
const { ResendMailer } = await import('../api/resend.js')
const { parseWhatsAppWebhook, WhatsAppClient } = await import('../api/whatsapp.js')
const { TikTokClient, TikTokError } = await import('../api/tiktok.js')
const { presignGetUrl, S3Storage, signRequest } = await import('../api/s3.js')
const { verifyStripeSignature, settledInvoiceFromEvent, StripeProvider } = await import('../api/stripe.js')
const { buildServiceAccountJwt, safeCell, GoogleSheetsClient } = await import('../api/sheets.js')
const { ocrImageText } = await import('../api/ocr.js')

const ok = (json: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => json })

test('resend mailer reports delivered only when an id comes back', async () => {
  assert.equal((await new ResendMailer('k12345678', 'a@b.c', ok({ id: 'x' })).send({ to: 'u@x.com', subject: 's', text: 't' })).delivered, true)
  assert.equal((await new ResendMailer('k12345678', 'a@b.c', ok({ message: 'bad' }, 422)).send({ to: 'u@x.com', subject: 's', text: 't' })).delivered, false)
  assert.equal((await new ResendMailer('k12345678', 'a@b.c', async () => { throw new Error('down') }).send({ to: 'u@x.com', subject: 's', text: 't' })).delivered, false)
})

test('whatsapp webhook parser keeps only text messages', () => {
  const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P1' }, contacts: [{ wa_id: '9230012345', profile: { name: 'Ali' } }], messages: [
    { id: 'wamid.1', from: '9230012345', timestamp: '1700000000', type: 'text', text: { body: ' price? ' } },
    { id: 'wamid.2', from: '9230012345', type: 'image' },
    { id: 'wamid.3', from: '9230012345', type: 'text', text: { body: '   ' } },
  ] } }] }] }
  const events = parseWhatsAppWebhook(body)
  assert.equal(events.length, 1)
  assert.equal(events[0].text, 'price?')
  assert.equal(events[0].senderName, 'Ali')
  assert.equal(events[0].timestamp, 1700000000000)
  assert.deepEqual(parseWhatsAppWebhook({ object: 'page' }), [])
})

test('whatsapp sendText needs a confirmed message id', async () => {
  assert.deepEqual(await new WhatsAppClient('t', 'P1', ok({ messages: [{ id: 'wamid.9' }] })).sendText('923001', 'hi'), { id: 'wamid.9' })
  await assert.rejects(new WhatsAppClient('t', 'P1', ok({ messages: [] })).sendText('923001', 'hi'))
  await assert.rejects(new WhatsAppClient('t', 'P1', ok({ error: { message: 'no' } }, 400)).sendText('923001', 'hi'))
})

test('tiktok photo post needs publish_id and surfaces errors', async () => {
  const good = new TikTokClient('tok', ok({ data: { publish_id: 'v_pub_1' }, error: { code: 'ok' } }))
  assert.deepEqual(await good.publishPhotos({ title: 't', description: 'd', imageUrls: ['https://x/y.jpg'], privacyLevel: 'SELF_ONLY' }), { publishId: 'v_pub_1' })
  await assert.rejects(good.publishPhotos({ title: 't', description: 'd', imageUrls: [], privacyLevel: 'SELF_ONLY' }), TikTokError)
  const bad = new TikTokClient('tok', ok({ error: { code: 'access_token_invalid', message: 'bad token' } }, 401))
  await assert.rejects(bad.queryCreatorInfo(), /bad token/)
})

test('S3 presign matches the AWS documented example signature', () => {
  const url = presignGetUrl({ endpoint: 'https://s3.amazonaws.com', region: 'us-east-1', bucket: 'examplebucket', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', pathStyle: false }, 'test.txt', 86400, new Date('2013-05-24T00:00:00Z'))
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/)
  assert.ok(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?'))
})

test('S3 put signs the request and fails on non-2xx', async () => {
  const cfg = { endpoint: 'https://acc.r2.cloudflarestorage.com', region: 'auto', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK' }
  const signed = signRequest(cfg, 'PUT', 'proofs/a b.png', Buffer.from('x'), 'image/png', new Date('2026-01-01T00:00:00Z'))
  assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/20260101\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
  assert.ok(signed.url.endsWith('/b/proofs/a%20b.png'))
  await new S3Storage(cfg, async () => ({ ok: true, status: 200 })).put('k.png', Buffer.from('x'), 'image/png')
  await assert.rejects(new S3Storage(cfg, async () => ({ ok: false, status: 403 })).put('k.png', Buffer.from('x'), 'image/png'), /403/)
})

test('stripe signature check: valid, tampered, stale', () => {
  const secret = 'whsec_test_12345'
  const body = '{"id":"evt_1"}'
  const t = 1_800_000_000
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, 300, t * 1000), true)
  assert.equal(verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, secret, 300, t * 1000), false)
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, 300, (t + 1000) * 1000), false)
  assert.equal(verifyStripeSignature(body, undefined, secret), false)
})

test('only a paid checkout session settles an invoice', () => {
  const base = { type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 500000, currency: 'pkr', metadata: { invoice_id: 'inv-1' } } } }
  assert.deepEqual(settledInvoiceFromEvent(base), { invoiceId: 'inv-1', reference: 'stripe:pi_1', amountMinor: 500000, currency: 'PKR' })
  assert.equal(settledInvoiceFromEvent({ ...base, data: { object: { ...base.data.object, payment_status: 'unpaid' } } }), null)
  assert.equal(settledInvoiceFromEvent({ ...base, type: 'charge.refunded' }), null)
})

test('stripe checkout returns a url or throws', async () => {
  const input = { invoiceId: 'i', invoiceNumber: 'INV-1', description: 'Pro', amountMinor: 100, currency: 'PKR', customerEmail: 'a@b.c', successUrl: 'https://a/s', cancelUrl: 'https://a/c' }
  assert.equal((await new StripeProvider('sk_test_1234', ok({ id: 'cs_1', url: 'https://checkout.stripe.com/x' })).createCheckout(input)).url, 'https://checkout.stripe.com/x')
  await assert.rejects(new StripeProvider('sk_test_1234', ok({ error: { message: 'nope' } }, 400)).createCheckout(input), /nope/)
})

test('google service account JWT is a valid RS256 token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const jwt = buildServiceAccountJwt({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: privateKey }, 1000)
  const [h, c, s] = jwt.split('.')
  assert.equal(JSON.parse(Buffer.from(c, 'base64url').toString()).exp, 4600)
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')), true)
})

test('sheets cells cannot become formulas and sync needs Google confirmation', async () => {
  assert.equal(safeCell('=HYPERLINK("x")'), `'=HYPERLINK("x")`)
  assert.equal(safeCell(12), '12')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const calls: string[] = []
  const fake = async (url: string) => {
    calls.push(url)
    if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'a' }) }
    if (url.includes(':clear')) return { ok: true, status: 200, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ updatedRows: 3 }) }
  }
  const client = new GoogleSheetsClient({ client_email: 'sa@x', private_key: privateKey }, fake)
  assert.deepEqual(await client.replaceTab('SID', 'Orders', ['a'], [['1'], ['2']]), { rows: 2 })
  assert.equal(calls.length, 3)
})

test('ocr output is never marked verified', async () => {
  const r = await ocrImageText({ baseUrl: 'https://x', apiKey: 'k', model: 'm', contentType: 'image/png', dataBase64: 'AAAA', fetchImpl: ok({ choices: [{ message: { content: 'Transaction ID: ABC123456 Rs. 1,150' } }] }) })
  assert.equal(r.verified, false)
  assert.equal(r.extracted.transactionId, 'ABC123456')
  assert.equal(r.extracted.amount, 1150)
  await assert.rejects(ocrImageText({ baseUrl: 'https://x', apiKey: 'k', model: 'm', contentType: 'image/png', dataBase64: 'AAAA', fetchImpl: ok({}, 500) }))
})
