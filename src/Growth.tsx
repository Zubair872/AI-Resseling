// Purpose (round 12): OAuth connect buttons, WhatsApp templates, marketplace CSV import and the LLM assistant card.
// Syntax-checked only in the authoring session (no npm registry). Run `npm run build` locally and send me any error.
import { useEffect, useState } from 'react'
import { api, type ApiIntegration, type ApiLlmOutput, type ApiMarketplaceResult, type ApiMetaPage, type ApiOAuthInfo, type ApiWaTemplate } from './api'

type Notify = (message: string) => void
const fail = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback)

// ---------------- Connect with Facebook/Instagram and TikTok ----------------
export function ConnectCards({ token, canAdmin, integrations, onNotify, onChanged }: { token: string; canAdmin: boolean; integrations: ApiIntegration[]; onNotify: Notify; onChanged: () => void }) {
  const [info, setInfo] = useState<{ meta: ApiOAuthInfo; tiktok: ApiOAuthInfo } | null>(null)
  const [pages, setPages] = useState<ApiMetaPage[] | null>(null)
  const [selection, setSelection] = useState('')
  const [aiMode, setAiMode] = useState('approval')
  const [commentReplyMode, setCommentReplyMode] = useState('private')
  const [busy, setBusy] = useState('')

  useEffect(() => { api.oauthStatus(token).then(setInfo).catch(() => undefined) }, [token])
  // The provider sends the browser back to /?oauth=meta&status=...: show the result and, for Meta, let the user pick a Page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const provider = params.get('oauth')
    if (!provider) return
    const status = params.get('status')
    const message = params.get('message')
    const pick = params.get('token')
    window.history.replaceState({}, '', window.location.pathname)
    if (status === 'select' && pick) {
      setSelection(pick)
      api.oauthPending(token, pick).then(({ pages: list }) => setPages(list)).catch((e) => onNotify(fail(e, 'This selection expired. Press Connect again.')))
    } else if (message) { onNotify(message); onChanged() }
  }, [token])

  const connect = async (provider: 'meta' | 'tiktok') => {
    setBusy(provider)
    try { const { url } = await api.oauthStart(token, provider); window.location.assign(url) } catch (e) { onNotify(fail(e, 'Could not start login')); setBusy('') }
  }
  const finish = async (pageId: string) => {
    setBusy('finish')
    try {
      const r = await api.oauthFinishMeta(token, { token: selection, pageId, aiMode, commentReplyMode })
      onNotify(r.message); setPages(null); onChanged()
    } catch (e) { onNotify(fail(e, 'Could not finish connecting')) } finally { setBusy('') }
  }
  const meta = integrations.find((i) => i.provider === 'meta')
  const tiktok = integrations.find((i) => i.provider === 'tiktok')
  const card = (title: string, provider: 'meta' | 'tiktok', about: InfoAbout, current: ApiIntegration | undefined) => <div className="panel-row" style={{ alignItems: 'flex-start' }}>
    <div><strong>{title}</strong><br /><small className="muted">{current ? `${current.status}${current.connected_via === 'oauth' ? ' · connected by login' : ' · token pasted by hand'}` : 'Not connected'}</small>{current?.status_message && <><br /><small>{current.status_message}</small></>}</div>
    <div>{canAdmin ? <button className="primary-btn compact" disabled={busy === provider || !about?.configured} onClick={() => void connect(provider)}>{current ? 'Reconnect' : 'Connect'} {provider === 'meta' ? 'Facebook / Instagram' : 'TikTok'}</button> : <small className="muted">Admins only</small>}</div>
    {about && !about.configured && <small className="muted" style={{ gridColumn: '1 / -1' }}>Not set up on the server yet. Missing: {about.missing.join(', ')}. See DEPLOYMENT.md. {about.redirectUri ? `Add this redirect URL in the developer app: ${about.redirectUri}` : ''}</small>}
  </div>
  return <section className="card panel-card">
    <div className="card-heading"><div><h2>Connect with login (OAuth)</h2></div></div>
    <div className="panel-list">{card('Facebook Page + Instagram (messages, comments)', 'meta', info?.meta, meta)}{card('TikTok (photo posts)', 'tiktok', info?.tiktok, tiktok)}</div>
    {pages && <div className="panel-form" style={{ marginTop: 12 }}>
      <h3 style={{ width: '100%' }}>Choose the Page to connect</h3>
      <label>AI replies<select value={aiMode} onChange={(e) => setAiMode(e.target.value)}><option value="manual">Off</option><option value="approval">AI drafts, I send</option><option value="auto">AI sends safe answers</option></select></label>
      <label>Comments<select value={commentReplyMode} onChange={(e) => setCommentReplyMode(e.target.value)}><option value="private">Private message only</option><option value="public">Short public reply only</option><option value="both">Private message + public note</option></select></label>
      {pages.length === 0 ? <p className="muted">No Pages were granted.</p> : pages.map((pg) => <button key={pg.id} className="secondary-btn" disabled={busy === 'finish'} onClick={() => void finish(pg.id)}>{pg.name}{pg.instagramUsername ? ` + @${pg.instagramUsername}` : ''}</button>)}
      <button className="secondary-btn" onClick={() => setPages(null)}>Cancel</button>
    </div>}
  </section>
}
type InfoAbout = ApiOAuthInfo | undefined

