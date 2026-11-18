// Purpose: turn a CSV that YOU exported (AliExpress affiliate/dropshipping export, Temu or Daraz product list, or any similar sheet)
// into reviewed product candidates. No scraping and no logging into marketplaces: only files you provide.
// Header names differ between exports and change over time, so columns are matched by many aliases and can be overridden by hand.
// The header aliases are NOT verified against a real export from each marketplace: always run the preview first.
import { classifyProduct } from './agents.js'
import { productCategories, type SourcingCandidate, type SourcingRules } from './sourcing.js'

export type Marketplace = 'aliexpress' | 'temu' | 'daraz'
export const marketplaces: Marketplace[] = ['aliexpress', 'temu', 'daraz']
export type FieldKey = 'name' | 'price' | 'originalPrice' | 'currency' | 'rating' | 'ratingPercent' | 'reviews' | 'sold' | 'image' | 'url' | 'category' | 'stock' | 'description' | 'externalId'
export const fieldKeys: FieldKey[] = ['name', 'price', 'originalPrice', 'currency', 'rating', 'ratingPercent', 'reviews', 'sold', 'image', 'url', 'category', 'stock', 'description', 'externalId']

const common: Record<FieldKey, string[]> = {
  name: ['productname', 'title', 'name', 'producttitle', 'itemname', 'productdesc', 'goodsname'],
  price: ['specialprice', 'saleprice', 'targetsaleprice', 'discountprice', 'currentprice', 'finalprice', 'sellingprice', 'price'],
  originalPrice: ['originalprice', 'targetoriginalprice', 'listprice', 'regularprice', 'marketprice'],
  currency: ['currency', 'targetcurrency', 'pricecurrency'],
  rating: ['rating', 'stars', 'starrating', 'averagerating', 'productrating', 'ratingscore'],
  ratingPercent: ['evaluaterate', 'positivefeedback', 'positiveratingrate', 'feedbackrate'],
  reviews: ['reviewcount', 'reviews', 'numberofreviews', 'ratingcount', 'totalreviews', 'feedbackcount', 'evaluations'],
  sold: ['soldcount', 'sold', 'volume', 'salesvolume', '30daysvolume', 'totalsold', 'itemssold', 'orders', 'orderscount', 'sales'],
  image: ['imageurl', 'productimageurl', 'mainimage', 'imagelink', 'image', 'images', 'picture', 'thumbnail'],
  url: ['producturl', 'productdetailurl', 'itemurl', 'productlink', 'detailurl', 'url', 'link'],
  category: ['categoryname', 'firstlevelcategoryname', 'secondlevelcategoryname', 'categorypath', 'category', 'producttype'],
  stock: ['availablestock', 'stock', 'quantity', 'inventory', 'qty'],
  description: ['description', 'productdescription', 'productdetail', 'details'],
  externalId: ['productid', 'itemid', 'goodsid', 'sellersku', 'sku', 'id'],
}

export type MarketplacePreset = { label: string; defaultCurrency: string; note: string }
export const marketplacePresets: Record<Marketplace, MarketplacePreset> = {
  aliexpress: { label: 'AliExpress', defaultCurrency: 'USD', note: 'Use an export from the AliExpress affiliate/dropshipping portal or your own sheet. Prices are usually in USD: enter today\u2019s PKR rate. Review counts are often missing, so the quality gate skips missing fields by default.' },
  temu: { label: 'Temu', defaultCurrency: 'USD', note: 'Temu has no public product export or API for resellers. Use a sheet you prepared yourself (name, price, link, image, rating, sold). Check each product on Temu before selling.' },
  daraz: { label: 'Daraz', defaultCurrency: 'PKR', note: 'Use a product sheet from your Daraz seller/affiliate account or your own sheet. Prices are normally already in PKR.' },
}

// ---------- low-level parsing ----------
export const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]+/g, '')

function detectDelimiter(firstLine: string) {
  const counts = [',', ';', '\t', '|'].map((d) => ({ d, n: firstLine.split(d).length - 1 }))
  counts.sort((a, b) => b.n - a.n)
  return counts[0].n > 0 ? counts[0].d : ','
}

// RFC 4180 style: quoted fields may contain delimiters, doubled quotes and line breaks.
export function parseCsvRecords(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1 } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) { row.push(cell.trim()); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1
      row.push(cell.trim()); cell = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell.trim())
  if (row.some((v) => v !== '')) rows.push(row)
  return rows
}

