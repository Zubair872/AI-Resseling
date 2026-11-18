// Purpose: pure plan-limit check used for products, social accounts and AI actions.
export function checkLimit(used: number, limit: number, adding = 1) {
  const remaining = Math.max(limit - used, 0)
  return { allowed: used + adding <= limit, remaining }
}
