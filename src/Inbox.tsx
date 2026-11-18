// Purpose: Customer inbox. Shows Facebook/Instagram/WhatsApp conversations, channel badges,
// AI status (AI active / needs me / order created), human takeover, creating orders with variant SKUs,
// and copying Markaz order texts.
import { useEffect, useState } from 'react'
import { SendTemplateBox } from './Growth'
import { api, type ApiChatMessage, type ApiConversation, type ApiProduct, type ApiProductVariant } from './api'

const windowOpen = (lastInbound?: string | null, comment = false) =>
  Boolean(lastInbound) && Date.now() - new Date(lastInbound as string).getTime() < (comment ? 7 : 1) * 24 * 60 * 60 * 1000

function channelBadge(channel: string) {
  switch (channel) {
    case 'facebook':
      return <span className="category-tag badge-blue">Facebook</span>
    case 'instagram':
      return <span className="category-tag badge-pink">Instagram</span>
    case 'whatsapp':
      return <span className="category-tag badge-emerald">WhatsApp</span>
    default:
      return <span className="category-tag badge-cyan">Manual</span>
  }
}

function statusBadge(c: ApiConversation) {
  if (c.order_id || c.order_status === 'ready for Markaz' || c.status === 'ready for Markaz') {
    return <span className="status approved">Order created</span>
  }
  if (c.human_takeover) {
    return <span className="status draft">Human takeover</span>
  }
  if (c.status === 'pending') {
    return <span className="status rejected">Needs me</span>
  }
  return <span className="status new">AI active</span>
}

