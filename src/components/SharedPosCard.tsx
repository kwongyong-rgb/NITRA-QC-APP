import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '../lib/i18n'
import { posForInspection, posOrderingPart, allPoNos, attachToPo, detachFromPo, type PoLink } from '../lib/inspectionPos'
import type { Profile } from '../App'

// Inspection-side: manage which POs this SKU inspection covers. Eligible POs are
// those that ordered this part number; the off-PO toggle offers all others and
// attaches them with the off_po flag.
export default function SharedPosCard({ inspId, partNo, profile }: {
  inspId: string; partNo: string; profile: Profile
}) {
  const { t } = useI18n()
  const [links, setLinks] = useState<PoLink[]>([])
  const [options, setOptions] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [showOff, setShowOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const cur = await posForInspection(inspId)
    setLinks(cur)
    const linkedNos = cur.map(l => l.po_no)
    const opts = showOff ? await allPoNos(linkedNos) : await posOrderingPart(partNo, linkedNos)
    setOptions(opts)
    setPick('')
  }, [inspId, partNo, showOff])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!pick) return
    setBusy(true); setMsg('')
    // off-PO if the chosen PO does not order this part (only possible via the toggle)
    const eligible = await posOrderingPart(partNo)
    const offPo = !eligible.includes(pick)
    const { error } = await attachToPo(inspId, pick, offPo, profile.id)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    load()
  }

  const remove = async (po: string) => {
    setBusy(true); setMsg('')
    const { error } = await detachFromPo(inspId, po)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    load()
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2 style={{ margin: '0 0 4px' }}>{t('sharedWithPos')}</h2>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>{t('sharedHint')}</p>

      {links.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noPosLinked')}</p>}
      {links.map(l => (
        <div key={l.po_no} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 600 }}>
            {l.po_no}
            {l.off_po && <span className="pill" style={{ marginLeft: 6, background: 'var(--amber-bg)', color: 'var(--amber)' }}>⚠ {t('offPo')}</span>}
          </div>
          <button className="btn ghost" style={{ minHeight: 32, padding: '3px 12px', fontSize: 13 }} disabled={busy} onClick={() => remove(l.po_no)}>{t('remove')}</button>
        </div>
      ))}

      <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
        <select className="txt" value={pick} onChange={e => setPick(e.target.value)} style={{ flex: 1, minHeight: 40 }}>
          <option value="">{t('addToPo')}…</option>
          {options.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn" style={{ minHeight: 40, padding: '4px 16px' }} disabled={!pick || busy} onClick={add}>＋</button>
      </div>
      <label className="row" style={{ gap: 8, fontSize: 13, marginTop: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} style={{ width: 18, height: 18 }} />
        {t('showOffPo')}
      </label>
      {msg && <p style={{ color: 'var(--fail)', fontSize: 13 }}>{msg}</p>}
    </div>
  )
}
