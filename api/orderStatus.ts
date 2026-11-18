// Purpose: allowed order status transitions (from the master prompt's 11 statuses).
export const orderStatuses = ['new', 'pending_confirmation', 'payment_pending', 'payment_verified', 'processing', 'submitted_to_supplier', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'] as const
export type OrderStatus = (typeof orderStatuses)[number]

const transitions: Record<OrderStatus, OrderStatus[]> = {
  new: ['pending_confirmation', 'payment_pending', 'processing', 'cancelled'],
  pending_confirmation: ['payment_pending', 'processing', 'cancelled'],
  payment_pending: ['payment_verified', 'cancelled'],
  payment_verified: ['processing', 'cancelled', 'refunded'],
  processing: ['submitted_to_supplier', 'shipped', 'cancelled'],
  submitted_to_supplier: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: ['refunded'],
  refunded: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return transitions[from].includes(to)
}
