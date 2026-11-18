// Purpose: read products from Markaz's PUBLIC web pages (markaz.app) so you do not have to type them in.
// What it does: finds product links on a category/listing page, opens each product page, reads name, price, image (JSON-LD, OG tags,
// __NEXT_DATA__, then page text) and returns candidates. It is slow on purpose (one page at a time, a pause between pages) and only talks to markaz.app.
// Honest limits: written without access to the live site from the authoring environment, so it is tested on sample HTML only.
// If Markaz changes its pages or blocks the request, the result says exactly what was missing instead of guessing.
export class MarkazError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'MarkazError'
  }
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export type MarkazProduct = {
  name: string
  wholesalePrice: number
  imageUrl: string | null
  description: string | null
  productUrl: string
  markazId: string
  kind: 'markaz' | 'china'
  category: string | null
  stockLeft: number | null
  rating: number | null
  reviewCount: number | null
  source: string[]
}

export const MARKAZ_HOSTS = ['markaz.app', 'www.markaz.app']
const MAX_HTML = 3_000_000

export function isMarkazUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && MARKAZ_HOSTS.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function isProductUrl(value: string) {
  try {
    return /^\/(shop\/product|china)\/[^/]+\/\d+\/?$/.test(new URL(value).pathname)
  } catch {
    return false
  }
}

export function productIdFromUrl(value: string) {
  try {
    const match = new URL(value).pathname.match(/^\/(shop\/product|china)\/[^/]+\/(\d+)\/?$/)
    return match ? { id: match[2], kind: (match[1] === 'china' ? 'china' : 'markaz') as 'markaz' | 'china' } : null
  } catch {
    return null
  }
}

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
}

const clean = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim()

export function parsePkr(text: string): number | null {
  const match = text.match(/(?:PKR|Rs\.?|₨)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

// Collects product links from a listing page (absolute or relative links, plain or inside JSON).
export function extractProductLinks(html: string, baseUrl = 'https://www.markaz.app/') {
  const found = new Map<string, string>()
  const pattern = /(?:https?:)?(?:\/\/(?:www\.)?markaz\.app)?\/(shop\/product|china)\/([A-Za-z0-9%_.~-]+)\/(\d+)(?=[\\"'\s?#<>)/]|$)/g
  const text = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/')
  for (const match of text.matchAll(pattern)) {
    const absolute = new URL(`/${match[1]}/${match[2]}/${match[3]}`, baseUrl).toString()
    if (!found.has(match[3])) found.set(match[3], absolute)
  }
  return [...found.values()]
}

function metaContent(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const name = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    if (name === key.toLowerCase()) {
      const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1]
      if (content !== undefined) return clean(content)
    }
  }
  return null
}

function jsonBlocks(html: string, matcher: RegExp) {
  const out: unknown[] = []
  for (const match of html.matchAll(matcher)) {
    try {
      out.push(JSON.parse(match[1].trim()))
    } catch {
      // ignore broken JSON blocks
    }
  }
  return out
}

function flattenLd(value: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) value.forEach((item) => flattenLd(item, out))
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    out.push(record)
    if (record['@graph']) flattenLd(record['@graph'], out)
  }
  return out
}

const asNumber = (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN
  return Number.isFinite(n) ? n : null
}

function firstImage(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(firstImage).find(Boolean) ?? null
  if (value && typeof value === 'object') return firstImage((value as Record<string, unknown>).url ?? (value as Record<string, unknown>).contentUrl)
  return null
}

type Partial_ = { name?: string; price?: number; image?: string; description?: string; rating?: number; reviews?: number; stockLeft?: number }

function fromJsonLd(html: string): Partial_ {
  const result: Partial_ = {}
  const blocks = jsonBlocks(html, /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const node of blocks.flatMap((block) => flattenLd(block))) {
    const type = node['@type']
    const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'))
    if (!isProduct) continue
    if (typeof node.name === 'string') result.name = clean(node.name)
    const image = firstImage(node.image)
    if (image) result.image = image
    if (typeof node.description === 'string') result.description = clean(node.description)
    const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers
    if (offers && typeof offers === 'object') {
      const offer = offers as Record<string, unknown>
      const price = asNumber(offer.price) ?? asNumber(offer.lowPrice)
      if (price && price > 0) result.price = price
    }
    const rating = node.aggregateRating as Record<string, unknown> | undefined
    if (rating) {
      const value = asNumber(rating.ratingValue)
      const count = asNumber(rating.reviewCount) ?? asNumber(rating.ratingCount)
      if (value !== null && value <= 5) result.rating = value
      if (count !== null) result.reviews = Math.floor(count)
    }
    break
  }
  return result
}

const priceKeys = ['sellingPrice', 'resellerPrice', 'salePrice', 'discountedPrice', 'price', 'minPrice', 'wholesalePrice']
const imageKeys = ['image', 'imageUrl', 'thumbnail', 'thumbnailUrl', 'mainImage', 'images', 'photos', 'media']

