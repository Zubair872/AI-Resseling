const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export type ApiUser = { id: string; tenantId: string; email: string; role: string }
export type ApiProduct = {
  id: string
  name: string
  description?: string
  category: string
  wholesale_price: string
  selling_price: string
  stock: number
  status: string
  supplier_url?: string
  image_url?: string | null
  created_at: string
}
export type ApiOrder = {
  id: string
  quantity: number
  total_amount: string
  payment_method: string
  status: string
  created_at: string
  customer_name: string
  phone: string
  product_name: string
}
export type ApiChatMessage = { reply_mode?: string; template_name?: string | null; id: string; direction: 'inbound' | 'outbound'; body: string; status: 'draft' | 'approved' | 'sent'; ai_generated?: boolean; sent_at?: string | null; last_error?: string | null; created_at: string }
export type ApiConversation = {
  id: string
  customer_id?: string
  channel: string
  status: string
  human_takeover?: boolean
  last_inbound_at?: string | null
  external_thread_id?: string | null
  created_at: string
  updated_at: string
  customer_name: string
  phone: string
  last_message?: string
  order_id?: string | null
  order_status?: string | null
  inbound_count?: number
}
export type ApiProductVariant = {
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
export type ApiChatSetup = {
  callbackUrl: string
  publicApiUrl: string
  verifyToken: string
  webhookVerified: boolean
  lastWebhookAt: string | null
  lastMessageAt: string | null
}
export type ApiContentDraft = {
  id: string
  product_id?: string
  platform: string
  language: string
  content: { caption: string; hashtags: string[]; disclaimer: string }
  status: string
  created_at: string
}
export type ApiSocialAccount = { id: string; platform: string; display_name: string; external_account_id?: string; category?: string | null; daily_limit: number; status: string; created_at: string }
export type ApiAdminTenant = { id: string; name: string; status: string; created_at: string; plan_code?: string; subscription_status?: string; users: number; products: number; orders: number }
export type ApiNotification = { id: string; kind: string; title: string; body?: string | null; read_at?: string | null; created_at: string }
export type ApiAnalytics = { summary: { products: number; socialAccounts: number; conversations: number; orders: number; openOrders: number; completedOrders: number; cancelledOrders: number; revenue: number; wholesaleCost: number; grossProfit: number; note: string }; byCategory: { category: string; orders: number; revenue: number }[] }
export type ApiIntegration = { connected_via?: 'manual' | 'oauth'; token_expires_at?: string | null; id: string; provider: 'buffer' | 'markaz' | 'meta' | 'whatsapp' | 'tiktok' | 'custom'; label: string; base_url?: string | null; config: Record<string, string>; secret_hint?: string | null; enabled: boolean; status: 'unverified' | 'verified' | 'failed'; status_message?: string | null; last_checked_at?: string | null }
export type SourcingSettings = { rules: { minRating: number; minReviews: number; minSold: number }; profit: { fixed: number; percent: number | null } }
export type MarkazPreviewRow = { row: number; name: string; wholesalePrice: number; sellingPrice: number; profit: number; rating: number | null; reviewCount: number | null; soldCount: number | null }
export type MarkazRejectedRow = { row: number; name?: string; sku?: string; reasons: string[] }

export type MarkazExportPreviewItem = {
  handle: string
  name: string
  skuRoot: string
  wholesalePrice: number
  fileSellingPrice: number | null
  sellingPrice: number
  profit: number
  variantsCount: number
  isAdvancePayment: boolean
  imagesCount: number
  mainImageUrl: string | null
  isUpdate: boolean
  rawRows: number[]
}

export type MarkazExportPreviewResult = {
  dryRun: boolean
  layout: 'shopify' | 'woocommerce' | 'generic'
  detectedHeaders: string[]
  mapping: Record<string, string | null>
  totalGrouped: number
  eligible: MarkazExportPreviewItem[]
  rejected: MarkazRejectedRow[]
  priceStrategy: 'profit_rule' | 'file_price'
  qualityRulesNotice: string
  newCount?: number
  updatedCount?: number
  note?: string
}
export type ApiPublishingJob = { id: string; scheduled_for: string; status: string; attempts: number; last_error?: string | null; external_post_id?: string | null; account: string; platform: string }
export type ApiTeamMember = { id: string; email: string; role: string; is_active: boolean; created_at: string }
export type ApiTeamInvite = { id: string; email: string; role: string; expires_at: string }
export type ApiInvoice = { id: string; number: string; plan_code: string; billing_cycle: string; subtotal: string; discount: string; total: string; currency: string; status: string; payment_reference?: string | null; paid_at?: string | null; created_at: string; workspace?: string }
export type ApiPlan = { code: string; name: string; monthly_price: string; annual_price: string; product_limit: number; social_account_limit: number; ai_action_limit: number; team_member_limit: number }
export type ApiBilling = { subscription: { status: string; billing_cycle: string; current_period_end: string; cancel_at_period_end: boolean; code: string; name: string; product_limit: number; social_account_limit: number; team_member_limit: number } | null; invoices: ApiInvoice[]; plans: ApiPlan[]; usage: { products: number; socialAccounts: number; teamMembers: number; pendingInvites: number }; paymentNote: string }
export type ApiCoupon = { id: string; code: string; percent_off: string | null; amount_off: string | null; plan_code: string | null; max_redemptions: number | null; redeemed_count: number; expires_at: string | null; active: boolean }
export type ApiAgent = { key: string; name: string; runnable: boolean; note: string; runs: number; lastRun: string | null }
export type ApiAgentRun = { id: string; agent: string; status: string; autonomy_mode: string; output: Record<string, unknown>; created_at?: string }
export type ApiCalendarJob = { id: string; scheduled_for: string; status: string; account: string; platform: string; day: string }
export type ApiSubscription = {
  status: string
  billing_cycle: string
  current_period_end: string
  code: string
  name: string
  product_limit: number
  social_account_limit: number
  ai_action_limit: number
  used_ai_actions: number
}

export type ApiOAuthInfo = { configured: boolean; redirectUri: string | null; scopes: string[]; missing: string[] }
export type ApiMetaPage = { id: string; name: string; instagramId: string | null; instagramUsername: string | null }
export type ApiWaTemplate = { id: string; name: string; language: string; category: string; status: string; body_text: string; variable_count: number; rejected_reason?: string | null }
export type ApiLlmOutput = { answer: string; stoppedBy: string; llmCalls: number; trace: { step: number; tool: string; kind: string; ok: boolean; result: string }[]; proposals: { kind: string; productName: string; from: string | number; to: string | number; reason: string; applied?: boolean; note?: string }[]; autoApplied: string[] }
export type ApiMarketplaceRow = { row: number; name: string; category: string; categoryFromRules: boolean; sourcePrice: number; sourceCurrency: string; wholesalePrice: number; sellingPrice: number; profit: number; rating: number | null; ratingApproximate: boolean; reviewCount: number | null; soldCount: number | null; stock: number }
export type ApiMarketplaceResult = { dryRun: boolean; total?: number; eligible?: ApiMarketplaceRow[]; imported?: number; rejected: { row: number; name?: string; reasons: string[] }[]; columns?: Record<string, string | null>; notes: string[] }

let refreshInFlight: Promise<string | null> | null = null

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('orbitly_refresh_token')
  if (!refreshToken) return null
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { token?: string; refreshToken?: string; user?: ApiUser }
      if (!response.ok || !body.token || !body.refreshToken || !body.user) return null
      localStorage.setItem('orbitly_token', body.token)
      localStorage.setItem('orbitly_refresh_token', body.refreshToken)
      localStorage.setItem('orbitly_user', JSON.stringify(body.user))
      return body.token
    }).catch(() => null).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    })
  } catch {
    throw new Error(`Could not reach the API at ${API_URL}. Start the API with "npm run api:dev" and try again.`)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) {
      const nextToken = retry && !path.startsWith('/api/auth/') ? await refreshAccessToken() : null
      if (nextToken) {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Bearer ${nextToken}`)
        return request<T>(path, { ...init, headers }, false)
      }
      localStorage.removeItem('orbitly_token')
      localStorage.removeItem('orbitly_refresh_token')
      localStorage.removeItem('orbitly_user')
      window.dispatchEvent(new Event('orbitly-auth-expired'))
    }
    const reasons = Array.isArray(body.reasons) ? ` (${body.reasons.join('; ')})` : ''
    throw new Error((typeof body.error === 'string' ? body.error : `Request failed (${response.status})`) + reasons)
  }
  return body as T
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: (email: string, password: string) => request<{ token: string; refreshToken: string; user: ApiUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, workspaceName: string, referralCode?: string) => request<{ token: string; refreshToken: string; user: ApiUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, workspaceName, referralCode }) }),
  logout: (token: string) => request<{ success: boolean }>('/api/auth/logout', { method: 'POST', headers: auth(token) }),
  subscription: (token: string) => request<{ subscription: ApiSubscription }>('/api/subscription', { headers: auth(token) }),
  products: (token: string) => request<{ products: ApiProduct[] }>('/api/products', { headers: auth(token) }),
  createProduct: (token: string, product: { name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description?: string; supplierUrl?: string }) => request<{ product: ApiProduct }>('/api/products', { method: 'POST', headers: auth(token), body: JSON.stringify(product) }),
  updateProduct: (token: string, id: string, product: Partial<{ name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description: string; supplierUrl: string }>) => request<{ product: ApiProduct }>(`/api/products/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(product) }),
  deleteProduct: (token: string, id: string) => request<void>(`/api/products/${id}`, { method: 'DELETE', headers: auth(token) }),
  importProductsCsv: (token: string, csv: string) => request<{ importedCount: number; skipped: { row: number; reason: string }[] }>('/api/products/import/csv', { method: 'POST', headers: auth(token), body: JSON.stringify({ csv }) }),
  updateOrderStatus: (token: string, id: string, status: string) => request<{ order: { id: string; status: string } }>(`/api/orders/${id}/status`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ status }) }),
  socialAccounts: (token: string) => request<{ accounts: ApiSocialAccount[] }>('/api/social-accounts', { headers: auth(token) }),
  createSocialAccount: (token: string, data: { platform: string; displayName: string; externalAccountId?: string; category?: string; dailyLimit: number }) => request<{ account: ApiSocialAccount; note: string }>('/api/social-accounts', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  createPublishingJob: (token: string, data: { contentDraftId: string; socialAccountId: string; scheduledFor: string }) => request<{ job: { id: string; scheduled_for: string; status: string } }>('/api/publishing/jobs', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  adminTenants: (token: string) => request<{ tenants: ApiAdminTenant[] }>('/api/admin/tenants', { headers: auth(token) }),
  setTenantStatus: (token: string, id: string, status: 'active' | 'suspended') => request<{ tenant: { id: string; status: string } }>(`/api/admin/tenants/${id}/status`, { method: 'POST', headers: auth(token), body: JSON.stringify({ status }) }),
  forgotPassword: (email: string) => request<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => request<{ success: boolean }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  verifyEmail: (token: string) => request<{ verified: boolean }>('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: (token: string) => request<{ message: string }>('/api/auth/resend-verification', { method: 'POST', headers: auth(token) }),
  notifications: (token: string) => request<{ notifications: ApiNotification[]; unread: number }>('/api/notifications', { headers: auth(token) }),
  markNotificationRead: (token: string, id: string) => request<{ success: boolean }>(`/api/notifications/${id}/read`, { method: 'POST', headers: auth(token) }),
  markAllNotificationsRead: (token: string) => request<{ success: boolean }>('/api/notifications/read-all', { method: 'POST', headers: auth(token) }),
  analytics: (token: string) => request<ApiAnalytics>('/api/analytics/summary', { headers: auth(token) }),
  exportOrdersCsv: async (token: string) => {
    const response = await fetch(`${API_URL}/api/exports/orders.csv`, { headers: auth(token) })
    if (!response.ok) throw new Error(`Export failed (${response.status})`)
    return response.text()
  },
  exportDataset: async (token: string, dataset: string, format: 'csv' | 'xls') => {
    const response = await fetch(`${API_URL}/api/exports/${dataset}?format=${format}`, { headers: auth(token) })
    if (!response.ok) throw new Error(`Export failed (${response.status})`)
    return response.blob()
  },
  syncSheets: (token: string, data: { dataset: string; spreadsheetId: string; tab: string }) => request<{ status: string; rows: number; note: string }>('/api/exports/sheets', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  startCheckout: (token: string) => request<{ url: string }>('/api/billing/checkout', { method: 'POST', headers: auth(token) }),
  connectTikTok: (token: string, id: string) => request<{ note: string }>(`/api/integrations/${id}/connect-tiktok-account`, { method: 'POST', headers: auth(token) }),
  integrations: (token: string) => request<{ integrations: ApiIntegration[] }>('/api/integrations', { headers: auth(token) }),
  createIntegration: (token: string, data: { provider: string; label: string; baseUrl?: string; config?: Record<string, string>; secret?: string }) => request<{ integration: ApiIntegration }>('/api/integrations', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  updateIntegration: (token: string, id: string, data: { label?: string; baseUrl?: string; config?: Record<string, string>; secret?: string; enabled?: boolean }) => request<{ integration: ApiIntegration }>(`/api/integrations/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(data) }),
  deleteIntegration: (token: string, id: string) => request<void>(`/api/integrations/${id}`, { method: 'DELETE', headers: auth(token) }),
  testIntegration: (token: string, id: string) => request<{ status: string; message: string }>(`/api/integrations/${id}/test`, { method: 'POST', headers: auth(token) }),
  syncChannels: (token: string, id: string) => request<{ created: number; updated: number; skipped: string[]; note?: string }>(`/api/integrations/${id}/sync-channels`, { method: 'POST', headers: auth(token) }),
  sourcingSettings: (token: string) => request<{ settings: SourcingSettings }>('/api/sourcing/settings', { headers: auth(token) }),
  saveSourcingSettings: (token: string, data: { minRating: number; minReviews: number; minSold: number; profitAmount: number; profitPercent: number | null }) => request<{ settings: SourcingSettings }>('/api/sourcing/settings', { method: 'PUT', headers: auth(token), body: JSON.stringify(data) }),
  markazImport: (token: string, csv: string, dryRun: boolean) => request<{ dryRun: boolean; eligible?: MarkazPreviewRow[]; imported?: number; rejected: MarkazRejectedRow[]; note?: string }>('/api/sourcing/markaz/import', { method: 'POST', headers: auth(token), body: JSON.stringify({ csv, dryRun }) }),
  markazExportImport: (token: string, data: { csv: string; dryRun: boolean; priceStrategy: 'profit_rule' | 'file_price'; mapping?: Record<string, string | null> }) => request<MarkazExportPreviewResult>('/api/sourcing/markaz/export-import', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  addSourcedProduct: (token: string, data: { name: string; category: string; wholesalePrice: number; profitAmount?: number; stock: number; imageUrl?: string; productUrl?: string; rating?: number; reviewCount?: number; soldCount?: number }) => request<{ product: { id: string; selling_price: string } }>('/api/sourcing/products', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  publishingJobs: (token: string) => request<{ jobs: ApiPublishingJob[] }>('/api/publishing/jobs', { headers: auth(token) }),
  retryPublishingJob: (token: string, id: string) => request<{ delivery: { status: string; message: string } }>(`/api/publishing/jobs/${id}/retry`, { method: 'POST', headers: auth(token) }),
  orders: (token: string) => request<{ orders: ApiOrder[] }>('/api/orders', { headers: auth(token) }),
  createOrder: (token: string, order: { customer: { name: string; phone: string; city?: string; address?: string }; productId: string; quantity: number; paymentMethod: string }) => request<{ order: ApiOrder }>('/api/orders', { method: 'POST', headers: auth(token), body: JSON.stringify(order) }),
  requestPaymentVerification: (token: string, data: { orderId: string; method: string; amount: number; reference?: string }) => request<{ verification: { id: string; status: string; created_at: string }; note: string }>('/api/payments/verification-requests', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  requestSupplierOrder: (token: string, data: { orderId: string; supplierKind: string }) => request<{ supplierOrder: { id: string; status: string; created_at: string }; note: string }>('/api/supplier-orders', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  conversations: (token: string) => request<{ conversations: ApiConversation[] }>('/api/conversations', { headers: auth(token) }),
  createConversation: (token: string, data: { customer: { name: string; phone: string; city?: string; address?: string }; channel: string }) => request<{ conversation: ApiConversation }>('/api/conversations', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  conversationMessages: (token: string, id: string) => request<{ messages: ApiChatMessage[] }>(`/api/conversations/${id}/messages`, { headers: auth(token) }),
  chatCreateReply: (token: string, id: string, body: string) => request<{ message: { id: string } }>(`/api/conversations/${id}/messages`, { method: 'POST', headers: auth(token), body: JSON.stringify({ body, direction: 'outbound' }) }),
  chatEditReply: (token: string, id: string, messageId: string, body: string) => request<{ message: { id: string } }>(`/api/conversations/${id}/messages/${messageId}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ body }) }),
  chatSend: (token: string, id: string, messageId: string) => request<{ status: string; message: string }>(`/api/conversations/${id}/messages/${messageId}/send`, { method: 'POST', headers: auth(token) }),
  chatUpdate: (token: string, id: string, data: { humanTakeover?: boolean; status?: string }) => request<{ conversation: { id: string } }>(`/api/conversations/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(data) }),
  chatCreateOrder: (token: string, id: string, data: { productId: string; variantId?: string; variantSku?: string; variantTitle?: string; quantity: number; name: string; phone: string; city: string; address: string; paymentMethod: string; notes?: string }) => request<{ order: { id: string } }>(`/api/conversations/${id}/create-order`, { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  markazSummary: (token: string, orderId: string) => request<{ summary: string; note: string }>(`/api/orders/${orderId}/markaz-summary`, { headers: auth(token) }),
  conversationMarkazSummary: (token: string, id: string) => request<{ summary: string; orderId: string }>(`/api/conversations/${id}/markaz-summary`, { headers: auth(token) }),
  productVariants: (token: string, productId: string) => request<{ variants: ApiProductVariant[] }>(`/api/products/${productId}/variants`, { headers: auth(token) }),
  chatSetup: (token: string) => request<ApiChatSetup>('/api/chat/setup', { headers: auth(token) }),
  updateChatSetup: (token: string, data: { publicApiUrl?: string; verifyToken?: string }) => request<ApiChatSetup>('/api/chat/setup', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  addConversationMessage: (token: string, id: string, data: { body: string; direction: string; status?: string }) => request<{ message: { id: string; direction: string; body: string; status: string; created_at: string }; note?: string }>(`/api/conversations/${id}/messages`, { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  generateContent: (token: string, data: { productId?: string; productName: string; category: string; platform: string; language: string; price?: number; brandVoice?: string }) => request<{ draft: ApiContentDraft }>('/api/content/generate', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  decideContentDraft: (token: string, id: string, decision: 'approved' | 'rejected') => request<{ draft: ApiContentDraft }>(`/api/content/drafts/${id}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision }) }),
  team: (token: string) => request<{ members: ApiTeamMember[]; invites: ApiTeamInvite[]; memberLimit: number }>('/api/team', { headers: auth(token) }),
  inviteMember: (token: string, data: { email: string; role: string }) => request<{ invite: ApiTeamInvite; emailDelivered: boolean; note: string }>('/api/team/invites', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  revokeInvite: (token: string, id: string) => request<void>(`/api/team/invites/${id}`, { method: 'DELETE', headers: auth(token) }),
  updateMember: (token: string, id: string, data: { role?: string; isActive?: boolean }) => request<{ member: ApiTeamMember }>(`/api/team/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(data) }),
  acceptInvite: (token: string, password: string) => request<{ token: string; refreshToken: string; user: ApiUser }>('/api/team/accept', { method: 'POST', body: JSON.stringify({ token, password }) }),
  billing: (token: string) => request<ApiBilling>('/api/billing', { headers: auth(token) }),
  billingQuote: (token: string, data: { planCode: string; cycle: string; couponCode?: string }) => request<{ subtotal: number; discount: number; total: number; currency: string }>('/api/billing/quote', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  changePlan: (token: string, data: { planCode: string; cycle: string; couponCode?: string }) => request<{ invoice: ApiInvoice; applied: boolean; note: string }>('/api/billing/change-plan', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  cancelPlan: (token: string) => request<{ note: string }>('/api/billing/cancel', { method: 'POST', headers: auth(token) }),
  resumePlan: (token: string) => request<{ cancelAtPeriodEnd: boolean }>('/api/billing/resume', { method: 'POST', headers: auth(token) }),
  invoiceDocument: async (token: string, id: string) => {
    const response = await fetch(`${API_URL}/api/invoices/${id}/document`, { headers: auth(token) })
    if (!response.ok) throw new Error(`Could not load invoice (${response.status})`)
    return response.text()
  },
  referral: (token: string) => request<{ code: string; link: string; referredWorkspaces: number; note: string }>('/api/referrals', { headers: auth(token) }),
  adminInvoices: (token: string, status?: string) => request<{ invoices: ApiInvoice[] }>(`/api/admin/invoices${status ? `?status=${status}` : ''}`, { headers: auth(token) }),
  markInvoicePaid: (token: string, id: string, reference: string) => request<{ invoice: ApiInvoice }>(`/api/admin/invoices/${id}/mark-paid`, { method: 'POST', headers: auth(token), body: JSON.stringify({ reference }) }),
  voidInvoice: (token: string, id: string) => request<{ success: boolean }>(`/api/admin/invoices/${id}/void`, { method: 'POST', headers: auth(token) }),
  adminCoupons: (token: string) => request<{ coupons: ApiCoupon[] }>('/api/admin/coupons', { headers: auth(token) }),
  createCoupon: (token: string, data: { code: string; percentOff?: number; amountOff?: number; planCode?: string; maxRedemptions?: number }) => request<{ coupon: ApiCoupon }>('/api/admin/coupons', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  setCouponActive: (token: string, id: string, active: boolean) => request<{ coupon: ApiCoupon }>(`/api/admin/coupons/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ active }) }),
  agents: (token: string) => request<{ mode: string; agents: ApiAgent[]; note: string }>('/api/agents', { headers: auth(token) }),
  setAgentMode: (token: string, mode: string) => request<{ mode: string }>('/api/agents/mode', { method: 'PUT', headers: auth(token), body: JSON.stringify({ mode }) }),
  agentRuns: (token: string) => request<{ runs: ApiAgentRun[] }>('/api/agents/runs', { headers: auth(token) }),
  runAgent: (token: string, data: { agent: string; productId?: string; text?: string; profitAmount?: number; profitPercent?: number }) => request<{ run: ApiAgentRun }>('/api/agents/run', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  decideAgentRun: (token: string, id: string, decision: 'approved' | 'rejected') => request<{ status: string }>(`/api/agents/runs/${id}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision }) }),
  parsePaymentText: (token: string, text: string) => request<{ parsed: { transactionId: string | null; amount: number | null; warnings: string[] }; note: string }>('/api/payments/parse-text', { method: 'POST', headers: auth(token), body: JSON.stringify({ text }) }),
  uploadImage: (token: string, data: { kind: 'product_image' | 'payment_proof'; contentType: string; dataBase64: string }) => request<{ id: string; url: string; note: string }>('/api/uploads', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  updateSocialAccount: (token: string, id: string, data: { displayName?: string; category?: string | null; dailyLimit?: number }) => request<{ account: ApiSocialAccount }>(`/api/social-accounts/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(data) }),
  deleteSocialAccount: (token: string, id: string) => request<void>(`/api/social-accounts/${id}`, { method: 'DELETE', headers: auth(token) }),
  calendar: (token: string) => request<{ timezone: string; jobs: ApiCalendarJob[] }>('/api/publishing/calendar', { headers: auth(token) }),
  autopilot: (token: string) => request<{ enabled: boolean; language: string; autonomyMode: string; note: string }>('/api/autopilot', { headers: auth(token) }),
  saveAutopilot: (token: string, data: { enabled: boolean; language: string }) => request<{ enabled: boolean; language: string }>('/api/autopilot', { method: 'PUT', headers: auth(token), body: JSON.stringify(data) }),
  runAutopilot: (token: string, data: { days: number }) => request<{ scheduled: number; draftsWaitingApproval: number; sent: number; notes: string[] }>('/api/autopilot/run', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  contentDrafts: (token: string) => request<{ drafts: ApiContentDraft[] }>('/api/content/drafts', { headers: auth(token) }),
  oauthStatus: (token: string) => request<{ meta: ApiOAuthInfo; tiktok: ApiOAuthInfo }>('/api/oauth/status', { headers: auth(token) }),
  oauthStart: (token: string, provider: 'meta' | 'tiktok') => request<{ url: string }>(`/api/oauth/${provider}/start`, { method: 'POST', headers: auth(token) }),
  oauthPending: (token: string, selection: string) => request<{ pages: ApiMetaPage[] }>(`/api/oauth/pending?token=${encodeURIComponent(selection)}`, { headers: auth(token) }),
  oauthFinishMeta: (token: string, data: { token: string; pageId: string; aiMode: string; commentReplyMode: string }) => request<{ message: string; note: string; webhookSubscribed: boolean }>('/api/oauth/meta/finish', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  waTemplates: (token: string) => request<{ templates: ApiWaTemplate[]; connected: boolean; wabaIdSet: boolean }>('/api/whatsapp/templates', { headers: auth(token) }),
  waSync: (token: string) => request<{ synced: number; note: string }>('/api/whatsapp/templates/sync', { method: 'POST', headers: auth(token) }),
  waCreate: (token: string, data: { name: string; language: string; category: string; bodyText: string; headerText?: string; footerText?: string; examples: string[] }) => request<{ warnings: string[]; note: string }>('/api/whatsapp/templates', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  waDelete: (token: string, id: string) => request<void>(`/api/whatsapp/templates/${id}`, { method: 'DELETE', headers: auth(token) }),
  waOptIn: (token: string, customerId: string, optIn: boolean, source?: string) => request<{ customer: { id: string; whatsapp_opt_in: boolean } }>(`/api/customers/${customerId}/whatsapp-opt-in`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ optIn, source }) }),
  sendTemplate: (token: string, conversationId: string, templateId: string, params: string[]) => request<{ body: string; note: string }>(`/api/conversations/${conversationId}/send-template`, { method: 'POST', headers: auth(token), body: JSON.stringify({ templateId, params }) }),
  llmStatus: (token: string) => request<{ enabled: boolean; model: string; note: string }>('/api/agents/llm/status', { headers: auth(token) }),
  llmRun: (token: string, goal: string) => request<{ run: { id: string; status: string; output: ApiLlmOutput; tokens_used: number; cost_estimate: number } }>('/api/agents/llm/run', { method: 'POST', headers: auth(token), body: JSON.stringify({ goal }) }),
  marketplaces: (token: string) => request<{ marketplaces: { key: string; label: string; defaultCurrency: string; note: string }[]; fields: string[] }>('/api/sourcing/marketplaces', { headers: auth(token) }),
  marketplaceImport: (token: string, data: Record<string, unknown>) => request<ApiMarketplaceResult>('/api/sourcing/marketplace/import', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
}

