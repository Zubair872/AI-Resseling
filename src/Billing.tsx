// Purpose: live Billing (plans, coupon, invoices, cancel, referral), Team (invites, roles) and Super Admin billing panels.
import { useEffect, useState } from 'react'
import { api, type ApiBilling, type ApiCoupon, type ApiInvoice, type ApiTeamInvite, type ApiTeamMember } from './api'

type Notify = (message: string) => void
const rs = (value: string | number) => `Rs. ${Number(value).toLocaleString()}`
const fail = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback)
const roleRank: Record<string, number> = { staff: 10, support_agent: 10, manager: 20, admin: 30, owner: 40, super_admin: 50 }
const isAtLeast = (role: string, minimum: string) => (roleRank[role] ?? 0) >= (roleRank[minimum] ?? 999)

export function BillingPanel({ token, role, onNotify }: { token: string; role: string; onNotify: Notify }) {
  const [data, setData] = useState<ApiBilling | null>(null)
  const [referral, setReferral] = useState<{ code: string; link: string; referredWorkspaces: number; note: string } | null>(null)
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly')
  const [coupon, setCoupon] = useState('')
  const [quotes, setQuotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.billing(token).then(setData).catch((reason) => onNotify(fail(reason, 'Could not load billing')))
    api.referral(token).then(setReferral).catch(() => undefined)
  }
  useEffect(() => { if (isAtLeast(role, 'admin')) load() }, [token])
  if (!isAtLeast(role, 'admin')) return <div className="page panel-stack"><section className="card panel-card"><h2>Billing</h2><p className="muted">Only workspace owners and admins can see billing.</p></section></div>
  if (!data) return <div className="page panel-stack"><section className="card panel-card"><p className="muted">Loading billing...</p></section></div>

  const isOwner = isAtLeast(role, 'owner')
  const sub = data.subscription
  const preview = async (planCode: string) => {
    try {
      const q = await api.billingQuote(token, { planCode, cycle, couponCode: coupon.trim() || undefined })
      setQuotes((previous) => ({ ...previous, [planCode]: `${rs(q.total)}${q.discount > 0 ? ` (discount ${rs(q.discount)})` : ''}` }))
    } catch (reason) { onNotify(fail(reason, 'Could not price this plan')) }
  }
  const choose = async (planCode: string) => {
    setBusy(true)
    try {
      const result = await api.changePlan(token, { planCode, cycle, couponCode: coupon.trim() || undefined })
      onNotify(result.note)
      load()
    } catch (reason) { onNotify(fail(reason, 'Could not change plan')) } finally { setBusy(false) }
  }
  const payByCard = async () => {
    try { const { url } = await api.startCheckout(token); window.location.assign(url) } catch (reason) { onNotify(fail(reason, 'Card payment is not available')) }
  }
  const run = async (action: () => Promise<{ note?: string } | unknown>, done: string) => {
    try { await action(); onNotify(done); load() } catch (reason) { onNotify(fail(reason, 'Action failed')) }
  }
  const openInvoice = async (invoice: ApiInvoice) => {
    try {
      const html = await api.invoiceDocument(token, invoice.id)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      window.open(url, '_blank', 'noopener')
    } catch (reason) { onNotify(fail(reason, 'Could not open invoice')) }
  }

  return <div className="page panel-stack">
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Plan and usage</h2></div>
        {isOwner && sub && sub.code !== 'starter' && (sub.cancel_at_period_end ? <button className="secondary-btn compact" onClick={() => run(() => api.resumePlan(token), 'Cancellation removed')}>Keep my plan</button> : <button className="secondary-btn compact" onClick={() => { if (window.confirm('Cancel at the end of the paid period?')) void run(() => api.cancelPlan(token), 'Cancellation scheduled') }}>Cancel plan</button>)}</div>
      <div className="stat-grid">
        <div className="stat-tile"><small>Products</small><strong>{data.usage.products} / {sub?.product_limit ?? '-'}</strong></div>
        <div className="stat-tile"><small>Social accounts</small><strong>{data.usage.socialAccounts} / {sub?.social_account_limit ?? '-'}</strong></div>
        <div className="stat-tile"><small>Team members</small><strong>{data.usage.teamMembers + data.usage.pendingInvites} / {sub?.team_member_limit ?? '-'}</strong></div>
      </div>
    </section>
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Change plan</h2></div>{isOwner && data.invoices.some((i) => i.status === 'pending') && <button className="primary-btn compact" onClick={payByCard}>Pay pending invoice by card</button>}</div>
      {!isOwner && <p className="muted">Only the workspace owner can change the plan.</p>}
      <div className="panel-form">
        <label>Billing cycle<select value={cycle} onChange={(e) => { setCycle(e.target.value as 'monthly' | 'annual'); setQuotes({}) }}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
        <label>Coupon (optional)<input value={coupon} onChange={(e) => { setCoupon(e.target.value); setQuotes({}) }} placeholder="CODE" /></label>
      </div>
      <div className="panel-list">{data.plans.map((plan) => <div className="panel-row" key={plan.code}>
        <strong>{plan.name}</strong>
        <span>{plan.code === 'enterprise' ? 'Custom price' : rs(cycle === 'annual' ? plan.annual_price : plan.monthly_price)}</span>
        <span>{plan.product_limit.toLocaleString()} products · {plan.social_account_limit} accounts · {plan.team_member_limit} seats</span>
        <span>{quotes[plan.code] ? `You pay ${quotes[plan.code]}` : ''}</span>
        <span>{plan.code !== 'enterprise' && <><button className="secondary-btn compact" onClick={() => preview(plan.code)}>Price</button>{isOwner && <button className="primary-btn compact" disabled={busy || (sub?.code === plan.code && sub.billing_cycle === cycle)} onClick={() => choose(plan.code)}>{sub?.code === plan.code ? 'Current' : 'Select'}</button>}</>}</span>
      </div>)}</div>
    </section>
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Invoices</h2></div></div>
      {data.invoices.length === 0 ? <p className="muted">No invoices yet.</p> : <div className="panel-list">{data.invoices.map((invoice) => <div className="panel-row" key={invoice.id}>
        <strong>{invoice.number}</strong><span>{invoice.plan_code} · {invoice.billing_cycle}</span><span>{rs(invoice.total)}</span><span className={`status ${invoice.status}`}>{invoice.status}</span><button className="secondary-btn compact" onClick={() => openInvoice(invoice)}>View</button>
      </div>)}</div>}
    </section>
    {referral && <section className="card panel-card">
      <div className="card-heading"><div><h2>Referrals</h2></div></div>
      <div className="stat-grid"><div className="stat-tile"><small>Your referral link</small><strong style={{ fontSize: 13, wordBreak: 'break-all' }}>{referral.link}</strong></div><div className="stat-tile"><small>Workspaces referred</small><strong>{referral.referredWorkspaces}</strong></div></div>
    </section>}
  </div>
}