function fromNextData(html: string): Partial_ {
  const blocks = jsonBlocks(html, /<script[^>]+id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)
  const result: Partial_ = {}
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > 9 || !node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.slice(0, 40).some((item) => visit(item, depth + 1))
    const record = node as Record<string, unknown>
    const name = record.name ?? record.title ?? record.productName
    const priceKey = priceKeys.find((key) => asNumber(record[key]) !== null && (asNumber(record[key]) as number) > 0)
    if (typeof name === 'string' && name.length > 3 && priceKey) {
      result.name = clean(name)
      result.price = asNumber(record[priceKey]) as number
      const imageKey = imageKeys.find((key) => firstImage(record[key]))
      if (imageKey) result.image = firstImage(record[imageKey]) as string
      if (typeof record.description === 'string') result.description = clean(record.description.replace(/<[^>]+>/g, ' '))
      const rating = asNumber(record.rating ?? record.averageRating)
      if (rating !== null && rating <= 5) result.rating = rating
      const count = asNumber(record.reviewCount ?? record.reviewsCount ?? record.ratingCount)
      if (count !== null) result.reviews = Math.floor(count)
      return true
    }
    return Object.values(record).some((value) => visit(value, depth + 1))
  }
  for (const block of blocks) if (visit(block, 0)) break
  return result
}

function visibleText(html: string) {
  return clean(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
}

function absoluteUrl(value: string | undefined | null, base: string) {
  if (!value) return null
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function pickImage(html: string, base: string) {
  const og = absoluteUrl(metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image'), base)
  if (og && !/logo|favicon|placeholder/i.test(og)) return og
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i)?.[1]
    const url = absoluteUrl(src, base)
    if (url && /\.(jpe?g|png|webp)(\?|$)/i.test(url) && !/logo|icon|favicon|sprite|avatar|placeholder|banner/i.test(url)) return url
  }
  return null
}

export function parseProductPage(html: string, url: string): { product: MarkazProduct | null; missing: string[]; source: string[] } {
  const ids = productIdFromUrl(url)
  const source: string[] = []
  const ld = fromJsonLd(html)
  if (Object.keys(ld).length) source.push('json-ld')
  const next = fromNextData(html)
  if (Object.keys(next).length) source.push('next-data')

  const ogTitle = metaContent(html, 'og:title')
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const stripSite = (value: string) => clean(value.replace(/\s*[|\-–—]\s*(?:Markaz|markaz\.app)[^|]*$/i, ''))
  const metaName = [ogTitle, h1 ? clean(h1.replace(/<[^>]+>/g, ' ')) : null, titleTag ? clean(titleTag) : null].find((value) => value && value.length > 2)
  if (!ld.name && !next.name && metaName) source.push('page-title')

  const text = visibleText(html)
  const metaPrice = asNumber(metaContent(html, 'product:price:amount') ?? metaContent(html, 'og:price:amount') ?? metaContent(html, 'price'))
  const textPrice = parsePkr(text)
  if (!ld.price && !next.price) source.push(metaPrice ? 'meta-price' : textPrice ? 'text-price' : 'no-price')

  const name = ld.name ?? next.name ?? (metaName ? stripSite(metaName) : undefined)
  const price = ld.price ?? next.price ?? (metaPrice && metaPrice > 0 ? metaPrice : undefined) ?? textPrice ?? undefined
  const image = absoluteUrl(ld.image ?? next.image ?? null, url) ?? pickImage(html, url)
  const description = ld.description ?? next.description ?? metaContent(html, 'og:description') ?? metaContent(html, 'description') ?? null
  const left = text.match(/Only\s+(\d+)\s+left/i)
  const crumbs = [...html.matchAll(/\/shop\/(?:home-page\/)?([A-Za-z0-9%+ _-]+)(?:\/([A-Za-z0-9%+ _-]+))?/g)].map((m) => decodeURIComponent(m[2] ?? m[1]).replace(/\+/g, ' '))
  const missing: string[] = []
  if (!name) missing.push('name')
  if (!price) missing.push('price')
  if (!image) missing.push('image')
  if (!ids) missing.push('product id in link')
  if (!name || !price || !ids) return { product: null, missing, source }
  return {
    product: {
      name: name.slice(0, 180),
      wholesalePrice: price,
      imageUrl: image,
      description: description ? description.slice(0, 2000) : null,
      productUrl: url,
      markazId: ids.id,
      kind: ids.kind,
      category: crumbs[0] ?? null,
      stockLeft: left ? Number(left[1]) : null,
      rating: ld.rating ?? next.rating ?? null,
      reviewCount: ld.reviews ?? next.reviews ?? null,
      source,
    },
    missing,
    source,
  }
}

const categoryWords: [RegExp, string][] = [
  [/mobile|phone|charger|earphone|earbud|airpod|cable/i, 'Mobile Accessories'],
  [/electronic|gadget|camera|speaker|watch|light|led/i, 'Electronics'],
  [/cosmetic|beauty|skin|makeup|perfume|hair|serum/i, 'Beauty'],
  [/jewel|ring|necklace|bracelet|earring/i, 'Jewellery'],
  [/sport|fitness|gym|yoga/i, 'Sports'],
  [/kitchen|home|furniture|decor|bottle|tool/i, 'Home & Kitchen'],
  [/baby|kid|toy/i, 'Baby Products'],
  [/grocery|food|snack/i, 'Grocery'],
  [/cloth|fashion|shirt|dress|shoe|bag|wear|kurta|men|women/i, 'Fashion'],
]
export function guessCategory(...hints: (string | null | undefined)[]) {
  const text = hints.filter(Boolean).join(' ')
  return categoryWords.find(([pattern]) => pattern.test(text))?.[1] ?? 'Other'
}

export async function fetchMarkazHtml(url: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  if (!isMarkazUrl(url)) throw new MarkazError('Only https://www.markaz.app links are allowed')
  let response
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitlyLocal/1.0; personal catalog tool)', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.8' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new MarkazError('Could not reach markaz.app. Check your internet connection.')
  }
  if (response.status === 403 || response.status === 429 || response.status === 503) throw new MarkazError(`Markaz refused the request (HTTP ${response.status}). It may be blocking automatic access; wait and try fewer products, or add products by link one at a time.`, response.status)
  if (!response.ok) throw new MarkazError(`Markaz returned HTTP ${response.status} for this page`, response.status)
  const html = (await response.text()).slice(0, MAX_HTML)
  if (/just a moment|cf-chl|attention required/i.test(html.slice(0, 4000)) && !/\/shop\/product\//.test(html)) throw new MarkazError('Markaz showed a bot-check page instead of products. Try again later or add products one by one.')
  return html
}

