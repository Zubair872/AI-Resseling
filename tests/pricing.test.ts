import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePrice } from '../api/pricing.js'

test('calculates fixed-profit selling price and net profit', () => {
  assert.deepEqual(calculatePrice({ wholesalePrice: 1000, profitAmount: 150 }), {
    sellingPrice: 1150,
    paymentFee: 0,
    netProfit: 150,
  })
})

test('accounts for shipping, payment fee, and discount', () => {
  const result = calculatePrice({
    wholesalePrice: 1000,
    profitPercent: 20,
    shippingCost: 100,
    paymentFeePercent: 2,
    discount: 50,
  })
  assert.equal(result.sellingPrice, 1276)
  assert.equal(result.netProfit, 150)
})