const currencySymbols: [RegExp, string][] = [[/(^|[^a-z])(pkr|rs\.?|\u20a8)([^a-z]|$)/i, 'PKR'], [/(usd|us\s?\$|\$)/i, 'USD'], [/(eur|\u20ac)/i, 'EUR'], [/(gbp|\u00a3)/i, 'GBP'], [/(cny|rmb|\u00a5|yuan)/i, 'CNY'], [/(aed|dhs)/i, 'AED']]

export function parseMoney(text: string): { value: number; currency?: string } | null {
  if (!text) return null
  const currency = currencySymbols.find(([re]) => re.test(text))?.[1]
  let digits = text.replace(/[A-Za-z]+\.?/g, ' ').replace(/[^0-9.,]/g, '').replace(/^[.,]+|[.,]+$/g, '')
  if (!digits) return null
  const lastComma = digits.lastIndexOf(',')
  const lastDot = digits.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) digits = lastComma > lastDot ? digits.replace(/\./g, '').replace(',', '.') : digits.replace(/,/g, '')
  else if (lastComma >= 0) digits = /,\d{3}$/.test(digits) || (digits.match(/,/g)?.length ?? 0) > 1 ? digits.replace(/,/g, '') : digits.replace(',', '.')
  const value = Number(digits)
  return Number.isFinite(value) && value >= 0 ? { value, currency } : null
}

// "10K+ sold", "1.2k", "2M", "1,234", "500+"  ->  number
export function parseCount(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, '').trim()
  const m = /(\d+(?:\.\d+)?)\s*([km])?/.exec(t)
  if (!m) return null
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1)
  return Number.isFinite(n) ? Math.floor(n) : null
}

// "4.8", "4.8/5", "96.5%": a value above 5 up to 100 (or a % sign) is a positive-feedback percentage, converted to a 5-point scale (approximate).
export function parseRating(text: string, forcePercent = false): { rating: number; approximate: boolean } | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(text.replace(',', '.'))
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  if (forcePercent || text.includes('%') || (n > 5 && n <= 100)) return n <= 100 ? { rating: Math.round((n / 20) * 100) / 100, approximate: true } : null
  return n <= 5 ? { rating: n, approximate: false } : null
}

const firstUrl = (text: string) => text.split(/[\s|;,]+/).map((s) => s.trim()).find((s) => /^https?:\/\//i.test(s)) ?? ''
const validHttpUrl = (value: string) => {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''
  } catch {
    return ''
  }
}

// ---------- mapping ----------
export type ColumnMap = Partial<Record<FieldKey, string>>

export function detectMapping(headers: string[], override: ColumnMap = {}) {
  const normalized = headers.map(normalizeHeader)
  const mapping = {} as Record<FieldKey, number | null>
  const names = {} as Record<FieldKey, string | null>
  for (const key of fieldKeys) {
    let index = -1
    const wanted = override[key]
    if (wanted) index = headers.findIndex((h) => h.trim().toLowerCase() === wanted.trim().toLowerCase())
    if (index < 0 && !wanted) index = common[key].map((alias) => normalized.indexOf(alias)).find((i) => i >= 0) ?? -1
    mapping[key] = index >= 0 ? index : null
    names[key] = index >= 0 ? headers[index] : null
  }
  return { indexes: mapping, names }
}

export type MarketOptions = {
  marketplace: Marketplace
  exchangeRates?: Record<string, number> // PKR per 1 unit, for example { USD: 280 }
  shippingPerItem?: number // PKR added to every item (international shipping, courier)
  dutyPercent?: number // customs / handling, percent of the converted price
  defaultStock?: number
  columnMap?: ColumnMap
}

export type MarketCandidate = SourcingCandidate & { externalId?: string; sourceCurrency: string; sourcePrice: number; ratingApproximate: boolean; categoryFromRules: boolean; restrictedFlags: string[] }

