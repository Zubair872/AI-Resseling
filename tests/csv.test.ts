import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProductCsv } from '../api/csv.js'

test('parses valid product CSV rows', () => {
  const rows = parseProductCsv('name,category,wholesale_price,selling_price,stock\nLamp,Home & Kitchen,1000,1150,5')
  assert.deepEqual(rows[0], { name: 'Lamp', category: 'Home & Kitchen', wholesalePrice: 1000, sellingPrice: 1150, stock: 5 })
})

test('rejects invalid product CSV rows', () => {
  assert.throws(() => parseProductCsv('name,category,wholesale_price,selling_price,stock\nLamp,Beauty,not-a-number,1150,-1'), /Invalid product data/)
})
