// Purpose: pure pre-publish validation (no DB/network) so rules are unit-testable.
export type PublishCheckInput = {
  account: { status: string; platform: string; category: string | null; dailyLimit: number; postedToday: number }
  product: { category: string; stock: number; imageUrl?: string | null } | null
  draft: { status: string; platform: string }
  requireApproval: boolean
}

export function validatePublish(input: PublishCheckInput): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const { account, product, draft } = input
  if (account.status !== 'connected') errors.push('Account is not connected')
  if (draft.platform !== account.platform) errors.push('Content platform does not match the account platform')
  if (account.category && product && product.category !== account.category) errors.push('Product category does not match the account category')
  if (account.postedToday >= account.dailyLimit) errors.push('Daily posting limit reached')
  if (!product || product.stock <= 0) errors.push('Product is not available')
  if (product && ['instagram', 'tiktok'].includes(account.platform) && !product.imageUrl) errors.push('This platform needs a product image')
  if (input.requireApproval && draft.status !== 'approved') errors.push('Content is not approved')
  return { ok: errors.length === 0, errors }
}
