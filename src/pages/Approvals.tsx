import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { openInspectionReport } from '../lib/report'

interface Row { id: string; part_no: string; po_no: string; lot_size: number; status: string; submitted_at: string; inspector_id: string }

export default function Approvals() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})

  const load = async () => {
    const { data } = await supabase.from('inspections').select('*').eq('status', 'submitted').order('submitted_at')
    setRows((data as Row[]) || [])
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
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
