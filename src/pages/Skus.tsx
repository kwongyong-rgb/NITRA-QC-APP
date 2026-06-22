import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import type { Sku } from '../lib/standard'

type Row = Sku & { part_no_old: string; upc_code: string; fitment: string; active: boolean; bolt_circle_mm: number; wheel_weight_kg: number|null; wheel_weight_tol_kg: number; tpms_sensor_mm: string }
const EMPTY: Row = { part_no: '', part_no_old: '', model: '', size: '', diameter_in: 18, pcd: '', bolt_circle_mm: 0, offset_txt: '', offset_mm: 0, cb_mm: 0, lug_hole_mm: 15, counter_bore_mm: 34, seat_thickness_mm: 9.5, lug_seat_type: '', finish: '', max_load_lbs: 0, brand_name: '', factory: '', upc_code: '', fitment: '', wheel_weight_kg: null, wheel_weight_tol_kg: 0.4, tpms_sensor_mm: '', active: true }

export default function Skus() {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [edit, setEdit] = useState<Row | null>(null)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ newRows: Row[]; updateRows: Partial<Row>[]; news: string[]; updates: string[]; backup: Row[] } | null>(null)
  const [canUndo, setCanUndo] = useState(false)

  useEffect(() => { try { setCanUndo(!!localStorage.getItem('sku_import_backup')) } catch { /* ignore */ } }, [])

  const load = () => supabase.from('skus').select('*').order('part_no').then(({ data }) => setRows((data as Row[]) || []))
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.part_no) { alert('Part No. is required.'); return }
    const { error } = await supabase.from('skus').upsert(edit)
    if (error) { alert('Save failed: ' + error.message); return }
    setEdit(null); load()
  }

  // Excel import — header-aware. Parses the file, then shows a confirm preview.
  // On existing SKUs only the columns present in the file are changed (merge),
  // so e.g. adding just Brand/Factory won't blank the rest. A backup is kept so
  // the last import can be undone.
  const importXlsx = async (f: File) => {
    const wb = XLSX.read(await f.arrayBuffer())
    const ws = wb.Sheets[wb.SheetNames[0]]
    const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    const num = (v: unknown) => Number(String(v ?? '').replace(/[^\d.\-]/g, '')) || 0
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

    const present = new Set<string>()
    for (const rec of recs) for (const k of Object.keys(rec)) present.add(norm(k))
    const has = (...al: string[]) => al.some(a => present.has(a))

    const existing = new Map(rows.map(r => [r.part_no, r]))
    const newRows: Row[] = [], updateRows: Partial<Row>[] = []
    const news: string[] = [], updates: string[] = [], backup: Row[] = []

    for (const rec of recs) {
      const m: Record<string, unknown> = {}
      for (const k of Object.keys(rec)) m[norm(k)] = rec[k]
      const pick = (...al: string[]) => { for (const a of al) if (m[a] != null && m[a] !== '') return m[a]; return '' }

      const hasNew = 'newpartnumber' in m
      const partNo = (hasNew ? String(m['newpartnumber'] || '') : String(pick('partno', 'partnumber', 'part') || '')).trim().replace(/\s+/g, ' ')
      if (!partNo) continue

      let dia = 0, wid = 0
      const sizeStr = String(pick('size', 'wheelsize'))
      if (sizeStr) { const [a, b] = sizeStr.toLowerCase().replace(/\s/g, '').split('x'); dia = num(a); wid = num(b) }
      else { dia = num(pick('wheeldiameter')); wid = num(pick('wheelwidth')) }
      let holes = '', bcd = 0
      const pcdStr = String(pick('pcd'))
      if (pcdStr) { const [a, b] = pcdStr.toLowerCase().replace(/\s/g, '').split('x'); holes = a; bcd = num(b) }
      else { holes = String(pick('lugholes') || ''); bcd = num(pick('boltcirclemm')) }
      const dm = String(pick('drillno') || '').match(/∮(\d+(?:\.\d+)?).*?∮(\d+(?:\.\d+)?)/)
      const et = num(pick('offsetmm', 'et', 'offset'))
      const wheelLoad = String(pick('wheelload', 'load'))
      const maxLoadLbs = pick('loadratinglbs') !== '' ? num(pick('loadratinglbs'))
        : wheelLoad ? Math.round(/kg/i.test(wheelLoad) ? num(wheelLoad) / 0.45359237 : num(wheelLoad)) : 0
      const wWtLbs = pick('wheelweightlbs'), wWtKg = pick('wheelweightkg')
      const wheelWeightKg = wWtLbs !== '' ? Number((num(wWtLbs) * 0.45359237).toFixed(3))
        : wWtKg !== '' ? Number(num(wWtKg).toFixed(3)) : null

      // Only include fields whose source column is actually in the file
      const fields: Partial<Row> = {}
      if (has('stylename', 'model', 'style')) fields.model = String(pick('stylename', 'model', 'style')).trim()
      if (sizeStr || has('wheeldiameter')) { fields.size = dia && wid ? `${dia}x${wid.toFixed(1)}` : sizeStr; fields.diameter_in = dia }
      if (pcdStr || has('lugholes', 'boltcirclemm')) { fields.pcd = holes && bcd ? `${holes}x${bcd % 1 ? bcd.toFixed(1) : bcd}` : pcdStr; fields.bolt_circle_mm = bcd }
      if (has('offsetmm', 'et', 'offset')) { fields.offset_mm = et; fields.offset_txt = hasNew ? String(pick('offsetmm') || '') : (et ? `ET${et}` : '') }
      if (has('productioncbmm', 'cb', 'cbmm')) fields.cb_mm = num(pick('productioncbmm', 'cb', 'cbmm'))
      if (has('factoryfinishname', 'color', 'colour', 'finish')) fields.finish = String(pick('factoryfinishname', 'color', 'colour', 'finish')).trim()
      if (has('loadratinglbs', 'wheelload', 'load')) fields.max_load_lbs = maxLoadLbs
      if (has('brandname', 'brand')) fields.brand_name = String(pick('brandname', 'brand')).trim()
      if (has('factory', 'factoryname', 'plant')) fields.factory = String(pick('factory', 'factoryname', 'plant')).trim()
      if (has('wheelweightlbs', 'wheelweightkg')) fields.wheel_weight_kg = wheelWeightKg
      if (has('tpmssensormm', 'tpms')) fields.tpms_sensor_mm = String(pick('tpmssensormm', 'tpms')).trim().replace(/[xX]/g, '×')
      if (dm) { fields.lug_hole_mm = +dm[1]; fields.counter_bore_mm = +dm[2] }
      if (has('lugseatthickness1mm', 'seatthickness')) fields.seat_thickness_mm = num(pick('lugseatthickness1mm', 'seatthickness'))
      if (has('lugseat', 'seattype')) fields.lug_seat_type = String(pick('lugseat', 'seattype') || '')
      if (has('upccode', 'upc')) fields.upc_code = String(pick('upccode', 'upc') || '')
      if (has('fitment')) fields.fitment = String(pick('fitment') || '')
      if (hasNew) fields.part_no_old = String(m['partnumber'] || '')

      const ex = existing.get(partNo)
      if (ex) { updateRows.push({ part_no: partNo, ...fields }); updates.push(partNo); backup.push(ex) }
      else { newRows.push({ ...EMPTY, part_no: partNo, ...fields, active: true }); news.push(partNo) }
    }

    if (!newRows.length && !updateRows.length) { setMsg('No SKUs recognised — the file needs at least a part-number column (e.g. "Part No." or "NEW_PART_NUMBER").'); return }
    setMsg('')
    setPending({ newRows, updateRows, news, updates, backup })
  }

  const confirmImport = async () => {
    if (!pending) return
    const { newRows, updateRows, news, backup } = pending
    let error = null
    if (newRows.length) { const r = await supabase.from('skus').upsert(newRows); error = error || r.error }
    if (updateRows.length) { const r = await supabase.from('skus').upsert(updateRows); error = error || r.error }
    if (error) { setMsg('Import failed: ' + error.message); setPending(null); return }
    try { localStorage.setItem('sku_import_backup', JSON.stringify({ backup, news, at: Date.now() })); setCanUndo(true) } catch { /* ignore */ }
    setMsg(`Imported ✓ — ${updateRows.length} updated, ${newRows.length} new`)
    setPending(null); load()
  }

  const undoImport = async () => {
    let saved: { backup: Row[]; news: string[] } | null = null
    try { const s = localStorage.getItem('sku_import_backup'); if (s) saved = JSON.parse(s) } catch { /* ignore */ }
    if (!saved) { setMsg('Nothing to undo.'); setCanUndo(false); return }
    if (!confirm(`Undo the last import?\n\nThis restores ${saved.backup.length} SKU(s) to their values before the import and removes ${saved.news.length} SKU(s) the import added.`)) return
    let error = null
    if (saved.backup.length) { const r = await supabase.from('skus').upsert(saved.backup); error = error || r.error }
    if (saved.news.length) { const r = await supabase.from('skus').delete().in('part_no', saved.news); error = error || r.error }
    if (error) { setMsg('Undo failed: ' + error.message); return }
    try { localStorage.removeItem('sku_import_backup') } catch { /* ignore */ }
    setCanUndo(false); setMsg('Reverted to the values before the last import.'); load()
  }

  const F = (k: keyof Row, label: string, type = 'text') => (
    <label className="fld"><span>{label}</span>
      <input className="txt" type={type} value={String(edit?.[k] ?? '')}
        onChange={e => setEdit({ ...edit!, [k]: type === 'number' ? +e.target.value : e.target.value })} />
    </label>
  )

  return (
    <div className="page">
      <div className="card">
        <h2>{t('skus')} ({rows.length})</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Add SKU</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Import Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = '' }} />
          {canUndo && <button className="btn ghost" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }} onClick={undoImport}>↶ Undo last import</button>}
          {msg && <span className="muted">{msg}</span>}
        </div>
        <table className="tbl">
          <thead><tr><th>Part No.</th><th>Brand</th><th>Factory</th><th>Model</th><th>Size</th><th>PCD</th><th>ET</th><th>CB</th><th>Finish</th><th>Wt(kg)</th><th>TPMS</th><th /></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.part_no}>
                <td>{r.part_no}</td><td>{r.brand_name || '—'}</td><td>{r.factory || '—'}</td><td>{r.model}</td><td>{r.size}</td><td>{r.pcd}</td>
                <td>{r.offset_txt}</td><td>{r.cb_mm}</td><td>{r.finish}</td>
                <td>{r.wheel_weight_kg ?? '—'}</td><td>{r.tpms_sensor_mm || '—'}</td>
                <td><button className="btn ghost" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => setEdit(r)}>✎</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending && (
        <div className="modal-overlay" onClick={() => setPending(null)}>
          <div className="modal" style={{ width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Confirm import</h2>
            <p style={{ fontSize: 15 }}>
              <b>{pending.updates.length}</b> existing SKU(s) will be updated · <b>{pending.news.length}</b> new SKU(s) will be added.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              On existing SKUs, only the columns present in your file change — everything else is kept. Part numbers must match exactly to count as “existing” (mind spaces vs dashes).
            </p>
            {pending.updates.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Will update ({pending.updates.length}):</div>
                <div className="muted" style={{ fontSize: 12, maxHeight: 110, overflowY: 'auto' }}>{pending.updates.join(', ')}</div>
              </div>
            )}
            {pending.news.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--navy)' }}>Will add as new ({pending.news.length}):</div>
                <div className="muted" style={{ fontSize: 12, maxHeight: 110, overflowY: 'auto' }}>{pending.news.join(', ')}</div>
              </div>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" onClick={confirmImport}>Confirm import</button>
              <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {edit && (
        <div className="modal-overlay" onClick={() => setEdit(null)}>
          <div className="modal" style={{ width: 'min(680px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{edit.part_no || 'New SKU'}</h2>
              <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => setEdit(null)}>✕</button>
            </div>
            <div className="grid2">
              {F('part_no', 'Part No.')}{F('model', 'Model')}{F('size', 'Size (e.g. 18x8.0)')}
              {F('diameter_in', 'Diameter (in)', 'number')}{F('pcd', 'PCD (e.g. 5x114.3)')}
              {F('offset_txt', 'Offset text (e.g. +40)')}{F('offset_mm', 'Offset mm', 'number')}
              {F('cb_mm', 'CB mm', 'number')}{F('lug_hole_mm', 'Lug hole mm', 'number')}
              {F('counter_bore_mm', 'Counter bore mm', 'number')}{F('seat_thickness_mm', 'Seat thickness mm', 'number')}
              {F('lug_seat_type', 'Lug seat type')}{F('finish', 'Finish')}
              {F('brand_name', 'Brand Name')}{F('factory', 'Factory')}
              {F('max_load_lbs', 'Max load lbs', 'number')}{F('upc_code', 'UPC')}{F('fitment', 'Fitment')}
              {F('wheel_weight_kg', 'Wheel weight (kg)', 'number')}{F('wheel_weight_tol_kg', 'Weight tol ± (kg)', 'number')}
              {F('tpms_sensor_mm', 'TPMS sensor (mm)')}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" onClick={save}>{t('save')}</button>
              <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
