export type PricingInput = {
  wholesalePrice: number
  profitAmount?: number
  profitPercent?: number
  shippingCost?: number
  paymentFeePercent?: number
  discount?: number
}

export function calculatePrice(input: PricingInput) {
  const profit = input.profitAmount ?? input.wholesalePrice * ((input.profitPercent ?? 0) / 100)
  const shipping = input.shippingCost ?? 0
  const discount = input.discount ?? 0
  const subtotal = input.wholesalePrice + profit + shipping
  const paymentFee = subtotal * ((input.paymentFeePercent ?? 0) / 100)
  const sellingPrice = Math.max(0, subtotal + paymentFee - discount)
  const netProfit = sellingPrice - input.wholesalePrice - shipping - paymentFee
  return { sellingPrice: Number(sellingPrice.toFixed(2)), paymentFee: Number(paymentFee.toFixed(2)), netProfit: Number(netProfit.toFixed(2)) }
}