export function TeamPanel({ token, role, selfId, onNotify }: { token: string; role: string; selfId: string; onNotify: Notify }) {
  const [members, setMembers] = useState<ApiTeamMember[]>([])
  const [invites, setInvites] = useState<ApiTeamInvite[]>([])
  const [limit, setLimit] = useState(1)
  const [form, setForm] = useState({ email: '', role: 'staff' })
  const canManage = isAtLeast(role, 'admin')
  const assignable = ['admin', 'manager', 'staff', 'support_agent'].filter((r) => (roleRank[role] ?? 0) > roleRank[r])

  const load = () => api.team(token).then((result) => { setMembers(result.members); setInvites(result.invites); setLimit(result.memberLimit) }).catch((reason) => onNotify(fail(reason, 'Could not load team')))
  useEffect(() => { void load() }, [token])

  const invite = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const result = await api.inviteMember(token, form)
      onNotify(result.note)
      setForm({ ...form, email: '' })
      await load()
    } catch (reason) { onNotify(fail(reason, 'Could not send invite')) }
  }
  const change = async (id: string, data: { role?: string; isActive?: boolean }) => {
    try { await api.updateMember(token, id, data); await load() } catch (reason) { onNotify(fail(reason, 'Could not update member')) }
  }
  const revoke = async (id: string) => {
    try { await api.revokeInvite(token, id); await load() } catch (reason) { onNotify(fail(reason, 'Could not revoke invite')) }
  }

  return <div className="page panel-stack"><section className="card panel-card">
    <div className="card-heading"><div><h2>Team members</h2></div></div>
    {canManage && <form className="panel-form" onSubmit={invite}>
      <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{assignable.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></label>
      <button className="primary-btn compact">Send invite</button>
    </form>}
    <div className="panel-list">{members.map((member) => {
      const editable = canManage && member.id !== selfId && (roleRank[role] ?? 0) > (roleRank[member.role] ?? 999)
      return <div className="panel-row" key={member.id}>
        <strong>{member.email}{member.id === selfId ? ' (you)' : ''}</strong>
        <span>{editable ? <select value={member.role} onChange={(e) => change(member.id, { role: e.target.value })}>{assignable.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select> : member.role.replace('_', ' ')}</span>
        <span>{member.is_active ? 'Active' : 'Deactivated'}</span>
        <span>Joined {new Date(member.created_at).toLocaleDateString()}</span>
        <span>{editable && <button className="secondary-btn compact" onClick={() => change(member.id, { isActive: !member.is_active })}>{member.is_active ? 'Deactivate' : 'Reactivate'}</button>}</span>
      </div>
    })}</div>
    {invites.length > 0 && <><h3>Pending invites</h3><div className="panel-list">{invites.map((item) => <div className="panel-row" key={item.id}><strong>{item.email}</strong><span>{item.role.replace('_', ' ')}</span><span>Expires {new Date(item.expires_at).toLocaleDateString()}</span><span /><span>{canManage && <button className="secondary-btn compact" onClick={() => revoke(item.id)}>Revoke</button>}</span></div>)}</div></>}
  </section></div>
}

export function SuperBillingPanel({ token, onNotify }: { token: string; onNotify: Notify }) {
  const [invoices, setInvoices] = useState<ApiInvoice[]>([])
  const [coupons, setCoupons] = useState<ApiCoupon[]>([])
  const [form, setForm] = useState({ code: '', kind: 'percent', value: 10, maxRedemptions: '' })

  const load = () => {
    api.adminInvoices(token, 'pending').then((r) => setInvoices(r.invoices)).catch((reason) => onNotify(fail(reason, 'Could not load invoices')))
    api.adminCoupons(token).then((r) => setCoupons(r.coupons)).catch(() => undefined)
  }
  useEffect(() => { load() }, [token])

  const markPaid = async (invoice: ApiInvoice) => {
    const reference = window.prompt(`Enter the real payment reference for ${invoice.number} (bank/Easypaisa/JazzCash transaction ID). Only confirm after you saw the money arrive.`)
    if (!reference || reference.trim().length < 3) return
    try { await api.markInvoicePaid(token, invoice.id, reference.trim()); onNotify('Payment confirmed and plan activated'); load() } catch (reason) { onNotify(fail(reason, 'Could not confirm payment')) }
  }
  const voidInvoice = async (invoice: ApiInvoice) => {
    try { await api.voidInvoice(token, invoice.id); load() } catch (reason) { onNotify(fail(reason, 'Could not void invoice')) }
  }
  const createCoupon = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await api.createCoupon(token, { code: form.code, ...(form.kind === 'percent' ? { percentOff: Number(form.value) } : { amountOff: Number(form.value) }), ...(form.maxRedemptions ? { maxRedemptions: Number(form.maxRedemptions) } : {}) })
      setForm({ ...form, code: '' })
      load()
    } catch (reason) { onNotify(fail(reason, 'Could not create coupon')) }
  }
  const toggle = async (coupon: ApiCoupon) => {
    try { await api.setCouponActive(token, coupon.id, !coupon.active); load() } catch (reason) { onNotify(fail(reason, 'Could not update coupon')) }
  }

  return <div className="page panel-stack">
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Pending invoices (Super Admin)</h2></div></div>
      {invoices.length === 0 ? <p className="muted">No pending invoices.</p> : <div className="panel-list">{invoices.map((invoice) => <div className="panel-row" key={invoice.id}>
        <strong>{invoice.number} · {invoice.workspace}</strong><span>{invoice.plan_code} · {invoice.billing_cycle}</span><span>{rs(invoice.total)}</span><span>{new Date(invoice.created_at).toLocaleDateString()}</span>
        <span><button className="primary-btn compact" onClick={() => markPaid(invoice)}>Confirm paid</button><button className="secondary-btn compact" onClick={() => voidInvoice(invoice)}>Void</button></span>
      </div>)}</div>}
    </section>
    <section className="card panel-card">
      <div className="card-heading"><div><h2>Coupons</h2></div></div>
      <form className="panel-form" onSubmit={createCoupon}>
        <label>Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} minLength={3} required /></label>
        <label>Type<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="percent">Percent off</option><option value="amount">Rs. off</option></select></label>
        <label>Value<input type="number" min={1} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} required /></label>
        <label>Max uses (optional)<input type="number" min={1} value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} /></label>
        <button className="primary-btn compact">Create coupon</button>
      </form>
      <div className="panel-list">{coupons.map((c) => <div className="panel-row" key={c.id}><strong>{c.code}</strong><span>{c.percent_off ? `${Number(c.percent_off)}% off` : `${rs(c.amount_off ?? 0)} off`}</span><span>{c.redeemed_count}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''} used</span><span>{c.active ? 'Active' : 'Disabled'}</span><button className="secondary-btn compact" onClick={() => toggle(c)}>{c.active ? 'Disable' : 'Enable'}</button></div>)}</div>
    </section>
  </div>
}
