import { useEffect, useMemo, useState } from 'react'
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
  const [partNo, setPartNo] = useState('')
  const [po, setPo] = useState('')
  const [batch, setBatch] = useState('')
  const [lot, setLot] = useState(100)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('skus').select('*').eq('active', true).order('part_no')
      .then(({ data }) => setSkus((data as Sku[]) || []))
    supabase.from('settings').select('value').eq('key', 'sampling').single()
      .then(({ data }) => setSamp(data?.value as SamplingSettings))
  }, [])

  const sku = useMemo(() => skus.find(s => s.part_no === partNo), [skus, partNo])
  const sizes = useMemo(() => samp ? sampleSizes(lot, samp) : { app: 0, fun: 0 }, [lot, samp])

  const start = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('inspections').insert({
      part_no: partNo, po_no: po, batch, lot_size: lot,
      app_sample: sizes.app, fun_sample: sizes.fun,
      inspector_id: profile.id,
      form_data: { results: {}, extra_results: {}, meas_results: {}, meas_extra_results: {}, pallet: {} },
    }).select('id').single()
    setBusy(false)
    if (!error && data) nav(`/inspection/${data.id}`)
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{t('newInspection')}</h2>
        <div className="grid2">
          <label className="fld"><span>{t('partNo')}</span>
            <select className="sel" value={partNo} onChange={e => setPartNo(e.target.value)}>
              <option value="">—</option>
              {skus.map(s => <option key={s.part_no} value={s.part_no}>{s.part_no} — {s.model} {s.size}</option>)}
            </select>
          </label>
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
          <div className="banner ok" style={{ marginTop: 14 }}>
            {sku.model} · {sku.size} · PCD {sku.pcd} · ET {sku.offset_txt} · CB {sku.cb_mm} · {sku.finish}
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <div className="card" style={{ flex: 1, marginBottom: 0, textAlign: 'center' }}>
            <div className="muted">{t('appSample')}</div>
            <div style={{ fontSize: 34, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--navy)' }}>{sizes.app}</div>
          </div>
          <div className="card" style={{ flex: 1, marginBottom: 0, textAlign: 'center' }}>
            <div className="muted">{t('funSample')}</div>
            <div style={{ fontSize: 34, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--navy)' }}>{sizes.fun}</div>
          </div>
        </div>
        <button className="btn" style={{ width: '100%', marginTop: 16 }} disabled={!partNo || !lot || busy} onClick={start}>
          {t('start')}
        </button>
      </div>
    </div>
  )
}
