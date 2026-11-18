// Purpose: live Social Accounts + Publishing scheduler panel and Super Admin tenant panel (talk to the real API).
import { useEffect, useState } from 'react'
import { api, type ApiAdminTenant, type ApiAnalytics, type ApiContentDraft, type ApiNotification, type ApiSocialAccount } from './api'

export function PublishingPanel({ token, drafts, onNotify }: { token: string; drafts: ApiContentDraft[]; onNotify: (message: string) => void }) {
  const [accounts, setAccounts] = useState<ApiSocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState({ draftId: '', accountId: '', when: '' })
  const approved = drafts.filter((draft) => draft.status === 'approved')

  const load = () => api.socialAccounts(token).then(({ accounts: rows }) => setAccounts(rows)).catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load social accounts')).finally(() => setLoading(false))
  useEffect(() => { void load() }, [token])

  const schedule = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!job.draftId || !job.accountId || !job.when) return onNotify('Choose an approved draft, an account and a time')
    try {
      await api.createPublishingJob(token, { contentDraftId: job.draftId, socialAccountId: job.accountId, scheduledFor: new Date(job.when).toISOString() })
      onNotify('Post queued. It is only sent once an official channel adapter is connected.')
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Could not schedule post')
    }
  }

  return <div className="page panel-stack">
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Connected social channels</h2></div></div>
      {loading ? <p className="muted">Loading channels...</p> : accounts.length === 0 ? <div className="empty-feature"><h2>No connected channels</h2></div> : <div className="panel-list">{accounts.map((a) => <div className="panel-row" key={a.id}><strong>{a.display_name}</strong><span>{a.platform}</span><span>{a.category ?? 'Any category'}</span><span>{a.daily_limit} posts/day</span><span className={`status ${a.status}`}>{a.status}</span></div>)}</div>}
    </section>
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Schedule a post</h2></div></div>
      <form className="panel-form" onSubmit={schedule}>
        <select value={job.draftId} onChange={(e) => setJob({ ...job, draftId: e.target.value })} aria-label="Approved draft"><option value="">Approved draft...</option>{approved.map((d) => <option key={d.id} value={d.id}>{d.platform} · {d.content.caption.slice(0, 40)}</option>)}</select>
        <select value={job.accountId} onChange={(e) => setJob({ ...job, accountId: e.target.value })} aria-label="Account"><option value="">Account...</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name} ({a.platform})</option>)}</select>
        <input type="datetime-local" value={job.when} onChange={(e) => setJob({ ...job, when: e.target.value })} aria-label="Scheduled time" />
        <button className="primary-btn" type="submit">Schedule</button>
      </form>
      {approved.length === 0 && <p className="muted">No approved drafts yet. Generate and approve content in Content Studio first.</p>}
    </section>
  </div>
}

export function AdminPanel({ token, onNotify }: { token: string; onNotify: (message: string) => void }) {
  const [tenants, setTenants] = useState<ApiAdminTenant[]>([])
  const [loading, setLoading] = useState(true)
  const load = () => api.adminTenants(token).then(({ tenants: rows }) => setTenants(rows)).catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load tenants')).finally(() => setLoading(false))
  useEffect(() => { void load() }, [token])
  const toggle = async (tenant: ApiAdminTenant) => {
    const next = tenant.status === 'active' ? 'suspended' : 'active'
    if (next === 'suspended' && !window.confirm(`Suspend ${tenant.name}? Its users will be signed out and blocked.`)) return
    try {
      await api.setTenantStatus(token, tenant.id, next)
      onNotify(`${tenant.name} is now ${next}`)
      await load()
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Could not update tenant')
    }
  }
  return <div className="page panel-stack"><section className="card panel-card">
    <div className="card-heading"><div><h2>Super Admin · Tenants</h2></div></div>
    {loading ? <p className="muted">Loading tenants...</p> : <div className="panel-list">{tenants.map((t) => <div className="panel-row" key={t.id}><strong>{t.name}</strong><span>{t.plan_code ?? 'no plan'}</span><span>{t.users} users · {t.products} products · {t.orders} orders</span><span className={`status ${t.status}`}>{t.status}</span><button className="secondary-btn compact" onClick={() => toggle(t)}>{t.status === 'active' ? 'Suspend' : 'Reactivate'}</button></div>)}</div>}
  </section></div>
}

export function NotificationsPanel({ token, onNotify }: { token: string; onNotify: (message: string) => void }) {
  const [items, setItems] = useState<ApiNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const load = () => api.notifications(token).then(({ notifications, unread: count }) => { setItems(notifications); setUnread(count) }).catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load notifications')).finally(() => setLoading(false))
  useEffect(() => { void load() }, [token])
  const readAll = async () => {
    try { await api.markAllNotificationsRead(token); await load() } catch { onNotify('Could not update notifications') }
  }
  const readOne = async (id: string) => {
    try { await api.markNotificationRead(token, id); await load() } catch { onNotify('Could not update notification') }
  }
  return <div className="page panel-stack"><section className="card panel-card">
    <div className="card-heading"><div><h2>Notifications {unread > 0 && <span className="status new">{unread} unread</span>}</h2></div><button className="secondary-btn compact" onClick={readAll} disabled={unread === 0}>Mark all read</button></div>
    {loading ? <p className="muted">Loading notifications...</p> : items.length === 0 ? <div className="empty-feature"><h2>You are all caught up</h2></div> : <div className="panel-list">{items.map((n) => <div className="panel-row notification-row" key={n.id}><strong>{n.title}</strong><span>{n.body}</span><span>{new Date(n.created_at).toLocaleString()}</span>{n.read_at ? <span className="muted">read</span> : <button className="secondary-btn compact" onClick={() => readOne(n.id)}>Mark read</button>}</div>)}</div>}
  </section></div>
}

