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
export type ApiConversation = {
  id: string
  channel: string
  status: string
  created_at: string
  updated_at: string
  customer_name: string
  phone: string
  last_message?: string
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
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) {
      const nextToken = retry && !path.startsWith('/api/auth/') ? await refreshAccessToken() : null
      if (nextToken) {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `******`)
        return request<T>(path, { ...init, headers }, false)
      }
      localStorage.removeItem('orbitly_token')
      localStorage.removeItem('orbitly_refresh_token')
      localStorage.removeItem('orbitly_user')
      window.dispatchEvent(new Event('orbitly-auth-expired'))
    }
    throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`)
  }
  return body as T
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: (email: string, password: string) => request<{ token: string; refreshToken: string; user: ApiUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, workspaceName: string) => request<{ token: string; refreshToken: string; user: ApiUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, workspaceName }) }),
  logout: (token: string) => request<{ success: boolean }>('/api/auth/logout', { method: 'POST', headers: auth(token) }),
  subscription: (token: string) => request<{ subscription: ApiSubscription }>('/api/subscription', { headers: auth(token) }),
  products: (token: string) => request<{ products: ApiProduct[] }>('/api/products', { headers: auth(token) }),
  createProduct: (token: string, product: { name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description?: string; supplierUrl?: string }) => request<{ product: ApiProduct }>('/api/products', { method: 'POST', headers: auth(token), body: JSON.stringify(product) }),
  updateProduct: (token: string, id: string, product: Partial<{ name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description: string; supplierUrl: string }>) => request<{ product: ApiProduct }>(`/api/products/${id}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify(product) }),
  deleteProduct: (token: string, id: string) => request<void>(`/api/products/${id}`, { method: 'DELETE', headers: auth(token) }),
  importProductsCsv: (token: string, csv: string) => request<{ importedCount: number; skipped: { row: number; reason: string }[] }>('/api/products/import/csv', { method: 'POST', headers: auth(token), body: JSON.stringify({ csv }) }),
  orders: (token: string) => request<{ orders: ApiOrder[] }>('/api/orders', { headers: auth(token) }),
  createOrder: (token: string, order: { customer: { name: string; phone: string; city?: string; address?: string }; productId: string; quantity: number; paymentMethod: string }) => request<{ order: ApiOrder }>('/api/orders', { method: 'POST', headers: auth(token), body: JSON.stringify(order) }),
  requestPaymentVerification: (token: string, data: { orderId: string; method: string; amount: number; reference?: string }) => request<{ verification: { id: string; status: string; created_at: string }; note: string }>('/api/payments/verification-requests', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  requestSupplierOrder: (token: string, data: { orderId: string; supplierKind: string }) => request<{ supplierOrder: { id: string; status: string; created_at: string }; note: string }>('/api/supplier-orders', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  conversations: (token: string) => request<{ conversations: ApiConversation[] }>('/api/conversations', { headers: auth(token) }),
  createConversation: (token: string, data: { customer: { name: string; phone: string; city?: string; address?: string }; channel: string }) => request<{ conversation: ApiConversation }>('/api/conversations', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  conversationMessages: (token: string, id: string) => request<{ messages: { id: string; direction: string; body: string; status: string; created_at: string }[] }>(`/api/conversations/${id}/messages`, { headers: auth(token) }),
  addConversationMessage: (token: string, id: string, data: { body: string; direction: string; status?: string }) => request<{ message: { id: string; direction: string; body: string; status: string; created_at: string }; note?: string }>(`/api/conversations/${id}/messages`, { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  generateContent: (token: string, data: { productId?: string; productName: string; category: string; platform: string; language: string; price?: number; brandVoice?: string }) => request<{ draft: ApiContentDraft }>('/api/content/generate', { method: 'POST', headers: auth(token), body: JSON.stringify(data) }),
  decideContentDraft: (token: string, id: string, decision: 'approved' | 'rejected') => request<{ draft: ApiContentDraft }>(`/api/content/drafts/${id}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision }) }),
  contentDrafts: (token: string) => request<{ drafts: ApiContentDraft[] }>('/api/content/drafts', { headers: auth(token) }),
}
