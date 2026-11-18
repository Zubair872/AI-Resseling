import { useEffect, useState } from 'react'
import { IntegrationsPage } from './Integrations'
import { StudioPage } from './Studio'
import { AutopilotPanel } from './Autopilot'
import { PublishingPanel, NotificationsPanel, RecoveryForm } from './Panels'
import { InboxPage } from './Inbox'
import { Moon, Sun, LayoutDashboard, Sparkles, ShoppingBag, FileText, Zap, MessageSquare, PackageCheck, Globe2, Settings, Edit2, Trash2, DollarSign, TrendingUp, CheckCircle, Plus, X } from './icons'
import { api, retryLoad, type ApiAnalytics, type ApiIntegration, type ApiPublishingJob, type ApiSocialAccount, type ApiContentDraft, type ApiConversation, type ApiOrder, type ApiUser } from './api'

type PageKey = 'Overview' | 'Markaz Studio' | 'Products' | 'Content Studio' | 'Publishing' | 'Orders' | 'Customers' | 'Settings' | 'Integrations'
type Product = { id?: string; name: string; category: string; price: string; margin: string; stock: number; status: string; image: string; sku: string }
type NewProduct = { name: string; category: string; wholesalePrice: number; sellingPrice: number; stock: number; description?: string }

const nav: { label: PageKey; icon: React.ComponentType<{ size?: number; className?: string }>; colorClass: string }[] = [
  { label: 'Overview', icon: LayoutDashboard, colorClass: 'nav-c-blue' },
  { label: 'Markaz Studio', icon: Sparkles, colorClass: 'nav-c-purple' },
  { label: 'Products', icon: ShoppingBag, colorClass: 'nav-c-amber' },
  { label: 'Content Studio', icon: FileText, colorClass: 'nav-c-pink' },
  { label: 'Publishing', icon: Zap, colorClass: 'nav-c-cyan' },
  { label: 'Customers', icon: MessageSquare, colorClass: 'nav-c-emerald' },
  { label: 'Orders', icon: PackageCheck, colorClass: 'nav-c-orange' },
  { label: 'Integrations', icon: Globe2, colorClass: 'nav-c-indigo' },
  { label: 'Settings', icon: Settings, colorClass: 'nav-c-slate' },
]