function ExportsCard({ token, onNotify }: { token: string; onNotify: (message: string) => void }) {
  const [dataset, setDataset] = useState('orders')
  const [sheet, setSheet] = useState({ spreadsheetId: '', tab: 'Orders' })
  const [busy, setBusy] = useState(false)
  const download = async (format: 'csv' | 'xls') => {
    try {
      const url = URL.createObjectURL(await api.exportDataset(token, dataset, format))
      const link = document.createElement('a')
      link.href = url
      link.download = `${dataset}.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Export failed') }
  }
  const sync = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try { const r = await api.syncSheets(token, { dataset, ...sheet }); onNotify(`${r.rows} rows written. ${r.note}`) } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Sheets sync failed') } finally { setBusy(false) }
  }
  return <section className="card panel-card">
    <div className="card-heading"><div><h2>Exports and Google Sheets</h2></div></div>
    <div className="panel-form">
      <select value={dataset} onChange={(e) => setDataset(e.target.value)} aria-label="Dataset">{['orders', 'products', 'customers', 'payments', 'supplier_orders', 'profit'].map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}</select>
      <button className="secondary-btn compact" onClick={() => download('csv')}>Download CSV</button>
      <button className="secondary-btn compact" onClick={() => download('xls')}>Download Excel</button>
    </div>
    <form className="panel-form" onSubmit={sync}>
      <input required placeholder="Google spreadsheet ID" value={sheet.spreadsheetId} onChange={(e) => setSheet({ ...sheet, spreadsheetId: e.target.value })} aria-label="Spreadsheet ID" />
      <input required placeholder="Tab name" value={sheet.tab} onChange={(e) => setSheet({ ...sheet, tab: e.target.value })} aria-label="Tab name" />
      <button className="primary-btn compact" disabled={busy}>Sync to Google Sheets</button>
    </form>
  </section>
}

export function AnalyticsPanel({ token, onNotify }: { token: string; onNotify: (message: string) => void }) {
  const [data, setData] = useState<ApiAnalytics | null>(null)
  useEffect(() => { api.analytics(token).then(setData).catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load analytics')) }, [token])
  const exportCsv = async () => {
    try {
      const csv = await api.exportOrdersCsv(token)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'orders.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Export failed')
    }
  }
  if (!data) return <div className="page panel-stack"><section className="card panel-card"><p className="muted">Loading live analytics...</p></section></div>
  const s = data.summary
  const rs = (value: number) => `Rs. ${value.toLocaleString()}`
  const cards: [string, string][] = [['Products', String(s.products)], ['Social accounts', String(s.socialAccounts)], ['Conversations', String(s.conversations)], ['Orders', String(s.orders)], ['Open orders', String(s.openOrders)], ['Delivered', String(s.completedOrders)], ['Cancelled', String(s.cancelledOrders)], ['Revenue (delivered)', rs(s.revenue)], ['Wholesale cost', rs(s.wholesaleCost)], ['Gross profit', rs(s.grossProfit)]]
  return <div className="page panel-stack"><section className="card panel-card">
    <div className="card-heading"><div><h2>Live analytics</h2></div><button className="secondary-btn compact" onClick={exportCsv}>Export orders CSV</button></div>
    <div className="stat-grid">{cards.map(([label, value]) => <div className="stat-tile" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    <h3>By category (delivered orders)</h3>
    {data.byCategory.length === 0 ? <p className="muted">No delivered orders yet.</p> : <div className="panel-list">{data.byCategory.map((c) => <div className="panel-row" key={c.category}><strong>{c.category}</strong><span>{c.orders} orders</span><span>{rs(c.revenue)}</span></div>)}</div>}
  </section><ExportsCard token={token} onNotify={onNotify} /></div>
}

export function RecoveryForm({ onBack }: { onBack: () => void }) {
  const initialToken = new URLSearchParams(window.location.search).get('reset') ?? ''
  const [step, setStep] = useState<'request' | 'reset'>(initialToken ? 'reset' : 'request')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState(initialToken)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Something went wrong') } finally { setBusy(false) }
  }
  const request = (event: React.FormEvent) => { event.preventDefault(); void run(async () => { const result = await api.forgotPassword(email); setMessage(result.message); setStep('reset') }) }
  const reset = (event: React.FormEvent) => { event.preventDefault(); void run(async () => { await api.resetPassword(token.trim(), password); window.history.replaceState({}, '', window.location.pathname); setMessage('Password changed. You can sign in now.'); setPassword(''); onBack() }) }
  return <form onSubmit={step === 'request' ? request : reset}><div className="modal-body">
    {step === 'request' ? <label>Account email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label> : <>
      <label>Reset code from your email link<input value={token} onChange={(e) => setToken(e.target.value)} required minLength={20} /></label>
      <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label></>}
    {message && <p className="muted">{message}</p>}
    {error && <p className="form-error">{error}</p>}
    <p className="muted">Email sending is not connected yet, so reset links are only visible in the server log until an email provider is configured.</p>
  </div><div className="modal-foot"><button type="button" className="secondary-btn" onClick={onBack}>Back to sign in</button><button className="primary-btn" disabled={busy}>{busy ? 'Please wait...' : step === 'request' ? 'Send reset link' : 'Change password'}</button></div></form>
}
