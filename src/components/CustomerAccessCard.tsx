import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n, type Bi } from '../lib/i18n'
import { getOrCreatePoId } from '../lib/poStatus'

// Admin-only card on the PO page: which customer accounts may view this PO.
// Writes the SAME po_access table the Users page uses — just keyed by PO
// instead of by customer. Toggling is immediate (insert / delete one row).

interface Customer { id: string; email: string; full_name: string; active: boolean }

const T = {
  title:    { en: 'Customer access', zh: '客户访问权限' } as Bi,
  help:     { en: 'These customer accounts can view this PO\u2019s approved reports. Changes apply immediately.',
              zh: '以下客户账户可查看此订单的已批准报告。更改即时生效。' } as Bi,
  none:     { en: 'No customer accounts yet — add one on the Users page.', zh: '暂无客户账户——请在用户管理页添加。' } as Bi,
  grant:    { en: 'Grant', zh: '授予' } as Bi,
  granted:  { en: '\u2713 Granted', zh: '\u2713 已授予' } as Bi,
  loading:  { en: 'Loading\u2026', zh: '加载中\u2026' } as Bi,
  inactive: { en: 'deactivated', zh: '已停用' } as Bi,
}

async function listCustomers(): Promise<Customer[] | { error: string }> {
  const { data, error } = await supabase.functions.invoke('manage-users', { body: { action: 'list' } })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    }
    return { error: msg }
  }
  const res = data as { ok: boolean; users?: { id: string; email: string; full_name: string; role: string; active: boolean }[]; error?: string }
  if (!res?.ok) return { error: res?.error || 'Could not load customers.' }
  return (res.users || []).filter(u => u.role === 'customer').map(u => ({ id: u.id, email: u.email, full_name: u.full_name, active: u.active }))
}

export default function CustomerAccessCard({ po }: { po: string }) {
  const { bi } = useI18n()
  const [poId, setPoId] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const id = await getOrCreatePoId(po, true)
    setPoId(id)
    const cust = await listCustomers()
    if ('error' in cust) { setErr(cust.error); setCustomers([]); setLoading(false); return }
    setCustomers(cust)
    if (id) {
      const { data: acc } = await supabase.from('po_access').select('customer_id').eq('po_id', id)
      setAssigned(new Set(((acc as { customer_id: string }[]) || []).map(a => a.customer_id)))
    }
    setLoading(false)
  }, [po])

  useEffect(() => { load() }, [load])

  const toggle = async (customerId: string) => {
    if (!poId) return
    setBusyId(customerId); setErr('')
    const has = assigned.has(customerId)
    // optimistic
    const next = new Set(assigned)
    if (has) next.delete(customerId); else next.add(customerId)
    setAssigned(next)
    const { error } = has
      ? await supabase.from('po_access').delete().eq('po_id', poId).eq('customer_id', customerId)
      : await supabase.from('po_access').insert({ po_id: poId, customer_id: customerId })
    if (error) {
      // revert
      const back = new Set(assigned)
      setAssigned(back)
      setErr(error.message)
    }
    setBusyId(null)
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2 style={{ margin: '0 0 6px' }}>{bi(T.title)}</h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 }}>{bi(T.help)}</p>
      {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginBottom: 10 }}>{err}</div>}
      {loading ? <p className="muted">{bi(T.loading)}</p> : (
        customers.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>{bi(T.none)}</p> : (
          <div>
            {customers.map(c => {
              const on = assigned.has(c.id)
              return (
                <div key={c.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0, opacity: c.active ? 1 : 0.55 }}>
                    <div style={{ fontWeight: 700 }}>
                      {c.full_name || c.email}
                      {!c.active && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> ({bi(T.inactive)})</span>}
                    </div>
                    {c.full_name && <div className="muted" style={{ fontSize: 12 }}>{c.email}</div>}
                  </div>
                  <button
                    className={on ? 'btn ok' : 'btn ghost'}
                    style={{ minHeight: 38, padding: '4px 14px', fontSize: 14, minWidth: 108 }}
                    disabled={busyId === c.id || !poId}
                    onClick={() => toggle(c.id)}
                  >{on ? bi(T.granted) : bi(T.grant)}</button>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
