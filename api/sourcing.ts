// Purpose: pick only high-quality supplier products (rating, reviews, units sold) and add the reseller's profit.
import { splitCsvLine } from './csv.js'

export const productCategories = ['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other'] as const

export type SourcingRules = { minRating: number; minReviews: number; minSold: number }
export type ProfitConfig = { fixed: number; percent: number | null }
export const defaultSourcingRules: SourcingRules = { minRating: 4.5, minReviews: 50, minSold: 200 }
export const defaultProfit: ProfitConfig = { fixed: 150, percent: null }

export type SourcingCandidate = {
  name: string
  category: string
  wholesalePrice: number
  stock: number
  rating: number | null
  reviewCount: number | null
  soldCount: number | null
  imageUrl?: string
  productUrl?: string
  description?: string
  profit?: number
}

export function evaluateCandidate(candidate: Pick<SourcingCandidate, 'rating' | 'reviewCount' | 'soldCount'>, rules: SourcingRules) {
  const reasons: string[] = []
  if (candidate.rating === null) reasons.push('Rating is missing')
  else if (candidate.rating < rules.minRating) reasons.push(`Rating ${candidate.rating} is below ${rules.minRating}`)
  if (candidate.reviewCount === null) reasons.push('Review count is missing')
  else if (candidate.reviewCount < rules.minReviews) reasons.push(`${candidate.reviewCount} reviews is below ${rules.minReviews}`)
  if (candidate.soldCount === null) reasons.push('Units sold is missing')
  else if (candidate.soldCount < rules.minSold) reasons.push(`${candidate.soldCount} sold is below ${rules.minSold}`)
  return { eligible: reasons.length === 0, reasons }
}

// selling price = wholesale + profit. A per-product profit replaces the default; otherwise fixed + percent of wholesale.
export function applyProfit(wholesalePrice: number, profit: ProfitConfig, override?: number) {
  const extra = override !== undefined ? override : profit.fixed + (wholesalePrice * (profit.percent ?? 0)) / 100
  return Math.round((wholesalePrice + Math.max(extra, 0)) * 100) / 100
}

const aliases: Record<string, string[]> = {
  name: ['name', 'title', 'productname'],
  category: ['category'],
  wholesale: ['wholesaleprice', 'price', 'markazprice', 'cost'],
  stock: ['stock', 'quantity'],
  rating: ['rating', 'stars', 'starrating'],
  reviews: ['reviewcount', 'reviews'],
  sold: ['soldcount', 'sold', 'orders', 'buyers', 'subscribers'],
  image: ['imageurl', 'image'],
  url: ['producturl', 'url', 'link', 'supplierurl'],
  description: ['description'],
  profit: ['profit', 'profitamount', 'myprofit'],
}

function optionalNumber(text: string) {
  if (text === '') return { value: null as number | null }
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? { value } : { error: true as const }
}

export function parseSourcingCsv(csv: string) {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV must contain a header and at least one product row')
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[\s_-]+/g, ''))
  const column = (key: string) => aliases[key].map((alias) => headers.indexOf(alias)).find((index) => index >= 0) ?? -1
  for (const key of ['name', 'category', 'wholesale']) if (column(key) < 0) throw new Error(`CSV is missing required column: ${aliases[key][0]}`)
  const rows: { row: number; candidate: SourcingCandidate }[] = []
  const errors: { row: number; reason: string }[] = []
  lines.slice(1).forEach((line, index) => {
    const row = index + 2
    const values = splitCsvLine(line)
    const get = (key: string) => (column(key) >= 0 ? values[column(key)]?.trim() ?? '' : '')
    const category = productCategories.find((c) => c.toLowerCase() === get('category').toLowerCase())
    const wholesale = Number(get('wholesale'))
    const stock = optionalNumber(get('stock'))
    const rating = optionalNumber(get('rating'))
    const reviews = optionalNumber(get('reviews'))
    const sold = optionalNumber(get('sold'))
    const profit = optionalNumber(get('profit'))
    if (!get('name')) return errors.push({ row, reason: 'Name is missing' })
    if (!category) return errors.push({ row, reason: `Category must be one of: ${productCategories.join(', ')}` })
    if (!Number.isFinite(wholesale) || wholesale <= 0) return errors.push({ row, reason: 'Wholesale price must be a positive number' })
    if ('error' in stock || 'error' in rating || 'error' in reviews || 'error' in sold || 'error' in profit) return errors.push({ row, reason: 'Stock, rating, reviews, sold and profit must be non-negative numbers' })
    if (rating.value !== null && rating.value > 5) return errors.push({ row, reason: 'Rating cannot be above 5' })
    const candidate: SourcingCandidate = { name: get('name'), category, wholesalePrice: wholesale, stock: Math.floor(stock.value ?? 0), rating: rating.value, reviewCount: reviews.value === null ? null : Math.floor(reviews.value), soldCount: sold.value === null ? null : Math.floor(sold.value) }
    if (get('image')) candidate.imageUrl = get('image')
    if (get('url')) candidate.productUrl = get('url')
    if (get('description')) candidate.description = get('description')
    if (profit.value !== null) candidate.profit = profit.value
    rows.push({ row, candidate })
  })
  return { rows, errors }
}
