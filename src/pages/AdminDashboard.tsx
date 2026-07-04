import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// B3 — Admin dashboard: answers "what needs me?" at a glance.
// Card 1: everything awaiting approval (the money card), direct links in.
// Card 2: PO snapshot. Card 3: recently approved. Card 4: quick actions.

interface Pending { kind: 'inspection' | 'container'; id: string; label: string; po: string; at: string | null }
interface Recent extends Pending { disposition?: string }

const fmt = (dt: string | null) => dt ? new Date(dt).toLocaleDateString() + ' ' + new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

export default function AdminDashboard() {
  const [pending, setPending] = useState<Pending[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const [poCount, setPoCount] = useState<number | null>(null)
  const [openDrafts, setOpenDrafts] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      const [pi, pc, ri, rc, pos, di, dc] = await Promise.all([
        supabase.from('inspections').select('id,part_no,po_no,submitted_at').eq('status', 'submitted').order('submitted_at'),
        supabase.from('container_loadings').select('id,container_no,po_no,submitted_at').eq('insp_status', 'submitted').order('submitted_at'),
        supabase.from('inspections').select('id,part_no,po_no,updated_at').eq('status', 'approved').order('updated_at', { ascending: false }).limit(5),
        supabase.from('container_loadings').select('id,container_no,po_no,updated_at').eq('insp_status', 'approved').order('updated_at', { ascending: false }).limit(5),
        supabase.from('pos').select('id', { count: 'exact', head: true }),
        supabase.from('inspections').select('id', { count: 'exact', head: true }).in('status', ['draft', 'rejected']),
        supabase.from('container_loadings').select('id', { count: 'exact', head: true }).in('insp_status', ['draft', 'rejected']),
      ])
      const p: Pending[] = []
      for (const r of (pi.data as any[]) || []) p.push({ kind: 'inspection', id: r.id, label: r.part_no || '(no part no.)', po: r.po_no || '', at: r.submitted_at })
      for (const r of (pc.data as any[]) || []) p.push({ kind: 'container', id: r.id, label: r.container_no || '(no container no.)', po: r.po_no || '', at: r.submitted_at })
      p.sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      setPending(p)
      const rec: Recent[] = []
      for (const r of (ri.data as any[]) || []) rec.push({ kind: 'inspection', id: r.id, label: r.part_no || '', po: r.po_no || '', at: r.updated_at })
      for (const r of (rc.data as any[]) || []) rec.push({ kind: 'container', id: r.id, label: r.container_no || '', po: r.po_no || '', at: r.updated_at })
      rec.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
      setRecent(rec.slice(0, 5))
      setPoCount(pos.count ?? 0)
      setOpenDrafts((di.count ?? 0) + (dc.count ?? 0))
      setLoaded(true)
    })()
  }, [])

  const itemRow = (x: Pending, showLink = true) => (
    <Link key={x.kind + x.id} to={x.kind === 'inspection' ? `/inspection/${x.id}` : `/container/${x.id}`}
      style={{ textDecoration: showLink ? 'none' : undefined, color: 'inherit' }}>
      <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>{x.kind === 'inspection' ? '🛞' : '📦'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{x.label} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· PO {x.po || '—'}</span></div>
          <div className="muted" style={{ fontSize: 12 }}>{fmt(x.at)}</div>
        </div>
        <span style={{ color: 'var(--navy)' }}>›</span>
      </div>
    </Link>
  )

  return (
    <div className="page">
      <div className="card" style={{ border: pending.length ? '1.5px solid var(--amber, #B7791F)' : undefined }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Awaiting your approval {loaded ? `(${pending.length})` : ''}</h2>
          <Link to="/approvals"><button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}>Open Approvals</button></Link>
        </div>
        {loaded && pending.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>Nothing waiting — all caught up. ✓</p>}
        {pending.slice(0, 6).map(x => itemRow(x))}
        {pending.length > 6 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>+ {pending.length - 6} more in Approvals</p>}
      </div>

      <div className="row" style={{ gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
        <Link to="/" style={{ flex: 1, minWidth: 200, textDecoration: 'none', color: 'inherit' }}>
          <div className="card" style={{ cursor: 'pointer' }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>PURCHASE ORDERS</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--navy)' }}>{poCount ?? '…'}</div>
            <div className="muted" style={{ fontSize: 12 }}>open the PO list ›</div>
          </div>
        </Link>
        <div className="card" style={{ flex: 1, minWidth: 200 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>WORK IN PROGRESS</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--navy)' }}>{openDrafts ?? '…'}</div>
          <div className="muted" style={{ fontSize: 12 }}>draft or returned items across all inspectors</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>Recently approved</h2>
        {loaded && recent.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>Nothing approved yet.</p>}
        {recent.map(x => itemRow(x))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>Quick actions</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to="/"><button className="btn">＋ New PO</button></Link>
          <Link to="/users"><button className="btn ghost">＋ Add user</button></Link>
          <Link to="/skus"><button className="btn ghost">Manage SKUs</button></Link>
        </div>
      </div>
    </div>
  )
}
