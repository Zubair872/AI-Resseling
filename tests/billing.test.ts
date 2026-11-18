// Pure billing and team rule tests (no database needed).
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCoupon, canAssignRole, canManageMember, createReferralCode, downgradeBlockers, formatInvoiceNumber, nextPeriodEnd, planPrice } from '../api/billing.js'

const base = { percent_off: null, amount_off: null, plan_code: null, max_redemptions: null, redeemed_count: 0, expires_at: null, active: true }

test('planPrice picks monthly or annual price', () => {
  const plan = { code: 'professional', monthly_price: '2999.00', annual_price: '29990' }
  assert.equal(planPrice(plan, 'monthly'), 2999)
  assert.equal(planPrice(plan, 'annual'), 29990)
})

test('coupon: percent and fixed amounts, never below zero', () => {
  assert.deepEqual(applyCoupon(2999, 'professional', { ...base, percent_off: 10 }), { ok: true, discount: 299.9, total: 2699.1 })
  assert.deepEqual(applyCoupon(1000, 'professional', { ...base, amount_off: 5000 }), { ok: true, discount: 1000, total: 0 })
  assert.deepEqual(applyCoupon(1000, 'professional', { ...base, percent_off: 100 }), { ok: true, discount: 1000, total: 0 })
})

test('coupon: rejects missing, inactive, expired, used up and wrong plan', () => {
  const now = new Date('2026-11-04T00:00:00Z')
  assert.equal(applyCoupon(100, 'business', null, now).ok, false)
  assert.equal(applyCoupon(100, 'business', { ...base, percent_off: 10, active: false }, now).ok, false)
  assert.equal(applyCoupon(100, 'business', { ...base, percent_off: 10, expires_at: '2026-11-03T00:00:00Z' }, now).ok, false)
  assert.equal(applyCoupon(100, 'business', { ...base, percent_off: 10, max_redemptions: 2, redeemed_count: 2 }, now).ok, false)
  assert.equal(applyCoupon(100, 'business', { ...base, percent_off: 10, plan_code: 'professional' }, now).ok, false)
  assert.equal(applyCoupon(100, 'business', { ...base, percent_off: 10, max_redemptions: 2, redeemed_count: 1, expires_at: '2026-12-01T00:00:00Z' }, now).ok, true)
})

test('period end moves one month or one year', () => {
  assert.equal(nextPeriodEnd(new Date('2026-11-04T10:00:00Z'), 'monthly').toISOString(), '2026-12-04T10:00:00.000Z')
  assert.equal(nextPeriodEnd(new Date('2026-11-04T10:00:00Z'), 'annual').toISOString(), '2027-11-04T10:00:00.000Z')
})

test('invoice numbers are padded and dated', () => {
  assert.equal(formatInvoiceNumber(42, new Date('2026-11-04T00:00:00Z')), 'INV-202611-000042')
})

test('downgrade is blocked while usage is above the new limits', () => {
  const limits = { product_limit: 100, social_account_limit: 2, team_member_limit: 1 }
  assert.deepEqual(downgradeBlockers({ products: 50, socialAccounts: 2, teamMembers: 1 }, limits), [])
  assert.equal(downgradeBlockers({ products: 500, socialAccounts: 5, teamMembers: 3 }, limits).length, 3)
})

test('role rules: only a higher role can hand out or manage a role', () => {
  assert.equal(canAssignRole('owner', 'admin'), true)
  assert.equal(canAssignRole('admin', 'admin'), false)
  assert.equal(canAssignRole('admin', 'manager'), true)
  assert.equal(canAssignRole('owner', 'owner'), false)
  assert.equal(canAssignRole('owner', 'super_admin'), false)
  assert.equal(canManageMember('admin', 'owner'), false)
  assert.equal(canManageMember('admin', 'staff'), true)
  assert.equal(canManageMember('manager', 'admin'), false)
})

test('referral codes are 8 unambiguous characters', () => {
  const code = createReferralCode()
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.notEqual(code, createReferralCode())
})