export function parseMarketplaceCsv(csv: string, options: MarketOptions) {
  const records = parseCsvRecords(csv)
  if (records.length < 2) throw new Error('CSV must contain a header row and at least one product row')
  const headers = records[0]
  const { indexes, names } = detectMapping(headers, options.columnMap)
  const missing = (['name', 'price'] as FieldKey[]).filter((k) => indexes[k] === null)
  if (missing.length) throw new Error(`Could not find the ${missing.join(' and ')} column. Columns in your file: ${headers.join(' | ')}. Type the exact column name in the column overrides.`)
  const preset = marketplacePresets[options.marketplace]
  const rows: { row: number; candidate: MarketCandidate }[] = []
  const errors: { row: number; name?: string; reason: string }[] = []
  const rates = Object.fromEntries(Object.entries(options.exchangeRates ?? {}).map(([k, v]) => [k.toUpperCase(), v]))
  rates.PKR = 1

  records.slice(1).forEach((values, i) => {
    const row = i + 2
    const get = (key: FieldKey) => (indexes[key] === null ? '' : (values[indexes[key] as number] ?? '').trim())
    const title = get('name')
    if (!title) return errors.push({ row, reason: 'Name is missing' })
    const name = title.length > 180 ? `${title.slice(0, 177)}...` : title
    const money = parseMoney(get('price'))
    if (!money || money.value <= 0) return errors.push({ row, name, reason: 'Price is missing or not a positive number' })
    const currency = (get('currency').toUpperCase().match(/[A-Z]{3}/)?.[0] ?? money.currency ?? preset.defaultCurrency).toUpperCase()
    const rate = rates[currency]
    if (!rate || !(rate > 0)) return errors.push({ row, name, reason: `Enter the exchange rate for ${currency} (PKR per 1 ${currency})` })
    const converted = money.value * rate
    const wholesale = Math.round((converted * (1 + (options.dutyPercent ?? 0) / 100) + (options.shippingPerItem ?? 0)) * 100) / 100

    const ratingText = get('rating')
    const percentText = get('ratingPercent')
    const parsedRating = ratingText ? parseRating(ratingText) : percentText ? parseRating(percentText, true) : null
    const reviews = get('reviews') ? parseCount(get('reviews')) : null
    const sold = get('sold') ? parseCount(get('sold')) : null
    const stockText = get('stock')
    const stock = stockText ? parseCount(stockText) ?? 0 : (options.defaultStock ?? 0)
    const description = get('description') || (title.length > 180 ? title : undefined)
    const categoryText = get('category')
    const direct = productCategories.find((c) => c.toLowerCase() === categoryText.toLowerCase())
    const rule = classifyProduct({ name: `${categoryText} ${name}`, description })
    const category = direct ?? (rule.confidence > 0 ? rule.category : 'Other')
    const image = validHttpUrl(firstUrl(get('image')))
    const url = validHttpUrl(get('url'))
    const candidate: MarketCandidate = {
      name, category, wholesalePrice: wholesale, stock: Math.max(0, Math.floor(stock)),
      rating: parsedRating?.rating ?? null, reviewCount: reviews, soldCount: sold,
      sourceCurrency: currency, sourcePrice: money.value, ratingApproximate: parsedRating?.approximate ?? false,
      categoryFromRules: !direct, restrictedFlags: rule.restrictedFlags,
    }
    if (image) candidate.imageUrl = image
    if (url) candidate.productUrl = url
    if (description) candidate.description = description.slice(0, 10000)
    const id = get('externalId')
    if (id) candidate.externalId = id.slice(0, 120)
    rows.push({ row, candidate })
  })
  return { rows, errors, headers, columns: names }
}

// strict = like Markaz (missing rating/reviews/sold rejects); skip_missing = only check what the file contains; off = no quality check.
export type QualityMode = 'strict' | 'skip_missing' | 'off'
export function evaluateMarketCandidate(c: Pick<SourcingCandidate, 'rating' | 'reviewCount' | 'soldCount'>, rules: SourcingRules, mode: QualityMode) {
  if (mode === 'off') return { eligible: true, reasons: [] as string[] }
  const reasons: string[] = []
  const check = (value: number | null, min: number, label: string, unit: string) => {
    if (value === null) { if (mode === 'strict') reasons.push(`${label} is missing`) } else if (value < min) reasons.push(`${value}${unit} is below ${min}`)
  }
  check(c.rating, rules.minRating, 'Rating', ' rating')
  check(c.reviewCount, rules.minReviews, 'Review count', ' reviews')
  check(c.soldCount, rules.minSold, 'Units sold', ' sold')
  return { eligible: reasons.length === 0, reasons }
}
