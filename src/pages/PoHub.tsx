import { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'
import PoInfo from './PoInfo'
import EmailModal from '../components/EmailModal'

interface Insp { id: string; part_no: string; status: string; updated_at: string; inspector_id: string }
interface Cont { id: string; container_no: string; seal_no: string; status: string; insp_status: string; updated_at: string; inspector_id: string }

function fmt(dt: string | null) {
  if (!dt) return '—'
  const d = new Date(dt)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function PoHub({ profile }: { profile: Profile }) {
  const { poNo } = useParams()
  const po = decodeURIComponent(poNo || '')
  const nav = useNavigate()
  const [insps, setInsps] = useState<Insp[]>([])
  const [conts, setConts] = useState<Cont[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: i } = await supabase.from('inspections').select('id,part_no,status,updated_at,inspector_id').eq('po_no', po).order('updated_at', { ascending: false })
    setInsps((i as Insp[]) || [])
    const { data: c } = await supabase.from('container_loadings').select('id,container_no,seal_no,status,insp_status,updated_at,inspector_id').eq('po_no', po).order('updated_at', { ascending: false })
    setConts((c as Cont[]) || [])
  }, [po])
  useEffect(() => { load() }, [load])

  const addContainer = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('container_loadings').insert({ inspector_id: profile.id, po_no: po }).select('id').single()
    setBusy(false)
    if (error) { alert(error.message); return }
    if (data) nav(`/container/${data.id}`)
  }

  const [emailOpen, setEmailOpen] = useState(false)
  const emailPoReport = () => setEmailOpen(true)
  const doEmailPo = async (emails: string[]) => {
    setBusy(true)
    const { error } = await supabase.functions.invoke('send-po-report', { body: { po, emails } })
    setBusy(false)
    if (error) { alert('Email failed: ' + error.message); return }
    setEmailOpen(false)
    alert('Consolidated PO report link sent.')
  }

  const delInsp = async (r: Insp) => {
    if (!confirm('Delete this wheel inspection? This cannot be undone.')) return
    const { error } = await supabase.from('inspections').delete().eq('id', r.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }
  const delCont = async (c: Cont) => {
    if (!confirm('Delete this container loading? This cannot be undone.')) return
    const { error } = await supabase.from('container_loadings').delete().eq('id', c.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }
  const canDelInsp = (r: Insp) => profile.role === 'admin' || (r.status === 'draft' && r.inspector_id === profile.id)
  const canDelCont = (c: Cont) => profile.role === 'admin' || (['draft', 'rejected'].includes(c.insp_status) && c.inspector_id === profile.id)

  const delPO = async () => {
    if (!confirm(`Delete the ENTIRE PO “${po || '(No PO)'}”?\n\nThis permanently deletes its ${insps.length} wheel inspection(s) and ${conts.length} container loading(s), including their photos.\n\nThis cannot be undone.`)) return
    const { error: e1 } = await supabase.from('inspections').delete().eq('po_no', po)
    const { error: e2 } = await supabase.from('container_loadings').delete().eq('po_no', po)
    if (e1 || e2) { alert('Delete failed: ' + (e1?.message || e2?.message)); return }
    await supabase.from('pos').delete().eq('po_no', po) // master row + items (cascade)
    nav('/')
  }

  return (
    <div className="page">
      <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, marginBottom: 12 }} onClick={() => nav('/')}>← All POs</button>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>PO: {po || '(No PO)'}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{insps.length} wheel inspection(s) · {conts.length} container loading(s)</p>
        {profile.role === 'admin' && (insps.length > 0 || conts.length > 0) &&
          <button className="btn danger" style={{ minHeight: 36, padding: '6px 12px', fontSize: 13, marginTop: 8 }} onClick={delPO}>🗑 Delete entire PO</button>}
      </div>

      <PoInfo po={po} profile={profile} refreshKey={insps.length + conts.length} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Wheel inspections</h2>
          <Link to={`/new?po=${encodeURIComponent(po)}`}><button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}>＋ Add SKU</button></Link>
        </div>
        {insps.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No wheel inspections yet.</p>}
        {insps.map(r => (
          <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Link to={`/inspection/${r.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{r.part_no}</Link>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Updated: {fmt(r.updated_at)}</div>
              </div>
              {canDelInsp(r) && <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delInsp(r)}>🗑</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Container loadings</h2>
          <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} disabled={busy} onClick={addContainer}>＋ Add container</button>
        </div>
        {conts.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No container loadings yet.</p>}
        {conts.map(c => (
          <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Link to={`/container/${c.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{c.container_no || '(no container no.)'}</Link>
                  <span className={`pill ${c.insp_status}`}>{c.insp_status}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Seal: {c.seal_no || '—'} · Status: {c.status} · Updated: {fmt(c.updated_at)}</div>
              </div>
              {canDelCont(c) && <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delCont(c)}>🗑</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: '0 0 10px' }}>Consolidated PO report</h2>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5 }}>One shareable report with a container-loading and wheel-inspection overview for this PO. Each row links out to its own interactive report.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to={`/po-report/${encodeURIComponent(po)}`} target="_blank">
            <button className="btn" style={{ minHeight: 40, padding: '6px 16px' }}>Open consolidated report</button>
          </Link>
          <button className="btn ghost" style={{ minHeight: 40, padding: '6px 16px' }} disabled={busy} onClick={emailPoReport}>✉ Email consolidated report</button>
        </div>
      </div>
      {emailOpen && <EmailModal title="Email consolidated PO report" sending={busy}
        onSend={doEmailPo} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}