// Public reply mode for an already-connected Meta integration.
export function CommentModeSelect({ token, item, onNotify, onChanged }: { token: string; item: ApiIntegration; onNotify: Notify; onChanged: () => void }) {
  return <label className="muted">Comments: <select className="status-select" value={item.config.commentReplyMode ?? 'private'} onChange={async (e) => {
    try { await api.updateIntegration(token, item.id, { config: { ...item.config, commentReplyMode: e.target.value } }); onNotify('Comment reply mode saved'); onChanged() } catch (reason) { onNotify(fail(reason, 'Could not save')) }
  }}><option value="private">Private message only</option><option value="public">Short public reply only</option><option value="both">Private message + public note</option></select></label>
}

// ---------------- WhatsApp templates ----------------
export function WhatsAppTemplates({ token, canAdmin, onNotify }: { token: string; canAdmin: boolean; onNotify: Notify }) {
  const [rows, setRows] = useState<ApiWaTemplate[]>([])
  const [state, setState] = useState({ connected: true, wabaIdSet: true })
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', language: 'en', category: 'UTILITY', bodyText: '', headerText: '', footerText: '', examples: '' })
  const load = () => api.waTemplates(token).then((r) => { setRows(r.templates); setState({ connected: r.connected, wabaIdSet: r.wabaIdSet }) }).catch(() => onNotify('Could not load templates'))
  useEffect(() => { void load() }, [token])
  const act = async (fn: () => Promise<string | void>) => { setBusy(true); try { const m = await fn(); if (m) onNotify(m); await load() } catch (e) { onNotify(fail(e, 'Action failed')) } finally { setBusy(false) } }
  const create = (e: React.FormEvent) => {
    e.preventDefault()
    void act(async () => {
      const r = await api.waCreate(token, { name: form.name, language: form.language, category: form.category, bodyText: form.bodyText, headerText: form.headerText || undefined, footerText: form.footerText || undefined, examples: form.examples.split('|').map((x) => x.trim()).filter(Boolean) })
      setForm({ ...form, name: '', bodyText: '', examples: '' })
      return `${r.note}${r.warnings.length ? ' Warning: ' + r.warnings.join(' ') : ''}`
    })
  }
  return <>
    <section className="card panel-card">
      <div className="card-heading"><div><h2>WhatsApp message templates</h2></div>{canAdmin && <button className="secondary-btn compact" disabled={busy} onClick={() => void act(async () => (await api.waSync(token)).note)}>Sync from Meta</button>}</div>
      {!state.connected && <p className="muted">Add a WhatsApp connection first (Connections tab).</p>}
      {state.connected && !state.wabaIdSet && <p className="muted">Add your WhatsApp Business Account ID (<code>wabaId</code>) to the WhatsApp connection to manage templates. Find it in Meta Business Settings → WhatsApp accounts.</p>}
      {rows.length === 0 ? <p className="muted">No templates yet. Create one below or press Sync.</p> : <div className="panel-list">{rows.map((t) => <div className="panel-row" key={t.id}><strong>{t.name} <small className="muted">({t.language})</small></strong><span className="category-pill">{t.category}</span><span className={`status ${t.status === 'APPROVED' ? 'approved' : t.status === 'REJECTED' ? 'rejected' : 'draft'}`}>{t.status}</span><span style={{ wordBreak: 'break-word' }}>{t.body_text}{t.rejected_reason ? ` — ${t.rejected_reason}` : ''}</span>{canAdmin && <button className="secondary-btn compact" onClick={() => { if (window.confirm(`Delete ${t.name}?`)) void act(async () => { await api.waDelete(token, t.id); return 'Template deleted' }) }}>Delete</button>}</div>)}</div>}
    </section>
    {canAdmin && <section className="card panel-card">
      <div className="card-heading"><div><h2>Create a template</h2></div></div>
      <form className="panel-form" onSubmit={create}>
        <input required placeholder="name_in_lowercase" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} aria-label="Template name" />
        <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} aria-label="Language"><option value="en">English (en)</option><option value="en_US">English US</option><option value="ur">Urdu (ur)</option></select>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label="Category"><option value="UTILITY">Utility (order updates)</option><option value="MARKETING">Marketing (offers)</option></select>
        <textarea required rows={3} maxLength={1024} placeholder="Hello {{1}}, your order {{2}} has been shipped. Thank you!" value={form.bodyText} onChange={(e) => setForm({ ...form, bodyText: e.target.value })} aria-label="Body" style={{ gridColumn: '1 / -1' }} />
        <input placeholder="Examples: Ali | ORD-1042" value={form.examples} onChange={(e) => setForm({ ...form, examples: e.target.value })} aria-label="Examples" />
        <input maxLength={60} placeholder="Header (optional)" value={form.headerText} onChange={(e) => setForm({ ...form, headerText: e.target.value })} aria-label="Header" />
        <input maxLength={60} placeholder="Footer (optional)" value={form.footerText} onChange={(e) => setForm({ ...form, footerText: e.target.value })} aria-label="Footer" />
        <button className="primary-btn" disabled={busy}>Submit to Meta</button>
      </form>
    </section>}
  </>
}

