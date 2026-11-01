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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`)
  return body as T
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: (email: string, password: string) => request<{ token: string; user: ApiUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, workspaceName: string) => request<{ token: string; user: ApiUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, workspaceName }) }),
  products: (token: string) => request<{ products: ApiProduct[] }>('/api/products', { headers: { Authorization: `Bearer ${token}` } }),
  createProduct: (token: string, product: { name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description?: string; supplierUrl?: string }) => request<{ product: ApiProduct }>('/api/products', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(product) }),
  updateProduct: (token: string, id: string, product: Partial<{ name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description: string; supplierUrl: string }>) => request<{ product: ApiProduct }>(`/api/products/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(product) }),
  deleteProduct: (token: string, id: string) => request<void>(`/api/products/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
  importProductsCsv: (token: string, csv: string) => request<{ importedCount: number; skipped: { row: number; reason: string }[] }>('/api/products/import/csv', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ csv }) }),
}
