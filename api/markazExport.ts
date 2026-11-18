// Pure parser module for Markaz export files (Shopify CSV, WooCommerce CSV, and Generic layout).
// Zero framework imports.
// Note: Markaz has no public API. This parser handles exports downloaded from markaz.app/export-product-data.
import { productCategories, type SourcingRules } from './sourcing.js'

export type ExportLayout = 'shopify' | 'woocommerce' | 'generic'

export type ExportFieldKey =
  | 'handle'
  | 'name'
  | 'description'
  | 'category'
  | 'wholesalePrice'
  | 'fileSellingPrice'
  | 'sku'
  | 'imageUrl'
  | 'stock'
  | 'option1Name'
  | 'option1Value'
  | 'option2Name'
  | 'option2Value'
  | 'advancePayment'
  | 'rating'
  | 'reviews'
  | 'sold'

export const exportFieldKeys: ExportFieldKey[] = [
  'handle',
  'name',
  'description',
  'category',
  'wholesalePrice',
  'fileSellingPrice',
  'sku',
  'imageUrl',
  'stock',
  'option1Name',
  'option1Value',
  'option2Name',
  'option2Value',
  'advancePayment',
  'rating',
  'reviews',
  'sold',
]

export const exportFieldLabels: Record<ExportFieldKey, string> = {
  handle: 'Product Handle / ID',
  name: 'Product Title / Name',
  description: 'Description',
  category: 'Category / Product Type',
  wholesalePrice: 'Markaz Price (Cost)',
  fileSellingPrice: 'File Selling Price',
  sku: 'Variant SKU (MKZ-...)',
  imageUrl: 'Image URL',
  stock: 'Stock Quantity',
  option1Name: 'Option 1 Name (e.g. Size)',
  option1Value: 'Option 1 Value (e.g. M)',
  option2Name: 'Option 2 Name (e.g. Color)',
  option2Value: 'Option 2 Value (e.g. Red)',
  advancePayment: 'Advance Payment / China Note',
  rating: 'Star Rating',
  reviews: 'Review Count',
  sold: 'Units Sold',
}

export const normalizeHeader = (header: string) => header.toLowerCase().replace(/[\s_\-]+/g, '')

const layoutAliases: Record<ExportLayout, Record<ExportFieldKey, string[]>> = {
  shopify: {
    handle: ['handle', 'producthandle'],
    name: ['title', 'producttitle', 'name'],
    description: ['bodyhtml', 'body', 'description'],
    category: ['type', 'producttype', 'tags'],
    wholesalePrice: ['costperitem', 'variantcost', 'cost', 'wholesale', 'markazprice', 'wholesaleprice', 'variantcostprice'],
    fileSellingPrice: ['variantprice', 'price', 'sellingprice', 'yourprice'],
    sku: ['variantsku', 'sku'],
    imageUrl: ['imagesrc', 'imageurl', 'image', 'images'],
    stock: ['variantinventoryqty', 'inventoryquantity', 'stock', 'quantity'],
    option1Name: ['option1name'],
    option1Value: ['option1value'],
    option2Name: ['option2name'],
    option2Value: ['option2value'],
    advancePayment: ['tags', 'notes', 'advancepayment', 'china'],
    rating: ['rating', 'stars'],
    reviews: ['reviews', 'reviewcount'],
    sold: ['sold', 'soldcount', 'orders'],
  },
  woocommerce: {
    handle: ['parent', 'id', 'sku', 'slug'],
    name: ['name', 'productname', 'title'],
    description: ['description', 'shortdescription'],
    category: ['categories', 'category'],
    wholesalePrice: ['regularprice', 'cost', 'wholesale', 'markazprice', 'wholesaleprice'],
    fileSellingPrice: ['saleprice', 'sellingprice', 'price', 'yourprice'],
    sku: ['sku'],
    imageUrl: ['images', 'image', 'imageurl'],
    stock: ['stock', 'inventory'],
    option1Name: ['attributename1', 'attribute1name'],
    option1Value: ['attributevalue1', 'attribute1value', 'attribute1values'],
    option2Name: ['attributename2', 'attribute2name'],
    option2Value: ['attributevalue2', 'attribute2value', 'attribute2values'],
    advancePayment: ['tags', 'notes', 'advancepayment', 'china'],
    rating: ['rating', 'stars'],
    reviews: ['reviews', 'reviewcount'],
    sold: ['sold', 'soldcount', 'orders'],
  },
  generic: {
    handle: ['handle', 'productid', 'itemid', 'id', 'sku'],
    name: ['productname', 'name', 'title', 'itemname'],
    description: ['description', 'desc', 'details'],
    category: ['category', 'categories', 'type', 'producttype'],
    wholesalePrice: ['markazprice', 'cost', 'wholesale', 'wholesaleprice', 'supplierprice', 'regularprice'],
    fileSellingPrice: ['sellingprice', 'yourprice', 'saleprice', 'price', 'resellerprice'],
    sku: ['variantsku', 'sku', 'productsku'],
    imageUrl: ['imageurl', 'images', 'image', 'picture', 'imagesrc', 'photos'],
    stock: ['stock', 'quantity', 'qty', 'inventory'],
    option1Name: ['option1name', 'variant1name', 'attributename1'],
    option1Value: ['option1value', 'variant1value', 'attributevalue1', 'size'],
    option2Name: ['option2name', 'variant2name', 'attributename2'],
    option2Value: ['option2value', 'variant2value', 'attributevalue2', 'color'],
    advancePayment: ['advancepayment', 'advance', 'chinanote', 'china', 'tags', 'paymentterms'],
    rating: ['rating', 'stars', 'starrating'],
    reviews: ['reviews', 'reviewcount', 'numreviews'],
    sold: ['sold', 'soldcount', 'orders', 'unitssold'],
  },
}