// Used in the Customers page: send an approved template into a WhatsApp conversation.
export function SendTemplateBox({ token, conversationId, customerId, onNotify }: { token: string; conversationId: string; customerId: string; onNotify: Notify }) {
  const [rows, setRows] = useState<ApiWaTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [values, setValues] = useState('')
  useEffect(() => { api.waTemplates(token).then((r) => setRows(r.templates.filter((t) => t.status === 'APPROVED'))).catch(() => undefined) }, [token])
  const chosen = rows.find((t) => t.id === templateId)
  const send = async () => { try { const r = await api.sendTemplate(token, conversationId, templateId, values.split('|').map((v) => v.trim()).filter(Boolean)); onNotify(r.note) } catch (e) { onNotify(fail(e, 'Could not send')) } }
  const consent = async () => {
    const source = window.prompt('How did this customer agree to receive WhatsApp messages? (recorded in the audit log)')
    if (!source) return
    try { await api.waOptIn(token, customerId, true, source); onNotify('Opt-in recorded') } catch (e) { onNotify(fail(e, 'Could not record')) }
  }
  if (rows.length === 0) return <small className="muted">No approved WhatsApp templates yet (Integrations → WhatsApp templates).</small>
  return <div className="panel-form"><select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template"><option value="">Send a template…</option>{rows.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}</select>
    {chosen && <><input placeholder={`${chosen.variable_count} value(s), separated by |`} value={values} onChange={(e) => setValues(e.target.value)} aria-label="Template values" /><small className="muted" style={{ width: '100%' }}>{chosen.body_text}</small><button className="primary-btn compact" onClick={() => void send()}>Send template</button></>}
    <button className="secondary-btn compact" onClick={() => void consent()}>Record WhatsApp consent</button></div>
}

