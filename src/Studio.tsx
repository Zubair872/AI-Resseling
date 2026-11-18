// Purpose: "Markaz Studio" page. Auto mode, then 1) read products from Markaz, 2) post a product through Buffer accounts.
import { useEffect, useState } from 'react'
import { api, studioApi, type ApiMarkazAuto, type ApiPostResult, type ApiProduct, type ApiScrapeResult, type ApiSocialAccount } from './api'

const money = (value: number) => `Rs. ${Math.round(value).toLocaleString('en-PK')}`

export function StudioPage({ token, role, onNotify }: { token: string; role: string; onNotify: (message: string) => void }) {
  const [accounts, setAccounts] = useState<ApiSocialAccount[]>([])
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [loading, setLoading] = useState(true)
  const canAdmin = ['admin', 'owner', 'super_admin'].includes(role)
  const canManage = canAdmin || role === 'manager'

  const reload = async () => {
    try {
      const [a, p] = await Promise.all([api.socialAccounts(token), api.products(token)])
      setAccounts(a.accounts); setProducts(p.products)
    } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Could not load Markaz Studio') } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [token])

  return <div className="page panel-stack">
    <AutoCard token={token} canManage={canManage} onNotify={onNotify} onChanged={reload} />
    <MarkazCard token={token} canManage={canManage} onNotify={onNotify} onImported={reload} />
    <PostCard token={token} products={products} accounts={accounts} canManage={canManage} loading={loading} onNotify={onNotify} onDone={reload} />
  </div>
}

function AutoCard({ token, canManage, onNotify, onChanged }: { token: string; canManage: boolean; onNotify: (m: string) => void; onChanged: () => void }) {
  const [state, setState] = useState<ApiMarkazAuto | null>(null)
  const [links, setLinks] = useState('')
  const [perRun, setPerRun] = useState(5)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try { const r = await studioApi.markazAuto(token); setState(r); setLinks(r.urls.join('\n')); setPerRun(r.perRun) } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Could not load auto mode') }
  }
  useEffect(() => { void load() }, [token])
  const parse = () => links.split('\n').map((l) => l.trim()).filter(Boolean)
  const save = async (enabled: boolean) => {
    setBusy(true)
    try { await studioApi.saveMarkazAuto(token, { enabled, urls: parse(), perRun }); onNotify(enabled ? 'Auto mode ON' : 'Auto mode OFF'); await load() } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Could not save') } finally { setBusy(false) }
  }
  const runNow = async () => {
    setBusy(true)
    try { const r = await studioApi.runMarkazAuto(token); onNotify(r.message); await load(); onChanged() } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Run failed') } finally { setBusy(false) }
  }
  return <section className="card panel-card">
    <div className="card-heading"><div><h2>Auto mode: Markaz to posts</h2></div></div>
    {canManage ? <div className="panel-form">
      <label>Markaz links (one per line)<textarea rows={4} placeholder="https://www.markaz.app/shop/home-page/Electronics" value={links} onChange={(e) => setLinks(e.target.value)} /></label>
      <label>New products per run<input type="number" min={1} max={10} value={perRun} onChange={(e) => setPerRun(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></label>
      <button className="primary-btn compact" disabled={busy} onClick={() => save(true)}>{state?.enabled ? 'Save (stay ON)' : 'Turn ON'}</button>
      {state?.enabled && <button className="secondary-btn compact" disabled={busy} onClick={() => save(false)}>Turn OFF</button>}
      <button className="secondary-btn compact" disabled={busy || !state?.enabled} onClick={runNow}>{busy ? 'Working...' : 'Run now'}</button>
    </div> : <p className="muted">Managers and admins only.</p>}
    {state && <p className="muted">Status: {state.enabled ? 'ON' : 'OFF'}{state.lastRun ? ` · last run ${new Date(state.lastRun).toLocaleString()}` : ''}{state.lastMessage ? ` · ${state.lastMessage}` : ''}</p>}
  </section>
}

function MarkazCard({ token, canManage, onNotify, onImported }: { token: string; canManage: boolean; onNotify: (m: string) => void; onImported: () => void }) {
  const [url, setUrl] = useState('')
  const [limit, setLimit] = useState(10)
  const [pages, setPages] = useState(1)
  const [category, setCategory] = useState('')
  const [stock, setStock] = useState(10)
  const [profit, setProfit] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ApiScrapeResult | null>(null)
  const run = async (dryRun: boolean) => {
    setBusy(true)
    try {
      const r = await studioApi.scrape(token, { url: url.trim(), limit, pages, category: category || undefined, defaultStock: stock, profitAmount: profit === '' ? undefined : Number(profit), dryRun })
      setResult(r)
      if (!dryRun) { onNotify(`${r.imported ?? 0} product(s) added to your catalog`); onImported() }
    } catch (reason) { setResult(null); onNotify(reason instanceof Error ? reason.message : 'Could not read Markaz') } finally { setBusy(false) }
  }
  return <section className="card panel-card">
    <div className="card-heading"><div><h2>Step 1. Take products from Markaz</h2></div></div>
    {canManage ? <>
      <div className="panel-form">
        <label>Markaz link<input placeholder="https://www.markaz.app/shop/home-page/Electronics" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label>How many products<input type="number" min={1} max={30} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></label>
        <label>Listing pages to scan<select value={pages} onChange={(e) => setPages(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Detect from the page</option>{['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Stock to assume<input type="number" min={1} value={stock} onChange={(e) => setStock(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label>My profit per item (Rs.)<input type="number" min={0} placeholder="your default" value={profit} onChange={(e) => setProfit(e.target.value)} /></label>
        <button className="secondary-btn compact" disabled={busy || !url.trim()} onClick={() => run(true)}>{busy ? 'Reading Markaz...' : 'Preview'}</button>
        <button className="primary-btn compact" disabled={busy || !result || !result.dryRun || result.products.length === 0} onClick={() => run(false)}>Add {result?.products.length ?? 0} to my catalog</button>
      </div>
    </> : <p className="muted">Managers and admins can read products from Markaz.</p>}
    {result && <div>
      <p><strong>{result.products.length}</strong> product(s) {result.dryRun ? 'ready to add' : 'added'} · {result.linksFound} links found · {result.failures.length} could not be read</p>
      {result.products.length > 0 && <div className="studio-grid">{result.products.map((p) => <article key={p.url} className="studio-item">{p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="studio-noimg">{p.name.slice(0, 1)}</div>}<strong>{p.name}</strong><small>{p.category}</small><small>Markaz {money(p.wholesalePrice)} → you sell {money(p.sellingPrice)} (profit {money(p.profit)})</small></article>)}</div>}
      {result.notes.map((n, i) => <p key={`n${i}`} className="muted">{n}</p>)}
      {result.rejected.map((r, i) => <p key={`r${i}`} className="muted">Skipped {r.name}: {r.reasons.join('; ')}</p>)}
      {result.failures.map((f, i) => <p key={`f${i}`} className="muted">Could not read {f.url}: {f.reason}</p>)}
    </div>}
  </section>
}

function PostCard({ token, products, accounts, canManage, loading, onNotify, onDone }: { token: string; products: ApiProduct[]; accounts: ApiSocialAccount[]; canManage: boolean; loading: boolean; onNotify: (m: string) => void; onDone: () => void }) {
  const connected = accounts.filter((a) => a.status === 'connected')
  const [selected, setSelected] = useState<string[]>([])
  const [language, setLanguage] = useState('roman_urdu')
  const [when, setWhen] = useState('')
  const [repost, setRepost] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ApiPostResult['results']>>({})
  const available = products.filter((p) => p.stock > 0)
  const post = async (product: ApiProduct) => {
    if (selected.length === 0) return onNotify('Tick at least one account first')
    setBusyId(product.id)
    try {
      const r = await studioApi.postProduct(token, product.id, { accountIds: selected, language, scheduledFor: when ? new Date(when).toISOString() : undefined, repost })
      setResults({ ...results, [product.id]: r.results }); onDone()
    } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Could not post') } finally { setBusyId(null) }
  }
  return <section className="card panel-card">
    <div className="card-heading"><div><h2>Step 2. Post a product (via Buffer)</h2></div></div>
    {connected.length === 0 ? <p className="muted">No account yet. Add your Buffer key in Integrations and press Sync.</p> : <div className="panel-form">
      <div className="studio-accounts">{connected.map((a) => <label key={a.id} className="check"><input type="checkbox" checked={selected.includes(a.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))} />{a.display_name} <small>({a.platform})</small></label>)}</div>
      <label>Language<select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="roman_urdu">Roman Urdu</option><option value="english">English</option><option value="urdu">Urdu</option></select></label>
      <label>Send at (empty = now)<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={repost} onChange={(e) => setRepost(e.target.checked)} />Post again even if already posted</label>
    </div>}
    {loading ? <p className="muted">Loading...</p> : available.length === 0 ? <p className="muted">No products yet. Take products from Markaz in Step 1.</p> : <ul className="studio-list">{available.map((p) => <li key={p.id}>
      <div className="studio-product">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="studio-noimg small">{p.name.slice(0, 1)}</div>}<div><strong>{p.name}</strong><small>{money(Number(p.selling_price))} · stock {p.stock}</small>
        {results[p.id]?.map((r) => <small key={r.accountId} className={r.status === 'published' || r.status === 'scheduled_local' || r.status === 'scheduled_in_buffer' || r.status === 'submitted_to_tiktok' ? 'ok' : 'bad'}>{r.account ?? 'Account'}: {r.status}. {r.message}</small>)}</div></div>
      {canManage && <button className="primary-btn compact" disabled={busyId !== null || connected.length === 0} onClick={() => post(p)}>{busyId === p.id ? 'Sending...' : when ? 'Schedule' : 'Post now'}</button>}
    </li>)}</ul>}
  </section>
}
