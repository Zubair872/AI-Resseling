import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, Bot, Boxes, ChevronDown,
  CircleHelp, ClipboardList, CreditCard, ExternalLink, FileText, Filter, Globe2,
  Grid2X2, Headphones, LayoutDashboard, LineChart, ListFilter, Menu, MessageSquare,
  Moon, MoreHorizontal, PackageCheck, PanelLeftClose, Plus, Search, Settings,
  ShoppingBag, Sparkles, Sun, Tag, Users, WalletCards, X, Zap,
} from 'lucide-react'
import { api, type ApiContentDraft, type ApiConversation, type ApiOrder, type ApiSubscription, type ApiUser } from './api'

type PageKey = 'Overview' | 'Products' | 'Sources' | 'Content Studio' | 'Publishing' | 'Orders' | 'Customers' | 'Analytics' | 'Billing' | 'Team' | 'Settings'
type Product = { id?: string; name: string; category: string; price: string; margin: string; stock: number; status: string; image: string; sku: string }
type NewProduct = { name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description?: string }

const nav: { label: PageKey; icon: typeof LayoutDashboard; section?: string }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Products', icon: Boxes },
  { label: 'Sources', icon: Globe2 },
  { label: 'Content Studio', icon: Sparkles },
  { label: 'Publishing', icon: Zap },
  { label: 'Orders', icon: ClipboardList },
  { label: 'Customers', icon: Users },
  { label: 'Analytics', icon: LineChart },
  { label: 'Billing', icon: CreditCard, section: 'Workspace' },
  { label: 'Team', icon: Users },
  { label: 'Settings', icon: Settings },
]

