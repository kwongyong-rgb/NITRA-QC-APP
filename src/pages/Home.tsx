import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'

interface InspRow { id: string; po_no: string | null; updated_at: string }
interface ContRow { id: string; po_no: string | null; updated_at: string }
interface PoMaster { po_no: string; customer_name: string | null; destination: string | null; created_at: string }
interface POGroup { po: string; inspCount: number; contCount: number; latest: string; customer?: string; destination?: string }

export default function Home({ profile }: { profile: Profile }) {
  const nav = useNavigate()
  const [groups, setGroups] = useState<POGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [newPo, setNewPo] = useState<{ po_no: string; customer_name: string; po_date: string; destination: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    const { data: i } = await supabase.from('inspections').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500)
    const { data: c } = await supabase.from('container_loadings').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500)
    const { data: p } = await supabase.from('pos').select('po_no,customer_name,destination,created_at').order('created_at', { ascending: false }).limit(500)
    const map = new Map<string, POGroup>()
    const bump = (key: string, when: string, kind: 'insp' | 'cont') => {
      const g = map.get(key) || { po: key, inspCount: 0, contCount: 0, latest: when }
      if (kind === 'insp') g.inspCount++; else g.contCount++
      if (when > g.latest) g.latest = when
      map.set(key, g)
    }
    for (const r of (i as InspRow[]) || []) bump(r.po_no || '', r.updated_at, 'insp')
    for (const r of (c as ContRow[]) || []) bump(r.po_no || '', r.updated_at, 'cont')
    // Merge PO master rows: POs created ahead of any inspection still appear,
    // and customer/destination annotate every group that has them.
    for (const m of (p as PoMaster[]) || []) {
      const g = map.get(m.po_no) || { po: m.po_no, inspCount: 0, contCount: 0, latest: m.created_at }
      g.customer = m.customer_name || undefined
      g.destination = m.destination || undefined
      map.set(m.po_no, g)
    }
    setGroups([...map.values()].sort((a, b) => b.latest.localeCompare(a.latest)))
    setLoaded(true)
  }
  useEffect(() => { load() }, [])

  const newPO = () => {
    if (profile.role === 'admin') {
      setErr(''); setNewPo({ po_no: '', customer_name: '', po_date: '', destination: '' })
      return
    }
    // Inspectors keep the quick open-a-PO flow (no master-data editing rights).
    const po = window.prompt('Enter the PO number:')
    if (po === null) return
    nav(`/po/${encodeURIComponent(po.trim())}`)
  }

  const createPO = async () => {
    if (!newPo) return
    const po_no = newPo.po_no.trim()
    if (!po_no) { setErr('PO number is required.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('pos').upsert({
      po_no,
      customer_name: newPo.customer_name.trim() || null,
      po_date: newPo.po_date || null,
      destination: newPo.destination.trim() || null,
    }, { onConflict: 'po_no' })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setNewPo(null)
    nav(`/po/${encodeURIComponent(po_no)}`)
  }

  const delPO = async (g: POGroup) => {
    const label = g.po || '(No PO)'
    if (!confirm(`Delete the ENTIRE PO “${label}”?\n\nThis permanently deletes its ${g.inspCount} wheel inspection(s) and ${g.contCount} container loading(s), including their photos.\n\nThis cannot be undone.`)) return
    const { error: e1 } = await supabase.from('inspections').delete().eq('po_no', g.po)
    const { error: e2 } = await supabase.from('container_loadings').delete().eq('po_no', g.po)
    if (e1 || e2) { alert('Delete failed: ' + (e1?.message || e2?.message)); return }
    await supabase.from('pos').delete().eq('po_no', g.po) // master row + items (cascade)
    load()
  }

  return (
    <div className="page">
      <button className="btn" style={{ width: '100%', marginBottom: 16 }} onClick={newPO}>＋ New PO</button>
      <div className="card">
        <h2>Purchase Orders / 采购订单</h2>
        {loaded && groups.length === 0 && <p className="muted">No POs yet. Tap “＋ New PO” to start.</p>}
        {groups.map(g => (
          <div key={g.po} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to={`/po/${encodeURIComponent(g.po)}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--navy)' }}>{g.po || '(No PO)'}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                {g.customer ? <>{g.customer}{g.destination ? ` → ${g.destination}` : ''} · </> : (g.destination ? <>→ {g.destination} · </> : null)}
                {g.inspCount} wheel inspection(s) · {g.contCount} container loading(s)
              </div>
            </Link>
            {profile.role === 'admin' && (
              <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delPO(g)}>🗑</button>
            )}
          </div>
        ))}
      </div>

      {newPo && (
        <div className="modal-overlay" onClick={() => setNewPo(null)}>
          <div className="modal" style={{ width: 'min(460px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>New Purchase Order</h2>
            <label className="fld"><span>PO number *</span>
              <input className="txt" value={newPo.po_no} autoFocus onChange={e => setNewPo({ ...newPo, po_no: e.target.value })} /></label>
            <label className="fld"><span>Customer name</span>
              <input className="txt" value={newPo.customer_name} onChange={e => setNewPo({ ...newPo, customer_name: e.target.value })} /></label>
            <label className="fld"><span>PO date</span>
              <input className="txt" type="date" value={newPo.po_date} onChange={e => setNewPo({ ...newPo, po_date: e.target.value })} /></label>
            <label className="fld"><span>Destination</span>
              <input className="txt" value={newPo.destination} onChange={e => setNewPo({ ...newPo, destination: e.target.value })} /></label>
            <p className="muted" style={{ fontSize: 12 }}>Ordered part numbers and quantities are added on the next screen (manually or by Excel upload).</p>
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={createPO}>{busy ? 'Creating…' : 'Create PO'}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setNewPo(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
