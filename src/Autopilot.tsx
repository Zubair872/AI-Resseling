// Purpose: Autopilot card (Publishing page): automatic product rotation and scheduling per account.
import { useEffect, useState } from 'react'
import { api } from './api'

export function AutopilotPanel({ token, role, onNotify }: { token: string; role: string; onNotify: (message: string) => void }) {
  const [enabled, setEnabled] = useState(false)
  const [language, setLanguage] = useState('roman_urdu')
  const [mode, setMode] = useState('approval')
  const [note, setNote] = useState('')
  const [days, setDays] = useState(1)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ scheduled: number; draftsWaitingApproval: number; sent: number; notes: string[] } | null>(null)
  const canAdmin = ['admin', 'owner', 'super_admin'].includes(role)
  const canRun = canAdmin || role === 'manager'

  useEffect(() => { api.autopilot(token).then((r) => { setEnabled(r.enabled); setLanguage(r.language); setMode(r.autonomyMode); setNote(r.note) }).catch(() => onNotify('Could not load autopilot settings')) }, [token])

  const save = async (nextEnabled: boolean, nextLanguage: string) => {
    try { await api.saveAutopilot(token, { enabled: nextEnabled, language: nextLanguage }); setEnabled(nextEnabled); setLanguage(nextLanguage); onNotify(nextEnabled ? 'Autopilot is on: it fills today and tomorrow every hour' : 'Autopilot is off') } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Could not save') }
  }
  const run = async () => {
    setBusy(true)
    try { setResult(await api.runAutopilot(token, { days })) } catch (reason) { onNotify(reason instanceof Error ? reason.message : 'Autopilot failed') } finally { setBusy(false) }
  }

  return <section className="card panel-card">
    <div className="card-heading"><div><h2>Autopilot</h2></div></div>
    <p className="muted">Approval mode: {mode}. Change it on the Agents page. In approval mode, posts wait for your approval in Content Studio; run Autopilot again after approving.</p>
    <div className="panel-form">
      <label>Post language<select value={language} disabled={!canAdmin} onChange={(e) => save(enabled, e.target.value)}><option value="roman_urdu">Roman Urdu</option><option value="english">English</option><option value="urdu">Urdu</option></select></label>
      <label>Automatic (every hour)<select value={enabled ? 'on' : 'off'} disabled={!canAdmin} onChange={(e) => save(e.target.value === 'on', language)}><option value="off">Off</option><option value="on">On</option></select></label>
      <label>Run now for<select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}</select></label>
      {canRun && <button className="primary-btn compact" disabled={busy} onClick={run}>{busy ? 'Working...' : 'Run Autopilot now'}</button>}
    </div>
    {result && <div><p><strong>{result.scheduled}</strong> scheduled · <strong>{result.sent}</strong> confirmed sent by Buffer/TikTok · <strong>{result.draftsWaitingApproval}</strong> posts waiting for approval</p>{result.notes.length > 0 && <ul>{result.notes.slice(0, 12).map((n, i) => <li key={i} className="muted">{n}</li>)}</ul>}</div>}
  </section>
}
