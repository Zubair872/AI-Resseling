// Purpose: AI Agents dashboard (autonomy mode, runs, approvals), media upload, payment text helper and publishing calendar.
import { useEffect, useState } from 'react'
import { LlmAssistant } from './Growth'
import { api, type ApiAgent, type ApiAgentRun, type ApiCalendarJob, type ApiProduct } from './api'

type Notify = (message: string) => void
const fail = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback)
const modes: [string, string][] = [['manual', 'Manual: agents only suggest'], ['approval', 'Approval: a person approves every change'], ['hybrid', 'Hybrid: low-risk changes apply automatically'], ['full', 'Full: low-risk changes only (money is never automatic)']]

export function AgentsPanel({ token, role, onNotify }: { token: string; role: string; onNotify: Notify }) {
  const [mode, setMode] = useState('approval')
  const [agents, setAgents] = useState<ApiAgent[]>([])
  const [runs, setRuns] = useState<ApiAgentRun[]>([])
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [productId, setProductId] = useState('')
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<string>('')
  const [jobs, setJobs] = useState<ApiCalendarJob[]>([])
  const [uploadUrl, setUploadUrl] = useState('')
  const canManage = ['manager', 'admin', 'owner', 'super_admin'].includes(role)
  const canAdmin = ['admin', 'owner', 'super_admin'].includes(role)

  const load = () => {
    api.agents(token).then((r) => { setMode(r.mode); setAgents(r.agents) }).catch((e) => onNotify(fail(e, 'Could not load agents')))
    api.agentRuns(token).then((r) => setRuns(r.runs)).catch(() => undefined)
    api.calendar(token).then((r) => setJobs(r.jobs)).catch(() => undefined)
  }
  useEffect(() => { load(); api.products(token).then((r) => setProducts(r.products)).catch(() => undefined) }, [token])

  const changeMode = async (value: string) => {
    try { await api.setAgentMode(token, value); setMode(value); onNotify('Autonomy mode saved') } catch (e) { onNotify(fail(e, 'Could not save mode')) }
  }
  const run = async (agent: string) => {
    try {
      const result = await api.runAgent(token, { agent, productId: productId || undefined, text: text || undefined })
      onNotify(`${agent} finished: ${result.run.status.replace('_', ' ')}`)
      load()
    } catch (e) { onNotify(fail(e, 'Agent run failed')) }
  }
  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    try { await api.decideAgentRun(token, id, decision); load() } catch (e) { onNotify(fail(e, 'Could not save decision')) }
  }
  const parse = async () => {
    try {
      const r = await api.parsePaymentText(token, text)
      setParsed(`Transaction ID: ${r.parsed.transactionId ?? 'not found'} · Amount: ${r.parsed.amount ?? 'not found'} · ${r.parsed.warnings.join(' ')}`)
    } catch (e) { onNotify(fail(e, 'Could not read text')) }
  }
  const upload = async (file: File | undefined, kind: 'product_image' | 'payment_proof') => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = String(reader.result)
      try {
        const r = await api.uploadImage(token, { kind, contentType: file.type, dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) })
        setUploadUrl(r.url)
        onNotify(r.note)
      } catch (e) { onNotify(fail(e, 'Upload failed')) }
    }
    reader.readAsDataURL(file)
  }

  const byDay = jobs.reduce<Record<string, ApiCalendarJob[]>>((acc, job) => { (acc[job.day] ??= []).push(job); return acc }, {})

  return <div className="page panel-stack">
    <section className="card panel-card">
      <div className="card-heading"><div><h2>AI agents</h2></div></div>
      <div className="panel-form"><label>Autonomy mode<select value={mode} disabled={!canAdmin} onChange={(e) => changeMode(e.target.value)}>{modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Product (for classification / pricing)<select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Choose a product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Payment text (for the payment assistant)<input value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text from the screenshot" /></label></div>
      <div className="panel-list">{agents.map((agent) => <div className="panel-row" key={agent.key}><strong>{agent.name}</strong><span>{agent.note}</span><span>{agent.runs} runs</span><span>{agent.lastRun ? new Date(agent.lastRun).toLocaleString() : 'never'}</span>
        <span>{agent.runnable && canManage ? <button className="secondary-btn compact" onClick={() => run(agent.key)}>Run</button> : <small className="muted">{agent.runnable ? '' : 'See its page'}</small>}</span></div>)}</div>
    </section>
    <LlmAssistant token={token} canManage={canManage} onNotify={onNotify} onDone={load} />
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Agent history</h2></div></div>
      {runs.length === 0 ? <p className="muted">No runs yet.</p> : <div className="panel-list">{runs.map((r) => <div className="panel-row" key={r.id}><strong>{r.agent}</strong><span className={`status ${r.status}`}>{r.status.replace('_', ' ')}</span><span style={{ wordBreak: 'break-word' }}>{JSON.stringify(r.output).slice(0, 160)}</span><span>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
        <span>{r.status === 'awaiting_approval' && canManage && <><button className="primary-btn compact" onClick={() => decide(r.id, 'approved')}>Apply</button><button className="secondary-btn compact" onClick={() => decide(r.id, 'rejected')}>Reject</button></>}</span></div>)}</div>}
    </section>
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Payment text and image upload</h2></div></div>
      <div className="panel-form"><button className="secondary-btn compact" onClick={parse} disabled={text.length < 3}>Read payment text</button>
        <label>Product image (PNG/JPEG/WebP, max 3 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0], 'product_image')} /></label>
        <label>Payment proof (private)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0], 'payment_proof')} /></label></div>
      {parsed && <p className="muted">{parsed}</p>}
      {uploadUrl && <p className="muted">Uploaded link: <code>{uploadUrl}</code></p>}
    </section>
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Publishing calendar</h2></div></div>
      {jobs.length === 0 ? <p className="muted">No scheduled posts.</p> : Object.entries(byDay).map(([day, items]) => <div key={day}><h3>{day}</h3><div className="panel-list">{items.map((j) => <div className="panel-row" key={j.id}><strong>{j.account}</strong><span>{j.platform}</span><span>{new Date(j.scheduled_for).toLocaleTimeString()}</span><span className={`status ${j.status}`}>{j.status.replace(/_/g, ' ')}</span><span /></div>)}</div></div>)}
    </section>
  </div>
}