const products: Product[] = [
  { name: 'Aura LED Desk Lamp', category: 'Home & Kitchen', price: 'Rs. 2,450', margin: '38%', stock: 86, status: 'Published', sku: 'SKU-1722', image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=140&q=80' },
  { name: 'Sculpt Seamless Set', category: 'Fashion', price: 'Rs. 3,800', margin: '42%', stock: 24, status: 'Review', sku: 'SKU-4415', image: 'https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=140&q=80' },
  { name: 'MagSafe Power Bank', category: 'Mobile Accessories', price: 'Rs. 2,999', margin: '31%', stock: 148, status: 'Published', sku: 'SKU-6621', image: 'https://images.unsplash.com/photo-1609592424476-5a3b2b4d7b4f?auto=format&fit=crop&w=140&q=80' },
  { name: 'Glow Vitamin C Serum', category: 'Beauty', price: 'Rs. 1,650', margin: '46%', stock: 9, status: 'Low stock', sku: 'SKU-3802', image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=140&q=80' },
  { name: 'Cloud Knit Slides', category: 'Fashion', price: 'Rs. 2,199', margin: '35%', stock: 61, status: 'Draft', sku: 'SKU-4130', image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=140&q=80' },
]

const orders = [
  { id: '#OR-2841', customer: 'Ayesha Khan', product: 'Aura LED Desk Lamp', amount: 'Rs. 2,450', status: 'Processing', time: '12 min ago', initials: 'AK', color: 'lavender' },
  { id: '#OR-2840', customer: 'Hamza Ali', product: 'MagSafe Power Bank', amount: 'Rs. 2,999', status: 'New', time: '36 min ago', initials: 'HA', color: 'peach' },
  { id: '#OR-2839', customer: 'Maham Siddiqui', product: 'Sculpt Seamless Set', amount: 'Rs. 3,800', status: 'Shipped', time: '1 hr ago', initials: 'MS', color: 'mint' },
  { id: '#OR-2838', customer: 'Bilal Ahmed', product: 'Glow Vitamin C Serum', amount: 'Rs. 1,650', status: 'Delivered', time: '2 hrs ago', initials: 'BA', color: 'sky' },
]

const formatNumber = (value: string) => value

function App() {
  const [page, setPage] = useState<PageKey>('Overview')
  const [dark, setDark] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showOrder, setShowOrder] = useState(false)
  const [toast, setToast] = useState('')
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('orbitly_token') ?? '')
  const [authUser, setAuthUser] = useState<ApiUser | null>(() => {
    const saved = localStorage.getItem('orbitly_user')
    return saved ? JSON.parse(saved) as ApiUser : null
  })
  const [showAuth, setShowAuth] = useState(false)
  const [apiOnline, setApiOnline] = useState(false)
  const [liveProducts, setLiveProducts] = useState<Product[] | null>(null)
  const [liveOrders, setLiveOrders] = useState<ApiOrder[] | null>(null)
  const [conversations, setConversations] = useState<ApiConversation[]>([])
  const [contentDrafts, setContentDrafts] = useState<ApiContentDraft[]>([])
  const [subscription, setSubscription] = useState<ApiSubscription | null>(null)
  const [showConversation, setShowConversation] = useState(false)

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const filteredProducts = useMemo(() => products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())), [search])
  useEffect(() => {
    api.health().then(() => setApiOnline(true)).catch(() => setApiOnline(false))
  }, [])
  useEffect(() => {
    const handleAuthExpired = () => {
      setAuthToken('')
      setAuthUser(null)
      setLiveProducts(null)
      setLiveOrders(null)
      setConversations([])
      setContentDrafts([])
      setSubscription(null)
      setShowAuth(true)
      notify('Your session expired. Please sign in again.')
    }
    window.addEventListener('orbitly-auth-expired', handleAuthExpired)
    return () => window.removeEventListener('orbitly-auth-expired', handleAuthExpired)
  }, [])
  useEffect(() => {
    if (!authToken) return
    api.products(authToken).then(({ products: rows }) => setLiveProducts(rows.map((p) => ({
      id: p.id, name: p.name, category: p.category, price: `Rs. ${Number(p.selling_price).toLocaleString()}`, margin: `${Math.round(((Number(p.selling_price) - Number(p.wholesale_price)) / Math.max(Number(p.selling_price), 1)) * 100)}%`, stock: p.stock, status: p.status, sku: p.id.slice(0, 8).toUpperCase(), image: products[0].image,
    })))).catch(() => notify('Could not load live products'))
  }, [authToken])
  useEffect(() => {
    if (!authToken) return
    api.contentDrafts(authToken).then(({ drafts }) => setContentDrafts(drafts)).catch(() => notify('Could not load content drafts'))
  }, [authToken])
  useEffect(() => {
    if (!authToken) return
    api.conversations(authToken).then(({ conversations: rows }) => setConversations(rows)).catch(() => notify('Could not load customer conversations'))
  }, [authToken])
  useEffect(() => {
    if (!authToken) return
    api.orders(authToken).then(({ orders: rows }) => setLiveOrders(rows)).catch(() => notify('Could not load live orders'))
  }, [authToken])
  useEffect(() => {
    if (!authToken) return
    api.subscription(authToken).then(({ subscription: value }) => setSubscription(value)).catch(() => notify('Could not load subscription usage'))
  }, [authToken])

  const signIn = (token: string, refreshToken: string, user: ApiUser) => {
    localStorage.setItem('orbitly_token', token)
    localStorage.setItem('orbitly_refresh_token', refreshToken)
    localStorage.setItem('orbitly_user', JSON.stringify(user))
    setAuthToken(token)
    setAuthUser(user)
    setShowAuth(false)
    notify('Workspace connected to the production API')
  }
  const signOut = async () => {
    let serverLogoutFailed = false
    if (authToken) {
      try {
        await api.logout(authToken)
      } catch {
        serverLogoutFailed = true
      }
    }
    localStorage.removeItem('orbitly_token')
    localStorage.removeItem('orbitly_user')
    setAuthToken('')
    setAuthUser(null)
    setLiveProducts(null)
    setLiveOrders(null)
    setConversations([])
    setContentDrafts([])
    setSubscription(null)
    notify(serverLogoutFailed ? 'Signed out locally; server session could not be revoked' : 'Signed out of the API workspace')
  }
  const refreshLiveProducts = async (token: string) => {
    const { products: rows } = await api.products(token)
    setLiveProducts(rows.map((p) => ({
      id: p.id, name: p.name, category: p.category, price: `Rs. ${Number(p.selling_price).toLocaleString()}`, margin: `${Math.round(((Number(p.selling_price) - Number(p.wholesale_price)) / Math.max(Number(p.selling_price), 1)) * 100)}%`, stock: p.stock, status: p.status, sku: p.id.slice(0, 8).toUpperCase(), image: products[0].image,
    })))
  }
  const saveProduct = async (product: NewProduct) => {
    if (!authToken) {
      setShowAdd(false)
      notify('Connect a workspace before saving live products')
      return
    }
    try {
      await api.createProduct(authToken, product)
      await refreshLiveProducts(authToken)
      setShowAdd(false)
      notify('Product added to the live catalog')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not save product')
    }
  }
  const updateProduct = async (id: string, product: Partial<NewProduct>) => {
    if (!authToken) return notify('Connect a workspace before editing live products')
    try {
      await api.updateProduct(authToken, id, product)
      await refreshLiveProducts(authToken)
      notify('Product updated in the live catalog')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not update product')
    }
  }
  const deleteProduct = async (id: string) => {
    if (!authToken) return notify('Connect a workspace before deleting live products')
    if (!window.confirm('Delete this product from the live catalog?')) return
    try {
      await api.deleteProduct(authToken, id)
      await refreshLiveProducts(authToken)
      notify('Product deleted from the live catalog')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not delete product')
    }
  }
  const importProducts = async (csv: string) => {
    if (!authToken) return notify('Connect a workspace before importing products')
    try {
      const result = await api.importProductsCsv(authToken, csv)
      await refreshLiveProducts(authToken)
      notify(`${result.importedCount} products imported${result.skipped.length ? `; ${result.skipped.length} skipped` : ''}`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not import CSV')
    }
  }
  const refreshOrders = async () => {
    if (!authToken) return
    const { orders: rows } = await api.orders(authToken)
    setLiveOrders(rows)
  }
  const saveOrder = async (order: { customer: { name: string; phone: string; city?: string; address?: string }; productId: string; quantity: number; paymentMethod: string }) => {
    if (!authToken) return notify('Connect a workspace before creating orders')
    try {
      await api.createOrder(authToken, order)
      await Promise.all([refreshOrders(), refreshLiveProducts(authToken)])
      setShowOrder(false)
      notify('Order created and stock reserved')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not create order')
    }
  }
  const requestPayment = async (order: ApiOrder) => {
    if (!authToken) return
    const reference = window.prompt('Payment reference (optional):') ?? undefined
    try {
      const result = await api.requestPaymentVerification(authToken, { orderId: order.id, method: order.payment_method === 'cod' ? 'other' : order.payment_method, amount: Number(order.total_amount), reference })
      notify(`Payment marked ${result.verification.status}; human verification is still required`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not request payment verification')
    }
  }
  const requestSupplier = async (order: ApiOrder) => {
    if (!authToken) return
    try {
      const result = await api.requestSupplierOrder(authToken, { orderId: order.id, supplierKind: 'aliexpress' })
      notify(`Supplier workflow: ${result.supplierOrder.status}; no external order was placed`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not create supplier workflow')
    }
  }
  const createConversation = async (data: { customer: { name: string; phone: string; city?: string; address?: string }; channel: string }) => {
    if (!authToken) return notify('Connect a workspace before creating conversations')
    try {
      const result = await api.createConversation(authToken, data)
      setConversations((current) => [{ ...result.conversation, customer_name: data.customer.name, phone: data.customer.phone }, ...current])
      setShowConversation(false)
      notify('Customer conversation created')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not create conversation')
    }
  }
  const generateContent = async (data: { productId?: string; productName: string; category: string; platform: string; language: string; price?: number; brandVoice?: string }) => {
    if (!authToken) return notify('Connect a workspace before generating content')
    try {
      const result = await api.generateContent(authToken, data)
      setContentDrafts((current) => [result.draft, ...current])
      notify('AI draft generated and saved for review')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'AI generation failed')
    }
  }
  const decideContentDraft = async (id: string, decision: 'approved' | 'rejected') => {
    if (!authToken) return notify('Connect a workspace before reviewing content')
    try {
      const result = await api.decideContentDraft(authToken, id, decision)
      setContentDrafts((current) => current.map((draft) => draft.id === id ? result.draft : draft))
      notify(`Draft ${decision} and saved`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not review content draft')
    }
  }

  return (
    <div className={dark ? 'app dark' : 'app'}>
      <aside className={sidebarOpen ? 'sidebar' : 'sidebar collapsed'}>
        <div className="brand">
          <div className="brand-mark"><Sparkles size={16} fill="currentColor" /></div>
          {sidebarOpen && <><span>orbitly</span><span className="brand-dot">.</span></>}
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">N</div>
          {sidebarOpen && <div className="workspace-copy"><strong>Nova Commerce</strong><small>Personal workspace</small></div>}
          {sidebarOpen && <ChevronDown size={15} className="muted" />}
        </div>
        <div className="nav-scroll">
          <nav>
            <p className="nav-label">{sidebarOpen ? 'Workspace' : '•••'}</p>
            {nav.slice(0, 8).map((item) => {
              const Icon = item.icon
              return <button key={item.label} className={page === item.label ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.label)} title={item.label}><Icon size={18} />{sidebarOpen && <span>{item.label}</span>}{item.label === 'Orders' && sidebarOpen && <em>8</em>}</button>
            })}
            <p className="nav-label second">{sidebarOpen ? 'Manage' : '•••'}</p>
            {nav.slice(8).map((item) => {
              const Icon = item.icon
              return <button key={item.label} className={page === item.label ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.label)} title={item.label}><Icon size={18} />{sidebarOpen && <span>{item.label}</span>}</button>
            })}
          </nav>
        </div>
        {sidebarOpen && <div className="sidebar-bottom">
          <div className="usage-card"><div className="usage-top"><span>Monthly usage</span><span>{subscription ? `${Math.min(100, Math.round((subscription.used_ai_actions / Math.max(subscription.ai_action_limit, 1)) * 100))}%` : '—'}</span></div><div className="progress"><i style={{ width: `${subscription ? Math.min(100, (subscription.used_ai_actions / Math.max(subscription.ai_action_limit, 1)) * 100) : 0}%` }} /></div><small>{subscription ? `${subscription.used_ai_actions.toLocaleString()} / ${subscription.ai_action_limit.toLocaleString()} AI actions` : 'Usage unavailable'}</small><button onClick={() => setPage('Billing')}>View plan <ArrowUpRight size={13} /></button></div>
          <div className="help-row"><CircleHelp size={17} /><span>Help center</span><Settings size={16} className="help-settings" /></div>
          <div className="profile-row"><div className="profile-avatar">ZS</div><div><strong>Zubair Shah</strong><small>Owner</small></div><MoreHorizontal size={17} className="muted" /></div>
        </div>}
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={19} /></button>
          <div className="breadcrumbs"><span>{page === 'Overview' ? 'Workspace' : 'Workspace'}</span><b>/</b><strong>{page}</strong></div>
          <div className="top-actions">
            <div className="search-box"><Search size={16} /><input placeholder="Search anything..." value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></div>
            <button className="icon-btn" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-btn notification" onClick={() => notify('You are all caught up')}><Bell size={18} /><i /></button>
            <button className="top-avatar" onClick={() => setShowAuth(true)} title={authUser ? `Connected as ${authUser.email}` : 'Connect workspace'}>{authUser ? authUser.email.slice(0, 2).toUpperCase() : 'ZS'}</button>
          </div>
        </header>
        <div className="content">
          {page === 'Overview' ? <Overview onNavigate={setPage} onAdd={() => setShowAdd(true)} onNotify={notify} apiOnline={apiOnline} authUser={authUser} /> : <PageView page={page} products={liveProducts ?? filteredProducts} orders={liveOrders ?? []} conversations={conversations} drafts={contentDrafts} onAdd={() => setShowAdd(true)} onCreateOrder={() => setShowOrder(true)} onCreateConversation={() => setShowConversation(true)} onGenerateContent={generateContent} onDecideContentDraft={decideContentDraft} onNotify={notify} onCreateProduct={saveProduct} onUpdateProduct={updateProduct} onDeleteProduct={deleteProduct} onImportProducts={importProducts} onRequestPayment={requestPayment} onRequestSupplier={requestSupplier} />}
        </div>
      </main>
      {showAdd && <AddProductModal onClose={() => setShowAdd(false)} onSave={saveProduct} />}
      {showOrder && <CreateOrderModal products={liveProducts ?? []} onClose={() => setShowOrder(false)} onSave={saveOrder} />}
      {showConversation && <CreateConversationModal onClose={() => setShowConversation(false)} onSave={createConversation} />}
      {showAuth && <AuthModal user={authUser} onClose={() => setShowAuth(false)} onSignIn={signIn} onSignOut={signOut} />}
      {toast && <div className="toast"><div className="toast-check">✓</div>{toast}</div>}
    </div>
  )
}

