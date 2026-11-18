// Purpose: customer-support reply logic. Pure and unit-tested. Replies use ONLY facts read from the database (name, price, stock).
// Never invents delivery charges, discounts, payment confirmation or order status. Delivery cost and order confirmation are left to a human.
export type ProductVariant = {
  id: string
  sku: string
  title?: string | null
  option1_name?: string | null
  option1_value?: string | null
  option2_name?: string | null
  option2_value?: string | null
  selling_price?: string | number
  stock?: number
}

export type CatalogProduct = {
  id: string
  name: string
  category: string
  selling_price: string | number
  stock: number
  description?: string | null
  is_advance_payment?: boolean
  sku?: string | null
  variants?: ProductVariant[]
}
export type Intent = 'greeting' | 'price' | 'stock' | 'delivery' | 'order' | 'other'
export type ReplyResult = { text: string; needsHuman: boolean; productIds: string[]; allowedNumbers: string[] }

const tokenize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ').split(/\s+/).filter((token) => token.length >= 3)

export function formatPrice(value: string | number) {
  const number = Number(value)
  const text = Number.isInteger(number) ? String(number) : number.toFixed(2)
  return `Rs. ${text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function matchProducts(text: string, products: CatalogProduct[], limit = 3) {
  const words = new Set(tokenize(text))
  return products
    .map((product) => ({ product, score: tokenize(product.name).filter((token) => words.has(token)).length }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.product)
}

export function detectIntent(text: string): Intent {
  const t = text.toLowerCase()
  if (/\b(order|book|lena hai|lena h|chahiye|chahiyay|mangwa|buy|purchase|confirm)\b/.test(t)) return 'order'
  if (/(delivery|deliver|shipping|charges|courier|kitne din|kab tak)/.test(t)) return 'delivery'
  if (/(price|qeemat|keemat|kimat|rate|kitne|kitna|kya rate|cost|rs\b|rupay|rupee)/.test(t)) return 'price'
  if (/(stock|available|availab|mojood|maujood|milega|milegi|hai kya|hai ya)/.test(t)) return 'stock'
  if (/^(hi|hello|hey|salam|assalam|aoa|asalam|slam)\b/.test(t.trim())) return 'greeting'
  return 'other'
}

// Reads labeled lines such as "Name: Ali", "Phone: 0300...", "City: Lahore", "Address: ...", "Qty: 2", "Size: M".
export function extractOrderDetails(text: string) {
  const pick = (labels: string) => text.match(new RegExp(`(?:^|\\n|,|;)\\s*(?:${labels})\\s*[:=\\-]\\s*([^\\n,;]+)`, 'i'))?.[1]?.trim()
  const nameNatural = text.match(/(?:(?:mera\s+naam|my\s+name\s+is)\s+|^naam\s+)([A-Za-z\s]+?)(?:\s+hai|\.|\n|$)/i)?.[1]?.trim()
  const addressLine = text.match(/(?:^|\n)\s*(?:address|pata|patta)\s*[:=\-]\s*([^\n]+)/i)?.[1]?.trim()
  const phoneMatch = text.match(/(?:\+?92|0)3\d{2}[-\s]?\d{7}/)
  const quantity = Number(pick('qty|quantity|miqdar|tadad'))
  const variantPick = pick('variant|size|color|colour|rang|varient|option')
  const variantFromText = text.match(/\b(small|medium|large|extra large|xl|xxl|xs)\b/i)?.[0]
  return {
    name: pick('name|naam') || nameNatural || undefined,
    phone: pick('phone|mobile|contact|number|phone number')?.replace(/[^\d+]/g, '') || phoneMatch?.[0]?.replace(/[^\d+]/g, ''),
    city: pick('city|shehar|sheher'),
    address: addressLine || pick('address|pata|patta'),
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : undefined,
    variant: variantPick || variantFromText || undefined,
  }
}

export function missingOrderFields(details: Partial<ReturnType<typeof extractOrderDetails>>, hasVariants = false) {
  const fields: { key: keyof ReturnType<typeof extractOrderDetails>; label: string; question: string }[] = [
    { key: 'name', label: 'poora naam', question: 'Order ke liye meherbani karke apna poora naam bata dein.' },
    { key: 'phone', label: 'phone number', question: 'Order ke liye apna rabta number (phone/WhatsApp) bata dein.' },
    { key: 'city', label: 'shehar', question: 'Order deliver karne ke liye apna shehar (city) bata dein.' },
    { key: 'address', label: 'mukammal address', question: 'Delivery ke liye apna mukammal pata (complete address) bata dein.' },
    { key: 'quantity', label: 'quantity', question: 'Aap ko kitni quantity chahiye?' },
  ]
  if (hasVariants) {
    fields.push({ key: 'variant', label: 'variant / size / color', question: 'Aap ko kaun sa variant / size / color chahiye?' })
  }
  return fields.filter((f) => !details[f.key])
}

// Customers often send the details over several messages. Newest message wins for each field.
export function mergeOrderDetails(texts: string[]) {
  const merged: Partial<ReturnType<typeof extractOrderDetails>> = {}
  for (const text of [...texts].reverse()) {
    const d = extractOrderDetails(text)
    for (const key of Object.keys(d) as (keyof typeof d)[]) if (merged[key] === undefined && d[key] !== undefined) (merged as Record<string, unknown>)[key] = d[key]
  }
  return merged
}

export type AutoOrder = {
  product: CatalogProduct
  quantity: number
  name: string
  phone: string
  city: string
  address: string
  paymentMethod: 'cod' | 'bank_transfer' | 'easypaisa' | 'jazzcash'
  variant?: ProductVariant
}

// Returns an order only when the customer asked to order AND every detail is present AND the product is in stock. Never guesses a missing detail.
export function detectAutoOrder(texts: string[], products: CatalogProduct[]): AutoOrder | null {
  if (!texts.some((text) => detectIntent(text) === 'order')) return null
  const details = mergeOrderDetails(texts)
  const newestFirst = [...texts].reverse()
  let product: CatalogProduct | undefined
  for (const text of newestFirst) { product = matchProducts(text, products, 1)[0]; if (product) break }
  if (!product) return null
  if (product.is_advance_payment) return null // China / advance payment products cannot be auto-ordered
  const hasVariants = (product.variants?.length ?? 0) > 0
  if (missingOrderFields(details, hasVariants).length) return null
  let matchedVariant: ProductVariant | undefined
  if (hasVariants && product.variants) {
    const vText = (details.variant ?? '').toLowerCase().trim()
    matchedVariant = product.variants.find((v) => {
      const title = (v.title ?? '').toLowerCase()
      const o1 = (v.option1_value ?? '').toLowerCase()
      const o2 = (v.option2_value ?? '').toLowerCase()
      const sku = v.sku.toLowerCase()
      return vText && (title.includes(vText) || o1 === vText || o2 === vText || sku === vText || vText.includes(title) || vText.includes(o1))
    })
    if (!matchedVariant && product.variants.length > 0) return null
  }
  const quantity = details.quantity as number
  const name = details.name as string
  const phone = details.phone as string
  const city = details.city as string
  const address = details.address as string
  if (quantity > 1000 || product.stock < quantity || name.length < 2 || phone.replace(/\D/g, '').length < 7 || city.length < 2 || address.length < 5) return null
  const all = texts.join('\n').toLowerCase()
  const paymentMethod = /easypaisa|easy paisa/.test(all) ? 'easypaisa' : /jazz ?cash/.test(all) ? 'jazzcash' : /bank|transfer/.test(all) ? 'bank_transfer' : 'cod'
  return { product, quantity, name: name.slice(0, 160), phone: phone.slice(0, 40), city: city.slice(0, 100), address: address.slice(0, 500), paymentMethod, variant: matchedVariant }
}

export const priceFacts = (price?: number | string | null) => {
  if (price === undefined || price === null || !Number.isFinite(Number(price))) return []
  const n = Number(price)
  return [String(n), n.toFixed(2), formatPrice(n).replace('Rs. ', '')]
}
const numbersFor = (products: CatalogProduct[]) => products.flatMap((product) => priceFacts(product.selling_price))

export function composeReply(text: string, products: CatalogProduct[], context: { priorText?: string; history?: string[] } = {}): ReplyResult {
  const history = context.history ?? []
  // A message that only carries order details (no word like "order") still continues an order the customer already started.
  const continuesOrder = detectIntent(text) === 'other' && history.some((t) => detectIntent(t) === 'order') && Object.values(extractOrderDetails(text)).some(Boolean)
  const intent: Intent = continuesOrder ? 'order' : detectIntent(text)
  const matched = matchProducts(text, products)
  const productsToUse = matched.length ? matched : matchProducts([...history].reverse().join(' ') || (context.priorText ?? ''), products, 1)
  const available = products.filter((product) => product.stock > 0)
  const done = (reply: string, needsHuman: boolean, used: CatalogProduct[]): ReplyResult => ({ text: reply, needsHuman, productIds: used.map((product) => product.id), allowedNumbers: numbersFor(used) })

  if (intent === 'order') {
    const details = mergeOrderDetails([...history, text])
    const product = productsToUse[0]
    if (!product) return done(`Order ke liye shukriya. Aap kaun sa product lena chahte hain? ${available.length ? `Abhi hamare paas ${available.slice(0, 3).map((p) => p.name).join(', ')} available hain.` : 'Hamari team aap ko product ki tafseel batayegi.'}`, true, available.slice(0, 3))
    if (product.stock <= 0) return done(`${product.name} abhi stock mein nahi hai. Hamari team aap ko jald batayegi.`, true, [product])
    const hasVariants = (product.variants?.length ?? 0) > 0
    const missing = missingOrderFields(details, hasVariants)
    if (missing.length) {
      // Ask ONE missing item at a time
      return done(`Ji, ${product.name} ${formatPrice(product.selling_price)} mein available hai. ${missing[0].question} (Aap ka naam, phone aur delivery address required hoga).`, false, [product])
    }
    return done(`Shukriya ${details.name}! Aap ki details mil gayi hain. Hamari team order confirm karke aap se rabta karegi. Order confirm hone se pehle koi payment na karein.`, true, [product])
  }
  if (intent === 'delivery') return done('Delivery charges aur muddat aap ke shehar par depend karte hain. Hamari team aap ko sahi tafseel batayegi.', true, [])
  if (intent === 'price' || intent === 'stock') {
    const product = productsToUse[0]
    if (!product) return done(`Aap kaun sa product poochh rahe hain? ${available.length ? `Hamare paas ${available.slice(0, 3).map((p) => p.name).join(', ')} available hain.` : ''}`.trim(), available.length === 0, available.slice(0, 3))
    const priceLine = `${product.name} ki qeemat ${formatPrice(product.selling_price)} hai.`
    const stockLine = product.stock > 0 ? 'Ye abhi available hai.' : 'Ye abhi stock mein nahi hai.'
    return done(intent === 'price' ? `${priceLine} ${stockLine}` : stockLine === 'Ye abhi available hai.' ? `${product.name} abhi available hai.` : `${product.name} abhi stock mein nahi hai.`, false, [product])
  }
  if (intent === 'greeting') return done(`Assalam o Alaikum! Hamare store mein khush aamdeed. Aap kaun sa product dekhna chahte hain?${available.length ? ` Abhi available: ${available.slice(0, 3).map((p) => p.name).join(', ')}.` : ''}`, false, available.slice(0, 3))
  return done('Shukriya aap ke message ka. Hamari team jald aap ko jawab degi.', true, [])
}

// Guard for any LLM-written reply: every price-like number must come from the database facts.
export function replyUsesOnlyKnownNumbers(reply: string, allowedNumbers: string[]) {
  const allowed = new Set(allowedNumbers.flatMap((n) => [n, n.replace(/,/g, '')]))
  const found = reply.match(/\d[\d,]*(?:\.\d+)?/g) ?? []
  return found.every((raw) => raw.replace(/,/g, '').length < 2 || allowed.has(raw) || allowed.has(raw.replace(/,/g, '')))
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

// Optional LLM phrasing. Falls back to the rule-based reply when the model fails or uses a number that is not in the facts.
export async function composeWithLlm(text: string, products: CatalogProduct[], baseline: ReplyResult, ai: { baseUrl: string; apiKey: string; model: string }, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<ReplyResult> {
  if (baseline.needsHuman || baseline.productIds.length === 0) return baseline
  const facts = products.filter((p) => baseline.productIds.includes(p.id)).map((p) => ({ name: p.name, price: formatPrice(p.selling_price), available: p.stock > 0, description: (p.description ?? '').slice(0, 300) }))
  try {
    const baseUrl = ai.baseUrl.replace(/\/+$/, '')
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ai.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ai.model, temperature: 0.3, messages: [
        { role: 'system', content: 'You are a polite shop assistant replying in Roman Urdu. Use ONLY the facts provided. Never invent prices, discounts, stock numbers, delivery charges, warranties or order status. Keep it under 60 words. If unsure, say the team will confirm.' },
        { role: 'user', content: JSON.stringify({ customerMessage: text, facts }) },
      ] }),
    })
    if (!response.ok) return baseline
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const reply = body.choices?.[0]?.message?.content?.trim()
    if (!reply || reply.length > 800 || !replyUsesOnlyKnownNumbers(reply, baseline.allowedNumbers)) return baseline
    return { ...baseline, text: reply }
  } catch {
    return baseline
  }
}