export function InboxPage({
  token,
  conversations,
  onCreate,
  onReload,
  onNotify,
}: {
  token: string
  conversations: ApiConversation[]
  onCreate: () => void
  onReload: () => void
  onNotify: (message: string) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = conversations.find((c) => c.id === activeId) ?? null

  useEffect(() => {
    const timer = setInterval(onReload, 15000)
    return () => clearInterval(timer)
  }, [token])

  const copyOrderText = async (conversationId: string) => {
    try {
      const res = await api.conversationMarkazSummary(token, conversationId)
      await navigator.clipboard.writeText(res.summary)
      onNotify('Markaz order text copied!')
    } catch {
      onNotify('Could not load order text')
    }
  }

  const toggleTakeover = async (c: ApiConversation) => {
    try {
      await api.chatUpdate(token, c.id, { humanTakeover: !c.human_takeover })
      onNotify(c.human_takeover ? 'AI replies resumed' : 'You took over: AI paused')
      onReload()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed')
    }
  }

  return (
    <div className="page panel-stack">
      <section className="card panel-card">
        <div className="card-heading">
          <div>
            <h2>Customer inbox</h2>
          </div>
          <button className="primary-btn" onClick={onCreate}>
            New manual conversation
          </button>
        </div>
        {conversations.length === 0 ? (
          <div className="empty-feature">
            <h2>No conversations yet</h2>
          </div>
        ) : (
          <div className="panel-list">
            {conversations.map((c) => (
              <div
                className="panel-row"
                key={c.id}
                style={{ gridTemplateColumns: '1.2fr 90px 2fr 130px auto', alignItems: 'center' }}
              >
                <div>
                  <strong>{c.customer_name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.phone}</div>
                </div>
                <div>{channelBadge(c.channel)}</div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                  {c.last_message ?? 'No messages yet'}
                </div>
                <div>{statusBadge(c)}</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    className="secondary-btn compact"
                    title={c.human_takeover ? 'Resume AI' : 'Take over'}
                    onClick={() => void toggleTakeover(c)}
                  >
                    {c.human_takeover ? 'Resume AI' : 'Take over'}
                  </button>
                  {c.order_id && (
                    <button
                      className="secondary-btn compact"
                      onClick={() => void copyOrderText(c.id)}
                    >
                      Copy Markaz text
                    </button>
                  )}
                  <button
                    className="secondary-btn compact"
                    onClick={() => setActiveId(c.id === activeId ? null : c.id)}
                  >
                    {c.id === activeId ? 'Close' : 'Open'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {active && <Thread key={active.id} token={token} conversation={active} onReload={onReload} onNotify={onNotify} />}
    </div>
  )
}

function Thread({
  token,
  conversation,
  onReload,
  onNotify,
}: {
  token: string
  conversation: ApiConversation
  onReload: () => void
  onNotify: (message: string) => void
}) {
  const [messages, setMessages] = useState<ApiChatMessage[]>([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [variants, setVariants] = useState<ApiProductVariant[]>([])
  const [showOrder, setShowOrder] = useState(false)
  const [order, setOrder] = useState({
    productId: '',
    variantId: '',
    quantity: 1,
    name: conversation.customer_name || '',
    phone: conversation.phone || '',
    city: '',
    address: '',
    paymentMethod: 'cod',
  })
  const [summary, setSummary] = useState('')
  const linked = ['facebook', 'instagram', 'whatsapp'].includes(conversation.channel)
  const isComment = Boolean(conversation.external_thread_id?.startsWith('c:'))
  const open = windowOpen(conversation.last_inbound_at, isComment)

  const load = () =>
    api
      .conversationMessages(token, conversation.id)
      .then(({ messages: rows }) => setMessages(rows))
      .catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load messages'))

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      void load()
    }, 10000)
    return () => clearInterval(timer)
  }, [conversation.id])

  // Load existing order summary if conversation already has an order
  useEffect(() => {
    if (conversation.order_id) {
      api
        .conversationMarkazSummary(token, conversation.id)
        .then((res) => setSummary(res.summary))
        .catch(() => undefined)
    }
  }, [conversation.id, conversation.order_id])

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key)
    try {
      const message = await action()
      if (message) onNotify(message)
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'Action failed')
    } finally {
      setBusy('')
      await load()
      onReload()
    }
  }

  const send = (id: string) =>
    run(`s${id}`, async () => {
      await api.chatSend(token, conversation.id, id)
      return 'Sent. Message confirmed.'
    })

  const sendNew = () =>
    run('new', async () => {
      const created = await api.chatCreateReply(token, conversation.id, reply.trim())
      setReply('')
      if (linked) {
        await api.chatSend(token, conversation.id, created.message.id)
        return 'Sent. Message confirmed.'
      }
      return 'Saved as a draft (this conversation is not linked).'
    })

  const openOrder = async () => {
    setShowOrder(!showOrder)
    if (products.length === 0) {
      api
        .products(token)
        .then(({ products: rows }) => setProducts(rows))
        .catch((reason) => onNotify(reason instanceof Error ? reason.message : 'Could not load products'))
    }
  }

  const handleProductChange = async (productId: string) => {
    setOrder({ ...order, productId, variantId: '' })
    if (productId) {
      try {
        const res = await api.productVariants(token, productId)
        setVariants(res.variants)
      } catch {
        setVariants([])
      }
    } else {
      setVariants([])
    }
  }

  const createOrder = (event: React.FormEvent) => {
    event.preventDefault()
    void run('order', async () => {
      const selVariant = variants.find((v) => v.id === order.variantId)
      const result = await api.chatCreateOrder(token, conversation.id, {
        ...order,
        variantId: order.variantId || undefined,
        variantSku: selVariant?.sku,
        variantTitle: selVariant?.title || undefined,
        quantity: Number(order.quantity),
      })
      const prepared = await api.markazSummary(token, result.order.id)
      setSummary(prepared.summary)
      setShowOrder(false)
      return 'Order created. Markaz summary is ready to copy.'
    })
  }

  return (
    <section className="card panel-card">
      <div className="card-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2>
            {conversation.customer_name} · {conversation.phone}
          </h2>
          {channelBadge(conversation.channel)}
          {statusBadge(conversation)}
        </div>
        <div className="order-actions">
          <button
            className="secondary-btn compact"
            disabled={busy === 'take'}
            onClick={() =>
              run('take', async () => {
                await api.chatUpdate(token, conversation.id, { humanTakeover: !conversation.human_takeover })
                return conversation.human_takeover ? 'AI replies resumed' : 'You took over: AI paused'
              })
            }
          >
            {conversation.human_takeover ? 'Resume AI' : 'Take over'}
          </button>
          <button className="secondary-btn compact" onClick={() => void openOrder()}>
            Create order
          </button>
          {summary && (
            <button
              className="secondary-btn compact"
              onClick={() => {
                void navigator.clipboard
                  .writeText(summary)
                  .then(() => onNotify('Markaz order text copied!'))
                  .catch(() => onNotify('Could not copy'))
              }}
            >
              Copy Markaz text
            </button>
          )}
          <button
            className="secondary-btn compact"
            disabled={busy === 'close'}
            onClick={() =>
              run('close', async () => {
                await api.chatUpdate(token, conversation.id, {
                  status: conversation.status === 'closed' ? 'open' : 'closed',
                })
              })
            }
          >
            {conversation.status === 'closed' ? 'Reopen' : 'Close chat'}
          </button>
        </div>
      </div>

      {conversation.channel === 'whatsapp' && conversation.customer_id && (
        <SendTemplateBox
          token={token}
          conversationId={conversation.id}
          customerId={conversation.customer_id}
          onNotify={onNotify}
        />
      )}

      <div className="panel-list">
        {messages.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div className="integration-card" key={m.id}>
              <div className="integration-head">
                <strong>{m.direction === 'inbound' ? 'Customer' : m.ai_generated ? 'AI assistant' : 'You'}</strong>
                <span className={`status ${m.status === 'sent' ? 'approved' : 'draft'}`}>
                  {m.direction === 'inbound' ? 'received' : m.status}
                </span>
                <small className="muted">{new Date(m.created_at).toLocaleString()}</small>
              </div>
              {editing?.id === m.id ? (
                <div className="panel-form">
                  <input
                    value={editing.body}
                    onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
                    aria-label="Edit reply"
                  />
                  <button
                    className="primary-btn compact"
                    disabled={busy === 'edit'}
                    onClick={() =>
                      run('edit', async () => {
                        await api.chatEditReply(token, conversation.id, m.id, editing.body)
                        setEditing(null)
                      })
                    }
                  >
                    Save
                  </button>
                </div>
              ) : (
                <p>{m.body}</p>
              )}
              {m.last_error && <small className="muted" style={{ color: 'var(--accent-rose)' }}>Last send error: {m.last_error}</small>}
              {m.direction === 'outbound' && m.status !== 'sent' && !editing && (
                <div className="order-actions">
                  <button className="secondary-btn compact" onClick={() => setEditing({ id: m.id, body: m.body })}>
                    Edit
                  </button>
                  {linked && (
                    <button
                      className="primary-btn compact"
                      disabled={busy === `s${m.id}` || !open}
                      title={open ? '' : 'Reply window closed'}
                      onClick={() => void send(m.id)}
                    >
                      Approve and send
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="panel-form">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply..."
          maxLength={1900}
          aria-label="Reply"
        />
        <button
          className="primary-btn"
          disabled={!reply.trim() || busy === 'new' || (linked && !open)}
          onClick={() => void sendNew()}
        >
          {linked ? 'Send' : 'Save draft'}
        </button>
      </div>

      {showOrder && (
        <form className="panel-form" onSubmit={createOrder} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <select
            required
            value={order.productId}
            onChange={(e) => void handleProductChange(e.target.value)}
            aria-label="Product"
          >
            <option value="">Select Product...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (Stock: {p.stock})
              </option>
            ))}
          </select>

          {variants.length > 0 && (
            <select
              value={order.variantId}
              onChange={(e) => setOrder({ ...order, variantId: e.target.value })}
              aria-label="Variant"
            >
              <option value="">Select Variant (Optional)...</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title || v.sku} {v.sku ? `[${v.sku}]` : ''}
                </option>
              ))}
            </select>
          )}

          <input
            type="number"
            min={1}
            value={order.quantity}
            onChange={(e) => setOrder({ ...order, quantity: Number(e.target.value) })}
            aria-label="Quantity"
            placeholder="Quantity"
          />
          <input
            required
            minLength={2}
            placeholder="Customer name"
            value={order.name}
            onChange={(e) => setOrder({ ...order, name: e.target.value })}
            aria-label="Customer name"
          />
          <input
            required
            minLength={7}
            placeholder="Phone number"
            value={order.phone}
            onChange={(e) => setOrder({ ...order, phone: e.target.value })}
            aria-label="Phone"
          />
          <input
            required
            minLength={2}
            placeholder="City"
            value={order.city}
            onChange={(e) => setOrder({ ...order, city: e.target.value })}
            aria-label="City"
          />
          <input
            required
            minLength={5}
            placeholder="Full delivery address"
            value={order.address}
            onChange={(e) => setOrder({ ...order, address: e.target.value })}
            aria-label="Address"
          />
          <select
            value={order.paymentMethod}
            onChange={(e) => setOrder({ ...order, paymentMethod: e.target.value })}
            aria-label="Payment method"
          >
            <option value="cod">Cash on delivery (COD)</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="easypaisa">Easypaisa</option>
            <option value="jazzcash">JazzCash</option>
          </select>
          <button className="primary-btn" disabled={busy === 'order'}>
            Create order
          </button>
        </form>
      )}

      {summary && (
        <div className="integration-card" style={{ marginTop: 16 }}>
          <div className="integration-head">
            <strong>Order text for the Markaz app</strong>
            <button
              className="secondary-btn compact"
              onClick={() => {
                void navigator.clipboard
                  .writeText(summary)
                  .then(() => onNotify('Markaz order text copied!'))
                  .catch(() => onNotify('Could not copy'))
              }}
            >
              Copy Markaz text
            </button>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0', fontSize: 13, background: 'var(--surface-raised)', padding: 12, borderRadius: 8 }}>
            {summary}
          </pre>
          <small className="muted">Prepared for manual entry in Markaz. Nothing was submitted to Markaz.</small>
        </div>
      )}
    </section>
  )
}
