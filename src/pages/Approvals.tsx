import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { openInspectionReport } from '../lib/report'

interface Row { id: string; part_no: string; po_no: string; lot_size: number; status: string; submitted_at: string; inspector_id: string }
interface CRow { id: string; po_no: string; container_no: string; seal_no: string; status: string; inspector_id: string }

export default function Approvals() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [crows, setCrows] = useState<CRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [cnote, setCnote] = useState<Record<string, string>>({})

  const load = async () => {
    const { data } = await supabase.from('inspections').select('*').eq('status', 'submitted').order('submitted_at')
    setRows((data as Row[]) || [])
    const { data: cd } = await supabase.from('container_loadings').select('id,po_no,container_no,seal_no,status,inspector_id').eq('insp_status', 'submitted').order('submitted_at')
    setCrows((cd as CRow[]) || [])
    const { data: ps } = await supabase.from('profiles').select('id, full_name')
    setNames(Object.fromEntries((ps || []).map(p => [p.id, p.full_name])))
  }
  useEffect(() => { load() }, [])

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('inspections').update({
      status, reviewed_at: new Date().toISOString(), reviewed_by: user?.id, review_note: note[id] || '',
    }).eq('id', id)
    if (status === 'approved') {
      // fire the report email (edge function); non-blocking
      supabase.functions.invoke('send-report', { body: { inspection_id: id } }).catch(() => {})
    }
    load()
  }

  const decideCont = async (id: string, status: 'approved' | 'rejected') => {
    if (!confirm(status === 'approved' ? 'Approve this container loading?' : 'Reject and send back to the inspector?')) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('container_loadings').update({
      insp_status: status, reviewed_at: new Date().toISOString(), reviewed_by: user?.id, review_note: cnote[id] || '',
    }).eq('id', id)
    load()
  }

  const emailContReport = async (id: string) => {
    const raw = window.prompt('Enter recipient email(s), comma-separated. Leave blank to use the saved distribution list.')
    if (raw === null) return
    const emails = raw.split(',').map(v => v.trim()).filter(Boolean)
    const { data, error } = await supabase.functions.invoke('send-container-report', { body: { container_loading_id: id, emails } })
    if (error) { alert('Email failed: ' + error.message); return }
    if (data?.ok === false) { alert('Email failed: ' + (data?.error || 'Unknown error')); return }
    alert('Container report email sent.')
  }



  const emailInteractiveReport = async (id: string) => {
    const raw = prompt('Enter recipient email(s), separated by commas. Leave blank to use the saved distribution list.')
    if (raw === null) return
    const emails = raw.split(',').map(v => v.trim()).filter(Boolean)
    const { data, error } = await supabase.functions.invoke('send-report', { body: { inspection_id: id, emails } })
    if (error) { alert('Email failed: ' + error.message); return }
    if (data?.ok === false) { alert('Email failed: ' + (data?.error || 'Unknown error')); return }
    alert('Interactive report email sent.\n\nReport link:\n' + (data?.report_url || ''))
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{t('approvals')}</h2>
        {rows.length === 0 && <p className="muted">—</p>}
        {rows.map(r => (
          <div key={r.id} className="card" style={{ background: '#F7F9FB' }}>
            <div className="row">
              <Link to={`/inspection/${r.id}`} style={{ fontWeight: 700, fontSize: 18 }}>{r.part_no}</Link>
              <span className="muted">PO {r.po_no} · lot {r.lot_size} · {names[r.inspector_id] || ''}</span>
            </div>
            <input className="txt" placeholder="Review note…" style={{ margin: '10px 0' }}
              value={note[r.id] || ''} onChange={e => setNote({ ...note, [r.id]: e.target.value })} />
            <div className="row">
              <button className="btn ok" onClick={() => decide(r.id, 'approved')}>{t('approve')}</button>
              <button className="btn danger" onClick={() => decide(r.id, 'rejected')}>{t('reject')}</button>
              <button className="btn ghost" onClick={() => openInspectionReport(r.id, lang)}>{t('pdfReport')}</button>
              <button className="btn ghost" onClick={() => emailInteractiveReport(r.id)}>Email Interactive Report</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Container loadings — sign-off</h2>
        {crows.length === 0 && <p className="muted">—</p>}
        {crows.map(c => (
          <div key={c.id} className="card" style={{ background: '#F7F9FB' }}>
            <div className="row">
              <Link to={`/container/${c.id}`} style={{ fontWeight: 700, fontSize: 18 }}>{c.container_no || '(no container no.)'}</Link>
              <span className="muted">PO {c.po_no || '—'} · seal {c.seal_no || '—'} · {names[c.inspector_id] || ''}</span>
            </div>
            <input className="txt" placeholder="Review note…" style={{ margin: '10px 0' }}
              value={cnote[c.id] || ''} onChange={e => setCnote({ ...cnote, [c.id]: e.target.value })} />
            <div className="row">
              <button className="btn ok" onClick={() => decideCont(c.id, 'approved')}>{t('approve')}</button>
              <button className="btn danger" onClick={() => decideCont(c.id, 'rejected')}>{t('reject')}</button>
              <button className="btn ghost" onClick={() => emailContReport(c.id)}>Email Container Report</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
