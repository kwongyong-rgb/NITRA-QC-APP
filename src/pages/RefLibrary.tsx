import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import Camera, { photoUrl } from '../components/Camera'
import type { Profile } from '../App'

interface Ref { id: string; storage_path: string; caption: string; ref_category: string }
const CATS = ['porosity', 'paint_inclusion', 'scratch', 'hat_marks', 'coating', 'marking', 'packing', 'not_a_defect']

export default function RefLibrary({ profile }: { profile: Profile }) {
  const { t } = useI18n()
  const [refs, setRefs] = useState<Ref[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [cat, setCat] = useState('porosity')
  const [caption, setCaption] = useState('')

  const load = () => supabase.from('photos').select('*').eq('is_reference', true).order('ref_category')
    .then(({ data }) => setRefs((data as Ref[]) || []))
  useEffect(() => { load() }, [])
  useEffect(() => {
    refs.forEach(async r => {
      if (!urls[r.storage_path]) setUrls(prev => ({ ...prev }))
      const u = await photoUrl(r.storage_path)
      setUrls(prev => ({ ...prev, [r.storage_path]: u }))
    })
  }, [refs]) // eslint-disable-line

  return (
    <div className="page">
      <div className="card">
        <h2>{t('refLibrary')}</h2>
        <p className="muted">What counts as a defect vs acceptable — tap a category.</p>
        <div className="tabs" style={{ position: 'static' }}>
          {CATS.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c.replace('_', ' ')}</button>)}
        </div>
        <div className="row">
          {refs.filter(r => r.ref_category === cat).map(r => (
            <figure key={r.id} style={{ margin: 0 }}>
              {urls[r.storage_path] && <img src={urls[r.storage_path]} style={{ width: 200, borderRadius: 10, border: '1px solid var(--line)' }} />}
              <figcaption className="muted" style={{ maxWidth: 200 }}>{r.caption}</figcaption>
            </figure>
          ))}
          {refs.filter(r => r.ref_category === cat).length === 0 && <p className="muted">No reference photos yet.</p>}
        </div>
        {profile.role === 'approver' && (
          <div className="row" style={{ marginTop: 16 }}>
            <input className="txt" style={{ flex: 1 }} placeholder="Caption…" value={caption} onChange={e => setCaption(e.target.value)} />
            <Camera label={t('takePhoto')} onUploaded={async path => {
              await supabase.from('photos').insert({ is_reference: true, ref_category: cat, caption, storage_path: path, uploaded_by: profile.id })
              setCaption(''); load()
            }} />
          </div>
        )}
      </div>
    </div>
  )
}
