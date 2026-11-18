import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePublish } from '../api/scheduler.js'
import { checkLimit } from '../api/limits.js'
import { canTransition } from '../api/orderStatus.js'

const base = {
  account: { status: 'connected', platform: 'instagram', category: 'Sports', dailyLimit: 5, postedToday: 2 },
  product: { category: 'Sports', stock: 3, imageUrl: 'https://example.com/a.jpg' },
  draft: { status: 'approved', platform: 'instagram' },
  requireApproval: true,
}

test('valid publish passes', () => assert.equal(validatePublish(base).ok, true))
test('category mismatch is blocked', () => assert.ok(validatePublish({ ...base, product: { category: 'Beauty', stock: 3, imageUrl: 'https://example.com/a.jpg' } }).errors.includes('Product category does not match the account category')))
test('daily limit is never exceeded', () => assert.ok(validatePublish({ ...base, account: { ...base.account, postedToday: 5 } }).errors.includes('Daily posting limit reached')))
test('unapproved content and out-of-stock blocked', () => {
  const r = validatePublish({ ...base, draft: { status: 'draft', platform: 'instagram' }, product: { category: 'Sports', stock: 0, imageUrl: 'https://example.com/a.jpg' } })
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 2)
})
test('plan limits', () => {
  assert.equal(checkLimit(99, 100).allowed, true)
  assert.equal(checkLimit(100, 100).allowed, false)
  assert.equal(checkLimit(150, 100).remaining, 0)
})
test('order transitions', () => {
  assert.equal(canTransition('shipped', 'delivered'), true)
  assert.equal(canTransition('delivered', 'new'), false)
  assert.equal(canTransition('cancelled', 'processing'), false)
})
test('instagram and tiktok posts need a product image', () => {
  const r = validatePublish({ ...base, product: { category: 'Sports', stock: 3, imageUrl: null } })
  assert.ok(r.errors.includes('This platform needs a product image'))
  assert.equal(validatePublish({ ...base, account: { ...base.account, platform: 'facebook' }, draft: { status: 'approved', platform: 'facebook' }, product: { category: 'Sports', stock: 3, imageUrl: null } }).ok, true)
})