export type ApiChannel = { id: string; provider: string; label: string; config: Record<string, string>; secret_hint: string | null; enabled: boolean; status: string; status_message: string | null; last_checked_at: string | null; account_id: string | null; display_name: string | null; daily_limit: number | null; category: string | null; account_status: string | null }
export type ApiScrapedProduct = { name: string; category: string; wholesalePrice: number; sellingPrice: number; profit: number; imageUrl: string | null; url: string; stockLeft: number | null; readFrom: string[] }
export type ApiScrapeResult = { dryRun: boolean; imported?: number; products: ApiScrapedProduct[]; linksFound: number; failures: { url: string; reason: string }[]; notes: string[]; rejected: { name: string; reasons: string[] }[] }
export type ApiMarkazAuto = { enabled: boolean; urls: string[]; perRun: number; lastRun: string | null; lastMessage: string | null }
export type ApiPostResult = { results: { accountId: string; account?: string; status: string; message: string }[] }

export const studioApi = {
  channels: (token: string) => request<{ channels: ApiChannel[]; available: string[] }>('/api/channels', { headers: auth(token) }),
  connectChannel: (token: string, data: { provider: string; secret: string; config: Record<string, string> }) => request<{ id: string; accountId: string; message: string }>('/api/channels', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  testChannel: (token: string, id: string) => request<{ status: string; message: string }>(`/api/channels/${id}/test`, { method: 'POST', headers: auth(token) }),
  deleteChannel: (token: string, id: string) => request<void>(`/api/channels/${id}`, { method: 'DELETE', headers: auth(token) }),
  scrape: (token: string, data: { url: string; limit: number; pages: number; category?: string; defaultStock: number; profitAmount?: number; dryRun: boolean }) => request<ApiScrapeResult>('/api/markaz/scrape', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  markazAuto: (token: string) => request<ApiMarkazAuto>('/api/markaz/auto', { headers: auth(token) }),
  saveMarkazAuto: (token: string, data: { enabled: boolean; urls: string[]; perRun: number }) => request<{ enabled: boolean; urls: string[]; perRun: number }>('/api/markaz/auto', { method: 'PUT', headers: auth(token), body: JSON.stringify(data) }),
  runMarkazAuto: (token: string) => request<{ imported: number; failures: number; message: string }>('/api/markaz/auto/run', { method: 'POST', headers: auth(token) }),
  postProduct: (token: string, productId: string, data: { accountIds: string[]; language: string; scheduledFor?: string; repost: boolean }) => request<ApiPostResult>(`/api/products/${productId}/post`, { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
}

// The API may still be starting when the page opens: wait and try again instead of failing at once.
export async function retryLoad<T>(load: () => Promise<T>, tries = 10): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await load() } catch (reason) {
      if (attempt >= tries || !(reason instanceof Error) || !reason.message.startsWith('Could not reach')) throw reason
      await new Promise((resolve) => window.setTimeout(resolve, 2500))
    }
  }
}
