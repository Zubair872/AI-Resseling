// Purpose: pure billing and team rules (no database, no network) so they can be unit tested.
import { randomBytes } from 'node:crypto'

export type BillingCycle = 'monthly' | 'annual'
export type PlanPrices = { code: string; monthly_price: string | number; annual_price: string | number }
export type CouponRule = {
  percent_off: string | number | null
  amount_off: string | number | null
  plan_code: string | null
  max_redemptions: number | null
  redeemed_count: number
  expires_at: string | Date | null
  active: boolean
}

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function planPrice(plan: PlanPrices, cycle: BillingCycle) {
  return round2(Number(cycle === 'annual' ? plan.annual_price : plan.monthly_price))
}

export type CouponResult = { ok: true; discount: number; total: number } | { ok: false; reason: string }

// Discount is never larger than the subtotal, so an invoice total can never be negative.
export function applyCoupon(subtotal: number, planCode: string, coupon: CouponRule | null, now = new Date()): CouponResult {
  if (!coupon) return { ok: false, reason: 'Coupon code was not found' }
  if (!coupon.active) return { ok: false, reason: 'Coupon is not active' }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'Coupon has expired' }
  if (coupon.max_redemptions !== null && coupon.redeemed_count >= coupon.max_redemptions) return { ok: false, reason: 'Coupon has been fully used' }
  if (coupon.plan_code && coupon.plan_code !== planCode) return { ok: false, reason: `Coupon only applies to the ${coupon.plan_code} plan` }
  const raw = coupon.percent_off !== null ? subtotal * (Number(coupon.percent_off) / 100) : Number(coupon.amount_off ?? 0)
  const discount = round2(Math.min(Math.max(raw, 0), subtotal))
  return { ok: true, discount, total: round2(subtotal - discount) }
}

export function nextPeriodEnd(from: Date, cycle: BillingCycle) {
  const end = new Date(from.getTime())
  if (cycle === 'annual') end.setUTCFullYear(end.getUTCFullYear() + 1)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  return end
}

export function formatInvoiceNumber(sequence: number, date = new Date()) {
  const month = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  return `INV-${month}-${String(sequence).padStart(6, '0')}`
}

export type PlanLimits = { product_limit: number; social_account_limit: number; team_member_limit: number }
export type Usage = { products: number; socialAccounts: number; teamMembers: number }

// A downgrade is refused while the workspace still uses more than the new plan allows.
export function downgradeBlockers(usage: Usage, target: PlanLimits) {
  const reasons: string[] = []
  if (usage.products > target.product_limit) reasons.push(`You have ${usage.products} products; the new plan allows ${target.product_limit}`)
  if (usage.socialAccounts > target.social_account_limit) reasons.push(`You have ${usage.socialAccounts} social accounts; the new plan allows ${target.social_account_limit}`)
  if (usage.teamMembers > target.team_member_limit) reasons.push(`You have ${usage.teamMembers} team members; the new plan allows ${target.team_member_limit}`)
  return reasons
}

const assignable = ['admin', 'manager', 'staff', 'support_agent'] as const
export type AssignableRole = (typeof assignable)[number]
const rank: Record<string, number> = { staff: 10, support_agent: 10, manager: 20, admin: 30, owner: 40, super_admin: 50 }

// Only people ranked ABOVE a role may hand it out, and nobody can touch an owner or a higher role.
export function canAssignRole(actorRole: string, newRole: string) {
  if (!(assignable as readonly string[]).includes(newRole)) return false
  return (rank[actorRole] ?? 0) > (rank[newRole] ?? Number.MAX_SAFE_INTEGER)
}

export function canManageMember(actorRole: string, targetRole: string) {
  return (rank[actorRole] ?? 0) > (rank[targetRole] ?? Number.MAX_SAFE_INTEGER)
}

const referralAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function createReferralCode() {
  const bytes = randomBytes(8)
  return Array.from(bytes, (byte) => referralAlphabet[byte % referralAlphabet.length]).join('')
}
