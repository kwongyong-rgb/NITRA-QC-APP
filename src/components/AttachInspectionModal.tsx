import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { linkedInspectionIds, attachToPo } from '../lib/inspectionPos'
import type { Profile } from '../App'

interface Cand { id: string; part_no: string; batch: string | null; lot_size: number | null; updated_at: string }

// PO-side: attach an existing approved inspection to this PO. Eligible = a SKU
// this PO ordered; the "show off-PO" toggle reveals others and attaches them
// with the off_po flag set.
export default function AttachInspectionModal({ po, profile, onClose, onAttached }: {
  po: string; profile: Profile; onClose: () => void; onAttached: () => void
}) {
  const { t } = useI18n()
  const [cands, setCands] = useState<Cand[]>([])
  const [orderedParts, setOrderedParts] = useState<Set<string>>(new Set())
  const [linked, setLinked] = useState<Set<string>>(new Set())
  const [showOff, setShowOff] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data: posRow } = await supabase.from('pos').select('id').eq('po_no', po).maybeSingle()
    const pid = (posRow as { id: string } | null)?.id
    let parts = new Set<string>()
    if (pid) {
      const { data: items } = await supabase.from('po_items').select('part_no').eq('po_id', pid)
      parts = new Set(((items as { part_no: string }[]) || []).map(i => i.part_no))
    }
    setOrderedParts(parts)
    const { ids } = await linkedInspectionIds(po)
    setLinked(new Set(ids))
    const { data: appr } = await supabase.from('inspections')
      .select('id,part_no,batch,lot_size,updated_at').eq('status', 'approved').order('part_no')
    setCands((appr as Cand[]) || [])
  }, [po])
  useEffect(() => { load() }, [load])

  const attach = async (c: Cand) => {
    const onPo = orderedParts.has(c.part_no)
    setBusy(c.id); setMsg('')
    const { error } = await attachToPo(c.id, po, !onPo, profile.id)
    setBusy('')
    if (error) { setMsg(error.message); return }
    setLinked(prev => new Set(prev).add(c.id))
    onAttached()
  }

  const visible = cands.filter(c => !linked.has(c.id) && (showOff || orderedParts.has(c.part_no)))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, 94vw)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{t('attachInspection')}</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{t('attachHint')}</p>
        <label className="row" style={{ gap: 8, fontSize: 13, marginBottom: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} style={{ width: 18, height: 18 }} />
          {t('showOffPo')}
        </label>
        {visible.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noAttachCandidates')}</p>}
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {visible.map(c => {
            const onPo = orderedParts.has(c.part_no)
            return (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    {c.part_no}
                    {!onPo && <span className="pill" style={{ marginLeft: 6, background: 'var(--amber-bg)', color: 'var(--amber)' }}>⚠ {t('offPo')}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{t('batch')}: {c.batch || '—'} · {t('lotSize')}: {c.lot_size ?? '—'}</div>
                </div>
                <button className="btn" style={{ minHeight: 34, padding: '4px 14px', fontSize: 13 }} disabled={busy === c.id} onClick={() => attach(c)}>
                  {busy === c.id ? '…' : t('attach')}
                </button>
              </div>
            )
          })}
        </div>
        {msg && <p style={{ color: 'var(--fail)', fontSize: 13 }}>{msg}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn ghost" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}
