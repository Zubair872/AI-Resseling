// Purpose: Integrations page - manage API connections (Buffer, Markaz, Meta, WhatsApp, TikTok, Custom), Markaz sourcing with quality rules + profit, and Buffer post queue.
import { useEffect, useState } from 'react'
import { CommentModeSelect } from './Growth'
import { api, retryLoad, type ApiIntegration, type ApiPublishingJob, type MarkazPreviewRow, type MarkazRejectedRow, type SourcingSettings, type MarkazExportPreviewResult, type MarkazExportPreviewItem, type ApiChatSetup } from './api'

const categories = ['Electronics', 'Fashion', 'Sports', 'Beauty', 'Home & Kitchen', 'Jewellery', 'Mobile Accessories', 'Baby Products', 'Grocery', 'Other']
const statusClass = (status: string) => (status === 'verified' ? 'approved' : status === 'failed' ? 'rejected' : 'draft')

export function IntegrationsPage({ token, role, onNotify }: { token: string; role: string; onNotify: (message: string) => void }) {
  const [tab, setTab] = useState<'connections' | 'sourcing' | 'chat' | 'posts'>('connections')
  const canAdmin = ['admin', 'owner', 'super_admin'].includes(role)
  return (
    <div className="page panel-stack">
      <div className="tab-row">
        {(['connections', 'sourcing', 'chat', 'posts'] as const).map((key) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {key === 'connections' ? 'API Connections' : key === 'sourcing' ? 'Markaz Sourcing' : key === 'chat' ? 'Chat Setup' : 'Buffer Post Queue'}
          </button>
        ))}
      </div>
      {tab === 'connections' && <Connections token={token} canAdmin={canAdmin} onNotify={onNotify} />}
      {tab === 'sourcing' && <Sourcing token={token} canAdmin={canAdmin} onNotify={onNotify} />}
      {tab === 'chat' && <ChatSetupPanel token={token} canAdmin={canAdmin} onNotify={onNotify} />}
      {tab === 'posts' && <Posts token={token} onNotify={onNotify} />}
    </div>
  )
}

type Field = { key: string; label: string; placeholder: string; hint?: string; required?: boolean }
type ProviderDef = {
  provider: ApiIntegration['provider']
  title: string
  subtitle: string
  badge: string
  badgeColor: string
  keyLabel: string
  keyPlaceholder: string
  keyRequired: boolean
  fields: Field[]
  sync?: boolean
  aiMode?: boolean
}

const providers: ProviderDef[] = [
  {
    provider: 'buffer',
    title: 'Buffer Publishing',
    subtitle: '',
    badge: 'Social Media',
    badgeColor: 'badge-blue',
    keyLabel: 'Access Token',
    keyPlaceholder: 'Access Token',
    keyRequired: true,
    fields: [],
    sync: true,
  },
  {
    provider: 'markaz',
    title: 'Markaz',
    subtitle: 'Stores optional key and tests reachability',
    badge: 'Sourcing',
    badgeColor: 'badge-purple',
    keyLabel: 'Optional API Key',
    keyPlaceholder: 'Optional API Key',
    keyRequired: false,
    fields: [],
  },
  {
    provider: 'meta',
    title: 'Meta (Facebook & Instagram)',
    subtitle: 'Customer chat and comment replies',
    badge: 'Chat',
    badgeColor: 'badge-emerald',
    keyLabel: 'Page Access Token',
    keyPlaceholder: 'Page Access Token',
    keyRequired: true,
    fields: [
      { key: 'pageId', label: 'Facebook Page ID', placeholder: 'Page ID', required: true },
      { key: 'instagramId', label: 'Instagram Account ID (Optional)', placeholder: 'Instagram Account ID' },
    ],
    aiMode: true,
  },
  {
    provider: 'whatsapp',
    title: 'WhatsApp Cloud API',
    subtitle: 'Customer messaging',
    badge: 'Chat',
    badgeColor: 'badge-cyan',
    keyLabel: 'System User Token',
    keyPlaceholder: 'System User Token',
    keyRequired: true,
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: 'Phone Number ID', required: true },
      { key: 'wabaId', label: 'WABA ID (Optional)', placeholder: 'WABA ID' },
    ],
    aiMode: true,
  },
  {
    provider: 'tiktok',
    title: 'TikTok Content API',
    subtitle: 'Video publishing',
    badge: 'Video',
    badgeColor: 'badge-pink',
    keyLabel: 'Developer Token',
    keyPlaceholder: 'Developer Token',
    keyRequired: true,
    fields: [],
  },
]

function Connections({ token, canAdmin, onNotify }: { token: string; canAdmin: boolean; onNotify: (m: string) => void }) {
  const [items, setItems] = useState<ApiIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const load = () =>
    retryLoad(() => api.integrations(token))
      .then(({ integrations }) => setItems(integrations))
      .catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load integrations'))
      .finally(() => setLoading(false))

  useEffect(() => {
    void load()
  }, [token])

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key)
    try {
      const message = await action()
      if (message) onNotify(message)
      await load()
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Action failed')
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <section className="card panel-card">
        <p className="muted">Loading connection settings...</p>
      </section>
    )
  }

  return (
    <div className="api-connections-container">
      {/* Informative Guidance Banner */}
      <div className="api-overview-banner">
        <div className="banner-text">
          <h3>Connected API Integrations</h3>
          <p>
            Configure API keys for Buffer social publishing, customer chat channels, and custom endpoints.
          </p>
        </div>
        {!canAdmin && <div className="admin-lock-pill">Read Only (Admin permissions required to modify keys)</div>}
      </div>

      {/* Main Official Integrations List */}
      <div className="api-cards-grid">
        {providers.map((def) => (
          <ProviderCard
            key={def.provider}
            def={def}
            item={items.find((i) => i.provider === def.provider)}
            token={token}
            canAdmin={canAdmin}
            busy={busy}
            run={run}
            onNotify={onNotify}
            onChanged={() => void load()}
          />
        ))}
      </div>

      {/* Custom Webhook / API Section */}
      <CustomApis items={items.filter((i) => i.provider === 'custom')} token={token} canAdmin={canAdmin} busy={busy} run={run} />
    </div>
  )
}