export function detectLayout(headers: string[]): ExportLayout {
  const norm = headers.map(normalizeHeader)
  const isShopify = norm.includes('handle') && (norm.includes('variantsku') || norm.includes('variantprice') || norm.includes('imagesrc'))
  if (isShopify) return 'shopify'
  const isWoo = (norm.includes('parent') || norm.includes('taxstatus')) && (norm.includes('regularprice') || norm.includes('saleprice'))
  if (isWoo) return 'woocommerce'
  return 'generic'
}

export function splitCsvLinesRFC(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  // Detect delimiter from first line if possible
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 })).sort((a, b) => b.n - a.n)[0]?.n > 0
    ? [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 })).sort((a, b) => b.n - a.n)[0].d
    : ','

  for (let i = 0; i < src.length; i++) {
    const char = src[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < src.length && src[i + 1] === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === delimiter) {
        currentRow.push(currentField.trim())
        currentField = ''
      } else if (char === '\r') {
        if (i + 1 < src.length && src[i + 1] === '\n') i++
        currentRow.push(currentField.trim())
        if (currentRow.some((c) => c.length > 0)) rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else if (char === '\n') {
        currentRow.push(currentField.trim())
        if (currentRow.some((c) => c.length > 0)) rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    if (currentRow.some((c) => c.length > 0)) rows.push(currentRow)
  }
  return rows
}

export function autoDetectMapping(headers: string[], layout?: ExportLayout): Record<ExportFieldKey, string | null> {
  const chosenLayout = layout ?? detectLayout(headers)
  const normHeaders = headers.map(normalizeHeader)
  const mapping: Record<ExportFieldKey, string | null> = {
    handle: null,
    name: null,
    description: null,
    category: null,
    wholesalePrice: null,
    fileSellingPrice: null,
    sku: null,
    imageUrl: null,
    stock: null,
    option1Name: null,
    option1Value: null,
    option2Name: null,
    option2Value: null,
    advancePayment: null,
    rating: null,
    reviews: null,
    sold: null,
  }

  const aliasesForLayout = layoutAliases[chosenLayout]
  const genericAliases = layoutAliases.generic

  for (const field of exportFieldKeys) {
    const primaryCandidates = aliasesForLayout[field] ?? []
    const fallbackCandidates = genericAliases[field] ?? []
    const allCandidates = Array.from(new Set([...primaryCandidates, ...fallbackCandidates]))

    for (const alias of allCandidates) {
      const idx = normHeaders.indexOf(alias)
      if (idx >= 0) {
        mapping[field] = headers[idx]
        break
      }
    }
  }

  // Smart fallbacks
  if (!mapping.handle && mapping.sku) mapping.handle = mapping.sku
  if (!mapping.wholesalePrice && mapping.fileSellingPrice) {
    // Both could share or wholesalePrice fallback
  }

  return mapping
}

export function extractRootSku(sku: string): string {
  const trimmed = sku.trim()
  const match = trimmed.match(/^(MKZ-\d+)(?:-.*)?$/i)
  if (match) return match[1].toUpperCase()
  return trimmed
}

export function isChinaAdvancePayment(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('china') ||
    lower.includes('advance') ||
    lower.includes('advance payment') ||
    lower.includes('non-cod') ||
    lower.includes('no cod') ||
    lower.includes('prepaid')
  )
}