function Overview({ onNavigate, onAdd, onNotify, apiOnline, authUser }: { onNavigate: (p: PageKey) => void; onAdd: () => void; onNotify: (s: string) => void; apiOnline: boolean; authUser: ApiUser | null }) {
  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Saturday, October 31, 2026</p><h1>Good evening, Zubair <span>✦</span></h1><p className="subtitle">Here’s what’s happening with your store today.</p></div><div className="heading-actions"><button className="secondary-btn"><FileText size={16} /> Export report</button><button className="primary-btn" onClick={onAdd}><Plus size={17} /> Add product</button></div></div>
    <div className="insight-banner"><div className="insight-icon"><Sparkles size={19} /></div><div><strong>{authUser ? `Connected to ${authUser.email}` : 'Your store is having a great week'}</strong><p>{authUser ? 'Live product data is available from the production API.' : 'Revenue is up 24.8% compared to last week. Connect the API to load live workspace data.'}</p></div><button onClick={() => onNavigate('Analytics')}>{apiOnline ? 'API online' : 'View insights'} <ArrowUpRight size={14} /></button><X size={17} className="banner-close" onClick={() => onNotify('Insight dismissed')} /></div>
    <div className="metric-grid">
      <Metric title="Total revenue" value="Rs. 284,520" change="+24.8%" positive icon={<WalletCards size={18} />} foot="vs. Rs. 228,040 last month" />
      <Metric title="Orders" value="1,284" change="+18.2%" positive icon={<ShoppingBag size={18} />} foot="142 orders this week" />
      <Metric title="Net profit" value="Rs. 82,430" change="+31.4%" positive icon={<BarChart3 size={18} />} foot="28.9% average margin" />
      <Metric title="Active products" value="248" change="-4.2%" positive={false} icon={<Tag size={18} />} foot="12 need your attention" />
    </div>
    <div className="dashboard-grid">
      <section className="card revenue-card"><div className="card-heading"><div><h2>Revenue overview</h2><p>Track your store performance over time</p></div><div className="segmented"><button className="selected">Revenue</button><button>Profit</button><button>Orders</button></div></div><div className="chart-meta"><strong>Rs. 284,520</strong><span className="green-text">↗ 24.8%</span><select><option>Last 30 days</option><option>Last 7 days</option></select></div><RevenueChart /></section>
      <section className="card activity-card"><div className="card-heading"><div><h2>AI activity</h2><p>Your autonomous agents at work</p></div><button className="more-btn" onClick={() => onNavigate('Settings')}><MoreHorizontal size={18} /></button></div><div className="agent-status"><div className="agent-orb"><Bot size={19} /></div><div><strong>All systems operational</strong><span>4 agents running smoothly</span></div><span className="live-dot">Live</span></div><AgentRow icon={<Boxes size={16} />} name="Product classifier" value="48 products" status="Completed 8m ago" /><AgentRow icon={<Sparkles size={16} />} name="Content generator" value="12 posts" status="Completed 14m ago" /><AgentRow icon={<Headphones size={16} />} name="Support agent" value="23 conversations" status="Active now" active /><button className="text-btn full" onClick={() => onNavigate('Settings')}>View agent activity <ArrowUpRight size={14} /></button></section>
    </div>
    <div className="dashboard-grid lower"><section className="card table-card"><div className="card-heading"><div><h2>Recent orders</h2><p>Your latest customer orders</p></div><button className="text-btn" onClick={() => onNavigate('Orders')}>View all <ArrowUpRight size={14} /></button></div><OrdersTable /></section><section className="card quick-card"><div className="card-heading"><div><h2>Quick actions</h2><p>Get things done faster</p></div></div><div className="quick-grid"><QuickAction icon={<Plus />} label="Add product" onClick={onAdd} /><QuickAction icon={<Sparkles />} label="Create content" onClick={() => onNavigate('Content Studio')} /><QuickAction icon={<Zap />} label="Schedule post" onClick={() => onNavigate('Publishing')} /><QuickAction icon={<Activity />} label="View analytics" onClick={() => onNavigate('Analytics')} /></div><div className="checklist"><div className="check-icon"><PackageCheck size={17} /></div><div><strong>Finish your setup</strong><p>3 of 5 tasks complete</p></div><button onClick={() => onNotify('Setup checklist opened')}><ArrowUpRight size={16} /></button></div></section></div>
  </div>
}

