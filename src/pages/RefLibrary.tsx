import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import Camera, { photoUrl } from '../components/Camera'
import type { Profile } from '../App'

interface Ref { id: string; storage_path: string; caption: string; ref_category: string; ref_verdict: string }
interface InspPhoto { id: string; storage_path: string; item_key: string; piece_no: number; is_pass_photo: boolean }
const BASE_CATS = ['porosity', 'paint_inclusion', 'scratch', 'hat_marks', 'coating', 'marking', 'packing', 'general']

export default function RefLibrary({ profile }: { profile: Profile }) {
  const { t } = useI18n()
  const [refs, setRefs] = useState<Ref[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [cats, setCats] = useState<string[]>(BASE_CATS)
  const [cat, setCat] = useState(BASE_CATS[0])
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'acceptable' | 'defect'>('all')
  const [caption, setCaption] = useState('')
  const [newVerdict, setNewVerdict] = useState<'acceptable' | 'defect'>('defect')
  const [newCat, setNewCat] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [inspPhotos, setInspPhotos] = useState<InspPhoto[]>([])
  const [preview, setPreview] = useState('')
  const isApprover = profile.role === 'approver'

  const load = async () => {
    const { data } = await supabase.from('photos').select('*').eq('is_reference', true).order('ref_category')
    setRefs((data as Ref[]) || [])
    const { data: cs } = await supabase.from('settings').select('value').eq('key', 'ref_categories').maybeSingle()
    const extra: string[] = cs?.value?.extra || []
    setCats([...BASE_CATS, ...extra])
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    refs.forEach(async r => {
      if (!urls[r.storage_path]) {
        const u = await photoUrl(r.storage_path)
        if (u) setUrls(prev => ({ ...prev, [r.storage_path]: u }))
      }
    })
  }, [refs]) // eslint-disable-line

  const addCategory = async () => {
    const c = newCat.trim().toLowerCase().replace(/\s+/g, '_')
    if (!c || cats.includes(c)) return
    const extra = [...cats.filter(x => !BASE_CATS.includes(x)), c]
    await supabase.from('settings').upsert({ key: 'ref_categories', value: { extra } })
    setNewCat(''); load()
  }

  const openPicker = async () => {
    const { data } = await supabase.from('photos').select('id,storage_path,item_key,piece_no,is_pass_photo')
      .eq('is_reference', false).order('created_at', { ascending: false }).limit(60)
    const ps = (data as InspPhoto[]) || []
    setInspPhotos(ps)
    ps.forEach(async p => {
      if (!urls[p.storage_path]) {
        const u = await photoUrl(p.storage_path)
        if (u) setUrls(prev => ({ ...prev, [p.storage_path]: u }))
      }
    })
    setPickerOpen(true)
  }

  const copyToLibrary = async (p: InspPhoto) => {
    await supabase.from('photos').insert({
      is_reference: true, ref_category: cat, ref_verdict: newVerdict,
      storage_path: p.storage_path, caption: caption || `From inspection (${p.item_key || 'photo'})`,
      uploaded_by: profile.id, item_key: p.item_key, piece_no: p.piece_no,
    })
    setPickerOpen(false); load()
  }

  const shown = refs.filter(r => r.ref_category === cat && (verdictFilter === 'all' || r.ref_verdict === verdictFilter))

  return (
    <div className="page">
      <div className="card">
        <h2>{t('refLibrary')}</h2>
        <p className="muted">Acceptable vs defect examples per category — training reference for inspectors.</p>

        {/* Category chips */}
        <div className="tabs" style={{ position: 'static' }}>
          {cats.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c.replace(/_/g, ' ')}</button>)}
        </div>

        {/* Verdict filter */}
        <div className="row" style={{ marginBottom: 12 }}>
          {(['all', 'acceptable', 'defect'] as const).map(v => (
            <button key={v} className="btn ghost" style={{ minHeight: 38, padding: '6px 14px', fontSize: 13, ...(verdictFilter === v ? { background: v === 'defect' ? 'var(--fail)' : v === 'acceptable' ? 'var(--pass)' : 'var(--navy)', color: '#fff' } : {}) }}
              onClick={() => setVerdictFilter(v)}>
              {v === 'all' ? 'All' : v === 'acceptable' ? '✓ Acceptable' : '✗ Defect'}
            </button>
          ))}
        </div>

        {/* Gallery */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
          {shown.map(r => (
            <figure key={r.id} style={{ margin: 0, borderRadius: 10, overflow: 'hidden', border: `2px solid ${r.ref_verdict === 'acceptable' ? 'var(--pass)' : 'var(--fail)'}` }}>
              {urls[r.storage_path] && (
                <img src={urls[r.storage_path]} style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                  onClick={() => setPreview(urls[r.storage_path])} />
              )}
              <figcaption style={{ padding: '5px 8px', fontSize: 12, background: r.ref_verdict === 'acceptable' ? 'var(--pass-bg)' : 'var(--fail-bg)' }}>
                <b style={{ color: r.ref_verdict === 'acceptable' ? 'var(--pass)' : 'var(--fail)' }}>
                  {r.ref_verdict === 'acceptable' ? '✓ Acceptable' : '✗ Defect'}
                </b>
                <div className="muted">{r.caption}</div>
                {isApprover && (
                  <button className="btn ghost" style={{ minHeight: 30, padding: '2px 8px', fontSize: 11, marginTop: 4 }}
                    onClick={async () => { if (confirm('Remove from library?')) { await supabase.from('photos').delete().eq('id', r.id); load() } }}>🗑</button>
                )}
              </figcaption>
            </figure>
          ))}
          {shown.length === 0 && <p className="muted">No reference photos in this view yet.</p>}
        </div>

        {/* Approver controls */}
        {isApprover && (
          <div className="card" style={{ marginTop: 16, background: '#F7F9FB' }}>
            <h2 style={{ fontSize: 17 }}>Add to library → {cat.replace(/_/g, ' ')}</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              {(['acceptable', 'defect'] as const).map(v => (
                <button key={v} className="btn ghost" style={{ minHeight: 40, ...(newVerdict === v ? { background: v === 'defect' ? 'var(--fail)' : 'var(--pass)', color: '#fff' } : {}) }}
                  onClick={() => setNewVerdict(v)}>
                  {v === 'acceptable' ? '✓ Acceptable' : '✗ Defect'}
                </button>
              ))}
            </div>
            <input className="txt" placeholder="Caption…" style={{ marginBottom: 10 }} value={caption} onChange={e => setCaption(e.target.value)} />
            <div className="row">
              <Camera label={t('takePhoto')} onUploaded={async path => {
                await supabase.from('photos').insert({
                  is_reference: true, ref_category: cat, ref_verdict: newVerdict,
                  caption, storage_path: path, uploaded_by: profile.id,
                })
                setCaption(''); load()
              }} />
              <button className="btn ghost" onClick={openPicker}>📂 From past inspections</button>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <input className="txt" style={{ flex: 1 }} placeholder="New category name…" value={newCat} onChange={e => setNewCat(e.target.value)} />
              <button className="btn" onClick={addCategory}>+ Add category</button>
            </div>
          </div>
        )}
      </div>

      {/* Inspection photo picker */}
      {pickerOpen && (
        <div className="modal-overlay" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 10 }}>📂 Pick a photo → {cat.replace(/_/g, ' ')} ({newVerdict})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
              {inspPhotos.map(p => (
                <div key={p.id} style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}
                  onClick={() => copyToLibrary(p)}>
                  {urls[p.storage_path]
                    ? <img src={urls[p.storage_path]} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                    : <div style={{ height: 90, background: 'var(--steel)' }} />}
                  <div style={{ fontSize: 10, padding: '3px 6px' }}>{p.item_key ? p.item_key.replace(/_/g, ' ') : 'photo'}</div>
                </div>
              ))}
              {inspPhotos.length === 0 && <p className="muted">No inspection photos found.</p>}
            </div>
            <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setPickerOpen(false)}>Close</button>
          </div>
        </div>
      )}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview('')}>
          <img src={preview} style={{ maxWidth: '94vw', maxHeight: '88vh', borderRadius: 12 }} />
        </div>
      )}
    </div>
  )
}