export type ScrapeResult = {
  products: MarkazProduct[]
  failures: { url: string; reason: string }[]
  linksFound: number
  notes: string[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// url = one product link, or a category/listing link. limit = how many products to read (max 30 per run).
export async function scrapeMarkaz(options: { url: string; limit: number; pages?: number; delayMs?: number; fetchImpl?: FetchLike; skipIds?: Set<string> }): Promise<ScrapeResult> {
  const { url, fetchImpl, delayMs = 800 } = options
  const limit = Math.max(1, Math.min(Math.floor(options.limit), 30))
  const result: ScrapeResult = { products: [], failures: [], linksFound: 0, notes: [] }
  if (!isMarkazUrl(url)) throw new MarkazError('Paste a link that starts with https://www.markaz.app/')
  let links: string[]
  if (isProductUrl(url)) links = [url]
  else {
    const listing = new Set<string>()
    const pages = Math.max(1, Math.min(options.pages ?? 1, 5))
    const freshCount = () => [...listing].filter((link) => !options.skipIds?.has(productIdFromUrl(link)?.id ?? '')).length
    for (let page = 1; page <= pages && freshCount() < limit * 2; page += 1) {
      const pageUrl = page === 1 ? url : `${url.replace(/\/page-\d+\/?$/, '').replace(/\/$/, '')}/page-${page}`
      let html: string
      try {
        html = await fetchMarkazHtml(pageUrl, fetchImpl)
      } catch (error) {
        if (page === 1) throw error
        result.notes.push(`Page ${page} could not be read: ${error instanceof Error ? error.message : 'error'}`)
        break
      }
      const before = listing.size
      extractProductLinks(html).forEach((link) => listing.add(link))
      if (listing.size === before) break
      if (page < pages) await sleep(delayMs)
    }
    links = [...listing]
    if (links.length === 0) throw new MarkazError('No product links were found on that page. Open a category page on markaz.app (or a single product page) and paste its link. If the page loads products with JavaScript only, paste product links directly.')
  }
  result.linksFound = links.length
  const fresh = links.filter((link) => !options.skipIds?.has(productIdFromUrl(link)?.id ?? ''))
  if (fresh.length < links.length) result.notes.push(`${links.length - fresh.length} product(s) skipped because they are already in your catalog.`)
  for (const link of fresh.slice(0, limit)) {
    if (result.products.length + result.failures.length > 0) await sleep(delayMs)
    try {
      const html = await fetchMarkazHtml(link, fetchImpl)
      const parsed = parseProductPage(html, link)
      if (!parsed.product) result.failures.push({ url: link, reason: `Could not read: ${parsed.missing.join(', ')} missing` })
      else {
        if (!parsed.product.imageUrl) result.notes.push(`${parsed.product.name}: no image found (Instagram/Pinterest-style posts need one).`)
        result.products.push(parsed.product)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      result.failures.push({ url: link, reason })
      if (error instanceof MarkazError && (error.status === 403 || error.status === 429)) break
    }
  }
  return result
}
