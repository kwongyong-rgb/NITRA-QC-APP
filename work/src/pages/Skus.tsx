import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import type { Sku } from '../lib/standard'

type Row = Sku & { part_no_old: string; upc_code: string; fitment: string; active: boolean; bolt_circle_mm: number; wheel_weight_kg: number|null; wheel_weight_tol_kg: number; tpms_sensor_mm: string }
const EMPTY: Row = { part_no: '', part_no_old: '', model: '', size: '', diameter_in: 18, pcd: '', bolt_circle_mm: 0, offset_txt: '', offset_mm: 0, cb_mm: 0, lug_hole_mm: 15, counter_bore_mm: 34, seat_thickness_mm: 9.5, lug_seat_type: '', finish: '', max_load_lbs: 0, upc_code: '', fitment: '', wheel_weight_kg: null, wheel_weight_tol_kg: 0.4, tpms_sensor_mm: '', active: true }

export default function Skus() {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [edit, setEdit] = useState<Row | null>(null)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => supabase.from('skus').select('*').order('part_no').then(({ data }) => setRows((data as Row[]) || []))
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.part_no) return
    await supabase.from('skus').upsert(edit)
    setEdit(null); load()
  }

  // Excel import — same columns as the master wheel data file
  const importXlsx = async (f: File) => {
    const wb = XLSX.read(await f.arrayBuffer())
    const ws = wb.Sheets[wb.SheetNames[0]]
    const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    const drill = (s: unknown) => {
      const m = String(s || '').match(/∮(\d+(?:\.\d+)?).*?∮(\d+(?:\.\d+)?)/)
      return m ? { lug: +m[1], cb: +m[2] } : { lug: 15, cb: 34 }
    }
    const out = recs.filter(r => r['NEW_PART_NUMBER']).map(r => {
      const d = drill(r['DRILL_NO'])
      const dia = Number(r['WHEEL_DIAMETER'] || 0), wid = Number(r['WHEEL_WIDTH'] || 0)
      const bcd = Number(r['BOLT_CIRCLE_MM'] || 0)
      return {
        part_no: String(r['NEW_PART_NUMBER']), part_no_old: String(r['PART_NUMBER'] || ''),
        model: String(r['STYLE_NAME'] || ''), size: `${dia}x${wid.toFixed(1)}`, diameter_in: dia,
        pcd: `${r['LUG_HOLES']}x${bcd % 1 ? bcd.toFixed(1) : bcd}`, bolt_circle_mm: bcd,
        offset_txt: String(r['OFFSET_MM'] || ''), offset_mm: Number(String(r['OFFSET_MM'] || '0').replace('+', '')),
        cb_mm: Number(r['PRODUCTION_CB_MM'] || 0), lug_hole_mm: d.lug, counter_bore_mm: d.cb,
        seat_thickness_mm: Number(r['LUG_SEAT_THICKNESS_1_MM'] || 0), lug_seat_type: String(r['LUG_SEAT'] || ''),
        finish: String(r['FACTORY_FINISH_NAME'] || ''), max_load_lbs: Number(r['LOAD_RATING_LBS'] || 0),
        upc_code: String(r['UPC_CODE'] || ''), fitment: String(r['FITMENT'] || ''), active: true,
        // File stores weight in lbs (col WHEEL_WEIGHT_LBS); app stores & shows kg.
        wheel_weight_kg: r['WHEEL_WEIGHT_LBS'] != null && r['WHEEL_WEIGHT_LBS'] !== ''
          ? Number((Number(r['WHEEL_WEIGHT_LBS']) * 0.45359237).toFixed(3)) : null,
        wheel_weight_tol_kg: 0.4,
        tpms_sensor_mm: String(r['TPMS_SENSOR_MM'] || '').trim().replace(/[xX]/g, '×'),
      }
    })
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
          <thead><tr><th>Part No.</th><th>Model</th><th>Size</th><th>PCD</th><th>ET</th><th>CB</th><th>Finish</th><th>Wt(kg)</th><th>TPMS</th><th /></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.part_no}>
                <td>{r.part_no}</td><td>{r.model}</td><td>{r.size}</td><td>{r.pcd}</td>
                <td>{r.offset_txt}</td><td>{r.cb_mm}</td><td>{r.finish}</td>
                <td>{r.wheel_weight_kg ?? '—'}</td><td>{r.tpms_sensor_mm || '—'}</td>
                <td><button className="btn ghost" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => setEdit(r)}>✎</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="card" style={{ border: '2px solid var(--navy)' }}>
          <h2>{edit.part_no || 'New SKU'}</h2>
          <div className="grid2">
            {F('part_no', 'Part No.')}{F('model', 'Model')}{F('size', 'Size (e.g. 18x8.0)')}
            {F('diameter_in', 'Diameter (in)', 'number')}{F('pcd', 'PCD (e.g. 5x114.3)')}
            {F('offset_txt', 'Offset text (e.g. +40)')}{F('offset_mm', 'Offset mm', 'number')}
            {F('cb_mm', 'CB mm', 'number')}{F('lug_hole_mm', 'Lug hole mm', 'number')}
            {F('counter_bore_mm', 'Counter bore mm', 'number')}{F('seat_thickness_mm', 'Seat thickness mm', 'number')}
            {F('lug_seat_type', 'Lug seat type')}{F('finish', 'Finish')}
            {F('max_load_lbs', 'Max load lbs', 'number')}{F('upc_code', 'UPC')}{F('fitment', 'Fitment')}
            {F('wheel_weight_kg', 'Wheel weight (kg)', 'number')}{F('wheel_weight_tol_kg', 'Weight tol ± (kg)', 'number')}
            {F('tpms_sensor_mm', 'TPMS sensor (mm)')}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={save}>{t('save')}</button>
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
