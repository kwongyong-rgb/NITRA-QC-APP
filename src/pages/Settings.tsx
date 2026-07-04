import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function Settings() {
  const { t } = useI18n()
  const [samp, setSamp] = useState({ app_base: 8, app_inc: 4, fun_base: 4, fun_inc: 2, extra_on_defect: 4 })
  const [pf, setPf] = useState({ trigger_rate: 0.10 })
  const [emails, setEmails] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('key, value').then(({ data }) => {
      for (const row of data || []) {
        if (row.key === 'sampling') setSamp(row.value)
        if (row.key === 'passfail') setPf(row.value)
        if (row.key === 'distribution') setEmails((row.value.emails || []).join(', '))
      }
    })
  }, [])

  const save = async () => {
    await supabase.from('settings').upsert([
      { key: 'sampling', value: samp },
      { key: 'passfail', value: pf },
      { key: 'distribution', value: { emails: emails.split(',').map(s => s.trim()).filter(Boolean) } },
    ])
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  const num = (v: string) => (v === '' ? 0 : +v)

  return (
    <div className="page">
      <div className="card">
        <h2>{t('settings')} — Sampling</h2>
        <div className="grid2">
          <label className="fld"><span>Appearance base (per ≤100)</span>
            <input className="txt" type="number" value={samp.app_base} onChange={e => setSamp({ ...samp, app_base: num(e.target.value) })} /></label>
          <label className="fld"><span>Appearance increment (per +100)</span>
            <input className="txt" type="number" value={samp.app_inc} onChange={e => setSamp({ ...samp, app_inc: num(e.target.value) })} /></label>
          <label className="fld"><span>Functional base (per ≤100)</span>
            <input className="txt" type="number" value={samp.fun_base} onChange={e => setSamp({ ...samp, fun_base: num(e.target.value) })} /></label>
          <label className="fld"><span>Functional increment (per +100)</span>
            <input className="txt" type="number" value={samp.fun_inc} onChange={e => setSamp({ ...samp, fun_inc: num(e.target.value) })} /></label>
          <label className="fld"><span>Extra pieces on defect</span>
            <input className="txt" type="number" value={samp.extra_on_defect} onChange={e => setSamp({ ...samp, extra_on_defect: num(e.target.value) })} /></label>

        </div>
      </div>
      <div className="card">
        <h2>Report distribution list</h2>
        <label className="fld"><span>Emails (comma-separated)</span>
          <input className="txt" value={emails} onChange={e => setEmails(e.target.value)} placeholder="kwong@nitrawheels.com, client@example.com" /></label>
      </div>
      <button className="btn" onClick={save}>{saved ? '✓' : t('save')}</button>
    </div>
  )
}