type RunFn = (key: string, action: () => Promise<string | void>) => Promise<void>
const statusText = (item: ApiIntegration) => (item.status === 'verified' ? 'Active & Verified' : item.status === 'failed' ? 'Connection Failed' : 'Unchecked')

async function testAfterSave(token: string, id: string, provider: string): Promise<string> {
  try {
    const result = await api.testIntegration(token, id)
    if (provider === 'buffer' && result.status === 'verified') {
      const sync = await api.syncChannels(token, id)
      return `${result.message} Channels loaded: ${sync.created + sync.updated}.`
    }
    return result.message
  } catch (reason) {
    return `Saved, but the test failed: ${reason instanceof Error ? reason.message : 'unknown error'}`
  }
}

function ConnectionHead({ def, item }: { def: ProviderDef; item?: ApiIntegration }) {
  return (
    <div className="integration-card-header">
      <div className="integration-title-group">
        <div className="title-with-pill">
          <strong>{def.title}</strong>
          <span className={`category-tag ${def.badgeColor}`}>{def.badge}</span>
        </div>
        {def.subtitle ? <p className="integration-subtitle">{def.subtitle}</p> : null}
      </div>
      <div className="integration-status-group">
        {item ? (
          <span className={`status ${statusClass(item.status)}`}>{statusText(item)}</span>
        ) : (
          <span className="status draft">Not Connected</span>
        )}
        {item && !item.enabled && <span className="status draft">Disabled</span>}
      </div>
    </div>
  )
}