function Metric({ title, value, change, positive, icon, foot }: { title: string; value: string; change: string; positive: boolean; icon: React.ReactNode; foot: string }) {
  return <div className="metric card"><div className="metric-top"><span className="metric-icon">{icon}</span><span className={positive ? 'change positive' : 'change negative'}>{positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{change}</span></div><p>{title}</p><h3>{value}</h3><small>{foot}</small></div>
}

function RevenueChart() {
  return <div className="chart-wrap"><div className="y-labels"><span>60k</span><span>40k</span><span>20k</span><span>0</span></div><div className="chart"><div className="grid-lines"><i /><i /><i /><i /></div><svg viewBox="0 0 760 190" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#7359e6" stopOpacity=".25" /><stop offset="100%" stopColor="#7359e6" stopOpacity="0" /></linearGradient></defs><path d="M0,150 C35,140 42,115 76,124 C105,132 125,111 153,117 C181,124 194,94 228,105 C262,116 282,91 306,98 C335,106 355,75 386,86 C418,98 438,72 468,74 C503,76 519,48 547,62 C578,78 601,38 630,48 C659,58 675,24 708,35 C729,42 744,23 760,28 L760,190 L0,190 Z" fill="url(#fill)" /><path d="M0,150 C35,140 42,115 76,124 C105,132 125,111 153,117 C181,124 194,94 228,105 C262,116 282,91 306,98 C335,106 355,75 386,86 C418,98 438,72 468,74 C503,76 519,48 547,62 C578,78 601,38 630,48 C659,58 675,24 708,35 C729,42 744,23 760,28" fill="none" stroke="#755de4" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg><div className="x-labels"><span>Oct 01</span><span>Oct 07</span><span>Oct 14</span><span>Oct 21</span><span>Oct 31</span></div></div></div>
}

function AgentRow({ icon, name, value, status, active }: { icon: React.ReactNode; name: string; value: string; status: string; active?: boolean }) {
  return <div className="agent-row"><div className="small-icon">{icon}</div><div className="agent-copy"><strong>{name}</strong><span>{value}</span></div><div className="agent-time"><span className={active ? 'active-status' : ''}>{active && <i />}{status}</span></div></div>
}

function OrdersTable() {
  return <div className="orders-table"><div className="table-head"><span>Order</span><span>Customer</span><span>Amount</span><span>Status</span><span /></div>{orders.map((order) => <div className="table-row" key={order.id}><div className="order-id"><strong>{order.id}</strong><small>{order.time}</small></div><div className="customer"><span className={`customer-avatar ${order.color}`}>{order.initials}</span><span>{order.customer}</span></div><strong>{order.amount}</strong><span className={`status ${order.status.toLowerCase().replace(' ', '-')}`}>{order.status}</span><MoreHorizontal size={17} className="muted" /></div>)}</div>
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className="quick-action" onClick={onClick}><span>{icon}</span><strong>{label}</strong><ArrowUpRight size={15} /></button>
}

function PageView({ page, products, orders, conversations, drafts, onAdd, onCreateOrder, onCreateConversation, onGenerateContent, onDecideContentDraft, onNotify, onCreateProduct, onUpdateProduct, onDeleteProduct, onImportProducts, onRequestPayment, onRequestSupplier }: { page: PageKey; products: Product[]; orders: ApiOrder[]; conversations: ApiConversation[]; drafts: ApiContentDraft[]; onAdd: () => void; onCreateOrder: () => void; onCreateConversation: () => void; onGenerateContent: (data: { productId?: string; productName: string; category: string; platform: string; language: string; price?: number; brandVoice?: string }) => void; onDecideContentDraft: (id: string, decision: 'approved' | 'rejected') => void; onNotify: (s: string) => void; onCreateProduct: (product: NewProduct) => void; onUpdateProduct: (id: string, product: Partial<NewProduct>) => void; onDeleteProduct: (id: string) => void; onImportProducts: (csv: string) => void; onRequestPayment: (order: ApiOrder) => void; onRequestSupplier: (order: ApiOrder) => void }) {
  const configs: Record<PageKey, { title: string; subtitle: string; icon: React.ReactNode }> = {
    Overview: { title: 'Overview', subtitle: '', icon: <LayoutDashboard /> }, Products: { title: 'Product catalog', subtitle: 'Manage your products, pricing and inventory.', icon: <Boxes /> }, Sources: { title: 'Product sources', subtitle: 'Connect and manage your approved supplier feeds.', icon: <Globe2 /> }, 'Content Studio': { title: 'Content studio', subtitle: 'Create on-brand content with your AI copilot.', icon: <Sparkles /> }, Publishing: { title: 'Publishing planner', subtitle: 'Schedule, approve and monitor your social content.', icon: <Zap /> }, Orders: { title: 'Orders', subtitle: 'Stay on top of customer orders and fulfillment.', icon: <ClipboardList /> }, Customers: { title: 'Customers', subtitle: 'Build lasting relationships with your customers.', icon: <Users /> }, Analytics: { title: 'Analytics', subtitle: 'Understand what is driving your growth.', icon: <LineChart /> }, Billing: { title: 'Billing & plans', subtitle: 'Manage your subscription and usage.', icon: <CreditCard /> }, Team: { title: 'Team members', subtitle: 'Manage roles and workspace access.', icon: <Users /> }, Settings: { title: 'Settings', subtitle: 'Configure your workspace and automation preferences.', icon: <Settings /> },
  }
  const config = configs[page]
  return <div className="page"><div className="page-heading"><div><div className="title-with-icon"><span className="page-icon">{config.icon}</span><h1>{config.title}</h1></div><p className="subtitle">{config.subtitle}</p></div><div className="heading-actions"><button className="secondary-btn"><Filter size={16} /> Filters</button><button className="primary-btn" onClick={onAdd}><Plus size={17} /> {page === 'Products' ? 'Add product' : 'Create new'}</button></div></div>
    {page === 'Products' ? <ProductView products={products} onAdd={onAdd} onNotify={onNotify} onUpdateProduct={onUpdateProduct} onDeleteProduct={onDeleteProduct} onImportProducts={onImportProducts} /> : page === 'Orders' ? <OrdersView orders={orders} products={products} onCreateOrder={onCreateOrder} onRequestPayment={onRequestPayment} onRequestSupplier={onRequestSupplier} /> : page === 'Customers' ? <CustomerView conversations={conversations} onCreate={onCreateConversation} /> : page === 'Content Studio' ? <ContentStudioView products={products} drafts={drafts} onGenerate={onGenerateContent} onDecide={onDecideContentDraft} /> : <GenericPage page={page} onNotify={onNotify} />}
  </div>
}

function ContentStudioView({ products, drafts, onGenerate, onDecide }: { products: Product[]; drafts: ApiContentDraft[]; onGenerate: (data: { productId?: string; productName: string; category: string; platform: string; language: string; price?: number; brandVoice?: string }) => void; onDecide: (id: string, decision: 'approved' | 'rejected') => void }) {
  const [productId, setProductId] = useState(products.find((product) => product.id)?.id ?? '')
  const [platform, setPlatform] = useState('instagram')
  const [language, setLanguage] = useState('roman_urdu')
  const selected = products.find((product) => product.id === productId)
  return <section className="card table-card"><div className="card-heading"><div><h2>AI content drafts</h2><p>Generate a draft, then review every claim before publishing.</p></div></div><div className="modal-body"><label>Product<select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Choose a live product</option>{products.filter((product) => product.id).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><div className="form-grid"><label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="whatsapp">WhatsApp</option></select></label><label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="roman_urdu">Roman Urdu</option><option value="english">English</option><option value="urdu">Urdu</option></select></label></div><button className="primary-btn" disabled={!selected} onClick={() => selected && onGenerate({ productId: selected.id, productName: selected.name, category: selected.category, platform, language, price: Number(selected.price.replace(/[^\d.]/g, '')) })}><Sparkles size={16} /> Generate review draft</button></div>{drafts.length === 0 ? <div className="empty-feature"><h2>No drafts yet</h2><p>Generated drafts will appear here with their review disclaimer.</p></div> : <div className="activity-list">{drafts.map((draft) => <div className="activity-item" key={draft.id}><span className="activity-bubble bubble-0"><Sparkles size={15} /></span><div><strong>{draft.platform} · {draft.language} · {draft.status}</strong><p>{draft.content.caption}</p><small>{draft.content.hashtags.join(' ')} · {draft.content.disclaimer}</small>{draft.status === 'draft' && <div className="order-actions"><button className="secondary-btn compact" onClick={() => onDecide(draft.id, 'approved')}>Approve</button><button className="secondary-btn compact" onClick={() => onDecide(draft.id, 'rejected')}>Reject</button></div>}</div></div>)}</div>}</section>
}

function CustomerView({ conversations, onCreate }: { conversations: ApiConversation[]; onCreate: () => void }) {
  return <section className="card table-card"><div className="card-heading"><div><h2>Customer inbox</h2><p>Manual conversations are stored with tenant isolation; outbound replies remain drafts.</p></div><button className="primary-btn" onClick={onCreate}><Plus size={16} /> New conversation</button></div>{conversations.length === 0 ? <div className="empty-feature"><h2>No conversations yet</h2><p>Create a manual customer conversation to start tracking messages.</p></div> : <div className="activity-list">{conversations.map((conversation) => <div className="activity-item" key={conversation.id}><span className="activity-bubble bubble-0"><MessageSquare size={15} /></span><div><strong>{conversation.customer_name} · {conversation.channel}</strong><p>{conversation.last_message ?? 'No messages yet'} · {conversation.status}</p></div><small>{conversation.phone}</small></div>)}</div>}</section>
}

function OrdersView({ orders, products, onCreateOrder, onRequestPayment, onRequestSupplier }: { orders: ApiOrder[]; products: Product[]; onCreateOrder: () => void; onRequestPayment: (order: ApiOrder) => void; onRequestSupplier: (order: ApiOrder) => void }) {
  return <section className="card table-card"><div className="card-heading"><div><h2>Live manual orders</h2><p>Payment and supplier actions remain human-approved.</p></div><button className="primary-btn" onClick={onCreateOrder}><Plus size={16} /> Create order</button></div>{orders.length === 0 ? <div className="empty-feature"><h2>No live orders yet</h2><p>Create an order from an approved catalog product to start the manual workflow.</p>{products.length === 0 && <small>Load or create a product first.</small>}</div> : <div className="orders-table"><div className="table-head"><span>Order</span><span>Customer</span><span>Product</span><span>Amount</span><span>Status</span><span>Actions</span></div>{orders.map((order) => <div className="table-row" key={order.id}><div className="order-id"><strong>#{order.id.slice(0, 8).toUpperCase()}</strong><small>{new Date(order.created_at).toLocaleString()}</small></div><div className="customer"><span>{order.customer_name}</span><small>{order.phone}</small></div><span>{order.product_name} × {order.quantity}</span><strong>Rs. {Number(order.total_amount).toLocaleString()}</strong><span className={`status ${order.status}`}>{order.status}</span><div className="order-actions"><button className="secondary-btn compact" onClick={() => onRequestPayment(order)}>Payment review</button><button className="secondary-btn compact" onClick={() => onRequestSupplier(order)}>Supplier review</button></div></div>)}</div>}</section>
}

function ProductView({ products, onAdd, onNotify, onUpdateProduct, onDeleteProduct, onImportProducts }: { products: Product[]; onAdd: () => void; onNotify: (s: string) => void; onUpdateProduct: (id: string, product: Partial<NewProduct>) => void; onDeleteProduct: (id: string) => void; onImportProducts: (csv: string) => void }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const visible = products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))
  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    onImportProducts(await file.text())
    event.target.value = ''
  }
  return <><div className="tab-row"><button className="active">All products <b>{products.length}</b></button><button>Published</button><button>Needs review</button><button>Low stock</button><span className="tab-spacer" /><label className="secondary-btn compact">Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={handleImport} /></label><button className="secondary-btn compact"><ListFilter size={15} /> Sort: Recently added</button></div><div className="card product-card"><div className="product-toolbar"><div className="local-search"><Search size={16} /><input placeholder="Search products..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="toolbar-right"><button className="secondary-btn compact"><Tag size={15} /> Categories <ChevronDown size={14} /></button><button className="secondary-btn compact" onClick={onAdd}><Plus size={15} /> Add</button></div></div><div className="product-table"><div className="product-head"><span className="check-box" /> <span>Product</span><span>Category</span><span>Price</span><span>Margin</span><span>Stock</span><span>Status</span><span /></div>{visible.map((p) => <div className="product-line" key={p.id ?? p.name}><span className="check-box" /><div className="product-name"><img src={p.image} /><div><strong>{p.name}</strong><small>{p.sku}</small></div></div><span className="category-pill">{p.category}</span><strong>{p.price}</strong><span className="margin">{p.margin}</span><span className={p.stock < 15 ? 'stock low' : 'stock'}>{p.stock} units</span><span className={`status ${p.status.toLowerCase().replace(' ', '-')}`}>{p.status}</span><div className="product-actions">{p.id && <><button className="icon-btn" title="Edit product" onClick={() => setEditing(p)}><Settings size={15} /></button><button className="icon-btn" title="Delete product" onClick={() => onDeleteProduct(p.id!)}><X size={15} /></button></>}</div></div>)} </div><div className="pagination"><span>Showing {visible.length} of {products.length} products</span></div></div><div className="ai-tip"><Sparkles size={18} /><div><strong>AI enrichment remains approval-based</strong><p>Descriptions and social content will stay drafts until you approve them.</p></div><button className="primary-btn" onClick={() => onNotify('AI description generation remains review-based')}>Review drafts <ArrowUpRight size={14} /></button></div>{editing && <EditProductModal product={editing} onClose={() => setEditing(null)} onSave={(product) => { onUpdateProduct(editing.id!, product); setEditing(null) }} />}</>
}

function GenericPage({ page, onNotify }: { page: PageKey; onNotify: (s: string) => void }) {
  const details: Record<PageKey, { metric: string; value: string; label: string; cards: string[] }> = { Overview: { metric: '', value: '', label: '', cards: [] }, Products: { metric: 'Active products', value: '248', label: '12 need attention', cards: ['Aura LED Desk Lamp', 'Sculpt Seamless Set', 'Glow Vitamin C Serum'] }, Sources: { metric: 'Connected sources', value: '8', label: '+2 this month', cards: ['AliExpress feed', 'Google Sheets catalog', 'Daraz supplier feed'] }, 'Content Studio': { metric: 'Content created', value: '1,842', label: '+18.4% this month', cards: ['Weekend sale campaign', 'Glow serum launch', 'Ramadan essentials'] }, Publishing: { metric: 'Scheduled posts', value: '36', label: 'Across 8 accounts', cards: ['Instagram · 10:30 AM', 'Facebook · 12:00 PM', 'TikTok · 7:00 PM'] }, Orders: { metric: 'Total orders', value: '1,284', label: '+18.2% this month', cards: ['#OR-2841 · Processing', '#OR-2840 · New', '#OR-2839 · Shipped'] }, Customers: { metric: 'Active customers', value: '8,420', label: '+12.6% this month', cards: ['Ayesha Khan', 'Hamza Ali', 'Maham Siddiqui'] }, Analytics: { metric: 'Net profit', value: 'Rs. 82,430', label: '+31.4% this month', cards: ['Revenue by category', 'Best performing products', 'Account performance'] }, Billing: { metric: 'Current plan', value: 'Professional', label: 'Renews Nov 18, 2026', cards: ['2,000 AI actions', '10 social accounts', 'Unlimited orders'] }, Team: { metric: 'Team members', value: '6', label: '3 seats available', cards: ['Zubair Shah · Owner', 'Hira Malik · Admin', 'Saad Ahmed · Manager'] }, Settings: { metric: 'Automation mode', value: 'Approval', label: 'Human review enabled', cards: ['AI agents', 'Notifications', 'Integrations'] } }
  const d = details[page]
  return <><div className="metric-grid compact-metrics"><div className="metric card"><div className="metric-top"><span className="metric-icon"><Activity size={18} /></span><span className="change positive">● Live</span></div><p>{d.metric}</p><h3>{d.value}</h3><small>{d.label}</small></div><div className="metric card"><div className="metric-top"><span className="metric-icon"><Sparkles size={18} /></span><span className="change positive">+12.4%</span></div><p>AI efficiency</p><h3>94.8%</h3><small>Based on the last 30 days</small></div><div className="metric card"><div className="metric-top"><span className="metric-icon"><Zap size={18} /></span><span className="change positive">Healthy</span></div><p>System status</p><h3>Operational</h3><small>All automations are running</small></div></div><div className="split-content"><section className="card placeholder-card"><div className="card-heading"><div><h2>Workspace activity</h2><p>Recent updates across your workspace</p></div><button className="more-btn"><MoreHorizontal size={18} /></button></div><div className="activity-list">{d.cards.map((item, i) => <div className="activity-item" key={item}><span className={`activity-bubble bubble-${i}`}><Sparkles size={15} /></span><div><strong>{item}</strong><p>{i === 0 ? 'Updated just now' : `${i + 2} hours ago`} · Orbitly AI</p></div><ExternalLink size={15} className="muted" /></div>)}</div><button className="text-btn full" onClick={() => onNotify('Activity history opened')}>View activity history <ArrowUpRight size={14} /></button></section><section className="card empty-feature"><div className="empty-illustration"><Grid2X2 size={26} /></div><h2>Make this space yours</h2><p>Connect your accounts and customize your workflow to unlock more of Orbitly.</p><button className="primary-btn" onClick={() => onNotify('Setup flow started')}>Get started <ArrowUpRight size={14} /></button></section></div></>
}

function AddProductModal({ onClose, onSave }: { onClose: () => void; onSave: (product: NewProduct) => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Home & Kitchen')
  const [wholesalePrice, setWholesalePrice] = useState('1000')
  const [sellingPrice, setSellingPrice] = useState('1150')
  const [stock, setStock] = useState('0')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Catalog</p><h2>Add a new product</h2><p>Save a real tenant-scoped product through the API.</p></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ name, category, wholesalePrice: Number(wholesalePrice), sellingPrice: Number(sellingPrice), stock: Number(stock) }) }}><div className="modal-body"><div className="form-grid"><label>Product name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Aura LED Desk Lamp" minLength={2} required /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Home & Kitchen</option><option>Electronics</option><option>Fashion</option><option>Sports</option><option>Beauty</option><option>Jewellery</option><option>Mobile Accessories</option><option>Other</option></select></label></div><div className="form-grid"><label>Wholesale price<input type="number" min="0" value={wholesalePrice} onChange={(event) => setWholesalePrice(event.target.value)} required /></label><label>Selling price<input type="number" min="0" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} required /></label></div><label>Stock units<input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} required /></label><div className="import-note"><Sparkles size={16} /><span>AI enrichment remains review-based. Product data will be stored in PostgreSQL for this workspace.</span></div></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Add product <ArrowUpRight size={14} /></button></div></form></div></div>
}

