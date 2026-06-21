import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { PALLET_PACKING_ITEMS, CONTAINER_ITEMS } from '../lib/standard'
import { MediaCapture, MediaThumb } from '../components/PhotoModal'
import type { Profile } from '../App'

type PFNA = 'P' | 'F' | 'NA' | undefined
interface Content { part_no: string; qty: number }
interface PalletData { contents: Content[]; checks: Record<string, PFNA> }
interface CLData { pallet_count?: number; pallets?: Record<string, PalletData>; container_checks?: Record<string, PFNA> }
interface CL {
  id: string; po_no: string; container_no: string; seal_no: string
  status: string; insp_status: string; inspector_id: string
  data: CLData; summary: { disposition?: string; corrective_action?: string }; review_note: string
}
interface Photo { id: string; storage_path: string; media_type: string; item_key: string; piece_no: number; is_pass_photo: boolean }

export default function ContainerLoading({ profile }: { profile: Profile }) {
  const { id } = useParams()
  const nav = useNavigate()
  const { bi } = useI18n()
  const [cl, setCl] = useState<CL | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [skuList, setSkuList] = useState<string[]>([])
  const [capture, setCapture] = useState<{ itemKey: string; pieceNo: number; isPass: boolean } | null>(null)
  const [err, setErr] = useState('')

  const loadPhotos = useCallback(async (clId: string) => {
    const { data } = await supabase.from('photos').select('*').eq('container_loading_id', clId).order('created_at')
    const ph = (data || []) as Photo[]
    setPhotos(ph)
    const paths = [...new Set(ph.map(p => p.storage_path))]
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('qc-photos').createSignedUrls(paths, 60 * 60 * 6)
      const m: Record<string, string> = {}
      for (const s of signed || []) if (s.path && s.signedUrl) m[s.path] = s.signedUrl
      setUrls(m)
    }
  }, [])

  useEffect(() => {
    (async () => {
      const { data: skus } = await supabase.from('skus').select('part_no').eq('active', true).order('part_no')
      setSkuList((skus || []).map((s: { part_no: string }) => s.part_no))

      if (id === 'new') {
        const { data, error } = await supabase.from('container_loadings').insert({ inspector_id: profile.id }).select('id').single()
        if (error) { setErr(error.message); return }
        if (data) nav(`/container/${data.id}`, { replace: true })
        return
      }
      const { data, error } = await supabase.from('container_loadings').select('*').eq('id', id).single()
      if (error) { setErr(error.message); return }
      setCl(data as CL)
      await loadPhotos(id!)
    })()
  }, [id, profile.id, nav, loadPhotos])

  if (err) return <div className="page" style={{ paddingTop: 24 }}><p style={{ color: 'var(--fail)' }}>Error: {err}</p></div>
  if (!cl) return <div className="page" style={{ paddingTop: 24 }}><p className="muted">Loading…</p></div>

  const editable = ['draft', 'rejected'].includes(cl.insp_status) || profile.role === 'approver'
  const palletCount = cl.data.pallet_count ?? 0
  const pallets = Array.from({ length: palletCount }, (_, i) => i + 1)

  const patch = async (fields: Partial<CL>) => {
    const next = { ...cl, ...fields }
    setCl(next)
    await supabase.from('container_loadings').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', cl.id)
  }
  const setData = (d: CLData) => patch({ data: d })

  const setPalletCheck = (n: number, key: string, v: PFNA) => {
    const pallets = { ...(cl.data.pallets || {}) }
    const pd: PalletData = pallets[n] || { contents: [], checks: {} }
    const checks = { ...pd.checks }; if (checks[key] === v) delete checks[key]; else checks[key] = v
    pallets[n] = { ...pd, checks }
    setData({ ...cl.data, pallets })
  }
  const setContainerCheck = (key: string, v: PFNA) => {
    const cc = { ...(cl.data.container_checks || {}) }; if (cc[key] === v) delete cc[key]; else cc[key] = v
    setData({ ...cl.data, container_checks: cc })
  }
  const updateContents = (n: number, contents: Content[]) => {
    const pallets = { ...(cl.data.pallets || {}) }
    pallets[n] = { ...(pallets[n] || { contents: [], checks: {} }), contents }
    setData({ ...cl.data, pallets })
  }

  const onCaptured = async (path: string, type: 'photo' | 'video') => {
    if (!capture) return
    await supabase.from('photos').insert({
      container_loading_id: cl.id, storage_path: path, media_type: type,
      item_key: capture.itemKey, piece_no: capture.pieceNo, is_pass_photo: capture.isPass, comment: '',
    })
    setCapture(null); loadPhotos(cl.id)
  }
  const deletePhoto = async (p: Photo) => {
    if (!confirm('Delete this photo/video?')) return
    const { data, error } = await supabase.from('photos').delete().eq('id', p.id).select('id')
    if (error) { alert('Delete failed: ' + error.message); return }
    if (!data?.length) { alert('Delete blocked by database (run migration 06/07).'); return }
    loadPhotos(cl.id)
  }
  const photosFor = (itemKey: string, pieceNo: number) => photos.filter(p => p.item_key === itemKey && p.piece_no === pieceNo)

  // Rolled-up SKU totals across all pallets
  const totals: Record<string, number> = {}
  for (const n of pallets) for (const c of (cl.data.pallets?.[n]?.contents || [])) if (c.part_no) totals[c.part_no] = (totals[c.part_no] || 0) + (c.qty || 0)

  const submit = async () => {
    if (!cl.container_no.trim()) { alert('Enter a container number first.'); return }
    await patch({ insp_status: 'submitted' })
    await supabase.from('container_loadings').update({ submitted_at: new Date().toISOString() }).eq('id', cl.id)
    alert('Submitted for approval.')
  }

  const PFNARow = ({ val, onSet, onCam, photoCount }: { val: PFNA; onSet: (v: PFNA) => void; onCam: () => void; photoCount: number }) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <div className="pfna">
        {(['P', 'F', 'NA'] as const).map(v => (
          <button key={v} disabled={!editable} className={`${v === 'P' ? 'p' : v === 'F' ? 'f' : 'n'} ${val === v ? 'on' : ''}`}
            onClick={() => onSet(val === v ? undefined : v)}>{v}</button>
        ))}
      </div>
      {editable && <button className={`plus-btn ${photoCount > 0 ? 'has-photo' : ''}`} onClick={onCam}>{photoCount > 0 ? `📷 ${photoCount}` : '📷+'}</button>}
    </div>
  )

  return (
    <div className="page" style={{ paddingTop: 16 }}>
      <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, marginBottom: 12 }} onClick={() => nav('/')}>← Home</button>

      <div className="card">
        <h2>Container Loading</h2>
        <div className="grid2">
          <label className="fld"><span>PO number</span>
            <input className="txt" disabled={!editable} value={cl.po_no} onChange={e => patch({ po_no: e.target.value })} /></label>
          <label className="fld"><span>Status</span>
            <select className="sel" disabled={!editable} value={cl.status} onChange={e => patch({ status: e.target.value })}>
              <option value="in_progress">In progress</option>
              <option value="loaded">Loaded</option>
              <option value="hold">Hold</option>
            </select></label>
          <label className="fld"><span>Container number</span>
            <input className="txt" disabled={!editable} value={cl.container_no} onChange={e => patch({ container_no: e.target.value })} /></label>
          <label className="fld"><span>Seal number</span>
            <input className="txt" disabled={!editable} value={cl.seal_no} onChange={e => patch({ seal_no: e.target.value })} /></label>
        </div>
        {Object.keys(totals).length > 0 && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <b>Loaded contents (auto-totalled):</b> {Object.entries(totals).map(([pn, q]) => `${pn} × ${q}`).join(' · ')}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Pallet Packing</h2>
        <label className="fld" style={{ maxWidth: 240 }}><span>Number of pallets (1–22)</span>
          <input className="txt" type="number" min={1} max={22} disabled={!editable} value={cl.data.pallet_count ?? ''}
            onChange={e => { const n = Math.max(0, Math.min(22, Math.floor(+e.target.value || 0))); setData({ ...cl.data, pallet_count: n }) }} /></label>

        {palletCount < 1 ? <p className="muted" style={{ marginTop: 12 }}>Enter the number of pallets.</p> : pallets.map(n => {
          const pd = cl.data.pallets?.[n] || { contents: [] as Content[], checks: {} as Record<string, PFNA> }
          const labelPhotos = photosFor('pallet_label', n)
          return (
            <div key={n} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Pallet {n}</div>

              {/* Label photo */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Pallet label photo {labelPhotos.length === 0 && <span style={{ color: 'var(--fail)' }}>· required</span>}</div>
                {editable && <MediaCapture label="Label" onUploaded={async (path, type) => { setCapture({ itemKey: 'pallet_label', pieceNo: n, isPass: true }); await supabase.from('photos').insert({ container_loading_id: cl.id, storage_path: path, media_type: type, item_key: 'pallet_label', piece_no: n, is_pass_photo: true, comment: '' }); setCapture(null); loadPhotos(cl.id) }} />}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {labelPhotos.map(p => (
                    <div key={p.id} style={{ position: 'relative' }}>
                      <MediaThumb type={p.media_type} url={urls[p.storage_path] || ''} onClick={() => urls[p.storage_path] && window.open(urls[p.storage_path], '_blank')} />
                      {editable && <button onClick={() => deletePhoto(p)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(204,17,34,.85)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, padding: '1px 5px', cursor: 'pointer' }}>🗑</button>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Contents */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Contents (part no. + quantity)</div>
                {(pd.contents || []).map((c, ci) => (
                  <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input className="txt" list="cl-skus" placeholder="Part no." disabled={!editable} value={c.part_no} style={{ flex: 2 }}
                      onChange={e => { const arr = [...pd.contents]; arr[ci] = { ...arr[ci], part_no: e.target.value }; updateContents(n, arr) }} />
                    <input className="txt" type="number" min={0} placeholder="Qty" disabled={!editable} value={c.qty || ''} style={{ flex: 1 }}
                      onChange={e => { const arr = [...pd.contents]; arr[ci] = { ...arr[ci], qty: +e.target.value || 0 }; updateContents(n, arr) }} />
                    {editable && <button className="btn ghost" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => updateContents(n, pd.contents.filter((_, i) => i !== ci))}>✕</button>}
                  </div>
                ))}
                {editable && <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => updateContents(n, [...(pd.contents || []), { part_no: '', qty: 0 }])}>＋ Add part no.</button>}
              </div>

              {/* Packing checks */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Packing checks</div>
                {PALLET_PACKING_ITEMS.map(item => (
                  <div key={item.key} className="row" style={{ gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ flex: 1, fontSize: 14 }}>{bi(item.label)}</span>
                    <PFNARow val={pd.checks[item.key]} onSet={v => setPalletCheck(n, item.key, v)}
                      onCam={() => setCapture({ itemKey: item.key, pieceNo: n, isPass: pd.checks[item.key] !== 'F' })}
                      photoCount={photosFor(item.key, n).length} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        <datalist id="cl-skus">{skuList.map(s => <option key={s} value={s} />)}</datalist>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Container Loading checks</h2>
        {CONTAINER_ITEMS.map(item => (
          <div key={item.key} className="row" style={{ gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{bi(item.label)}</span>
            <PFNARow val={cl.data.container_checks?.[item.key]} onSet={v => setContainerCheck(item.key, v)}
              onCam={() => setCapture({ itemKey: item.key, pieceNo: 0, isPass: cl.data.container_checks?.[item.key] !== 'F' })}
              photoCount={photosFor(item.key, 0).length} />
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Disposition</h2>
        <label className="fld"><span>Corrective action / notes</span>
          <textarea className="txt" rows={3} disabled={!editable} value={cl.summary.corrective_action || ''}
            onChange={e => patch({ summary: { ...cl.summary, corrective_action: e.target.value } })} /></label>
        {editable && cl.insp_status !== 'submitted' && <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={submit}>Submit for approval</button>}
        {cl.insp_status === 'submitted' && <p className="muted" style={{ marginTop: 10 }}>Submitted — awaiting approver sign-off.</p>}
        {cl.insp_status === 'approved' && <p style={{ color: 'var(--pass)', marginTop: 10, fontWeight: 600 }}>✓ Approved</p>}
      </div>

      {capture && (
        <div className="modal-overlay" onClick={() => setCapture(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 12 }}>Add photo / video</h2>
            <MediaCapture label="Photo" onUploaded={onCaptured} />
            <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setCapture(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
