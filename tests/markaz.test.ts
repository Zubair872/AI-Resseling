import assert from 'node:assert/strict'
import test from 'node:test'
import { extractProductLinks, guessCategory, isMarkazUrl, parsePkr, parseProductPage, scrapeMarkaz, type FetchLike } from '../api/markaz.js'

const listing = `<html><body>
<a href="/shop/product/blue-idea-gun-massager-9-massage-head/780446"><img alt="x" src="https://cdn.example.com/a.jpg"/>PKR 3,500</a>
<a href="https://www.markaz.app/china/gh570-mini-wireless-bluetooth-earphones/889851842269?ref=1">earbuds</a>
<a href="/shop/product/blue-idea-gun-massager-9-massage-head/780446#reviews">dup</a>
<a href="/shop/home-page/Electronics/page-2">Next</a></body></html>`

const productLd = `<html><head><title>Blue idea Gun Massager | Markaz</title>
<meta property="og:image" content="https://cdn.example.com/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Blue idea Gun Massager 9 Massage Head","image":["https://cdn.example.com/p1.jpg"],"description":"Handheld massager","offers":{"@type":"Offer","price":"3500","priceCurrency":"PKR"},"aggregateRating":{"ratingValue":"4.6","reviewCount":"120"}}</script></head><body><h1>Blue idea Gun Massager 9 Massage Head</h1><p>Only 5 left</p></body></html>`

const productPlain = `<html><head><title>LED USB Light - Markaz</title><meta property="og:title" content="LED USB Light | Markaz"><meta property="og:image" content="/img/led.jpg"></head><body><h1>LED USB Light</h1><span>PKR 350</span><span>PKR 9,999</span><a href="/shop/Men/Electronics">x</a></body></html>`

const nextData = `<html><head><title>x</title></head><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"title":"Mini Camera 5","sellingPrice":1569,"images":[{"url":"https://cdn.example.com/cam.jpg"}],"description":"<p>tiny cam</p>"}}}}</script></body></html>`

test('parsePkr reads rupee formats', () => {
  assert.equal(parsePkr('PKR 3,500'), 3500)
  assert.equal(parsePkr('Rs. 524'), 524)
  assert.equal(parsePkr('nothing'), null)
})

test('only https markaz hosts are allowed', () => {
  assert.equal(isMarkazUrl('https://www.markaz.app/shop/x'), true)
  assert.equal(isMarkazUrl('http://www.markaz.app/shop/x'), false)
  assert.equal(isMarkazUrl('https://evil.com/markaz.app'), false)
  assert.equal(isMarkazUrl('https://markaz.app.evil.com/x'), false)
})

test('extractProductLinks finds, absolutizes and de-duplicates links', () => {
  const links = extractProductLinks(listing)
  assert.deepEqual(links, ['https://www.markaz.app/shop/product/blue-idea-gun-massager-9-massage-head/780446', 'https://www.markaz.app/china/gh570-mini-wireless-bluetooth-earphones/889851842269'])
})

test('product page: JSON-LD gives name, price, image, rating, stock', () => {
  const { product } = parseProductPage(productLd, 'https://www.markaz.app/shop/product/blue-idea-gun-massager-9-massage-head/780446')
  assert.ok(product)
  assert.equal(product.name, 'Blue idea Gun Massager 9 Massage Head')
  assert.equal(product.wholesalePrice, 3500)
  assert.equal(product.imageUrl, 'https://cdn.example.com/p1.jpg')
  assert.equal(product.rating, 4.6)
  assert.equal(product.reviewCount, 120)
  assert.equal(product.stockLeft, 5)
  assert.equal(product.markazId, '780446')
})

test('product page: falls back to OG tags, h1 and the first PKR amount', () => {
  const { product } = parseProductPage(productPlain, 'https://www.markaz.app/shop/product/led-usb-light/1')
  assert.ok(product)
  assert.equal(product.name, 'LED USB Light')
  assert.equal(product.wholesalePrice, 350)
  assert.equal(product.imageUrl, 'https://www.markaz.app/img/led.jpg')
})

test('product page: reads __NEXT_DATA__', () => {
  const { product } = parseProductPage(nextData, 'https://www.markaz.app/shop/product/mini-camera-5/2')
  assert.ok(product)
  assert.equal(product.name, 'Mini Camera 5')
  assert.equal(product.wholesalePrice, 1569)
  assert.equal(product.imageUrl, 'https://cdn.example.com/cam.jpg')
  assert.equal(product.description, 'tiny cam')
})

test('product page with no price reports what is missing instead of guessing', () => {
  const result = parseProductPage('<html><head><title>x</title></head><body><h1>Thing</h1></body></html>', 'https://www.markaz.app/shop/product/thing/3')
  assert.equal(result.product, null)
  assert.ok(result.missing.includes('price'))
})

test('guessCategory maps words to catalog categories', () => {
  assert.equal(guessCategory('Mobile Accessories'), 'Mobile Accessories')
  assert.equal(guessCategory('Cosmetics'), 'Beauty')
  assert.equal(guessCategory('zzz'), 'Other')
})

function fakeSite(): FetchLike {
  const pages: Record<string, string> = {
    'https://www.markaz.app/shop/home-page/Electronics': listing,
    'https://www.markaz.app/shop/product/blue-idea-gun-massager-9-massage-head/780446': productLd,
    'https://www.markaz.app/china/gh570-mini-wireless-bluetooth-earphones/889851842269': '<html><body>broken</body></html>',
  }
  return async (url) => (pages[url] ? { ok: true, status: 200, text: async () => pages[url] } : { ok: false, status: 404, text: async () => '' })
}

test('scrapeMarkaz reads a category, keeps good products and lists failures', async () => {
  const result = await scrapeMarkaz({ url: 'https://www.markaz.app/shop/home-page/Electronics', limit: 5, delayMs: 0, fetchImpl: fakeSite() })
  assert.equal(result.linksFound, 2)
  assert.equal(result.products.length, 1)
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0].reason, /missing/)
})

test('scrapeMarkaz skips products already in the catalog and refuses other sites', async () => {
  const result = await scrapeMarkaz({ url: 'https://www.markaz.app/shop/home-page/Electronics', limit: 5, delayMs: 0, fetchImpl: fakeSite(), skipIds: new Set(['780446']) })
  assert.equal(result.products.length, 0)
  await assert.rejects(() => scrapeMarkaz({ url: 'https://example.com/shop', limit: 1, fetchImpl: fakeSite() }), /markaz\.app/)
})

test('scrapeMarkaz stops when Markaz blocks and says why', async () => {
  const blocked: FetchLike = async () => ({ ok: false, status: 403, text: async () => '' })
  await assert.rejects(() => scrapeMarkaz({ url: 'https://www.markaz.app/shop/home-page/Electronics', limit: 3, delayMs: 0, fetchImpl: blocked }), /refused/)
})