function App() {
  const [page, setPage] = useState<PageKey>('Overview')
    const [sidebarOpen, setSidebarOpen] = useState(true)
  const [dark, setDark] = useState(() => localStorage.getItem('orbitly_theme') === 'dark')

  const toggleTheme = () => {
    setDark((prev) => {
      const next = !prev
      localStorage.setItem('orbitly_theme', next ? 'dark' : 'light')
      return next
    })
  }
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
    const [showConversation, setShowConversation] = useState(false)

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verifyToken = params.get('verify')
    if (params.has('reset') || params.has('invite') || params.has('ref')) setShowAuth(true)
    if (params.has('oauth')) setPage('Integrations')
    if (verifyToken) {
      api.verifyEmail(verifyToken).then(() => notify('Email verified')).catch((reason) => notify(reason instanceof Error ? reason.message : 'Could not verify email')).finally(() => window.history.replaceState({}, '', window.location.pathname))
    }
  }, [])
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
      setShowAuth(true)
      notify('Your session expired. Please sign in again.')
    }
    window.addEventListener('orbitly-auth-expired', handleAuthExpired)
    return () => window.removeEventListener('orbitly-auth-expired', handleAuthExpired)
  }, [])
  useEffect(() => {
    if (!authToken) return
    retryLoad(() => api.products(authToken)).then(({ products: rows }) => setLiveProducts(rows.map((p) => ({
      id: p.id, name: p.name, category: p.category, price: `Rs. ${Number(p.selling_price).toLocaleString()}`, margin: `${Math.round(((Number(p.selling_price) - Number(p.wholesale_price)) / Math.max(Number(p.selling_price), 1)) * 100)}%`, stock: p.stock, status: p.status, sku: p.id.slice(0, 8).toUpperCase(), image: p.image_url ?? '',
    })))).catch((reason) => notify(reason instanceof Error ? reason.message : 'Could not load live products'))
  }, [authToken])
  useEffect(() => {
    if (!authToken) return
    retryLoad(() => api.contentDrafts(authToken)).then(({ drafts }) => setContentDrafts(drafts)).catch((reason) => notify(reason instanceof Error ? reason.message : 'Could not load content drafts'))
  }, [authToken])
  useEffect(() => {
    if (!authToken) return
    retryLoad(() => api.conversations(authToken)).then(({ conversations: rows }) => setConversations(rows)).catch((reason) => notify(reason instanceof Error ? reason.message : 'Could not load customer conversations'))
  }, [authToken])
  useEffect(() => {
    if (!authToken) return
    retryLoad(() => api.orders(authToken)).then(({ orders: rows }) => setLiveOrders(rows)).catch((reason) => notify(reason instanceof Error ? reason.message : 'Could not load live orders'))
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
    notify(serverLogoutFailed ? 'Signed out locally; server session could not be revoked' : 'Signed out of the API workspace')
  }
  const refreshLiveProducts = async (token: string) => {
    const { products: rows } = await api.products(token)
    setLiveProducts(rows.map((p) => ({
      id: p.id, name: p.name, category: p.category, price: `Rs. ${Number(p.selling_price).toLocaleString()}`, margin: `${Math.round(((Number(p.selling_price) - Number(p.wholesale_price)) / Math.max(Number(p.selling_price), 1)) * 100)}%`, stock: p.stock, status: p.status, sku: p.id.slice(0, 8).toUpperCase(), image: p.image_url ?? '',
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
  const changeOrderStatus = async (order: ApiOrder, status: string) => {
    if (!authToken || status === order.status) return
    try {
      await api.updateOrderStatus(authToken, order.id, status)
      await Promise.all([refreshOrders(), refreshLiveProducts(authToken)])
      notify(`Order moved to ${status.replace(/_/g, ' ')}`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not change order status')
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
          <div className="brand-mark">O</div>
          {sidebarOpen && <><span>orbitly</span><span className="brand-dot">.</span></>}
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">{authUser ? authUser.email.slice(0, 1).toUpperCase() : '?'}</div>
          {sidebarOpen && <div className="workspace-copy"><strong>{authUser ? authUser.email : 'Not signed in'}</strong><small>{authUser ? authUser.role.replace('_', ' ') : 'Sign in to start'}</small></div>}
        </div>
        <div className="nav-scroll">
          <nav>
            {nav.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  className={`nav-item ${item.colorClass} ${page === item.label ? 'active' : ''}`}
                  onClick={() => setPage(item.label)}
                  title={item.label}
                >
                  <span className="nav-icon"><Icon size={19} /></span>
                  {sidebarOpen && <span className="nav-text">{item.label}</span>}
                </button>
              )
            })}
          </nav>
        </div>
        {sidebarOpen && <div className="sidebar-bottom"><div className="profile-row"><div className="profile-avatar">{authUser ? authUser.email.slice(0, 2).toUpperCase() : '?'}</div><div><strong>{authUser ? authUser.email : 'Signed out'}</strong><small>{authUser ? authUser.role.replace('_', ' ') : ''}</small></div></div></div>}
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>Menu</button>
          <div className="breadcrumbs"><strong>{page}</strong></div>
          <div className="top-actions">
                        <button className="icon-btn theme-toggle" onClick={toggleTheme} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
                        <button className="top-avatar" onClick={() => setShowAuth(true)} title={authUser ? `Connected as ${authUser.email}` : 'Connect workspace'}>{authUser ? authUser.email.slice(0, 2).toUpperCase() : '?'}</button>
          </div>
        </header>
        <div className="content">
          {!authToken || !authUser ? <SignInPrompt onSignIn={() => setShowAuth(true)} /> : <>
            {page === 'Overview' && <><Overview token={authToken} products={liveProducts ?? []} orders={liveOrders ?? []} drafts={contentDrafts} onNavigate={setPage} onAdd={() => setShowAdd(true)} /><NotificationsPanel token={authToken} onNotify={notify} /></>}
            {page === 'Markaz Studio' && <StudioPage token={authToken} role={authUser.role} onNotify={notify} />}
            {page === 'Integrations' && <IntegrationsPage token={authToken} role={authUser.role} onNotify={notify} />}
            {page === 'Customers' && <div className="page"><InboxPage token={authToken} conversations={conversations} onCreate={() => setShowConversation(true)} onReload={() => { api.conversations(authToken).then(({ conversations: rows }) => setConversations(rows)).catch(() => notify('Could not reload conversations')) }} onNotify={notify} /></div>}
            {(page === 'Products' || page === 'Orders' || page === 'Content Studio') && <PageView page={page} products={liveProducts ?? []} orders={liveOrders ?? []} conversations={conversations} drafts={contentDrafts} onAdd={() => setShowAdd(true)} onCreateOrder={() => setShowOrder(true)} onCreateConversation={() => setShowConversation(true)} onGenerateContent={generateContent} onDecideContentDraft={decideContentDraft} onNotify={notify} onCreateProduct={saveProduct} onUpdateProduct={updateProduct} onDeleteProduct={deleteProduct} onImportProducts={importProducts} onRequestPayment={requestPayment} onRequestSupplier={requestSupplier} onChangeOrderStatus={changeOrderStatus} />}
            {page === 'Publishing' && <><div className="page panel-stack"><AutopilotPanel token={authToken} role={authUser.role} onNotify={notify} /></div><PublishingPanel token={authToken} drafts={contentDrafts} onNotify={notify} /></>}
            {page === 'Settings' && <><AccountSettings user={authUser} onSignOut={() => { void signOut() }} /></>}
          </>}
        </div>
      </main>
      {showAdd && <AddProductModal onClose={() => setShowAdd(false)} onSave={saveProduct} />}
      {showOrder && <CreateOrderModal products={liveProducts ?? []} onClose={() => setShowOrder(false)} onSave={saveOrder} />}
      {showConversation && <CreateConversationModal onClose={() => setShowConversation(false)} onSave={createConversation} />}
      {showAuth && <AuthModal user={authUser} onClose={() => setShowAuth(false)} onSignIn={signIn} onSignOut={signOut} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Stat({ title, value, foot, icon: Icon, color }: { title: string; value: string; foot?: string; icon: React.ComponentType<{ size?: number }>; color: string }) {
  return (
    <div className={`metric card ${color}`}>
      <div className="metric-header">
        <p>{title}</p>
        <span className="metric-icon-wrap"><Icon size={20} /></span>
      </div>
      <h3>{value}</h3>
      {foot && <small>{foot}</small>}
    </div>
  )
}

// Overview shows ONLY real numbers from the API and a checklist of the real flow:
// Markaz products -> your profit -> post on social media -> chat with customers -> order to Markaz.
function Overview({ token, products, orders, drafts, onNavigate, onAdd }: { token: string; products: Product[]; orders: ApiOrder[]; drafts: ApiContentDraft[]; onNavigate: (p: PageKey) => void; onAdd: () => void }) {
  const [analytics, setAnalytics] = useState<ApiAnalytics | null>(null)
  const [integrations, setIntegrations] = useState<ApiIntegration[]>([])
  const [accounts, setAccounts] = useState<ApiSocialAccount[]>([])
  const [jobs, setJobs] = useState<ApiPublishingJob[]>([])
  useEffect(() => {
    api.analytics(token).then(setAnalytics).catch(() => undefined)
    api.integrations(token).then((r) => setIntegrations(r.integrations)).catch(() => undefined)
    api.socialAccounts(token).then((r) => setAccounts(r.accounts)).catch(() => undefined)
    api.publishingJobs(token).then((r) => setJobs(r.jobs)).catch(() => undefined)
  }, [token])
  const connected = (provider: string) => integrations.some((i) => String(i.provider) === provider && i.enabled)
  const steps: { title: string; detail: string; done: boolean; page: PageKey; cta: string }[] = [
    { title: '1. Take products from Markaz', detail: 'Paste a Markaz category or product link in Markaz Studio. Name, price and picture are read from the page and your profit is added automatically.', done: products.length > 0, page: 'Markaz Studio', cta: 'Open Markaz Studio' },
    { title: '2. Connect your posting account', detail: 'Add your Buffer key in Integrations and press Sync to load your Facebook / Instagram / TikTok channels.', done: accounts.some((a) => a.status === 'connected'), page: 'Integrations', cta: 'Open Integrations' },
    { title: '3. Create and approve posts', detail: 'Generate a caption for a product, check every claim, approve it.', done: drafts.some((d) => d.status === 'approved'), page: 'Content Studio', cta: 'Open Content Studio' },
    { title: '4. Schedule the posts', detail: 'Pick an approved post, an account and a time. Limits and category rules are checked for you.', done: jobs.length > 0, page: 'Publishing', cta: 'Open Publishing' },
    { title: '5. Connect customer chat', detail: 'Connect Facebook / Instagram (Meta) or WhatsApp so customer messages reach the Customers page.', done: connected('meta') || connected('whatsapp'), page: 'Integrations', cta: 'Connect chat' },
    { title: '6. Turn chats into orders and send them to Markaz', detail: 'Create the order from the chat, then copy the ready Markaz order text from the Orders page.', done: orders.length > 0, page: 'Customers', cta: 'Open Customers' },
  ]
  const s = analytics?.summary
  const rs = (value: number) => `Rs. ${Math.round(value).toLocaleString()}`
  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p><h1>Overview</h1></div><div className="heading-actions"><button className="primary-btn" onClick={onAdd}><Plus size={16} /> Add product</button></div></div>
    <div className="metric-grid">
      <Stat title="Products" value={String(s?.products ?? products.length)} icon={ShoppingBag} color="stat-purple" />
      <Stat title="Open orders" value={s ? String(s.openOrders) : '-'} icon={PackageCheck} color="stat-blue" />
      <Stat title="Delivered revenue" value={s ? rs(s.revenue) : '-'} foot="Delivered orders only" icon={DollarSign} color="stat-emerald" />
      <Stat title="Gross profit" value={s ? rs(s.grossProfit) : '-'} foot="Before delivery, fees and refunds" icon={TrendingUp} color="stat-amber" />
    </div>
    <section className="card panel-card"><div className="card-heading"><div><h2>Your flow, step by step</h2></div></div>
      <div className="panel-list">{steps.map((step) => <div className="panel-row" key={step.title}><strong>{step.title}</strong><span>{step.detail}</span><span className={`status ${step.done ? 'delivered' : 'new'}`}>{step.done ? 'done' : 'to do'}</span><span /><button className="secondary-btn compact" onClick={() => onNavigate(step.page)}>{step.cta}</button></div>)}</div>
    </section>
    <section className="card panel-card"><div className="card-heading"><div><h2>Recent orders</h2></div><button className="text-btn" onClick={() => onNavigate('Orders')}>View all </button></div>
      {orders.length === 0 ? <p className="muted">No orders yet.</p> : <div className="panel-list">{orders.slice(0, 5).map((order) => <div className="panel-row" key={order.id}><strong>{order.customer_name}</strong><span>{order.product_name} x {order.quantity}</span><span>Rs. {Number(order.total_amount).toLocaleString()}</span><span className={`status ${order.status}`}>{order.status.replace(/_/g, ' ')}</span><span>{new Date(order.created_at).toLocaleDateString()}</span></div>)}</div>}
    </section>
  </div>
}

function SignInPrompt({ onSignIn }: { onSignIn: () => void }) {
  return <div className="page"><section className="card panel-card"><h2>Sign in to your workspace</h2><button className="primary-btn" onClick={onSignIn}>Sign in or create workspace</button></section></div>
}

function AccountSettings({ user, onSignOut }: { user: ApiUser; onSignOut: () => void }) {
  return <div className="page panel-stack"><section className="card panel-card"><h2>Account</h2>
    <div className="stat-grid"><div className="stat-tile"><small>Email</small><strong style={{ fontSize: 14, wordBreak: 'break-all' }}>{user.email}</strong></div><div className="stat-tile"><small>Role</small><strong>{user.role.replace('_', ' ')}</strong></div></div>
    <button className="secondary-btn" onClick={onSignOut}>Sign out</button></section></div>
}

function PageView({ page, products, orders, conversations, drafts, onAdd, onCreateOrder, onCreateConversation, onGenerateContent, onDecideContentDraft, onNotify, onCreateProduct, onUpdateProduct, onDeleteProduct, onImportProducts, onRequestPayment, onRequestSupplier, onChangeOrderStatus }: { page: PageKey; products: Product[]; orders: ApiOrder[]; conversations: ApiConversation[]; drafts: ApiContentDraft[]; onAdd: () => void; onCreateOrder: () => void; onCreateConversation: () => void; onGenerateContent: (data: { productId?: string; productName: string; category: string; platform: string; language: string; price?: number; brandVoice?: string }) => void; onDecideContentDraft: (id: string, decision: 'approved' | 'rejected') => void; onNotify: (s: string) => void; onCreateProduct: (product: NewProduct) => void; onUpdateProduct: (id: string, product: Partial<NewProduct>) => void; onDeleteProduct: (id: string) => void; onImportProducts: (csv: string) => void; onRequestPayment: (order: ApiOrder) => void; onRequestSupplier: (order: ApiOrder) => void; onChangeOrderStatus: (order: ApiOrder, status: string) => void }) {
  const configs: Record<PageKey, { title: string }> = {
    'Markaz Studio': { title: 'Markaz Studio' }, Integrations: { title: 'Integrations' }, Overview: { title: 'Overview' }, Products: { title: 'Products' }, 'Content Studio': { title: 'Posts' }, Publishing: { title: 'Publishing' }, Orders: { title: 'Orders' }, Customers: { title: 'Customers' }, Settings: { title: 'Settings' },
  }
  const config = configs[page]
  return <div className="page"><div className="page-heading"><div><h1>{config.title}</h1></div><div className="heading-actions">{page === 'Products' && <button className="primary-btn" onClick={onAdd}>Add product</button>}</div></div>
    {page === 'Products' ? <ProductView products={products} onAdd={onAdd} onNotify={onNotify} onUpdateProduct={onUpdateProduct} onDeleteProduct={onDeleteProduct} onImportProducts={onImportProducts} /> : page === 'Orders' ? <OrdersView orders={orders} products={products} onCreateOrder={onCreateOrder} onRequestPayment={onRequestPayment} onRequestSupplier={onRequestSupplier} onChangeStatus={onChangeOrderStatus} /> : page === 'Customers' ? <CustomerView conversations={conversations} onCreate={onCreateConversation} /> : page === 'Content Studio' ? <ContentStudioView products={products} drafts={drafts} onGenerate={onGenerateContent} onDecide={onDecideContentDraft} /> : null}
  </div>
}

function ContentStudioView({ products, drafts, onGenerate, onDecide }: { products: Product[]; drafts: ApiContentDraft[]; onGenerate: (data: { productId?: string; productName: string; category: string; platform: string; language: string; price?: number; brandVoice?: string }) => void; onDecide: (id: string, decision: 'approved' | 'rejected') => void }) {
  const [productId, setProductId] = useState(products.find((product) => product.id)?.id ?? '')
  const [platform, setPlatform] = useState('instagram')
  const [language, setLanguage] = useState('roman_urdu')
  const selected = products.find((product) => product.id === productId)
  return <section className="card table-card"><div className="card-heading"><div><h2>AI content drafts</h2></div></div><div className="modal-body"><label>Product<select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Choose a live product</option>{products.filter((product) => product.id).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><div className="form-grid"><label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="whatsapp">WhatsApp</option></select></label><label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="roman_urdu">Roman Urdu</option><option value="english">English</option><option value="urdu">Urdu</option></select></label></div><button className="primary-btn" disabled={!selected} onClick={() => selected && onGenerate({ productId: selected.id, productName: selected.name, category: selected.category, platform, language, price: Number(selected.price.replace(/[^\d.]/g, '')) })}>Generate review draft</button></div>{drafts.length === 0 ? <div className="empty-feature"><h2>No drafts yet</h2></div> : <div className="activity-list">{drafts.map((draft) => <div className="activity-item" key={draft.id}><span className="activity-bubble bubble-0"></span><div><strong>{draft.platform} · {draft.language} · {draft.status}</strong><p>{draft.content.caption}</p><small>{draft.content.hashtags.join(' ')} · {draft.content.disclaimer}</small>{draft.status === 'draft' && <div className="order-actions"><button className="secondary-btn compact" onClick={() => onDecide(draft.id, 'approved')}>Approve</button><button className="secondary-btn compact" onClick={() => onDecide(draft.id, 'rejected')}>Reject</button></div>}</div></div>)}</div>}</section>
}

function CustomerView({ conversations, onCreate }: { conversations: ApiConversation[]; onCreate: () => void }) {
  return <section className="card table-card"><div className="card-heading"><div><h2>Customer inbox</h2></div><button className="primary-btn" onClick={onCreate}>New conversation</button></div>{conversations.length === 0 ? <div className="empty-feature"><h2>No conversations yet</h2></div> : <div className="activity-list">{conversations.map((conversation) => <div className="activity-item" key={conversation.id}><span className="activity-bubble bubble-0"></span><div><strong>{conversation.customer_name} · {conversation.channel}</strong><p>{conversation.last_message ?? 'No messages yet'} · {conversation.status}</p></div><small>{conversation.phone}</small></div>)}</div>}</section>
}

const orderStatusOptions = ['new', 'pending_confirmation', 'payment_pending', 'payment_verified', 'processing', 'submitted_to_supplier', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded']
function OrdersView({ orders, products, onCreateOrder, onRequestPayment, onRequestSupplier, onChangeStatus }: { orders: ApiOrder[]; products: Product[]; onCreateOrder: () => void; onRequestPayment: (order: ApiOrder) => void; onRequestSupplier: (order: ApiOrder) => void; onChangeStatus: (order: ApiOrder, status: string) => void }) {
  return <section className="card table-card"><div className="card-heading"><div><h2>Live manual orders</h2></div><button className="primary-btn" onClick={onCreateOrder}>Create order</button></div>{orders.length === 0 ? <div className="empty-feature"><h2>No live orders yet</h2><p>Create an order from an approved catalog product to start the manual workflow.</p>{products.length === 0 && <small>Load or create a product first.</small>}</div> : <div className="orders-table"><div className="table-head"><span>Order</span><span>Customer</span><span>Product</span><span>Amount</span><span>Status</span><span>Actions</span></div>{orders.map((order) => <div className="table-row" key={order.id}><div className="order-id"><strong>#{order.id.slice(0, 8).toUpperCase()}</strong><small>{new Date(order.created_at).toLocaleString()}</small></div><div className="customer"><span>{order.customer_name}</span><small>{order.phone}</small></div><span>{order.product_name} × {order.quantity}</span><strong>Rs. {Number(order.total_amount).toLocaleString()}</strong><select className="status-select" aria-label="Order status" value={order.status} onChange={(event) => onChangeStatus(order, event.target.value)}>{orderStatusOptions.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select><div className="order-actions"><button className="secondary-btn compact" onClick={() => onRequestPayment(order)}>Payment review</button><button className="secondary-btn compact" onClick={() => onRequestSupplier(order)}>Supplier review</button></div></div>)}</div>}</section>
}

function ProductView({ products, onAdd, onNotify, onUpdateProduct, onDeleteProduct, onImportProducts }: { products: Product[]; onAdd: () => void; onNotify: (s: string) => void; onUpdateProduct: (id: string, product: Partial<NewProduct>) => void; onDeleteProduct: (id: string) => void; onImportProducts: (csv: string) => void }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const visible = products.filter((p) => (p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || (filter === 'low' ? p.stock > 0 && p.stock < 15 : p.stock === 0)))
  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    onImportProducts(await file.text())
    event.target.value = ''
  }
  return <><div className="tab-row"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All products <b>{products.length}</b></button><button className={filter === 'low' ? 'active' : ''} onClick={() => setFilter('low')}>Low stock <b>{products.filter((p) => p.stock > 0 && p.stock < 15).length}</b></button><button className={filter === 'out' ? 'active' : ''} onClick={() => setFilter('out')}>Out of stock <b>{products.filter((p) => p.stock === 0).length}</b></button><span className="tab-spacer" /><label className="secondary-btn compact">Import CSV<input type="file" accept=".csv,text/csv" hidden onChange={handleImport} /></label></div>
    <div className="card product-card"><div className="product-toolbar"><div className="local-search"><input placeholder="Search products..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="toolbar-right"><button className="secondary-btn compact" onClick={onAdd}>Add</button></div></div>
      {products.length === 0 ? <div className="empty-feature"><h2>No products yet</h2></div> : <div className="product-table"><div className="product-head"><span className="check-box" /> <span>Product</span><span>Category</span><span>Price</span><span>Margin</span><span>Stock</span><span>Status</span><span /></div>{visible.map((p) => <div className="product-line" key={p.id ?? p.name}><span className="check-box" /><div className="product-name">{p.image ? <img src={p.image} alt="" /> : <span className="customer-avatar lavender">{p.name.slice(0, 1).toUpperCase()}</span>}<div><strong>{p.name}</strong><small>{p.sku}</small></div></div><span className="category-pill">{p.category}</span><strong>{p.price}</strong><span className="margin">{p.margin}</span><span className={p.stock < 15 ? 'stock low' : 'stock'}>{p.stock} units</span><span className={`status ${p.status.toLowerCase().replace(' ', '-')}`}>{p.status}</span><div className="product-actions">{p.id && <><button className="icon-btn edit-action" title="Edit product" onClick={() => setEditing(p)}><Edit2 size={15} /></button><button className="icon-btn delete-action" title="Delete product" onClick={() => onDeleteProduct(p.id!)}><Trash2 size={15} /></button></>}</div></div>)}</div>}
      <div className="pagination"><span>Showing {visible.length} of {products.length} products</span></div></div>{editing && <EditProductModal product={editing} onClose={() => setEditing(null)} onSave={(product) => { onUpdateProduct(editing.id!, product); setEditing(null) }} />}</>
}

function AddProductModal({ onClose, onSave }: { onClose: () => void; onSave: (product: NewProduct) => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Home & Kitchen')
  const [wholesalePrice, setWholesalePrice] = useState('1000')
  const [sellingPrice, setSellingPrice] = useState('1150')
  const [stock, setStock] = useState('0')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Catalog</p><h2>Add a new product</h2></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ name, category, wholesalePrice: Number(wholesalePrice), sellingPrice: Number(sellingPrice), stock: Number(stock) }) }}><div className="modal-body"><div className="form-grid"><label>Product name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Aura LED Desk Lamp" minLength={2} required /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Home & Kitchen</option><option>Electronics</option><option>Fashion</option><option>Sports</option><option>Beauty</option><option>Jewellery</option><option>Mobile Accessories</option><option>Other</option></select></label></div><div className="form-grid"><label>Wholesale price<input type="number" min="0" value={wholesalePrice} onChange={(event) => setWholesalePrice(event.target.value)} required /></label><label>Selling price<input type="number" min="0" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} required /></label></div><label>Stock units<input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} required /></label><div className="import-note"><span>AI enrichment remains review-based. Product data will be stored in PostgreSQL for this workspace.</span></div></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Add product </button></div></form></div></div>
}

function CreateOrderModal({ products, onClose, onSave }: { products: Product[]; onClose: () => void; onSave: (order: { customer: { name: string; phone: string; city?: string; address?: string }; productId: string; quantity: number; paymentMethod: string }) => void }) {
  const [productId, setProductId] = useState(products.find((product) => product.id)?.id ?? '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [paymentMethod, setPaymentMethod] = useState('cod')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Manual commerce</p><h2>Create customer order</h2></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ productId, quantity: Number(quantity), paymentMethod, customer: { name, phone, city, address } }) }}><div className="modal-body"><label>Product<select value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Select a live product</option>{products.filter((product) => product.id).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.stock} in stock)</option>)}</select></label><div className="form-grid"><label>Customer name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} minLength={7} required /></label></div><div className="form-grid"><label>City<input value={city} onChange={(event) => setCity(event.target.value)} /></label><label>Quantity<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label></div><label>Address<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={2} /></label><label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cod">Cash on delivery</option><option value="bank_transfer">Bank transfer</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option><option value="other">Other</option></select></label></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit" disabled={!productId}>Create pending order </button></div></form></div></div>
}

function CreateConversationModal({ onClose, onSave }: { onClose: () => void; onSave: (data: { customer: { name: string; phone: string; city?: string; address?: string }; channel: string }) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState('manual')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Customer care</p><h2>New conversation</h2></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ customer: { name, phone }, channel }) }}><div className="modal-body"><label>Customer name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} minLength={7} required /></label><label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="manual">Manual</option><option value="whatsapp">WhatsApp (not connected)</option><option value="instagram">Instagram (not connected)</option><option value="facebook">Facebook (not connected)</option><option value="email">Email (not connected)</option></select></label></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Create inbox record </button></div></form></div></div>
}

function EditProductModal({ product, onClose, onSave }: { product: Product; onClose: () => void; onSave: (product: Partial<NewProduct>) => void }) {
  const [name, setName] = useState(product.name)
  const [category, setCategory] = useState(product.category)
  const [sellingPrice, setSellingPrice] = useState(product.price.replace(/[^\d.]/g, ''))
  const [stock, setStock] = useState(String(product.stock))
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Catalog</p><h2>Edit product</h2></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); onSave({ name, category, sellingPrice: Number(sellingPrice), stock: Number(stock) }) }}><div className="modal-body"><label>Product name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Home & Kitchen</option><option>Electronics</option><option>Fashion</option><option>Sports</option><option>Beauty</option><option>Jewellery</option><option>Mobile Accessories</option><option>Other</option></select></label><div className="form-grid"><label>Selling price<input type="number" min="0" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} required /></label><label>Stock units<input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} required /></label></div></div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">Save changes </button></div></form></div></div>
}

