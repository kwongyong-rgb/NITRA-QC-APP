import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import type { Profile } from '../App'

interface Row {
  id: string; part_no: string; po_no: string; batch: string
  status: string; created_at: string; updated_at: string
  submitted_at: string | null; lot_size: number; inspector_id: string
}

function fmt(dt: string | null) {
  if (!dt) return '—'
  const d = new Date(dt)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function Home({ profile }: { profile: Profile }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = () =>
    supabase.from('inspections')
      .select('id,part_no,po_no,batch,status,created_at,updated_at,submitted_at,lot_size,inspector_id')
      .order('updated_at', { ascending: false }).limit(100)
      .then(({ data }) => setRows((data as Row[]) || []))

  useEffect(() => { load() }, [])

  const canDelete = (r: Row) => {
    if (profile.role === 'approver') return true
    return r.status === 'draft' && r.inspector_id === profile.id
  }

  const deleteInsp = async (id: string) => {
    if (!confirm('Delete this inspection? This cannot be undone.')) return
    setDeleting(id)
    const { error } = await supabase.from('inspections').delete().eq('id', id)
    setDeleting(null)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  return (
    <div className="page">
      <Link to="/new">
        <button className="btn" style={{ width: '100%', marginBottom: 16 }}>
          + {t('newInspection')}
        </button>
      </Link>
      <div className="card">
        <h2>{profile.role === 'approver' ? t('allInspections') : t('myInspections')}</h2>
        {rows.length === 0 && <p className="muted">No inspections yet.</p>}
        {rows.map(r => (
          <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <Link to={`/inspection/${r.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{r.part_no}</Link>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  PO: {r.po_no || '—'} · Batch: {r.batch || '—'} · Lot: {r.lot_size}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  {t('updated')}: {fmt(r.updated_at)}
                  {r.submitted_at && <> · {t('submitted')}: {fmt(r.submitted_at)}</>}
                </div>
              </div>
              {canDelete(r) && (
                <button
                  className="btn danger"
                  style={{ minHeight: 38, padding: '6px 12px', fontSize: 13 }}
                  disabled={deleting === r.id}
                  onClick={() => deleteInsp(r.id)}>
                  {deleting === r.id ? '…' : '🗑'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
