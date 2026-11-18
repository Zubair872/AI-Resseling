// Purpose: the tools the LLM assistant may call. All data access is injected (`ToolDeps`), so the tenant id is fixed by the server
// and the model can never ask for another workspace's data. Write-type tools only RECORD proposals; they never change the catalog.
import { calculatePrice } from './pricing.js'
import { categories, classifyProduct, type AutonomyMode } from './agents.js'
import { ToolError, f, objectValidator, type AgentTool } from './llmAgent.js'

export type ToolProduct = { id: string; name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; status: string; description?: string | null }
export type Proposal =
  | { kind: 'category_change'; productId: string; productName: string; from: string; to: string; reason: string }
  | { kind: 'price_change'; productId: string; productName: string; from: number; to: number; reason: string }

export type ToolDeps = {
  searchProducts(input: { query?: string; category?: string; limit: number }): Promise<ToolProduct[]>
  getProduct(id: string): Promise<ToolProduct | null>
  businessSummary(days: number): Promise<Record<string, unknown>>
  lowStock(threshold: number): Promise<{ id: string; name: string; stock: number }[]>
  recordProposal(proposal: Proposal): void
}

const brief = (p: ToolProduct) => ({ id: p.id, name: p.name, category: p.category, wholesalePrice: p.wholesalePrice, sellingPrice: p.sellingPrice, stock: p.stock, status: p.status })

export function buildAgentTools(deps: ToolDeps): AgentTool[] {
  return [
    {
      name: 'search_products', kind: 'read', description: 'Search this workspace\u2019s product catalog by words in the name and/or by category. Returns ids, prices (Rs.) and stock.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for in the product name' }, category: { type: 'string', enum: [...categories] }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
      validate: objectValidator({ query: f.str(100, true), category: f.oneOf(categories, true), limit: f.int(1, 20, true) }),
      run: async (a) => ({ products: (await deps.searchProducts({ query: a.query as string | undefined, category: a.category as string | undefined, limit: (a.limit as number | undefined) ?? 10 })).map(brief) }),
    },
    {
      name: 'get_product', kind: 'read', description: 'Get one product (including its description) by id.',
      parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'], additionalProperties: false },
      validate: objectValidator({ productId: f.uuid() }),
      run: async (a) => {
        const product = await deps.getProduct(a.productId as string)
        if (!product) throw new ToolError('Product not found in this workspace')
        return { ...brief(product), description: (product.description ?? '').slice(0, 1500) }
      },
    },
    {
      name: 'get_business_summary', kind: 'read', description: 'Orders, revenue, wholesale cost and gross profit for the last N days (cancelled/returned/refunded orders are excluded from revenue).',
      parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } }, additionalProperties: false },
      validate: objectValidator({ days: f.int(1, 90, true) }),
      run: async (a) => deps.businessSummary((a.days as number | undefined) ?? 30),
    },
    {
      name: 'list_low_stock', kind: 'read', description: 'Products whose stock is at or below a threshold.',
      parameters: { type: 'object', properties: { threshold: { type: 'integer', minimum: 0, maximum: 100 } }, additionalProperties: false },
      validate: objectValidator({ threshold: f.int(0, 100, true) }),
      run: async (a) => ({ products: await deps.lowStock((a.threshold as number | undefined) ?? 5) }),
    },
    {
      name: 'calculate_price', kind: 'read', description: 'Pure calculator: selling price and net profit from wholesale price, profit, shipping, payment fee % and discount. Does not change anything.',
      parameters: { type: 'object', properties: { wholesalePrice: { type: 'number' }, profitAmount: { type: 'number' }, profitPercent: { type: 'number' }, shippingCost: { type: 'number' }, paymentFeePercent: { type: 'number' }, discount: { type: 'number' } }, required: ['wholesalePrice'], additionalProperties: false },
      validate: objectValidator({ wholesalePrice: f.num(0, 10_000_000), profitAmount: f.num(0, 10_000_000, true), profitPercent: f.num(0, 1000, true), shippingCost: f.num(0, 1_000_000, true), paymentFeePercent: f.num(0, 100, true), discount: f.num(0, 10_000_000, true) }),
      run: async (a) => calculatePrice(a as Parameters<typeof calculatePrice>[0]),
    },
    {
      name: 'classify_product', kind: 'read', description: 'Rule-based category suggestion + restricted-product flags for a name/description. Does not change anything.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'], additionalProperties: false },
      validate: objectValidator({ name: f.str(180), description: f.str(4000, true) }),
      run: async (a) => classifyProduct({ name: a.name as string, description: a.description as string | undefined }),
    },
    {
      name: 'propose_category_change', kind: 'proposal', description: 'RECORD a suggestion to move a product to another category. Nothing changes until a person approves it.',
      parameters: { type: 'object', properties: { productId: { type: 'string' }, category: { type: 'string', enum: [...categories] }, reason: { type: 'string' } }, required: ['productId', 'category', 'reason'], additionalProperties: false },
      validate: objectValidator({ productId: f.uuid(), category: f.oneOf(categories), reason: f.str(300) }),
      run: async (a) => {
        const product = await deps.getProduct(a.productId as string)
        if (!product) throw new ToolError('Product not found in this workspace')
        if (product.category === a.category) throw new ToolError('The product is already in that category')
        deps.recordProposal({ kind: 'category_change', productId: product.id, productName: product.name, from: product.category, to: a.category as string, reason: a.reason as string })
        return { recorded: true, note: 'Proposal saved for a person to review. It is NOT applied yet.' }
      },
    },
    {
      name: 'propose_price_change', kind: 'proposal', description: 'RECORD a suggestion for a new selling price (Rs.). It can never be below the wholesale price. Nothing changes until a person approves it.',
      parameters: { type: 'object', properties: { productId: { type: 'string' }, newSellingPrice: { type: 'number' }, reason: { type: 'string' } }, required: ['productId', 'newSellingPrice', 'reason'], additionalProperties: false },
      validate: objectValidator({ productId: f.uuid(), newSellingPrice: f.num(1, 10_000_000), reason: f.str(300) }),
      run: async (a) => {
        const product = await deps.getProduct(a.productId as string)
        if (!product) throw new ToolError('Product not found in this workspace')
        const price = Math.round((a.newSellingPrice as number) * 100) / 100
        if (price < product.wholesalePrice) throw new ToolError(`Refused: Rs. ${price} is below the wholesale price Rs. ${product.wholesalePrice}`)
        if (price === product.sellingPrice) throw new ToolError('The product already has that price')
        deps.recordProposal({ kind: 'price_change', productId: product.id, productName: product.name, from: product.sellingPrice, to: price, reason: a.reason as string })
        return { recorded: true, note: 'Proposal saved for a person to review. It is NOT applied yet.' }
      },
    },
  ]
}

// Even in Full mode an LLM suggestion is auto-applied only if (a) it is a category change, (b) the independent rule-based classifier agrees,
// and (c) no restricted-product flag exists. Price changes and everything else always wait for a person.
export function shouldAutoApply(mode: AutonomyMode, proposal: Proposal, product: { name: string; description?: string | null }) {
  if (mode !== 'full' || proposal.kind !== 'category_change') return false
  const rule = classifyProduct({ name: product.name, description: product.description })
  return rule.category === proposal.to && rule.confidence >= 0.65 && rule.restrictedFlags.length === 0
}
