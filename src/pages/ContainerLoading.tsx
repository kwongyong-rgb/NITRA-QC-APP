import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { PALLET_PACKING_ITEMS, CONTAINER_PHOTO_ITEMS } from '../lib/standard'
import { MediaCapture, MediaThumb } from '../components/PhotoModal'
import type { Profile } from '../App'

type PFNA = 'P' | 'F' | 'NA' | undefined
interface Content { part_no: string; qty: number }
interface PalletData { contents: Content[]; checks: Record<string, PFNA> }
interface CLData { loading_type?: 'pallet' | 'non_pallet'; pallet_count?: number; pallets?: Record<string, PalletData>; non_pallet_contents?: Content[] }
interface CL {
  id: string; po_no: string; container_no: string; seal_no: string
  status: string; insp_status: string; inspector_id: string
  data: CLData; summary: { disposition?: string; corrective_action?: string }; review_note: string
}
interface Photo { id: string; storage_path: string; media_type: string; item_key: string; piece_no: number; is_pass_photo: boolean }

export default function ContainerLoading({ profile }: { profile: Profile }) {
  const { id } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { bi } = useI18n()
  const [cl, setCl] = useState<CL | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [skuList, setSkuList] = useState<string[]>([])
  const [capture, setCapture] = useState<{ itemKey: string; pieceNo: number; isPass: boolean } | null>(null)
  const [history, setHistory] = useState<{ palletNo: number; prevChecks: Record<string, PFNA> }[]>([])
  const [activePallet, setActivePallet] = useState(1)
  const [reviewNote, setReviewNote] = useState('')
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
      setUrls(prev => ({ ...prev, ...m }))
    }
  }, [])

  useEffect(() => {
    (async () => {
      const { data: skus } = await supabase.from('skus').select('part_no').eq('active', true).order('part_no')
      setSkuList((skus || []).map((s: { part_no: string }) => s.part_no))
      if (id === 'new') {
        const { data, error } = await supabase.from('container_loadings').insert({ inspector_id: profile.id, po_no: params.get('po') || '' }).select('id').single()
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
  const loadingType = cl.data.loading_type || 'pallet'
  const palletCount = cl.data.pallet_count ?? 0
  const pallets = Array.from({ length: palletCount }, (_, i) => i + 1)
  const curPallet = Math.min(Math.max(activePallet, 1), palletCount || 1)

  const patch = async (fields: Partial<CL>) => {
    const next = { ...cl, ...fields }; setCl(next)
    await supabase.from('container_loadings').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', cl.id)
  }
  const setData = (d: CLData) => patch({ data: d })

  const palletOf = (n: number): PalletData => cl.data.pallets?.[n] || { contents: [], checks: {} }
  const snapshot = (n: number) => setHistory(h => [...h, { palletNo: n, prevChecks: { ...palletOf(n).checks } }])

  const setPalletCheck = (n: number, key: string, v: PFNA) => {
    snapshot(n)
    const pallets = { ...(cl.data.pallets || {}) }; const pd = palletOf(n)
    const checks = { ...pd.checks }; if (checks[key] === v) delete checks[key]; else checks[key] = v
    pallets[n] = { ...pd, checks }; setData({ ...cl.data, pallets })
  }
  const setAllPallet = (n: number, v: PFNA) => {
    snapshot(n)
    const pallets = { ...(cl.data.pallets || {}) }; const pd = palletOf(n)
    const checks = { ...pd.checks }; for (const it of PALLET_PACKING_ITEMS) checks[it.key] = v
    pallets[n] = { ...pd, checks }; setData({ ...cl.data, pallets })
  }
  const undoPallet = (n: number) => {
    let idx = -1; for (let i = history.length - 1; i >= 0; i--) if (history[i].palletNo === n) { idx = i; break }
    if (idx < 0) return
    const entry = history[idx]; setHistory(h => h.filter((_, i) => i !== idx))
    const pallets = { ...(cl.data.pallets || {}) }; pallets[n] = { ...palletOf(n), checks: entry.prevChecks }
    setData({ ...cl.data, pallets })
  }
  const updateContents = (n: number, contents: Content[]) => {
    const pallets = { ...(cl.data.pallets || {}) }; pallets[n] = { ...palletOf(n), contents }
    setData({ ...cl.data, pallets })
  }

  const insertPhoto = async (itemKey: string, pieceNo: number, isPass: boolean, path: string, type: 'photo' | 'video') => {
    const { error } = await supabase.from('photos').insert({
      container_loading_id: cl.id, storage_path: path, media_type: type, item_key: itemKey, piece_no: pieceNo, is_pass_photo: isPass, comment: '',
    }).select('id')
    if (error) { alert('Could not save photo: ' + error.message + '\n\nIf this mentions a missing column or policy, run migration 07 in the Supabase SQL Editor.'); return false }
    return true
  }
  const onCaptured = async (path: string, type: 'photo' | 'video') => {
    if (!capture) return
    const ok = await insertPhoto(capture.itemKey, capture.pieceNo, capture.isPass, path, type)
    setCapture(null); if (ok) loadPhotos(cl.id)
  }
  const deletePhoto = async (p: Photo) => {
    if (!confirm('Delete this photo/video?')) return
    const { data, error } = await supabase.from('photos').delete().eq('id', p.id).select('id')
    if (error) { alert('Delete failed: ' + error.message); return }
    if (!data?.length) { alert('Delete blocked by database (run migration 06/07).'); return }
    loadPhotos(cl.id)
  }
  const photosFor = (itemKey: string, pieceNo: number) => photos.filter(p => p.item_key === itemKey && p.piece_no === pieceNo)

  const PhotoStrip = ({ itemKey, pieceNo }: { itemKey: string; pieceNo: number }) => {
    const ph = photosFor(itemKey, pieceNo); if (!ph.length) return null
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {ph.map(p => (
          <div key={p.id} style={{ position: 'relative' }}>
            <MediaThumb type={p.media_type} url={urls[p.storage_path] || ''} onClick={() => urls[p.storage_path] && window.open(urls[p.storage_path], '_blank')} />
            {editable && <button onClick={() => deletePhoto(p)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(204,17,34,.9)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, padding: '1px 5px', cursor: 'pointer' }}>🗑</button>}
          </div>
        ))}
      </div>
    )
  }
  const CamBtn = ({ itemKey, pieceNo, isPass = true, label = '📷 +' }: { itemKey: string; pieceNo: number; isPass?: boolean; label?: string }) =>
    editable ? <button className="btn ghost" style={{ minHeight: 38, padding: '4px 14px', fontSize: 13 }} onClick={() => setCapture({ itemKey, pieceNo, isPass })}>{label}</button> : null

  // Loaded contents per pallet
  const palletContents = pallets.map(n => ({ n, contents: (palletOf(n).contents || []).filter(c => c.part_no) })).filter(x => x.contents.length)

  const submit = async () => {
    const missing: string[] = []
    if (!cl.container_no.trim()) missing.push('Container number')
    for (const item of CONTAINER_PHOTO_ITEMS) if (photosFor(item.key, 0).length === 0) missing.push(bi(item.label) + ' (photo)')
    if (loadingType === 'pallet') for (const n of pallets) if (photosFor('pallet_label', n).length === 0) missing.push(`Pallet ${n} — label photo`)
    if (missing.length) { alert('Cannot submit — these are required first:\n\n• ' + missing.join('\n• ')); return }
    await patch({ insp_status: 'submitted' })
    await supabase.from('container_loadings').update({ submitted_at: new Date().toISOString() }).eq('id', cl.id)
    alert('Submitted for approval.')
  }

  const decide = async (status: 'approved' | 'rejected') => {
    if (!confirm(status === 'approved' ? 'Approve this container loading?' : 'Reject and send back to the inspector?')) return
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('container_loadings').update({
      insp_status: status, reviewed_at: new Date().toISOString(), reviewed_by: user?.id, review_note: reviewNote,
    }).eq('id', cl.id)
    if (error) { alert('Sign-off failed: ' + error.message); return }
    setCl({ ...cl, insp_status: status, review_note: reviewNote })
    alert(status === 'approved' ? 'Approved. Use “Email container report” to send it when ready.' : 'Rejected and sent back to the inspector.')
  }

  const emailReport = async () => {
    const raw = window.prompt('Enter recipient email(s), comma-separated. Leave blank to use the saved distribution list.')
    if (raw === null) return
    const emails = raw.split(',').map(v => v.trim()).filter(Boolean)
    const { data, error } = await supabase.functions.invoke('send-container-report', { body: { container_loading_id: cl.id, emails } })
    if (error) { alert('Email failed: ' + error.message); return }
    if (data?.ok === false) { alert('Email failed: ' + (data?.error || 'Unknown error')); return }
    alert('Container report email sent.')
  }

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
              <option value="in_progress">In progress</option><option value="loaded">Loaded</option><option value="hold">Hold</option>
            </select></label>
          <label className="fld"><span>Loading type</span>
            <select className="sel" disabled={!editable} value={loadingType} onChange={e => setData({ ...cl.data, loading_type: e.target.value as 'pallet' | 'non_pallet' })}>
              <option value="pallet">Pallet</option><option value="non_pallet">Non-pallet</option>
            </select></label>
          <div />
          <div>
            <label className="fld"><span>Container number</span>
              <input className="txt" disabled={!editable} value={cl.container_no} onChange={e => patch({ container_no: e.target.value })} /></label>
            <div style={{ marginTop: 6 }}><CamBtn itemKey="container_no_photo" pieceNo={0} label="📷 Photo of container no." /><PhotoStrip itemKey="container_no_photo" pieceNo={0} /></div>
          </div>
          <div>
            <label className="fld"><span>Seal number</span>
              <input className="txt" disabled={!editable} value={cl.seal_no} onChange={e => patch({ seal_no: e.target.value })} /></label>
            <div style={{ marginTop: 6 }}><CamBtn itemKey="seal_no_photo" pieceNo={0} label="📷 Photo of seal no." /><PhotoStrip itemKey="seal_no_photo" pieceNo={0} /></div>
          </div>
        </div>
        {palletContents.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <b>Loaded contents:</b>
            {palletContents.map(x => (
              <div key={x.n} style={{ marginTop: 2 }}>Pallet {x.n}: {x.contents.map(c => `${c.part_no} × ${c.qty}`).join(', ')}</div>
            ))}
          </div>
        )}
      </div>

      <datalist id="cl-skus">{skuList.map(s => <option key={s} value={s} />)}</datalist>

      {loadingType === 'non_pallet' && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Non-Pallet Loading</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Add each part number loaded into the container and the quantity.</p>
          {(cl.data.non_pallet_contents || []).map((c, ci) => {
            const set = (contents: Content[]) => setData({ ...cl.data, non_pallet_contents: contents })
            const arr = cl.data.non_pallet_contents || []
            return (
              <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input className="txt" list="cl-skus" placeholder="Part no." disabled={!editable} value={c.part_no} style={{ flex: 2 }}
                  onChange={e => { const a = [...arr]; a[ci] = { ...a[ci], part_no: e.target.value }; set(a) }} />
                <input className="txt" type="number" min={0} placeholder="Qty" disabled={!editable} value={c.qty || ''} style={{ flex: 1 }}
                  onChange={e => { const a = [...arr]; a[ci] = { ...a[ci], qty: +e.target.value || 0 }; set(a) }} />
                {editable && <button className="btn ghost" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => set(arr.filter((_, i) => i !== ci))}>✕</button>}
              </div>
            )
          })}
          {editable && <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}
            onClick={() => setData({ ...cl.data, non_pallet_contents: [...(cl.data.non_pallet_contents || []), { part_no: '', qty: 0 }] })}>＋ Add part no.</button>}
        </div>
      )}

      {loadingType === 'pallet' && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Pallet Packing</h2>
          <label className="fld" style={{ maxWidth: 240 }}><span>Number of pallets (1–22)</span>
            <input className="txt" type="number" min={1} max={22} disabled={!editable} value={cl.data.pallet_count ?? ''}
              onChange={e => { const n = Math.max(0, Math.min(22, Math.floor(+e.target.value || 0))); setData({ ...cl.data, pallet_count: n }) }} /></label>

          {palletCount < 1 ? <p className="muted" style={{ marginTop: 12 }}>Enter the number of pallets.</p> : (
            <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
              {pallets.map(pn => {
                const filled = (palletOf(pn).contents || []).some(c => c.part_no) || Object.keys(palletOf(pn).checks || {}).length > 0 || photosFor('pallet_label', pn).length > 0
                return (
                  <button key={pn} onClick={() => setActivePallet(pn)}
                    style={{ minHeight: 44, minWidth: 48, padding: '4px 10px', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                      border: `1.5px solid ${curPallet === pn ? 'var(--navy)' : 'var(--line)'}`,
                      background: curPallet === pn ? 'var(--navy)' : (filled ? 'var(--pass-bg)' : '#fff'),
                      color: curPallet === pn ? '#fff' : 'var(--navy)' }}>{pn}</button>
                )
              })}
            </div>
            {(() => {
              const n = curPallet
              const pd = palletOf(n); const labelPhotos = photosFor('pallet_label', n)
              const undoCount = history.filter(e => e.palletNo === n).length
              return (
              <div key={n} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 12 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Pallet {n}</div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Pallet label photo {labelPhotos.length === 0 && <span style={{ color: 'var(--fail)' }}>· required</span>}</div>
                  {editable && <MediaCapture label="Label" onUploaded={async (path, type) => { const ok = await insertPhoto('pallet_label', n, true, path, type); if (ok) loadPhotos(cl.id) }} />}
                  <PhotoStrip itemKey="pallet_label" pieceNo={n} />
                </div>

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

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Packing checks</span>
                    {editable && <>
                      <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12, color: 'var(--pass)', borderColor: 'var(--pass)' }} onClick={() => setAllPallet(n, 'P')}>All P</button>
                      <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12, color: 'var(--fail)', borderColor: 'var(--fail)' }} onClick={() => setAllPallet(n, 'F')}>All F</button>
                      <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12 }} onClick={() => setAllPallet(n, 'NA')}>All NA</button>
                      {undoCount > 0 && <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12, borderColor: 'var(--amber)', color: 'var(--amber)' }} onClick={() => undoPallet(n)}>↶ Undo</button>}
                    </>}
                  </div>
                  {PALLET_PACKING_ITEMS.map(item => (
                    <div key={item.key} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="row" style={{ gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 14 }}>{bi(item.label)}</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <div className="pfna">
                            {(['P', 'F', 'NA'] as const).map(v => (
                              <button key={v} disabled={!editable} className={`${v === 'P' ? 'p' : v === 'F' ? 'f' : 'n'} ${pd.checks[item.key] === v ? 'on' : ''}`}
                                onClick={() => setPalletCheck(n, item.key, pd.checks[item.key] === v ? undefined : v)}>{v}</button>
                            ))}
                          </div>
                          <CamBtn itemKey={item.key} pieceNo={n} isPass={pd.checks[item.key] !== 'F'} />
                        </div>
                      </div>
                      <PhotoStrip itemKey={item.key} pieceNo={n} />
                    </div>
                  ))}
                </div>
              </div>
            )
            })()}
            </>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Container Loading Inspection Photos</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>A photo is required for each item below before you can submit.</p>
        {CONTAINER_PHOTO_ITEMS.map(item => {
          const ph = photosFor(item.key, 0)
          return (
            <div key={item.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{bi(item.label)} {ph.length === 0 && <span style={{ color: 'var(--fail)', fontSize: 12 }}>· photo required</span>}</div>
              <div className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>{bi(item.instruction)}</div>
              <CamBtn itemKey={item.key} pieceNo={0} label="📷 Add photo / video" />
              <PhotoStrip itemKey={item.key} pieceNo={0} />
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Disposition</h2>
        {cl.insp_status === 'rejected' && cl.review_note && <div className="banner bad" style={{ marginBottom: 10 }}>↩ {cl.review_note}</div>}
        <label className="fld"><span>Corrective action / notes</span>
          <textarea className="txt" rows={3} disabled={!editable} value={cl.summary.corrective_action || ''}
            onChange={e => patch({ summary: { ...cl.summary, corrective_action: e.target.value } })} /></label>

        {['draft', 'rejected'].includes(cl.insp_status) && editable &&
          <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={submit}>Submit for approval</button>}

        {cl.insp_status === 'submitted' && profile.role !== 'approver' &&
          <p className="muted" style={{ marginTop: 10 }}>Submitted — awaiting approver sign-off.</p>}

        {cl.insp_status === 'submitted' && profile.role === 'approver' && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Approver sign-off</div>
            <input className="txt" placeholder="Review note (optional)…" value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn ok" style={{ flex: 1 }} onClick={() => decide('approved')}>Approve</button>
              <button className="btn danger" style={{ flex: 1 }} onClick={() => decide('rejected')}>Reject</button>
            </div>
          </div>
        )}

        {cl.insp_status === 'approved' && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: 'var(--pass)', fontWeight: 600 }}>✓ Approved</p>
            <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={emailReport}>📧 Email container report</button>
          </div>
        )}
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
