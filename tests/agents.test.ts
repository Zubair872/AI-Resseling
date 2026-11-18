import assert from 'node:assert/strict'
import test from 'node:test'
import { canAutoApply, classifyProduct, parsePaymentText, suggestPrice, validateImageBase64 } from '../api/agents.js'

test('classification maps products to strict categories and flags gaps', () => {
  assert.equal(classifyProduct({ name: 'MagSafe Power Bank 10000mAh' }).category, 'Mobile Accessories')
  assert.equal(classifyProduct({ name: 'Glow Vitamin C Serum' }).category, 'Beauty')
  assert.equal(classifyProduct({ name: 'Mystery gadget' }).category, 'Other')
  const r = classifyProduct({ name: 'Football size 5' })
  assert.equal(r.category, 'Sports')
  assert.ok(r.missing.includes('description') && r.missing.includes('image'))
  assert.deepEqual(classifyProduct({ name: 'Replica watch' }).restrictedFlags, ['replica'])
  assert.deepEqual(classifyProduct({ name: 'Scunthorpe guns' }).restrictedFlags, [])
})

test('autonomy: high risk actions are never automatic', () => {
  for (const mode of ['manual', 'approval', 'hybrid', 'full'] as const) assert.equal(canAutoApply(mode, 'high'), false)
  assert.equal(canAutoApply('manual', 'low'), false)
  assert.equal(canAutoApply('approval', 'low'), false)
  assert.equal(canAutoApply('hybrid', 'low'), true)
  assert.equal(canAutoApply('full', 'low'), true)
})

test('price suggestion: default Rs.150, percent and shipping', () => {
  assert.equal(suggestPrice({ wholesalePrice: 1000 }).sellingPrice, 1150)
  assert.equal(suggestPrice({ wholesalePrice: 1000, profitPercent: 20, shippingCost: 100 }).sellingPrice, 1300)
  assert.equal(suggestPrice({ wholesalePrice: 1000, profitAmount: 100 }).sellingPrice, 1100)
})

test('payment text parsing never claims verification', () => {
  const r = parsePaymentText('Easypaisa  Transaction ID: 12345678901  Rs. 2,450.00 sent to 0300')
  assert.equal(r.transactionId, '12345678901')
  assert.equal(r.amount, 2450)
  assert.equal(r.verified, false)
  const empty = parsePaymentText('hello')
  assert.equal(empty.transactionId, null)
  assert.ok(empty.warnings.length >= 3)
})

test('image validation checks type, base64 and magic bytes', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]).toString('base64')
  assert.equal(validateImageBase64(png, 'image/png').ok, true)
  assert.equal(validateImageBase64(png, 'image/jpeg').ok, false)
  assert.equal(validateImageBase64(png, 'image/gif').ok, false)
  assert.equal(validateImageBase64('not base64!!', 'image/png').ok, false)
  assert.equal(validateImageBase64(Buffer.from('<script>alert(1)</script>').toString('base64'), 'image/png').ok, false)
})
