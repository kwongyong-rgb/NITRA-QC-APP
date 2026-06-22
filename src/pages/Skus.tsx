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

  const load = () => supabase.from('skus').select('*').order('part_no').then(({ data }) => setRows((data as Row[]) || []))
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.part_no) { alert('Part No. is required.'); return }
    const { error } = await supabase.from('skus').upsert(edit)
    if (error) { alert('Save failed: ' + error.message); return }
    setEdit(null); load()
  }

  // Excel import — header-aware. Recognises the master wheel-data file, the simple
  // order file, and common header variants, by matching normalised column names.
  const importXlsx = async (f: File) => {
    const wb = XLSX.read(await f.arrayBuffer())
    const ws = wb.Sheets[wb.SheetNames[0]]
    const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    const num = (v: unknown) => Number(String(v ?? '').replace(/[^\d.\-]/g, '')) || 0
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

    const out: Row[] = []
    for (const rec of recs) {
      // normalised-header -> value map for this row
      const m: Record<string, unknown> = {}
      for (const k of Object.keys(rec)) m[norm(k)] = rec[k]
      const pick = (...aliases: string[]) => { for (const a of aliases) if (m[a] != null && m[a] !== '') return m[a]; return '' }

      const hasNew = 'newpartnumber' in m
      const partNo = hasNew ? String(m['newpartnumber'] || '') : String(pick('partno', 'partnumber', 'part') || '')
      if (!partNo) continue

      // size: explicit "Size" string, else diameter + width columns
      let dia = 0, wid = 0
      const sizeStr = String(pick('size', 'wheelsize'))
      if (sizeStr) { const [a, b] = sizeStr.toLowerCase().replace(/\s/g, '').split('x'); dia = num(a); wid = num(b) }
      else { dia = num(pick('wheeldiameter')); wid = num(pick('wheelwidth')) }

      // pcd: explicit "PCD" string, else lug holes + bolt circle columns
      let holes = '', bcd = 0
      const pcdStr = String(pick('pcd'))
      if (pcdStr) { const [a, b] = pcdStr.toLowerCase().replace(/\s/g, '').split('x'); holes = a; bcd = num(b) }
      else { holes = String(pick('lugholes') || ''); bcd = num(pick('boltcirclemm')) }

      // drill (lug hole ∮ / counter-bore ∮) — master only
      const dm = String(pick('drillno') || '').match(/∮(\d+(?:\.\d+)?).*?∮(\d+(?:\.\d+)?)/)
      const lugHole = dm ? +dm[1] : 15, cBore = dm ? +dm[2] : 34

      const et = num(pick('offsetmm', 'et', 'offset'))

      // load: prefer explicit lbs column; else "Wheel Load" (kg→lb if it says kg)
      const loadLbsRaw = pick('loadratinglbs')
      const wheelLoad = String(pick('wheelload', 'load'))
      const maxLoadLbs = loadLbsRaw !== '' ? num(loadLbsRaw)
        : wheelLoad ? Math.round(/kg/i.test(wheelLoad) ? num(wheelLoad) / 0.45359237 : num(wheelLoad)) : 0

      // wheel weight: lbs column (→kg) or kg column
      const wWtLbs = pick('wheelweightlbs'), wWtKg = pick('wheelweightkg')
      const wheelWeightKg = wWtLbs !== '' ? Number((num(wWtLbs) * 0.45359237).toFixed(3))
        : wWtKg !== '' ? Number(num(wWtKg).toFixed(3)) : null

      out.push({
        part_no: partNo.trim().replace(/\s+/g, ' '),
        part_no_old: hasNew ? String(m['partnumber'] || '') : '',
        model: String(pick('stylename', 'model', 'style') || '').trim(),
        size: dia && wid ? `${dia}x${wid.toFixed(1)}` : sizeStr,
        diameter_in: dia,
        pcd: holes && bcd ? `${holes}x${bcd % 1 ? bcd.toFixed(1) : bcd}` : pcdStr,
        bolt_circle_mm: bcd,
        offset_txt: hasNew ? String(pick('offsetmm') || '') : (et ? `ET${et}` : ''),
        offset_mm: et,
        cb_mm: num(pick('productioncbmm', 'cb', 'cbmm')),
        lug_hole_mm: lugHole, counter_bore_mm: cBore,
        seat_thickness_mm: num(pick('lugseatthickness1mm', 'seatthickness')),
        lug_seat_type: String(pick('lugseat', 'seattype') || ''),
        finish: String(pick('factoryfinishname', 'color', 'colour', 'finish') || '').trim(),
        max_load_lbs: maxLoadLbs,
        brand_name: String(pick('brandname', 'brand') || '').trim(),
        factory: String(pick('factory', 'factoryname', 'plant') || '').trim(),
        upc_code: String(pick('upccode', 'upc') || ''),
        fitment: String(pick('fitment') || ''),
        active: true,
        wheel_weight_kg: wheelWeightKg,
        wheel_weight_tol_kg: 0.4,
        tpms_sensor_mm: String(pick('tpmssensormm', 'tpms') || '').trim().replace(/[xX]/g, '×'),
      })
    }

    if (out.length === 0) {
      setMsg('No SKUs recognised — the file needs at least a part-number column (e.g. "Part No." or "NEW_PART_NUMBER").')
      return
    }
    const { error } = await supabase.from('skus').upsert(out)
    setMsg(error ? error.message : `Imported ${out.length} SKUs ✓`)
    load()
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
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importXlsx(f) }} />
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
