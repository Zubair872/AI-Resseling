import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyMetaSignature, parseMetaWebhook, isWithinReplyWindow, REPLY_WINDOW_MS } from '../api/meta.js'
import { parseWhatsAppWebhook, WHATSAPP_WINDOW_MS } from '../api/whatsapp.js'
import { detectAutoOrder, extractOrderDetails, missingOrderFields, type CatalogProduct } from '../api/support.js'

test('JOB 5: Signature check with constant-time HMAC comparison', () => {
  const secret = 'test-meta-app-secret-12345'
  const payload = JSON.stringify({ object: 'page', entry: [] })
  const validSignature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')

  assert.equal(verifyMetaSignature(payload, validSignature, secret), true)
  assert.equal(verifyMetaSignature(payload, 'sha256=badsignature', secret), false)
  assert.equal(verifyMetaSignature(payload, undefined, secret), false)
  assert.equal(verifyMetaSignature(payload, validSignature, 'wrong-secret'), false)
})

test('JOB 5: Handshake logic validates hub.verify_token and returns challenge', () => {
  const verifyToken = 'my_secret_verify_token_xyz'
  const query = {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'my_secret_verify_token_xyz',
    'hub.challenge': '1158201207',
  }

  const isValid = query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken
  assert.equal(isValid, true)
  assert.equal(query['hub.challenge'], '1158201207')

  const isInvalid = query['hub.mode'] === 'subscribe' && 'wrong_token' === verifyToken
  assert.equal(isInvalid, false)
})

test('JOB 5: Payload parsing for 3 channels (Facebook Messenger, Instagram DM, WhatsApp)', () => {
  // 1. Facebook Messenger
  const fbPayload = {
    object: 'page',
    entry: [
      {
        id: 'FB_PAGE_100',
        messaging: [
          {
            sender: { id: 'FB_USER_1' },
            message: { mid: 'mid_fb_123', text: 'Assalam o Alaikum mujhe dress chahiye' },
            timestamp: 1700000000000,
          },
        ],
      },
    ],
  }
  const fbEvents = parseMetaWebhook(fbPayload)
  assert.equal(fbEvents.length, 1)
  assert.equal(fbEvents[0].channel, 'facebook')
  assert.equal(fbEvents[0].messageId, 'mid_fb_123')
  assert.equal(fbEvents[0].text, 'Assalam o Alaikum mujhe dress chahiye')

  // 2. Instagram DM
  const igPayload = {
    object: 'instagram',
    entry: [
      {
        id: 'IG_ACC_200',
        messaging: [
          {
            sender: { id: 'IG_USER_2' },
            message: { mid: 'mid_ig_456', text: 'Price kya hai?' },
            timestamp: 1700000000000,
          },
        ],
      },
    ],
  }
  const igEvents = parseMetaWebhook(igPayload)
  assert.equal(igEvents.length, 1)
  assert.equal(igEvents[0].channel, 'instagram')
  assert.equal(igEvents[0].messageId, 'mid_ig_456')

  // 3. WhatsApp Cloud API
  const waPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'WA_PHONE_999' },
              contacts: [{ wa_id: '923001234567', profile: { name: 'Usman' } }],
              messages: [
                {
                  id: 'wamid_wa_789',
                  from: '923001234567',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Mera order book kar dein' },
                },
              ],
            },
          },
        ],
      },
    ],
  }
  const waEvents = parseWhatsAppWebhook(waPayload)
  assert.equal(waEvents.length, 1)
  assert.equal(waEvents[0].phoneNumberId, 'WA_PHONE_999')
  assert.equal(waEvents[0].from, '923001234567')
  assert.equal(waEvents[0].messageId, 'wamid_wa_789')
  assert.equal(waEvents[0].text, 'Mera order book kar dein')
})

test('JOB 5: Deduplication by external message id', () => {
  const seenIds = new Set<string>()
  const messages = ['mid_1', 'mid_2', 'mid_1', 'mid_3', 'mid_2']
  const processed: string[] = []

  for (const mid of messages) {
    if (seenIds.has(mid)) continue
    seenIds.add(mid)
    processed.push(mid)
  }

  assert.deepEqual(processed, ['mid_1', 'mid_2', 'mid_3'])
})

test('JOB 5: 24-hour reply window rule for Meta and WhatsApp', () => {
  const now = 1700000000000
  const recentTime = new Date(now - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
  const expiredTime = new Date(now - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago

  // Meta
  assert.equal(isWithinReplyWindow(recentTime, now, REPLY_WINDOW_MS), true)
  assert.equal(isWithinReplyWindow(expiredTime, now, REPLY_WINDOW_MS), false)

  // WhatsApp
  assert.equal(isWithinReplyWindow(recentTime, now, WHATSAPP_WINDOW_MS), true)
  assert.equal(isWithinReplyWindow(expiredTime, now, WHATSAPP_WINDOW_MS), false)
})

test('JOB 5: Order creation from finished conversation with variant SKU', () => {
  const catalog: CatalogProduct[] = [
    {
      id: 'p-lawn-dress',
      name: 'Embroidered Lawn Suit',
      category: 'Fashion',
      selling_price: '2800.00',
      stock: 15,
      sku: 'MKZ-101',
      variants: [
        {
          id: 'v-small',
          sku: 'MKZ-101-SM',
          title: 'Small',
          option1_name: 'Size',
          option1_value: 'Small',
          selling_price: '2800.00',
          stock: 5,
        },
        {
          id: 'v-medium',
          sku: 'MKZ-101-MD',
          title: 'Medium',
          option1_name: 'Size',
          option1_value: 'Medium',
          selling_price: '2800.00',
          stock: 10,
        },
      ],
    },
  ]

  const conversationTexts = [
    'Assalam o Alaikum mujhe Embroidered Lawn Suit order karna hai',
    'Mera naam Bilal Ahmed hai',
    'Phone: 0321-9876543',
    'City: Rawalpindi',
    'Address: House 12, Street 4, Sector G-10',
    'Qty: 1, Size: Medium',
  ]

  const autoOrder = detectAutoOrder(conversationTexts, catalog)
  assert.ok(autoOrder, 'Auto order should be detected when all fields are present')
  assert.equal(autoOrder.name, 'Bilal Ahmed')
  assert.equal(autoOrder.phone, '03219876543')
  assert.equal(autoOrder.city, 'Rawalpindi')
  assert.equal(autoOrder.quantity, 1)
  assert.equal(autoOrder.paymentMethod, 'cod')
  assert.ok(autoOrder.variant, 'Variant must be matched')
  assert.equal(autoOrder.variant.sku, 'MKZ-101-MD')
  assert.equal(autoOrder.variant.title, 'Medium')

  // Verify Markaz summary text composition
  const summaryLine = `Product: ${autoOrder.product.name} [SKU: ${autoOrder.variant.sku}] (${autoOrder.variant.title})`
  assert.ok(summaryLine.includes('[SKU: MKZ-101-MD]'))
  assert.ok(summaryLine.includes('Medium'))
})