function AuthModal({ user, onClose, onSignIn, onSignOut }: { user: ApiUser | null; onClose: () => void; onSignIn: (token: string, refreshToken: string, user: ApiUser) => void; onSignOut: () => void | Promise<void> }) {
  const urlParams = new URLSearchParams(window.location.search)
  const inviteToken = urlParams.get('invite')
  const referralCode = urlParams.get('ref') ?? undefined
  const [mode, setMode] = useState<'login' | 'register'>(referralCode && !inviteToken ? 'register' : 'login')
  const [recovery, setRecovery] = useState(() => new URLSearchParams(window.location.search).has('reset'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = inviteToken
        ? await api.acceptInvite(inviteToken, password)
        : mode === 'login'
          ? await api.login(email, password)
          : await api.register(email, password, workspaceName, referralCode)
      if (inviteToken) window.history.replaceState({}, '', window.location.pathname)
      onSignIn(result.token, result.refreshToken, result.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to connect workspace')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal auth-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">Production workspace</p><h2>{user ? 'Workspace connection' : mode === 'login' ? 'Connect your workspace' : 'Create your workspace'}</h2></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
    {user ? <div className="modal-body connected-state"><strong>{user.role.replace('_', ' ')} account connected</strong><p>Live API requests are authenticated with a tenant-scoped access token.</p><button className="secondary-btn" onClick={onSignOut}>Sign out</button></div> : recovery ? <RecoveryForm onBack={() => setRecovery(false)} /> : <form onSubmit={submit}><div className="modal-body">
      {!inviteToken && mode === 'register' && <label>Workspace name<input placeholder="Your shop name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} minLength={2} required /></label>}
      {!inviteToken && <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>}
      <label>{inviteToken ? 'Choose a password for your invited account' : 'Password'}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="At least 8 characters" required /></label>
      {error && <p className="form-error">{error}</p>}
      <div className="auth-switch"><span>{mode === 'login' ? 'New to Orbitly?' : 'Already have a workspace?'}</span><button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Create workspace' : 'Sign in'}</button>{mode === 'login' && <button type="button" onClick={() => setRecovery(true)}>Forgot password?</button>}</div>
    </div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={busy}>{busy ? 'Connecting...' : mode === 'login' ? 'Connect workspace' : 'Create workspace'} </button></div></form>}
  </div></div>
}

export default App
