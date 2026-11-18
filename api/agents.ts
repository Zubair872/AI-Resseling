// Purpose: pure rules for the built-in agents (no database, no network). These agents are RULE-BASED, not LLM calls.
export const categories = ['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other'] as const
export type Category = (typeof categories)[number]
export type AutonomyMode = 'manual' | 'approval' | 'hybrid' | 'full'
export const autonomyModes: AutonomyMode[] = ['manual', 'approval', 'hybrid', 'full']

const keywords: Record<Exclude<Category, 'Other'>, string[]> = {
  'Mobile Accessories': ['charger', 'cable', 'power bank', 'powerbank', 'earbuds', 'airpods', 'phone case', 'screen protector', 'handsfree', 'magsafe', 'usb', 'adapter'],
  Electronics: ['led', 'lamp', 'speaker', 'camera', 'smart watch', 'smartwatch', 'trimmer', 'headphone', 'bluetooth', 'monitor', 'keyboard', 'mouse', 'fan', 'router'],
  Fashion: ['shirt', 'dress', 'kurta', 'shoes', 'slides', 'sandal', 'jacket', 'hoodie', 'scarf', 'handbag', 'wallet', 'sunglasses', 'jeans', 'abaya', 'hijab'],
  Sports: ['football', 'cricket', 'bat', 'yoga', 'dumbbell', 'gym', 'fitness', 'badminton', 'skipping', 'treadmill', 'jersey', 'resistance band'],
  Beauty: ['serum', 'lipstick', 'foundation', 'moisturizer', 'cream', 'perfume', 'shampoo', 'makeup', 'mascara', 'face wash', 'sunscreen', 'hair oil'],
  'Home & Kitchen': ['kitchen', 'cookware', 'pan', 'knife set', 'organizer', 'bedsheet', 'curtain', 'mug', 'bottle', 'storage', 'cleaning', 'towel', 'blender'],
  Jewellery: ['necklace', 'ring', 'bracelet', 'earring', 'pendant', 'bangle', 'anklet', 'jewellery', 'jewelry'],
  'Baby Products': ['baby', 'diaper', 'toddler', 'infant', 'stroller', 'feeding', 'pacifier', 'kids toy'],
  Grocery: ['tea', 'coffee', 'spice', 'snack', 'biscuit', 'rice', 'flour', 'oil', 'sugar', 'dry fruit', 'honey'],
}
const restricted = ['weapon', 'gun', 'pistol', 'ammunition', 'vape', 'cigarette', 'tobacco', 'alcohol', 'drug', 'counterfeit', 'replica', 'first copy', 'medicine', 'prescription']

const has = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text)

export function classifyProduct(input: { name: string; description?: string | null; imageUrl?: string | null; sellingPrice?: number; stock?: number }) {
  const text = `${input.name} ${input.description ?? ''}`.toLowerCase()
  let best: { category: Category; score: number; matched: string[] } = { category: 'Other', score: 0, matched: [] }
  for (const category of Object.keys(keywords) as (keyof typeof keywords)[]) {
    const matched = keywords[category].filter((word) => has(text, word))
    if (matched.length > best.score) best = { category, score: matched.length, matched }
  }
  const missing: string[] = []
  if (!input.description || input.description.trim().length < 20) missing.push('description')
  if (!input.imageUrl) missing.push('image')
  if (!input.sellingPrice) missing.push('selling price')
  if (!input.stock) missing.push('stock')
  const flags = restricted.filter((word) => has(text, word))
  return { category: best.category, confidence: best.score === 0 ? 0 : Math.min(0.95, 0.5 + best.score * 0.15), matched: best.matched, missing, restrictedFlags: flags }
}

export type Risk = 'low' | 'high'
// Money, refunds, payment verification and supplier purchases are HIGH risk: never automatic, in any mode.
export function canAutoApply(mode: AutonomyMode, risk: Risk) {
  if (risk === 'high') return false
  return mode === 'hybrid' || mode === 'full'
}

export function suggestPrice(input: { wholesalePrice: number; profitAmount?: number; profitPercent?: number; shippingCost?: number }) {
  const profit = input.profitAmount ?? (input.profitPercent !== undefined ? input.wholesalePrice * (input.profitPercent / 100) : 150)
  const sellingPrice = Math.round((input.wholesalePrice + profit + (input.shippingCost ?? 0)) * 100) / 100
  return { sellingPrice, profit: Math.round(profit * 100) / 100 }
}

// Reads text copied from a payment screenshot (typed by a person or produced by an OCR provider later).
// The result is a SUGGESTION. It is never proof of payment: verification stays a human decision.
export function parsePaymentText(text: string) {
  const clean = text.replace(/\s+/g, ' ')
  const id = /(?:TID|TRX\s*ID|TXN\s*ID|Transaction\s*ID|Trans\s*ID|Ref(?:erence)?(?:\s*(?:No|ID|#))?)\s*[:#-]?\s*([A-Z0-9]{6,20})/i.exec(clean)
  const amount = /(?:Rs\.?|PKR)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(clean)
  const warnings: string[] = ['This is only extracted text. A person must confirm the money arrived in the real account before approving.']
  if (!id) warnings.push('No transaction ID found')
  if (!amount) warnings.push('No amount found')
  return { transactionId: id?.[1]?.toUpperCase() ?? null, amount: amount ? Number(amount[1].replace(/,/g, '')) : null, verified: false as const, warnings }
}

// Real image check: size and magic bytes must match the declared type.
export const maxUploadBytes = 3 * 1024 * 1024
export function validateImageBase64(dataBase64: string, contentType: string): { ok: true; bytes: number } | { ok: false; reason: string } {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) return { ok: false, reason: 'Only PNG, JPEG or WebP images are allowed' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) return { ok: false, reason: 'Image data is not valid base64' }
  const buffer = Buffer.from(dataBase64, 'base64')
  if (buffer.length === 0 || buffer.length > maxUploadBytes) return { ok: false, reason: 'Image must be between 1 byte and 3 MB' }
  const startsWith = (...bytes: number[]) => bytes.every((value, index) => buffer[index] === value)
  const okType = contentType === 'image/png' ? startsWith(0x89, 0x50, 0x4e, 0x47)
    : contentType === 'image/jpeg' ? startsWith(0xff, 0xd8, 0xff)
    : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  return okType ? { ok: true, bytes: buffer.length } : { ok: false, reason: 'File content does not match its declared image type' }
}