// ---------------- Marketplace CSV import ----------------
export function MarketplaceImport({ token, onNotify }: { token: string; onNotify: Notify }) {
  const [list, setList] = useState<{ key: string; label: string; defaultCurrency: string; note: string }[]>([])
  const [market, setMarket] = useState('aliexpress')
  const [csv, setCsv] = useState('')
  const [rate, setRate] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [shipping, setShipping] = useState('0')
  const [duty, setDuty] = useState('0')
  const [stock, setStock] = useState('0')
  const [quality, setQuality] = useState('skip_missing')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ApiMarketplaceResult | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.marketplaces(token).then((r) => setList(r.marketplaces)).catch(() => undefined) }, [token])
  useEffect(() => { const preset = list.find((m) => m.key === market); if (preset) setCurrency(preset.defaultCurrency) }, [market, list])
  const preset = list.find((m) => m.key === market)
  const run = async (dryRun: boolean) => {
    if (!csv.trim()) return onNotify('Choose or paste a CSV first')
    setBusy(true)
    try {
      const columnMap = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim()))
      const r = await api.marketplaceImport(token, { marketplace: market, csv, dryRun, exchangeRates: currency !== 'PKR' && rate ? { [currency]: Number(rate) } : {}, shippingPerItem: Number(shipping) || 0, dutyPercent: Number(duty) || 0, defaultStock: Math.floor(Number(stock)) || 0, qualityMode: quality, columnMap })
      if (dryRun) setResult(r)
      else { onNotify(`${r.imported ?? 0} products added as drafts. ${r.rejected.length} rejected.`); setResult(null); setCsv('') }
    } catch (e) { onNotify(fail(e, 'Import failed')) } finally { setBusy(false) }
  }
  const fields: [string, string][] = [['name', 'Name column'], ['price', 'Price column'], ['currency', 'Currency column'], ['rating', 'Rating column'], ['sold', 'Sold column'], ['reviews', 'Reviews column'], ['url', 'Product link column'], ['image', 'Image column'], ['category', 'Category column'], ['stock', 'Stock column']]
  return <section className="card panel-card">
    <div className="card-heading"><div><h2>Import from AliExpress / Temu / Daraz (CSV)</h2></div></div>
    <div className="panel-form">
      <select value={market} onChange={(e) => { setMarket(e.target.value); setResult(null) }} aria-label="Marketplace">{list.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
      <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setResult(null) } }} aria-label="CSV file" />
      {currency !== 'PKR' && <input type="number" min={0} step="0.01" placeholder={`PKR per 1 ${currency} (today’s rate)`} value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Exchange rate" />}
      <input type="number" min={0} placeholder="Shipping per item (Rs.)" value={shipping} onChange={(e) => setShipping(e.target.value)} aria-label="Shipping per item" />
      <input type="number" min={0} max={200} placeholder="Duty / handling %" value={duty} onChange={(e) => setDuty(e.target.value)} aria-label="Duty percent" />
      <input type="number" min={0} placeholder="Stock if not in file" value={stock} onChange={(e) => setStock(e.target.value)} aria-label="Default stock" />
      <select value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="Quality check"><option value="skip_missing">Quality rules: check only what the file has</option><option value="strict">Quality rules: reject if a value is missing</option><option value="off">Quality rules: off</option></select>
    </div>
    {preset && <p className="muted">{preset.note}</p>}
    <details><summary>Column overrides (only if the preview says a column was not found)</summary><div className="panel-form">{fields.map(([key, label]) => <input key={key} placeholder={label} value={overrides[key] ?? ''} onChange={(e) => setOverrides({ ...overrides, [key]: e.target.value })} aria-label={label} />)}</div></details>
    <div className="panel-form"><button className="secondary-btn" disabled={busy} onClick={() => void run(true)}>Preview</button><button className="primary-btn" disabled={busy || !result || (result.eligible?.length ?? 0) === 0} onClick={() => void run(false)}>Import {result?.eligible?.length ?? 0} products</button></div>
    {result && <>
      {result.notes.map((n) => <p className="muted" key={n}>{n}</p>)}
      {result.columns && <p className="muted">Columns used: {Object.entries(result.columns).filter(([, v]) => v).map(([k, v]) => `${k} ← ${v}`).join(' · ')}</p>}
      <h3>Will be imported ({result.eligible?.length ?? 0})</h3>
      <div className="panel-list">{(result.eligible ?? []).map((r) => <div className="panel-row" key={r.row}><strong>{r.name}</strong><span>{r.sourceCurrency} {r.sourcePrice} → cost Rs. {r.wholesalePrice.toLocaleString()}</span><span>Sell Rs. {r.sellingPrice.toLocaleString()} (+{r.profit.toLocaleString()})</span><span>{r.category}{r.categoryFromRules ? ' (guessed)' : ''}</span><span>{r.rating ?? '—'}{r.ratingApproximate ? '~' : ''}★ · {r.soldCount ?? '—'} sold</span></div>)}</div>
      <h3>Rejected ({result.rejected.length})</h3>
      <div className="panel-list">{result.rejected.map((r) => <div className="panel-row" key={`${r.row}-${r.name}`}><strong>Row {r.row}{r.name ? ` · ${r.name}` : ''}</strong><span style={{ gridColumn: 'span 4' }}>{r.reasons.join('; ')}</span></div>)}</div>
    </>}
  </section>
}