function CreateOrderModal({ products, onClose, onSave }: { products: Product[]; onClose: () => void; onSave: (order: { customer: { name: string; phone: string; city?: string; address?: string }; productId: string; quantity: number; paymentMethod: string }) => void }) {
  const [productId, setProductId] = useState(products.find((product) => product.id)?.id ?? '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [paymentMethod, setPaymentMethod] = useState('cod')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Manual commerce</p><h2>Create customer order</h2><p>Stock is reserved now; payment and supplier actions require review.</p></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ productId, quantity: Number(quantity), paymentMethod, customer: { name, phone, city, address } }) }}><div className="modal-body"><label>Product<select value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Select a live product</option>{products.filter((product) => product.id).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.stock} in stock)</option>)}</select></label><div className="form-grid"><label>Customer name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} minLength={7} required /></label></div><div className="form-grid"><label>City<input value={city} onChange={(event) => setCity(event.target.value)} /></label><label>Quantity<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label></div><label>Address<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={2} /></label><label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cod">Cash on delivery</option><option value="bank_transfer">Bank transfer</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option><option value="other">Other</option></select></label></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit" disabled={!productId}>Create pending order <ArrowUpRight size={14} /></button></div></form></div></div>
}

function CreateConversationModal({ onClose, onSave }: { onClose: () => void; onSave: (data: { customer: { name: string; phone: string; city?: string; address?: string }; channel: string }) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState('manual')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Customer care</p><h2>New conversation</h2><p>Manual inbox only; no external message will be sent.</p></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ customer: { name, phone }, channel }) }}><div className="modal-body"><label>Customer name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} minLength={7} required /></label><label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="manual">Manual</option><option value="whatsapp">WhatsApp (not connected)</option><option value="instagram">Instagram (not connected)</option><option value="facebook">Facebook (not connected)</option><option value="email">Email (not connected)</option></select></label></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Create inbox record <ArrowUpRight size={14} /></button></div></form></div></div>
}