export type ParsedVariant = {
  sku: string
  wholesalePrice: number
  fileSellingPrice: number | null
  stock: number
  option1Name?: string
  option1Value?: string
  option2Name?: string
  option2Value?: string
  imageUrl?: string
  rawRow: number
}

export type ParsedGroupedProduct = {
  handle: string
  name: string
  description: string
  category: string
  skuRoot: string
  mainImageUrl: string | null
  images: string[]
  wholesalePrice: number // Minimum wholesale price across variants
  fileSellingPrice: number | null
  totalStock: number
  isAdvancePayment: boolean
  rating: number | null
  reviewCount: number | null
  soldCount: number | null
  hasQualityData: boolean
  variants: ParsedVariant[]
  rawRows: number[]
}

export type ParseMarkazExportResult = {
  layout: ExportLayout
  detectedHeaders: string[]
  mapping: Record<ExportFieldKey, string | null>
  products: ParsedGroupedProduct[]
  errors: { row: number; reason: string; column?: string }[]
}

export function parseMarkazExport(
  csvText: string,
  customMapping?: Partial<Record<ExportFieldKey, string>>
): ParseMarkazExportResult {
  const records = splitCsvLinesRFC(csvText)
  if (records.length < 2) {
    throw new Error('CSV file must contain a header row and at least one product row.')
  }

  const rawHeaders = records[0]
  const layout = detectLayout(rawHeaders)
  const autoMap = autoDetectMapping(rawHeaders, layout)
  const mapping: Record<ExportFieldKey, string | null> = { ...autoMap, ...(customMapping ?? {}) }

  // Check essential column presence
  const requiredFields: ExportFieldKey[] = ['name', 'wholesalePrice']
  for (const field of requiredFields) {
    const mappedHeader = mapping[field]
    if (!mappedHeader || !rawHeaders.includes(mappedHeader)) {
      throw new Error(
        `Required column for "${exportFieldLabels[field]}" was not found. Available columns in file: [${rawHeaders.join(', ')}]. Please map this column.`
      )
    }
  }

  const getColIndex = (field: ExportFieldKey): number => {
    const headerName = mapping[field]
    return headerName ? rawHeaders.indexOf(headerName) : -1
  }

  const idxHandle = getColIndex('handle')
  const idxName = getColIndex('name')
  const idxDesc = getColIndex('description')
  const idxCat = getColIndex('category')
  const idxCost = getColIndex('wholesalePrice')
  const idxPrice = getColIndex('fileSellingPrice')
  const idxSku = getColIndex('sku')
  const idxImage = getColIndex('imageUrl')
  const idxStock = getColIndex('stock')
  const idxOpt1N = getColIndex('option1Name')
  const idxOpt1V = getColIndex('option1Value')
  const idxOpt2N = getColIndex('option2Name')
  const idxOpt2V = getColIndex('option2Value')
  const idxAdv = getColIndex('advancePayment')
  const idxRating = getColIndex('rating')
  const idxReviews = getColIndex('reviews')
  const idxSold = getColIndex('sold')

  const groups = new Map<string, ParsedGroupedProduct>()
  const errors: { row: number; reason: string; column?: string }[] = []
  let lastProductHandle = ''

  for (let r = 1; r < records.length; r++) {
    const row = records[r]
    const rowNum = r + 1
    const cell = (idx: number) => (idx >= 0 && idx < row.length ? row[idx].trim() : '')

    const nameVal = cell(idxName)
    let handleVal = cell(idxHandle)
    const skuVal = cell(idxSku)

    // In Shopify CSV, secondary variant rows often have empty title/handle, reusing the last product's handle
    if (!handleVal) {
      if (nameVal) {
        handleVal = nameVal.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      } else if (lastProductHandle) {
        handleVal = lastProductHandle
      } else if (skuVal) {
        handleVal = extractRootSku(skuVal)
      }
    }

    if (!handleVal) {
      errors.push({ row: rowNum, reason: 'Row has no handle, product name, or SKU to associate with a product.' })
      continue
    }

    lastProductHandle = handleVal

    // Price validation
    const costRaw = cell(idxCost)
    const costNum = Number(costRaw.replace(/[^0-9.]/g, ''))
    if (!costRaw || !Number.isFinite(costNum) || costNum <= 0) {
      errors.push({ row: rowNum, reason: `Invalid or missing Markaz cost price: "${costRaw}"`, column: mapping.wholesalePrice ?? 'Markaz Price' })
      continue
    }

    const priceRaw = cell(idxPrice)
    const priceNum = priceRaw ? Number(priceRaw.replace(/[^0-9.]/g, '')) : null
    const validPrice = priceNum !== null && Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null

    // Stock
    const stockRaw = cell(idxStock)
    const stockNum = stockRaw ? parseInt(stockRaw.replace(/[^0-9]/g, ''), 10) : 0
    const finalStock = Number.isFinite(stockNum) && stockNum >= 0 ? stockNum : 0

    // Variant details
    const variantSku = skuVal || `${handleVal}-${groups.get(handleVal)?.variants.length ?? 0 + 1}`
    const opt1Name = cell(idxOpt1N) || undefined
    const opt1Value = cell(idxOpt1V) || undefined
    const opt2Name = cell(idxOpt2N) || undefined
    const opt2Value = cell(idxOpt2V) || undefined
    const imageVal = cell(idxImage)

    // China / Advance payment detection
    const advVal = cell(idxAdv)
    const isAdv = isChinaAdvancePayment(advVal) || isChinaAdvancePayment(nameVal) || isChinaAdvancePayment(cell(idxDesc))

    // Quality metrics if available in row
    const ratingRaw = cell(idxRating)
    const ratingNum = ratingRaw ? parseFloat(ratingRaw) : null
    const reviewsRaw = cell(idxReviews)
    const reviewsNum = reviewsRaw ? parseInt(reviewsRaw, 10) : null
    const soldRaw = cell(idxSold)
    const soldNum = soldRaw ? parseInt(soldRaw, 10) : null

    const variant: ParsedVariant = {
      sku: variantSku,
      wholesalePrice: costNum,
      fileSellingPrice: validPrice,
      stock: finalStock,
      option1Name: opt1Name || (opt1Value ? 'Option 1' : undefined),
      option1Value: opt1Value,
      option2Name: opt2Name || (opt2Value ? 'Option 2' : undefined),
      option2Value: opt2Value,
      imageUrl: imageVal || undefined,
      rawRow: rowNum,
    }

    if (!groups.has(handleVal)) {
      // Determine category
      const rawCat = cell(idxCat)
      const matchedCat = productCategories.find((c) => c.toLowerCase() === rawCat.toLowerCase()) || 'Other'

      // Collect images (comma-separated or single)
      const initialImages: string[] = []
      if (imageVal) {
        imageVal.split(',').forEach((img) => {
          const t = img.trim()
          if (t && !initialImages.includes(t)) initialImages.push(t)
        })
      }

      groups.set(handleVal, {
        handle: handleVal,
        name: nameVal || handleVal,
        description: cell(idxDesc) || '',
        category: matchedCat,
        skuRoot: extractRootSku(variantSku),
        mainImageUrl: initialImages[0] ?? null,
        images: initialImages,
        wholesalePrice: costNum,
        fileSellingPrice: validPrice,
        totalStock: finalStock,
        isAdvancePayment: isAdv,
        rating: Number.isFinite(ratingNum) ? ratingNum : null,
        reviewCount: Number.isFinite(reviewsNum) ? reviewsNum : null,
        soldCount: Number.isFinite(soldNum) ? soldNum : null,
        hasQualityData: Boolean(ratingNum || reviewsNum || soldNum),
        variants: [variant],
        rawRows: [rowNum],
      })
    } else {
      const existing = groups.get(handleVal)!
      if (!existing.name && nameVal) existing.name = nameVal
      if (!existing.description && cell(idxDesc)) existing.description = cell(idxDesc)
      if (costNum < existing.wholesalePrice) existing.wholesalePrice = costNum
      if (validPrice !== null && (existing.fileSellingPrice === null || validPrice < existing.fileSellingPrice)) {
        existing.fileSellingPrice = validPrice
      }
      existing.totalStock += finalStock
      if (isAdv) existing.isAdvancePayment = true

      // Image collection
      if (imageVal) {
        imageVal.split(',').forEach((img) => {
          const t = img.trim()
          if (t && !existing.images.includes(t)) {
            existing.images.push(t)
            if (!existing.mainImageUrl) existing.mainImageUrl = t
          }
        })
      }

      existing.variants.push(variant)
      existing.rawRows.push(rowNum)
    }
  }

  return {
    layout,
    detectedHeaders: rawHeaders,
    mapping,
    products: Array.from(groups.values()),
    errors,
  }
}