// ---------------- LLM assistant ----------------
export function LlmAssistant({ token, canManage, onNotify, onDone }: { token: string; canManage: boolean; onNotify: Notify; onDone: () => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; model: string; note: string } | null>(null)
  const [goal, setGoal] = useState('')
  const [out, setOut] = useState<{ output: ApiLlmOutput; tokens: number; cost: number; status: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.llmStatus(token).then(setStatus).catch(() => undefined) }, [token])
  const run = async () => {
    setBusy(true)
    try { const { run: r } = await api.llmRun(token, goal); setOut({ output: r.output, tokens: r.tokens_used, cost: r.cost_estimate, status: r.status }); onDone() } catch (e) { onNotify(fail(e, 'The assistant failed')) } finally { setBusy(false) }
  }
  return <section className="card panel-card">
    <div className="card-heading"><div><h2>AI assistant (tool-calling)</h2></div></div>
    {status && !status.enabled && <p className="muted">{status.note}</p>}
    <div className="panel-form"><textarea rows={3} maxLength={1000} placeholder="Example: Which products are low on stock, and is any price below a 10% margin?" value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Task" style={{ gridColumn: '1 / -1' }} />
      <button className="primary-btn" disabled={busy || !canManage || !status?.enabled || goal.trim().length < 3} onClick={() => void run()}>{busy ? 'Working…' : 'Run assistant'}</button></div>
    {out && <div style={{ marginTop: 12 }}>
      <p style={{ whiteSpace: 'pre-wrap' }}>{out.output.answer}</p>
      {out.output.autoApplied.map((n) => <p className="muted" key={n}>{n}</p>)}
      {out.output.proposals.length > 0 && <><h3>Suggestions ({out.status === 'awaiting_approval' ? 'waiting for your approval in Agent history' : out.status})</h3><div className="panel-list">{out.output.proposals.map((p, i) => <div className="panel-row" key={i}><strong>{p.productName}</strong><span>{p.kind === 'price_change' ? `Rs. ${p.from} → Rs. ${p.to}` : `${p.from} → ${p.to}`}</span><span style={{ gridColumn: 'span 3' }}>{p.reason}{p.applied ? ' (applied)' : ''}</span></div>)}</div></>}
      <details><summary>What it did ({out.output.trace.length} tool calls, {out.tokens} tokens{out.cost ? `, about $${out.cost}` : ''})</summary><div className="panel-list">{out.output.trace.map((t, i) => <div className="panel-row" key={i}><strong>{t.tool}</strong><span className={`status ${t.ok ? 'approved' : 'rejected'}`}>{t.ok ? 'ok' : t.kind === 'invalid' ? 'refused' : 'failed'}</span><span style={{ gridColumn: 'span 3', wordBreak: 'break-word' }}>{t.result}</span></div>)}</div></details>
    </div>}
  </section>
}