function EditProductModal({ product, onClose, onSave }: { product: Product; onClose: () => void; onSave: (product: Partial<NewProduct>) => void }) {
  const [name, setName] = useState(product.name)
  const [category, setCategory] = useState(product.category)
  const [sellingPrice, setSellingPrice] = useState(product.price.replace(/[^\d.]/g, ''))
  const [stock, setStock] = useState(String(product.stock))
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Catalog</p><h2>Edit product</h2><p>Changes are saved to this tenant's live catalog.</p></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ name, category, sellingPrice: Number(sellingPrice), stock: Number(stock) }) }}><div className="modal-body"><label>Product name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Home & Kitchen</option><option>Electronics</option><option>Fashion</option><option>Sports</option><option>Beauty</option><option>Jewellery</option><option>Mobile Accessories</option><option>Other</option></select></label><div className="form-grid"><label>Selling price<input type="number" min="0" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} required /></label><label>Stock units<input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} required /></label></div></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Save changes <ArrowUpRight size={14} /></button></div></form></div></div>
}

function AuthModal({ user, onClose, onSignIn, onSignOut }: { user: ApiUser | null; onClose: () => void; onSignIn: (token: string, refreshToken: string, user: ApiUser) => void; onSignOut: () => void | Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspaceName, setWorkspaceName] = useState('Nova Commerce')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password, workspaceName)
      onSignIn(result.token, result.refreshToken, result.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to connect workspace')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal auth-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">Production workspace</p><h2>{user ? 'Workspace connection' : mode === 'login' ? 'Connect your workspace' : 'Create your workspace'}</h2><p>{user ? user.email : 'Use the real API to load tenant-scoped commerce data.'}</p></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
    {user ? <div className="modal-body connected-state"><div className="connected-icon"><Zap size={22} /></div><strong>{user.role.replace('_', ' ')} account connected</strong><p>Live API requests are authenticated with a tenant-scoped access token.</p><button className="secondary-btn" onClick={onSignOut}>Sign out</button></div> : <form onSubmit={submit}><div className="modal-body">
      {mode === 'register' && <label>Workspace name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} minLength={2} required /></label>}
      <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
      <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="At least 8 characters" required /></label>
      {error && <p className="form-error">{error}</p>}
      <div className="auth-switch"><span>{mode === 'login' ? 'New to Orbitly?' : 'Already have a workspace?'}</span><button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Create workspace' : 'Sign in'}</button></div>
    </div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={busy}>{busy ? 'Connecting...' : mode === 'login' ? 'Connect workspace' : 'Create workspace'} <ArrowUpRight size={14} /></button></div></form>}
  </div></div>
}

export default App