function ItemActions({
  item,
  token,
  busy,
  run,
  test,
  sync,
  onEdit,
  onRemove,
}: {
  item: ApiIntegration
  token: string
  busy: string
  run: RunFn
  test: boolean
  sync: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="integration-actions-toolbar">
      {test && (
        <button
          className="secondary-btn compact"
          disabled={busy === `t${item.id}`}
          onClick={() => void run(`t${item.id}`, async () => (await api.testIntegration(token, item.id)).message)}
        >
          {busy === `t${item.id}` ? 'Testing...' : 'Test Connection'}
        </button>
      )}
      {sync && (
        <button
          className="secondary-btn compact"
          disabled={busy === `s${item.id}`}
          onClick={() =>
            void run(`s${item.id}`, async () => {
              const r = await api.syncChannels(token, item.id)
              return `Channels synced: ${r.created} new, ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped (plan limit)` : ''}`
            })
          }
        >
          {busy === `s${item.id}` ? 'Syncing...' : 'Sync Channels'}
        </button>
      )}
      <button
        className="secondary-btn compact"
        onClick={() =>
          void run(`e${item.id}`, async () => {
            await api.updateIntegration(token, item.id, { enabled: !item.enabled })
            return item.enabled ? 'Disabled' : 'Enabled'
          })
        }
      >
        {item.enabled ? 'Disable' : 'Enable'}
      </button>
      <button className="secondary-btn compact edit-btn" onClick={onEdit}>
        Edit Keys
      </button>
      <button className="secondary-btn compact delete-btn" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}

function ProviderCard({
  def,
  item,
  token,
  canAdmin,
  busy,
  run,
  onNotify,
  onChanged,
}: {
  def: ProviderDef
  item: ApiIntegration | undefined
  token: string
  canAdmin: boolean
  busy: string
  run: RunFn
  onNotify: (m: string) => void
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [aiMode, setAiMode] = useState('approval')

  const startEdit = () => {
    setValues(Object.fromEntries(def.fields.map((f) => [f.key, item?.config[f.key] ?? ''])))
    setSecret('')
    setAiMode(item?.config.aiMode ?? 'approval')
    setOpen(true)
  }

  const buildConfig = () => {
    const config: Record<string, string> = { ...(item?.config ?? {}) }
    for (const f of def.fields) {
      if (values[f.key]) config[f.key] = values[f.key]
      else delete config[f.key]
    }
    if (def.aiMode) config.aiMode = aiMode
    return config
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    void run(`save${def.provider}`, async () => {
      const config = buildConfig()
      let id: string
      if (item) {
        await api.updateIntegration(token, item.id, { config, secret: secret || undefined })
        id = item.id
      } else {
        id = (await api.createIntegration(token, { provider: def.provider, label: def.title, config, secret: secret || undefined })).integration.id
      }
      setOpen(false)
      setSecret('')
      return `Saved. ${await testAfterSave(token, id, def.provider)}`
    })
  }

  const showForm = open || (!item && canAdmin)

  return (
    <div className={`integration-box card ${item ? 'configured' : 'empty-state'}`}>
      <ConnectionHead def={def} item={item} />

      {item && (
        <div className="integration-summary-strip">
          <div className="summary-col">
            <span className="summary-label">Stored Secret:</span>
            <span className="summary-value font-mono">
              {item.secret_hint ? `••••••••••••${item.secret_hint}` : 'No key stored'}
            </span>
          </div>
          {item.last_checked_at && (
            <div className="summary-col">
              <span className="summary-label">Last Checked:</span>
              <span className="summary-value">{new Date(item.last_checked_at).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {item?.status_message && (
        <div className={`status-callout ${item.status === 'failed' ? 'error-callout' : 'info-callout'}`}>
          <span className="callout-icon">{item.status === 'failed' ? '⚠️' : 'ℹ️'}</span>
          <span className="callout-text">{item.status_message}</span>
        </div>
      )}

      {item && canAdmin && def.aiMode && !open && (
        <div className="inline-option-row">
          <span className="option-title">AI Customer Bot Mode:</span>
          <select
            className="status-select"
            value={item.config.aiMode ?? 'approval'}
            onChange={(e) =>
              void run(`m${item.id}`, async () => {
                await api.updateIntegration(token, item.id, { config: { ...item.config, aiMode: e.target.value } })
              })
            }
          >
            <option value="manual">Manual (Staff Only)</option>
            <option value="approval">Review (AI Drafts, Human Sends)</option>
            <option value="auto">Autopilot (AI Auto-Answers)</option>
          </select>
        </div>
      )}

      {item && canAdmin && def.provider === 'meta' && !open && (
        <div className="meta-options-wrapper">
          <CommentModeSelect token={token} item={item} onNotify={onNotify} onChanged={onChanged} />
        </div>
      )}

      {item && canAdmin && !open && (
        <ItemActions
          item={item}
          token={token}
          busy={busy}
          run={run}
          test
          sync={Boolean(def.sync)}
          onEdit={startEdit}
          onRemove={() => {
            if (window.confirm(`Remove ${def.title}?`)) {
              void run(`d${item.id}`, async () => {
                await api.deleteIntegration(token, item.id)
                return 'Removed'
              })
            }
          }}
        />
      )}

      {def.provider === 'tiktok' && item && canAdmin && !open && (
        <div className="order-actions" style={{ marginTop: 10 }}>
          <button
            className="secondary-btn compact"
            disabled={busy === `c${item.id}`}
            onClick={() => void run(`c${item.id}`, async () => (await api.connectTikTok(token, item.id)).note)}
          >
            Connect TikTok Account (OAuth)
          </button>
        </div>
      )}

      {canAdmin && showForm && (
        <form className="structured-api-form" onSubmit={save} autoComplete="off">
          <div className="form-legend">
            <strong>{item ? `Edit ${def.title}` : `Configure ${def.title}`}</strong>
          </div>

          <div className="form-fields-stack">
            {def.fields.map((f) => (
              <div className="form-group" key={f.key}>
                <label>
                  <span className="field-label-text">
                    {f.label} {f.required && <span className="req">*</span>}
                  </span>
                  <input
                    required={f.required}
                    name={`orbitly-${def.provider}-${f.key}`}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </label>
              </div>
            ))}

            {def.aiMode && (
              <div className="form-group">
                <label>
                  <span className="field-label-text">AI Automation Mode</span>
                  <select value={aiMode} onChange={(e) => setAiMode(e.target.value)}>
                    <option value="manual">Manual (Off)</option>
                    <option value="approval">Assisted (AI Drafts, Human Sends)</option>
                    <option value="auto">Full Autopilot (AI Answers Safe FAQs)</option>
                  </select>
                </label>
              </div>
            )}

            {(def.provider !== 'markaz' || !item) && (
              <div className="form-group">
                <label>
                  <span className="field-label-text">
                    {item ? `Update ${def.keyLabel}` : def.keyLabel} {def.keyRequired && !item && <span className="req">*</span>}
                  </span>
                  <input
                    type="password"
                    name={`orbitly-${def.provider}-key`}
                    autoComplete="new-password"
                    minLength={8}
                    required={def.keyRequired && !item}
                    placeholder={item ? 'Leave empty to keep existing key' : def.keyPlaceholder}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="form-actions-row">
            <button className="primary-btn" disabled={busy === `save${def.provider}`}>
              {busy === `save${def.provider}` ? 'Verifying & Saving...' : 'Save & Verify Connection'}
            </button>
            {item && (
              <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

function CustomApis({
  items,
  token,
  canAdmin,
  busy,
  run,
}: {
  items: ApiIntegration[]
  token: string
  canAdmin: boolean
  busy: string
  run: RunFn
}) {
  const [form, setForm] = useState({ label: '', baseUrl: '', secret: '' })
  const [editing, setEditing] = useState<{ id: string; label: string; baseUrl: string; secret: string } | null>(null)

  const add = (event: React.FormEvent) => {
    event.preventDefault()
    void run('addcustom', async () => {
      const { integration } = await api.createIntegration(token, {
        provider: 'custom',
        label: form.label,
        baseUrl: form.baseUrl || undefined,
        secret: form.secret || undefined,
      })
      setForm({ label: '', baseUrl: '', secret: '' })
      return form.baseUrl ? `Saved. ${await testAfterSave(token, integration.id, 'custom')}` : 'Saved. Add a Base URL to be able to test it.'
    })
  }

  return (
    <div className="integration-box card custom-api-section">
      <div className="integration-card-header">
        <div className="integration-title-group">
          <div className="title-with-pill">
            <strong>Custom Integrations & Webhooks</strong>
            <span className="category-tag badge-amber">Developer API</span>
          </div>
          <p className="integration-subtitle">Custom API endpoints and webhooks</p>
        </div>
      </div>

      {canAdmin && (
        <form className="structured-api-form custom-new-form" onSubmit={add} autoComplete="off">
          <div className="form-fields-grid">
            <div className="form-group">
              <label>
                <span className="field-label-text">Integration Name *</span>
                <input
                  required
                  minLength={2}
                  name="custom-name"
                  autoComplete="off"
                  placeholder="Integration Name"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </label>
            </div>
            <div className="form-group">
              <label>
                <span className="field-label-text">API Base URL</span>
                <input
                  type="url"
                  name="custom-url"
                  autoComplete="off"
                  placeholder="Base URL"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </label>
            </div>
            <div className="form-group">
              <label>
                <span className="field-label-text">Bearer Token or API Key *</span>
                <input
                  type="password"
                  name="custom-key"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="API Key / Token"
                  value={form.secret}
                  onChange={(e) => setForm({ ...form, secret: e.target.value })}
                />
              </label>
            </div>
          </div>
          <div className="form-actions-row">
            <button className="primary-btn" disabled={busy === 'addcustom'}>
              {busy === 'addcustom' ? 'Saving Custom API...' : '+ Add Custom Integration'}
            </button>
          </div>
        </form>
      )}

      {items.length > 0 && (
        <div className="custom-items-list">
          {items.map((item) => (
            <div className="custom-item-card" key={item.id}>
              <div className="custom-head-row">
                <div>
                  <strong>{item.label}</strong>
                  <span className="base-url-pill font-mono">{item.base_url || 'No Base URL configured'}</span>
                </div>
                <span className={`status ${statusClass(item.status)}`}>{statusText(item)}</span>
              </div>

              {canAdmin && editing?.id !== item.id && (
                <ItemActions
                  item={item}
                  token={token}
                  busy={busy}
                  run={run}
                  test
                  sync={false}
                  onEdit={() => setEditing({ id: item.id, label: item.label, baseUrl: item.base_url ?? '', secret: '' })}
                  onRemove={() => {
                    if (window.confirm(`Remove ${item.label}?`)) {
                      void run(`d${item.id}`, async () => {
                        await api.deleteIntegration(token, item.id)
                        return 'Removed'
                      })
                    }
                  }}
                />
              )}

              {editing?.id === item.id && (
                <form
                  className="structured-api-form edit-custom-box"
                  autoComplete="off"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void run('editcustom', async () => {
                      await api.updateIntegration(token, item.id, {
                        label: editing.label,
                        baseUrl: editing.baseUrl || undefined,
                        secret: editing.secret || undefined,
                      })
                      setEditing(null)
                      return `Saved. ${await testAfterSave(token, item.id, 'custom')}`
                    })
                  }}
                >
                  <div className="form-fields-grid">
                    <div className="form-group">
                      <label>
                        <span className="field-label-text">Name</span>
                        <input
                          required
                          minLength={2}
                          autoComplete="off"
                          placeholder="Integration Name"
                          value={editing.label}
                          onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="form-group">
                      <label>
                        <span className="field-label-text">Base URL</span>
                        <input
                          type="url"
                          autoComplete="off"
                          placeholder="Base URL"
                          value={editing.baseUrl}
                          onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="form-group">
                      <label>
                        <span className="field-label-text">New API Key</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          placeholder="Leave blank to keep existing key"
                          value={editing.secret}
                          onChange={(e) => setEditing({ ...editing, secret: e.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="form-actions-row">
                    <button className="primary-btn">Save & Verify</button>
                    <button type="button" className="secondary-btn" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ChatSetupPanel({ token, canAdmin, onNotify }: { token: string; canAdmin: boolean; onNotify: (m: string) => void }) {
  const [setup, setSetup] = useState<ApiChatSetup | null>(null)
  const [publicUrl, setPublicUrl] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.chatSetup(token)
      .then((data) => {
        setSetup(data)
        setPublicUrl(data.publicApiUrl)
        setTokenInput(data.verifyToken)
      })
      .catch((err) => onNotify(err instanceof Error ? err.message : 'Could not load chat setup'))
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 10000)
    return () => clearInterval(timer)
  }, [token])

  const generateToken = () => {
    const chars = 'abcdef0123456789'
    let res = ''
    for (let i = 0; i < 32; i++) res += chars[Math.floor(Math.random() * chars.length)]
    setTokenInput(res)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const updated = await api.updateChatSetup(token, {
        publicApiUrl: publicUrl.trim() || undefined,
        verifyToken: tokenInput.trim() || undefined,
      })
      setSetup(updated)
      onNotify('Chat webhook setup saved.')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save setup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-stack">
      <div className="banner-card">
        <div className="banner-text">
          <h3>Chat Webhook Setup</h3>
          <p>
            Connect Meta (Facebook Messenger, Instagram DM) and WhatsApp Cloud API to receive customer messages.
          </p>
        </div>
      </div>

      <section className="card panel-card">
        <div className="card-heading">
          <div>
            <h2>Meta & WhatsApp Callback Configuration</h2>
            <p className="muted">
              Use this Callback URL and Verify Token in your Meta App Developer Portal under Webhooks.
            </p>
          </div>
        </div>

        <form className="structured-api-form" onSubmit={save} style={{ marginTop: 16 }}>
          <div className="form-fields-stack">
            <div className="form-group">
              <label>
                <span className="field-label-text">Public API Base URL (PUBLIC_API_URL)</span>
                <input
                  type="url"
                  placeholder="https://your-domain.com or https://xxxx.trycloudflare.com"
                  value={publicUrl}
                  onChange={(e) => setPublicUrl(e.target.value)}
                  disabled={!canAdmin || busy}
                />
              </label>
              <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                For local testing, run <code>npm run tunnel</code> in your terminal to get a free Cloudflare tunnel URL.
              </small>
            </div>

            <div className="form-group">
              <label>
                <span className="field-label-text">Computed Meta Callback URL (Copy to Meta App)</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    value={setup?.callbackUrl || (publicUrl ? `${publicUrl.replace(/\/+$/, '')}/webhooks/meta` : 'Save a Public API URL first')}
                    style={{ background: 'var(--surface-raised)' }}
                  />
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() => {
                      const url = setup?.callbackUrl || `${publicUrl.replace(/\/+$/, '')}/webhooks/meta`
                      navigator.clipboard.writeText(url).then(() => onNotify('Callback URL copied!')).catch(() => onNotify('Copy failed'))
                    }}
                  >
                    Copy
                  </button>
                </div>
              </label>
            </div>

            <div className="form-group">
              <label>
                <span className="field-label-text">Webhook Verify Token</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Enter or generate verify token"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    disabled={!canAdmin || busy}
                  />
                  {canAdmin && (
                    <button type="button" className="secondary-btn compact" onClick={generateToken}>
                      Generate
                    </button>
                  )}
                  {tokenInput && (
                    <button
                      type="button"
                      className="secondary-btn compact"
                      onClick={() => {
                        navigator.clipboard.writeText(tokenInput).then(() => onNotify('Verify token copied!')).catch(() => onNotify('Copy failed'))
                      }}
                    >
                      Copy
                    </button>
                  )}
                </div>
              </label>
            </div>
          </div>

          {canAdmin && (
            <div className="form-actions-row" style={{ marginTop: 14 }}>
              <button className="primary-btn" disabled={busy}>
                {busy ? 'Saving...' : 'Save Chat Setup'}
              </button>
            </div>
          )}
        </form>

        <div style={{ marginTop: 24, padding: 16, background: 'var(--surface-raised)', borderRadius: 12, border: '1px solid var(--line)' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Webhook Status</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Webhook Verified:</span>
              <div style={{ marginTop: 4 }}>
                <span className={`status ${setup?.webhookVerified ? 'approved' : 'draft'}`}>
                  {setup?.webhookVerified ? 'Yes (Verified)' : 'No (Not verified yet)'}
                </span>
              </div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Last Webhook Handshake:</span>
              <div style={{ marginTop: 4, fontWeight: 500 }}>
                {setup?.lastWebhookAt ? new Date(setup.lastWebhookAt).toLocaleString() : 'None yet'}
              </div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Last Message Received:</span>
              <div style={{ marginTop: 4, fontWeight: 500 }}>
                {setup?.lastMessageAt ? new Date(setup.lastMessageAt).toLocaleString() : 'None yet'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Sourcing({ token, canAdmin, onNotify }: { token: string; canAdmin: boolean; onNotify: (m: string) => void }) {
  const [settings, setSettings] = useState<SourcingSettings | null>(null)
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<{ eligible: MarkazPreviewRow[]; rejected: MarkazRejectedRow[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [exportCsv, setExportCsv] = useState('')
  const [exportPriceStrategy, setExportPriceStrategy] = useState<'profit_rule' | 'file_price'>('profit_rule')
  const [exportPreview, setExportPreview] = useState<MarkazExportPreviewResult | null>(null)
  const [customMapping, setCustomMapping] = useState<Record<string, string | null>>({})
  const [showMappingEditor, setShowMappingEditor] = useState(false)
  const [manual, setManual] = useState({
    name: '',
    category: 'Electronics',
    wholesalePrice: '',
    profit: '',
    stock: '0',
    imageUrl: '',
    productUrl: '',
    rating: '',
    reviewCount: '',
    soldCount: '',
  })

  useEffect(() => {
    api
      .sourcingSettings(token)
      .then(({ settings: value }) => setSettings(value))
      .catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load sourcing settings'))
  }, [token])

  if (!settings) {
    return (
      <section className="card panel-card">
        <p className="muted">Loading sourcing rules...</p>
      </section>
    )
  }

  const profit = Number(manual.profit === '' ? settings.profit.fixed : manual.profit)
  const wholesale = Number(manual.wholesalePrice)
  const manualPrice =
    Number.isFinite(wholesale) && wholesale > 0
      ? Math.round((wholesale + profit + (manual.profit === '' ? (wholesale * (settings.profit.percent ?? 0)) / 100 : 0)) * 100) / 100
      : null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const result = await api.saveSourcingSettings(token, {
        minRating: settings.rules.minRating,
        minReviews: settings.rules.minReviews,
        minSold: settings.rules.minSold,
        profitAmount: settings.profit.fixed,
        profitPercent: settings.profit.percent,
      })
      setSettings(result.settings)
      onNotify('Sourcing rules and profit saved')
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Could not save')
    }
  }

  const readFile = async (file: File | undefined) => {
    if (file) {
      setCsv(await file.text())
      setPreview(null)
    }
  }

  const runImport = async (dryRun: boolean) => {
    if (!csv.trim()) return onNotify('Choose or paste a CSV first')
    setBusy(true)
    try {
      const result = await api.markazImport(token, csv, dryRun)
      if (dryRun) setPreview({ eligible: result.eligible ?? [], rejected: result.rejected })
      else {
        onNotify(`${result.imported} products added as drafts. ${result.rejected.length} rejected.`)
        setPreview(null)
        setCsv('')
      }
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const addManual = async (event: React.FormEvent) => {
    event.preventDefault()
    const optional = (value: string) => (value === '' ? undefined : Number(value))
    try {
      const result = await api.addSourcedProduct(token, {
        name: manual.name,
        category: manual.category,
        wholesalePrice: wholesale,
        profitAmount: optional(manual.profit),
        stock: Number(manual.stock),
        imageUrl: manual.imageUrl || undefined,
        productUrl: manual.productUrl || undefined,
        rating: optional(manual.rating),
        reviewCount: optional(manual.reviewCount),
        soldCount: optional(manual.soldCount),
      })
      onNotify(`Product added. Selling price Rs. ${Number(result.product.selling_price).toLocaleString()}`)
      setManual({ ...manual, name: '', wholesalePrice: '', profit: '', imageUrl: '', productUrl: '' })
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Could not add product')
    }
  }

  const num = (value: string) => Number(value)

  return (
    <>
      <section className="card panel-card">
        <div className="card-heading">
          <div>
            <h2>Quality Rules & Profit Calculation</h2>
            <p className="muted">Set your profit margins and quality filters for sourced products.</p>
          </div>
        </div>
        <form className="panel-form" onSubmit={save}>
          <label>
            Minimum Star Rating (0-5)
            <input
              type="number"
              step="0.1"
              min={0}
              max={5}
              placeholder="e.g. 4.0"
              value={settings.rules.minRating}
              onChange={(e) => setSettings({ ...settings, rules: { ...settings.rules, minRating: num(e.target.value) } })}
              disabled={!canAdmin}
            />
          </label>
          <label>
            Minimum Reviews Count
            <input
              type="number"
              min={0}
              placeholder="e.g. 10"
              value={settings.rules.minReviews}
              onChange={(e) => setSettings({ ...settings, rules: { ...settings.rules, minReviews: num(e.target.value) } })}
              disabled={!canAdmin}
            />
          </label>
          <label>
            Minimum Units Sold
            <input
              type="number"
              min={0}
              placeholder="e.g. 50"
              value={settings.rules.minSold}
              onChange={(e) => setSettings({ ...settings, rules: { ...settings.rules, minSold: num(e.target.value) } })}
              disabled={!canAdmin}
            />
          </label>
          <label>
            Fixed Profit Per Item (Rs.)
            <input
              type="number"
              min={0}
              placeholder="e.g. 350"
              value={settings.profit.fixed}
              onChange={(e) => setSettings({ ...settings, profit: { ...settings.profit, fixed: num(e.target.value) } })}
              disabled={!canAdmin}
            />
          </label>
          <label>
            Extra Percentage Profit % (Optional)
            <input
              type="number"
              min={0}
              step="0.5"
              placeholder="e.g. 15%"
              value={settings.profit.percent ?? ''}
              onChange={(e) =>
                setSettings({ ...settings, profit: { ...settings.profit, percent: e.target.value === '' ? null : num(e.target.value) } })
              }
              disabled={!canAdmin}
            />
          </label>
          {canAdmin && <button className="primary-btn">Save Sourcing Rules</button>}
        </form>
      </section>

      <section className="card panel-card">
        <div className="card-heading">
          <div>
            <h2>Import Products from Markaz (CSV)</h2>
            <p className="muted">Upload your exported Markaz catalog sheet to auto-calculate margins.</p>
          </div>
        </div>
        <div className="panel-form">
          <input type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} aria-label="CSV file" />
          <button className="secondary-btn" disabled={busy} onClick={() => void runImport(true)}>
            Preview Margin Calculation
          </button>
          <button
            className="primary-btn"
            disabled={busy || !preview || preview.eligible.length === 0}
            onClick={() => void runImport(false)}
          >
            Import {preview ? preview.eligible.length : 0} Eligible Products
          </button>
        </div>
        {preview && (
          <div style={{ marginTop: 20 }}>
            <h3>Eligible for Import ({preview.eligible.length})</h3>
            {preview.eligible.length === 0 ? (
              <p className="muted">No product passed your quality rules.</p>
            ) : (
              <div className="panel-list">
                {preview.eligible.map((r) => (
                  <div className="panel-row" key={r.row}>
                    <strong>{r.name}</strong>
                    <span>Supplier: Rs. {r.wholesalePrice.toLocaleString()}</span>
                    <span>
                      + Profit Rs. {r.profit.toLocaleString()} = Rs. {r.sellingPrice.toLocaleString()}
                    </span>
                    <span>
                      {r.rating}★ · {r.reviewCount} reviews · {r.soldCount} sold
                    </span>
                  </div>
                ))}
              </div>
            )}
            {preview.rejected.length > 0 && (
              <>
                <h3 style={{ marginTop: 20, color: 'var(--accent-rose)' }}>Rejected Products ({preview.rejected.length})</h3>
                <div className="panel-list">
                  {preview.rejected.map((r) => (
                    <div className="panel-row" key={r.row}>
                      <strong>
                        Row {r.row} {r.name ? `· ${r.name}` : ''}
                      </strong>
                      <span style={{ gridColumn: 'span 4' }}>{r.reasons.join('; ')}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* MARKAZ EXPORT FILE IMPORT SECTION (Shopify CSV / WooCommerce CSV) */}
      <section className="card panel-card">
        <div className="card-heading">
          <div>
            <h2>Import Markaz Export File</h2>
            <p className="muted">
              Upload the CSV exported from markaz.app (Shopify or WooCommerce layout). Variants, MKZ-SKUs, and multi-images are preserved.
            </p>
          </div>
        </div>

        <div className="panel-form" style={{ gridTemplateColumns: '1fr' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 260 }}>
              <span className="field-label-text">Select Markaz Export File (CSV only)</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                      onNotify('Excel files (.xlsx) cannot be read directly. Please open it in Excel and select "Save as CSV".')
                      e.target.value = ''
                      return
                    }
                    const text = await file.text()
                    setExportCsv(text)
                    setExportPreview(null)
                    setCustomMapping({})
                  }
                }}
              />
            </label>

            <label style={{ minWidth: 220 }}>
              <span className="field-label-text">Selling Price Strategy</span>
              <select
                value={exportPriceStrategy}
                onChange={(e) => setExportPriceStrategy(e.target.value as 'profit_rule' | 'file_price')}
              >
                <option value="profit_rule">Use my profit rule (Cost + Margin)</option>
                <option value="file_price">Keep the selling price written in file</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="secondary-btn"
              disabled={busy || !exportCsv.trim()}
              onClick={async () => {
                if (!exportCsv.trim()) return onNotify('Please select a CSV export file first')
                setBusy(true)
                try {
                  const res = await api.markazExportImport(token, {
                    csv: exportCsv,
                    dryRun: true,
                    priceStrategy: exportPriceStrategy,
                    mapping: Object.keys(customMapping).length > 0 ? customMapping : undefined,
                  })
                  setExportPreview(res)
                  if (!Object.keys(customMapping).length) {
                    setCustomMapping(res.mapping)
                  }
                  onNotify(`Preview loaded: ${res.eligible.length} products found, ${res.rejected.length} rows rejected.`)
                } catch (err) {
                  onNotify(err instanceof Error ? err.message : 'Preview failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Analyzing...' : 'Preview Before Saving'}
            </button>

            {exportPreview && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowMappingEditor(!showMappingEditor)}
              >
                {showMappingEditor ? 'Hide Column Mapping' : 'Adjust Column Mapping'}
              </button>
            )}

            <button
              type="button"
              className="primary-btn"
              disabled={busy || !exportPreview || exportPreview.eligible.length === 0}
              onClick={async () => {
                if (!exportCsv.trim() || !exportPreview) return
                setBusy(true)
                try {
                  const res = await api.markazExportImport(token, {
                    csv: exportCsv,
                    dryRun: false,
                    priceStrategy: exportPriceStrategy,
                    mapping: Object.keys(customMapping).length > 0 ? customMapping : undefined,
                  })
                  onNotify(`Import complete: ${res.newCount ?? 0} new products added, ${res.updatedCount ?? 0} updated with latest prices.`)
                  setExportPreview(null)
                  setExportCsv('')
                } catch (err) {
                  onNotify(err instanceof Error ? err.message : 'Import failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Saving...' : `Import ${exportPreview ? exportPreview.eligible.length : 0} Products`}
            </button>
          </div>
        </div>

        {/* COLUMN MAPPING ACCORDION */}
        {showMappingEditor && exportPreview && (
          <div style={{ marginTop: 20, padding: 18, background: 'var(--surface-raised)', borderRadius: 14, border: '1px solid var(--line)' }}>
            <div style={{ marginBottom: 12 }}>
              <strong>Column Mapping (Auto-detected layout: {exportPreview.layout.toUpperCase()})</strong>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                If any column guessed incorrectly, select the correct header from your file below and press "Re-run Preview".
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              {[
                { key: 'name', label: 'Product Name / Title *' },
                { key: 'wholesalePrice', label: 'Markaz Wholesale Price *' },
                { key: 'fileSellingPrice', label: 'File Selling Price' },
                { key: 'sku', label: 'SKU (MKZ-...)' },
                { key: 'handle', label: 'Handle / Parent Group' },
                { key: 'category', label: 'Category / Product Type' },
                { key: 'imageUrl', label: 'Image URL(s)' },
                { key: 'description', label: 'Description' },
                { key: 'stock', label: 'Inventory Stock' },
                { key: 'option1Value', label: 'Variant Option 1 Value' },
                { key: 'advancePayment', label: 'Advance Payment / China Note' },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{label}</span>
                  <select
                    value={customMapping[key] ?? exportPreview.mapping[key] ?? ''}
                    onChange={(e) => setCustomMapping({ ...customMapping, [key]: e.target.value || null })}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)' }}
                  >
                    <option value="">(None / Ignore)</option>
                    {exportPreview.detectedHeaders.map((hdr) => (
                      <option key={hdr} value={hdr}>
                        {hdr}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="secondary-btn compact"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const res = await api.markazExportImport(token, {
                      csv: exportCsv,
                      dryRun: true,
                      priceStrategy: exportPriceStrategy,
                      mapping: customMapping,
                    })
                    setExportPreview(res)
                    onNotify('Preview refreshed with updated column mapping.')
                  } catch (err) {
                    onNotify(err instanceof Error ? err.message : 'Mapping preview update failed')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Re-run Preview with Selected Mapping
              </button>
            </div>
          </div>
        )}

        {/* EXPORT FILE PREVIEW RESULTS */}
        {exportPreview && (
          <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>Products Ready to Import ({exportPreview.eligible.length})</h3>
                <small className="muted">{exportPreview.qualityRulesNotice}</small>
              </div>
              <span className="category-tag badge-blue">
                Format: {exportPreview.layout.toUpperCase()} CSV
              </span>
            </div>

            {exportPreview.eligible.length === 0 ? (
              <p className="muted">No products were found eligible. Review the rejected rows below or change your column mapping.</p>
            ) : (
              <div className="panel-list">
                {exportPreview.eligible.map((p) => (
                  <div className="panel-row" key={p.handle + p.skuRoot} style={{ gridTemplateColumns: '2fr 1fr 1.4fr 1.2fr auto' }}>
                    <div>
                      <strong>{p.name}</strong>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {p.skuRoot ? `Root SKU: ${p.skuRoot}` : 'No Root SKU'} · {p.variantsCount} variant{p.variantsCount > 1 ? 's' : ''} · {p.imagesCount} image{p.imagesCount > 1 ? 's' : ''}
                      </div>
                    </div>
                    <span>Markaz: Rs. {p.wholesalePrice.toLocaleString()}</span>
                    <span>
                      + Profit Rs. {p.profit.toLocaleString()} = Rs. {p.sellingPrice.toLocaleString()}
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {p.isAdvancePayment && (
                        <span className="category-tag badge-amber" title="Requires Advance Payment (China sourced). Excluded from automatic publishing.">
                          Advance Payment
                        </span>
                      )}
                      {p.isUpdate ? (
                        <span className="category-tag badge-cyan">Will Update Existing</span>
                      ) : (
                        <span className="category-tag badge-emerald">New Product</span>
                      )}
                    </div>
                    {p.mainImageUrl ? (
                      <img src={p.mainImageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>No Image</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {exportPreview.rejected.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <h3 style={{ color: 'var(--accent-rose)', margin: '0 0 10px' }}>
                  Rejected Rows ({exportPreview.rejected.length})
                </h3>
                <div className="panel-list">
                  {exportPreview.rejected.map((r, i) => (
                    <div className="panel-row" key={r.row + '-' + i} style={{ gridTemplateColumns: '1.2fr 3fr' }}>
                      <strong>
                        Row {r.row} {r.name ? `· ${r.name}` : ''} {r.sku ? `(${r.sku})` : ''}
                      </strong>
                      <span style={{ color: 'var(--accent-rose)' }}>{r.reasons.join('; ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card panel-card">
        <div className="card-heading">
          <div>
            <h2>Add Custom Sourced Product</h2>
            <p className="muted">Add a specific item from any local supplier or wholesale market.</p>
          </div>
        </div>
        <form className="panel-form" onSubmit={addManual}>
          <label>
            Product Title *
            <input
              required
              minLength={2}
              placeholder="e.g. Vintage Leather Crossbody Bag"
              value={manual.name}
              onChange={(e) => setManual({ ...manual, name: e.target.value })}
            />
          </label>
          <label>
            Category *
            <select value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Supplier Wholesale Price (Rs.) *
            <input
              required
              type="number"
              min={1}
              placeholder="e.g. 1200"
              value={manual.wholesalePrice}
              onChange={(e) => setManual({ ...manual, wholesalePrice: e.target.value })}
            />
          </label>
          <label>
            Custom Profit (Rs.)
            <input
              type="number"
              min={0}
              placeholder={`Default rule: Rs. ${settings.profit.fixed}`}
              value={manual.profit}
              onChange={(e) => setManual({ ...manual, profit: e.target.value })}
            />
          </label>
          <label>
            Stock Quantity
            <input
              type="number"
              min={0}
              placeholder="e.g. 25"
              value={manual.stock}
              onChange={(e) => setManual({ ...manual, stock: e.target.value })}
            />
          </label>
          <label>
            Product Image URL
            <input
              type="url"
              placeholder="https://example.com/photos/bag.jpg"
              value={manual.imageUrl}
              onChange={(e) => setManual({ ...manual, imageUrl: e.target.value })}
            />
          </label>
          <label>
            Supplier Product Link (Optional)
            <input
              type="url"
              placeholder="https://markaz.app/product/1234"
              value={manual.productUrl}
              onChange={(e) => setManual({ ...manual, productUrl: e.target.value })}
            />
          </label>
          <label>
            Initial Rating
            <input
              type="number"
              step="0.1"
              min={0}
              max={5}
              placeholder="e.g. 4.8"
              value={manual.rating}
              onChange={(e) => setManual({ ...manual, rating: e.target.value })}
            />
          </label>
          <label>
            Reviews Count
            <input
              type="number"
              min={0}
              placeholder="e.g. 42"
              value={manual.reviewCount}
              onChange={(e) => setManual({ ...manual, reviewCount: e.target.value })}
            />
          </label>
          <label>
            Units Sold
            <input
              type="number"
              min={0}
              placeholder="e.g. 180"
              value={manual.soldCount}
              onChange={(e) => setManual({ ...manual, soldCount: e.target.value })}
            />
          </label>
          <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
            <button className="primary-btn">
              {manualPrice === null ? 'Add Product to Catalog' : `Add Product at Selling Price: Rs. ${manualPrice.toLocaleString()}`}
            </button>
          </div>
        </form>
      </section>
    </>
  )
}

function Posts({ token, onNotify }: { token: string; onNotify: (m: string) => void }) {
  const [jobs, setJobs] = useState<ApiPublishingJob[]>([])
  const [loading, setLoading] = useState(true)

  const load = () =>
    api
      .publishingJobs(token)
      .then(({ jobs: rows }) => setJobs(rows))
      .catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load posts'))
      .finally(() => setLoading(false))

  useEffect(() => {
    void load()
  }, [token])

  const retry = async (id: string) => {
    try {
      const { delivery } = await api.retryPublishingJob(token, id)
      onNotify(delivery.message)
      await load()
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Retry failed')
    }
  }

  return (
    <section className="card panel-card">
      <div className="card-heading">
        <div>
          <h2>Buffer Publishing Queue</h2>
          <p className="muted">Live status of queued and delivered social media posts.</p>
        </div>
      </div>
      {loading ? (
        <p className="muted">Loading scheduled post queue...</p>
      ) : jobs.length === 0 ? (
        <div className="empty-feature">
          <h2>No queued posts</h2>
          <p>Posts scheduled through Content Studio or Autopilot will appear here.</p>
        </div>
      ) : (
        <div className="panel-list">
          {jobs.map((j) => (
            <div className="panel-row" key={j.id}>
              <strong>
                {j.account} ({j.platform})
              </strong>
              <span>{new Date(j.scheduled_for).toLocaleString()}</span>
              <span className={`status ${j.status === 'scheduled_in_buffer' ? 'approved' : j.status === 'failed' ? 'rejected' : 'draft'}`}>
                {j.status.replace(/_/g, ' ')}
              </span>
              <span>{j.last_error ?? 'Delivered smoothly'}</span>
              {['failed', 'queued'].includes(j.status) ? (
                <button className="secondary-btn compact" onClick={() => retry(j.id)}>
                  Retry Delivery
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
