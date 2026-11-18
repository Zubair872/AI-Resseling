import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseMarkazExport,
  detectLayout,
  extractRootSku,
  isChinaAdvancePayment,
  autoDetectMapping,
} from '../api/markazExport.js'

// Small synthetic test fixture: Shopify layout with 2 variants for 1 product
const syntheticShopifyCsv = `Handle,Title,Body (HTML),Vendor,Type,Tags,Option1 Name,Option1 Value,Variant SKU,Variant Price,Cost per item,Variant Inventory Qty,Image Src
aura-desk-lamp,Aura Desk Lamp,<p>LED lamp</p>,,Home & Kitchen,"lamps, desk",Color,White,MKZ-1001-1,1450,1100,20,https://cdn.example.com/lamp1.jpg
aura-desk-lamp,,,,,"lamps, desk",Color,Black,MKZ-1001-2,1450,1100,15,https://cdn.example.com/lamp2.jpg
`

// Small synthetic test fixture: WooCommerce layout
const syntheticWooCommerceCsv = `ID,Type,SKU,Name,Published,Regular price,Sale price,Categories,Images,Parent
200,simple,MKZ-2001-0,Wireless Earbuds,1,2200,2600,Electronics,https://cdn.example.com/buds.jpg,
`

// Small synthetic test fixture: China Advance Payment item
const syntheticChinaCsv = `Handle,Title,Type,Variant SKU,Cost per item,Variant Price,Image Src,Tags
smart-watch,Smart Watch Ultra,Electronics,MKZ-3001-1,3500,4200,https://cdn.example.com/watch.jpg,"china, advance payment only"
`

// Small synthetic test fixture: Missing cost column
const syntheticMissingCostCsv = `Handle,Title,Category,Variant SKU,Selling Price
bag-1,Leather Bag,Fashion,MKZ-4001,1500
`

test('detectLayout correctly identifies Shopify vs WooCommerce vs Generic', () => {
  assert.equal(detectLayout(['Handle', 'Title', 'Variant SKU', 'Variant Price', 'Cost per item']), 'shopify')
  assert.equal(detectLayout(['ID', 'Type', 'SKU', 'Name', 'Regular price', 'Sale price', 'Parent']), 'woocommerce')
  assert.equal(detectLayout(['Product Name', 'Cost', 'Price', 'SKU']), 'generic')
})

test('extractRootSku extracts MKZ-productId pattern correctly', () => {
  assert.equal(extractRootSku('MKZ-780446-1'), 'MKZ-780446')
  assert.equal(extractRootSku('mkz-12345-red-xl'), 'MKZ-12345')
  assert.equal(extractRootSku('CUSTOM-SKU-99'), 'CUSTOM-SKU-99')
})

test('isChinaAdvancePayment catches keywords', () => {
  assert.equal(isChinaAdvancePayment('China items need advance payment'), true)
  assert.equal(isChinaAdvancePayment('Normal COD available'), false)
})

test('Shopify CSV: groups variant rows into 1 product and collects all images', () => {
  const result = parseMarkazExport(syntheticShopifyCsv)
  assert.equal(result.layout, 'shopify')
  assert.equal(result.products.length, 1)
  const prod = result.products[0]
  assert.equal(prod.name, 'Aura Desk Lamp')
  assert.equal(prod.skuRoot, 'MKZ-1001')
  assert.equal(prod.wholesalePrice, 1100)
  assert.equal(prod.fileSellingPrice, 1450)
  assert.equal(prod.variants.length, 2)
  assert.equal(prod.variants[0].sku, 'MKZ-1001-1')
  assert.equal(prod.variants[0].option1Value, 'White')
  assert.equal(prod.variants[1].sku, 'MKZ-1001-2')
  assert.equal(prod.variants[1].option1Value, 'Black')
  assert.equal(prod.images.length, 2)
  assert.equal(prod.mainImageUrl, 'https://cdn.example.com/lamp1.jpg')
})

test('WooCommerce CSV: parsed successfully into grouped product', () => {
  const result = parseMarkazExport(syntheticWooCommerceCsv)
  assert.equal(result.layout, 'woocommerce')
  assert.equal(result.products.length, 1)
  const prod = result.products[0]
  assert.equal(prod.name, 'Wireless Earbuds')
  assert.equal(prod.wholesalePrice, 2200)
  assert.equal(prod.fileSellingPrice, 2600)
  assert.equal(prod.skuRoot, 'MKZ-2001')
})

test('China-sourced row is detected and flagged as isAdvancePayment', () => {
  const result = parseMarkazExport(syntheticChinaCsv)
  assert.equal(result.products.length, 1)
  assert.equal(result.products[0].isAdvancePayment, true)
})

test('Missing required column produces descriptive error message with available headers', () => {
  assert.throws(
    () => {
      parseMarkazExport(syntheticMissingCostCsv)
    },
    (err: Error) => {
      assert.ok(err.message.includes('Markaz Price'))
      assert.ok(err.message.includes('Handle, Title, Category, Variant SKU, Selling Price'))
      return true
    }
  )
})

test('Custom column mapping override works cleanly', () => {
  const customCsv = `ItemCode,ItemTitle,ItemCost,ResellerPrice
PROD-1,Canvas Shoes,1200,1600
`
  const result = parseMarkazExport(customCsv, {
    handle: 'ItemCode',
    name: 'ItemTitle',
    wholesalePrice: 'ItemCost',
    fileSellingPrice: 'ResellerPrice',
    sku: 'ItemCode',
  })
  assert.equal(result.products.length, 1)
  assert.equal(result.products[0].name, 'Canvas Shoes')
  assert.equal(result.products[0].wholesalePrice, 1200)
  assert.equal(result.products[0].fileSellingPrice, 1600)
})
