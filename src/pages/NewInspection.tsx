import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { sampleSizes, type SamplingSettings } from '../lib/rules'
import type { Sku } from '../lib/standard'
import type { Profile } from '../App'

export default function NewInspection({ profile }: { profile: Profile }) {
  const { t } = useI18n()
  const nav = useNavigate()
  const [skus, setSkus] = useState<Sku[]>([])
  const [samp, setSamp] = useState<SamplingSettings | null>(null)
  const [search, setSearch] = useState('')
  const [partNo, setPartNo] = useState('')
  const [po, setPo] = useState('')
  const [batch, setBatch] = useState('')
  const [lot, setLot] = useState(100)
  const [busy, setBusy] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('skus').select('*').eq('active', true).order('part_no')
      .then(({ data }) => setSkus((data as Sku[]) || []))
    supabase.from('settings').select('value').eq('key', 'sampling').single()
      .then(({ data }) => setSamp(data?.value as SamplingSettings))
  }, [])

  // Close the SKU dropdown when clicking anywhere outside it
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const sku = useMemo(() => skus.find(s => s.part_no === partNo), [skus, partNo])
  const selectedLabel = sku ? `${sku.part_no} — ${sku.model} ${sku.size}` : ''
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return skus
    // When a SKU is already selected and its label fills the box, show the full
    // list rather than filtering the combined label string down to "No matches".
    if (sku && search === selectedLabel) return skus
    return skus.filter(s => s.part_no.toLowerCase().includes(q) || s.model.toLowerCase().includes(q) || s.size.includes(q))
  }, [skus, search, sku, selectedLabel])

  const sizes = useMemo(() => samp ? sampleSizes(lot, samp) : { app: 0, fun: 0 }, [lot, samp])

  const select = (pn: string) => {
    setPartNo(pn)
    const s = skus.find(x => x.part_no === pn)
    setSearch(s ? `${pn} — ${s.model} ${s.size}` : pn)
    setShowDropdown(false)
  }

  const start = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('inspections').insert({
      part_no: partNo, po_no: po, batch, lot_size: lot,
      app_sample: sizes.app, fun_sample: sizes.fun,
      inspector_id: profile.id,
      form_data: { results: {}, extra_results: {}, meas_results: {}, meas_extra_results: {}, pallet: {}, na_overrides: {} },
    }).select('id').single()
    setBusy(false)
    if (error) { alert('Could not start inspection / 无法开始检验:\n\n' + error.message); return }
    if (data) nav(`/inspection/${data.id}`)
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{t('newInspection')}</h2>
        <div className="grid2">
          {/* Searchable Part No. */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="fld"><span>{t('partNo')}</span>
              <div ref={boxRef} style={{ position: 'relative' }}>
                <input className="txt" value={search}
                  onChange={e => { setSearch(e.target.value); setPartNo(''); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Type to search or scroll…" />
                {showDropdown && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff',
                    border:'1.5px solid var(--navy)', borderRadius:8, zIndex:100,
                    maxHeight:260, overflowY:'auto', boxShadow:'0 4px 20px rgba(0,0,0,.15)' }}>
                    {filtered.length === 0 && <div className="muted" style={{ padding:12 }}>No matches</div>}
                    {filtered.map(s => (
                      <div key={s.part_no} style={{ padding:'10px 14px', cursor:'pointer', borderBottom:'1px solid var(--line)',
                        background: s.part_no === partNo ? 'var(--steel)' : '#fff' }}
                        onClick={() => select(s.part_no)}>
                        <div style={{ fontWeight:600 }}>{s.part_no}</div>
                        <div className="muted" style={{ fontSize:13 }}>{s.model} · {s.size} · {s.finish}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </label>
          </div>
          <label className="fld"><span>{t('poNo')}</span>
            <input className="txt" value={po} onChange={e => setPo(e.target.value)} />
          </label>
          <label className="fld"><span>{t('batch')}</span>
            <input className="txt" value={batch} onChange={e => setBatch(e.target.value)} />
          </label>
          <label className="fld"><span>{t('lotSize')}</span>
            <input className="txt" type="number" min={1} value={lot} onChange={e => setLot(+e.target.value)} />
          </label>
        </div>
        {sku && (
          <div className="banner ok" style={{ marginTop:14 }}>
            {sku.model} · {sku.size} · PCD {sku.pcd} · ET {sku.offset_txt} · CB {sku.cb_mm} · {sku.finish}
            {sku.wheel_weight_kg && <> · {sku.wheel_weight_kg.toFixed(2)} kg</>}
            {sku.tpms_sensor_mm && <> · TPMS: {sku.tpms_sensor_mm}</>}
          </div>
        )}
        <div className="row" style={{ marginTop:12 }}>
          <div className="card" style={{ flex:1, marginBottom:0, textAlign:'center' }}>
            <div className="muted">{t('appSample')}</div>
            <div style={{ fontSize:34, fontFamily:'var(--display)', fontWeight:700, color:'var(--navy)' }}>{sizes.app}</div>
          </div>
          <div className="card" style={{ flex:1, marginBottom:0, textAlign:'center' }}>
            <div className="muted">{t('funSample')}</div>
            <div style={{ fontSize:34, fontFamily:'var(--display)', fontWeight:700, color:'var(--navy)' }}>{sizes.fun}</div>
          </div>
        </div>
        <button className="btn" style={{ width:'100%', marginTop:16 }}
          disabled={!partNo || !lot || busy} onClick={start}>
          {t('start')}
        </button>
      </div>
    </div>
  )
}
