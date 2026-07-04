import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { PALLET_PACKING_ITEMS, CONTAINER_PHOTO_ITEMS } from '../lib/standard'
import { MediaCapture, MediaThumb, ReassignModal, CopyModal } from '../components/PhotoModal'
import { openContainerReport } from '../lib/report'
import type { Profile } from '../App'
import PartPicker from '../components/PartPicker'
import EmailModal from '../components/EmailModal'

type PFNA = 'P' | 'F' | 'NA' | undefined
interface Content { part_no: string; qty: number; off_po?: boolean }
interface LabelScan { raw_text: string; part_no: string | null; qty: number | null; pallet_no: string | null; at: string; by: string }
interface PalletData { contents: Content[]; checks: Record<string, PFNA>; label_scan?: LabelScan }
interface CLData { loading_type?: 'pallet' | 'non_pallet'; pallet_count?: number; pallets?: Record<string, PalletData>; non_pallet_contents?: Content[]; date_loaded?: string; etd?: string; eta?: string; bl_no?: string; dest_port?: string; dep_port?: string }
interface CL {
  id: string; po_no: string; container_no: string; seal_no: string
  status: string; insp_status: string; inspector_id: string
  data: CLData; summary: { disposition?: string; corrective_action?: string }; review_note: string; report_logo_path?: string
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
  const [poParts, setPoParts] = useState<Set<string> | null>(null)
  const [poQty, setPoQty] = useState<Map<string, number>>(new Map())
  const [scan, setScan] = useState<{ pallet: number; busy: boolean; fields?: { part_no: string; qty: string; pallet_no: string }; raw?: string; warn?: string[]; err?: string } | null>(null)
  const [capture, setCapture] = useState<{ itemKey: string; pieceNo: number; isPass: boolean } | null>(null)
  const [history, setHistory] = useState<{ palletNo: number; prevChecks: Record<string, PFNA> }[]>([])
  const [activePallet, setActivePallet] = useState(1)
  const [reviewNote, setReviewNote] = useState('')
  const [err, setErr] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [photoModal, setPhotoModal] = useState<{ type: 'reassign' | 'copy'; photo: Photo } | null>(null)

  useEffect(() => {
    const path = cl?.report_logo_path
    if (!path) { setLogoUrl(''); return }
    supabase.storage.from('qc-photos').createSignedUrl(path, 3600).then(({ data }) => setLogoUrl(data?.signedUrl || ''))
  }, [cl?.report_logo_path])

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

  // Ordered items for this CL's PO — powers the ON-PO badge, off-PO warning,
  // and the qty-vs-remaining check in the label scan review.
  const loadPoItems = async (poNo: string) => {
    if (!poNo || !poNo.trim()) { setPoParts(null); setPoQty(new Map()); return }
    const { data: po } = await supabase.from('pos').select('id').eq('po_no', poNo).maybeSingle()
    if (!po) { setPoParts(null); setPoQty(new Map()); return }
    const { data: items } = await supabase.from('po_items').select('part_no,qty_ordered').eq('po_id', po.id)
    const list = (items as { part_no: string; qty_ordered: number }[]) || []
    setPoParts(list.length ? new Set(list.map(i => i.part_no)) : null)
    setPoQty(new Map(list.map(i => [i.part_no, i.qty_ordered])))
  }

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
      loadPoItems((data as CL).po_no)
    })()
  }, [id, profile.id, nav, loadPhotos])

  if (err) return <div className="page" style={{ paddingTop: 24 }}><p style={{ color: 'var(--fail)' }}>Error: {err}</p></div>
  if (!cl) return <div className="page" style={{ paddingTop: 24 }}><p className="muted">Loading…</p></div>

  const editable = ['draft', 'rejected'].includes(cl.insp_status) || profile.role === 'admin'
  const loadingType = cl.data.loading_type || 'pallet'
  const palletCount = cl.data.pallet_count ?? 0
  const pallets = Array.from({ length: palletCount }, (_, i) => i + 1)
  const curPallet = Math.min(Math.max(activePallet, 1), palletCount || 1)

  const allItemsForReassign = [
    { key: 'container_no_photo', label: 'Container number' },
    { key: 'seal_no_photo', label: 'Seal number' },
    ...CONTAINER_PHOTO_ITEMS.map(i => ({ key: i.key, label: bi(i.label) })),
    { key: 'pallet_label', label: 'Pallet label' },
    ...PALLET_PACKING_ITEMS.map(i => ({ key: i.key, label: bi(i.label) })),
  ]

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
  // AI label scan: runs OCR on a just-uploaded pallet-label photo, then shows
  // an editable review with PO comparison warnings. Nothing saves until the
  // inspector confirms.
  const runScan = async (palletNo: number, path: string) => {
    setScan({ pallet: palletNo, busy: true })
    const { data, error } = await supabase.functions.invoke('ocr-label', { body: { path } })
    if (error || !data?.ok) {
      let msg = error?.message || data?.error || 'Scan failed.'
      try { const ctx = (error as { context?: Response } | null)?.context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error } } catch { /* ignore */ }
      setScan({ pallet: palletNo, busy: false, err: msg })
      return
    }
    const f = data.fields || {}
    const warn: string[] = []
    if (!f.part_no) warn.push('Part number could not be read — enter it manually below.')
    if (f.part_no && poParts && poParts.size > 0 && !poParts.has(f.part_no)) warn.push(`${f.part_no} is not listed on PO ${cl?.po_no}.`)
    if (f.part_no && f.qty && poQty.has(f.part_no)) {
      const ordered = poQty.get(f.part_no) || 0
      const already = loadedSoFar(f.part_no)
      if (already + f.qty > ordered) warn.push(`Quantity check: ${already} already recorded + ${f.qty} on this label exceeds ${ordered} ordered.`)
    }
    setScan({ pallet: palletNo, busy: false, raw: data.raw_text || '',
      warn, fields: { part_no: f.part_no || '', qty: f.qty ? String(f.qty) : '', pallet_no: f.pallet_no || '' } })
  }
  // Loaded so far for a part, across THIS container's saved contents.
  const loadedSoFar = (part: string) => {
    let sum = 0
    for (const pd of Object.values(cl?.data.pallets || {})) for (const c of (pd.contents || [])) if (c.part_no === part) sum += c.qty || 0
    for (const c of (cl?.data.non_pallet_contents || [])) if (c.part_no === part) sum += c.qty || 0
    return sum
  }
  const confirmScan = () => {
    if (!scan?.fields || !cl) return
    const part = scan.fields.part_no.trim()
    const qty = parseInt(scan.fields.qty, 10)
    if (!part) { alert('Enter the part number before confirming.'); return }
    if (!Number.isFinite(qty) || qty <= 0) { alert('Enter a valid quantity.'); return }
    const offPo = !!(poParts && poParts.size > 0 && !poParts.has(part))
    const n = scan.pallet
    const pd = palletOf(n)
    const pallets = { ...(cl.data.pallets || {}) }
    pallets[n] = {
      ...pd,
      contents: [...(pd.contents || []).filter(c => c.part_no), { part_no: part, qty, off_po: offPo || undefined }],
      label_scan: { raw_text: scan.raw || '', part_no: part, qty, pallet_no: scan.fields.pallet_no || null, at: new Date().toISOString(), by: profile.full_name },
    }
    setData({ ...cl.data, pallets })
    setScan(null)
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
            {editable && (
              <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 3 }}>
                <button onClick={() => setPhotoModal({ type: 'reassign', photo: p })} title="Reassign to another parameter" style={{ background: 'rgba(31,58,95,.92)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, padding: '1px 5px', cursor: 'pointer' }}>↻</button>
                <button onClick={() => setPhotoModal({ type: 'copy', photo: p })} title="Copy to other parameters" style={{ background: 'rgba(31,58,95,.92)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, padding: '1px 5px', cursor: 'pointer' }}>⧉</button>
                <button onClick={() => deletePhoto(p)} title="Delete" style={{ background: 'rgba(204,17,34,.9)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, padding: '1px 5px', cursor: 'pointer' }}>🗑</button>
              </div>
            )}
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
    if (!cl.container_no.trim()) { alert('Container number is required before submitting.'); return }
    const missingPhotos: string[] = []
    for (const item of CONTAINER_PHOTO_ITEMS) if (photosFor(item.key, 0).length === 0) missingPhotos.push(bi(item.label))
    if (loadingType === 'pallet') for (const n of pallets) if (photosFor('pallet_label', n).length === 0) missingPhotos.push(`Pallet ${n} — label`)
    if (missingPhotos.length) {
      const ok = confirm(`The following inspection items have no photo attached:\n\n• ${missingPhotos.join('\n• ')}\n\nDo you want to submit for approval anyway, without these photos?`)
      if (!ok) return
    }
    await patch({ insp_status: 'submitted' })
    await supabase.from('container_loadings').update({ submitted_at: new Date().toISOString(), inspector_id: profile.id }).eq('id', cl.id)
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

  const [emailOpen, setEmailOpen] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const emailReport = () => setEmailOpen(true)
  const doEmail = async (emails: string[]) => {
    setEmailBusy(true)
    const { data, error } = await supabase.functions.invoke('send-container-report', { body: { container_loading_id: cl.id, emails } })
    setEmailBusy(false)
    if (error || data?.ok === false) { alert('Email failed: ' + (error?.message || data?.error || 'Unknown error')); return }
    setEmailOpen(false)
    alert('Container report email sent.')
  }

  const removeLogoBackground = (file: File): Promise<Blob> => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight
      const ctx = cv.getContext('2d'); if (!ctx) { reject(new Error('no canvas')); return }
      ctx.drawImage(img, 0, 0)
      const imgData = ctx.getImageData(0, 0, cv.width, cv.height); const px = imgData.data
      const corners = [[0, 0], [cv.width - 1, 0], [0, cv.height - 1], [cv.width - 1, cv.height - 1]].map(([x, y]) => { const i = (y * cv.width + x) * 4; return [px[i], px[i + 1], px[i + 2]] })
      const bg = [0, 1, 2].map(c => Math.round(corners.reduce((s, k) => s + k[c], 0) / corners.length)); const tol = 70
      for (let i = 0; i < px.length; i += 4) { const dd = Math.sqrt((px[i] - bg[0]) ** 2 + (px[i + 1] - bg[1]) ** 2 + (px[i + 2] - bg[2]) ** 2); if (dd < tol) px[i + 3] = 0 }
      ctx.putImageData(imgData, 0, 0); cv.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    }
    img.onerror = () => reject(new Error('image load failed')); img.src = URL.createObjectURL(file)
  })
  const uploadLogo = async (file: File, cutBg = false) => {
    let body: Blob = file; let ext = (file.name.split('.').pop() || 'png').toLowerCase(); let contentType = file.type || 'image/png'
    if (cutBg) { try { body = await removeLogoBackground(file); ext = 'png'; contentType = 'image/png' } catch { alert('Could not remove the background; uploading the original instead.') } }
    const path = `logos/cl-${cl.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('qc-photos').upload(path, body, { upsert: true, contentType })
    if (upErr) { alert('Logo upload failed: ' + upErr.message); return }
    await patch({ report_logo_path: path }); alert('Report logo updated.')
  }
  const clearLogo = async () => { await patch({ report_logo_path: '' }); alert('Report logo reset.') }
  const openReport = () => window.open(`/container-report/${cl.id}`, '_blank')
  const openPdf = () => openContainerReport(cl.id)

  return (
    <div className="page" style={{ paddingTop: 16 }}>
      <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, marginBottom: 12 }} onClick={() => nav(-1)}>← Back</button>

      {(profile.role === 'admin' || cl.insp_status === 'approved') && (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ flex: 1, marginBottom: 0 }}>Container Loading Inspection</h2>
            <button className="btn ghost" style={{ minHeight: 40, padding: '6px 14px' }} onClick={openPdf}>PDF Report</button>
            <button className="btn ghost" style={{ minHeight: 40, padding: '6px 14px' }} onClick={openReport}>View Interactive Report</button>
            <button className="btn" style={{ minHeight: 40, padding: '6px 14px' }} onClick={emailReport}>Email Interactive Report</button>
          </div>
          {profile.role === 'admin' && (
            <>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <label className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, cursor: 'pointer' }}>
                  🖼 {cl.report_logo_path ? 'Change report logo' : 'Set report logo'}
                  <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); (e.target as HTMLInputElement).value = '' }} />
                </label>
                <label className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, cursor: 'pointer' }} title="Uploads the logo with its solid background made transparent, so it blends onto the navy report header">
                  🪄 Logo · cut out background
                  <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f, true); (e.target as HTMLInputElement).value = '' }} />
                </label>
                {cl.report_logo_path && <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13 }} onClick={clearLogo}>Reset logo</button>}
              </div>
              {logoUrl && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Report logo (shown on the report instead of NITRA):</div>
                  <div style={{ display: 'inline-block', background: 'var(--navy)', borderRadius: 8, padding: '8px 14px' }}>
                    <img src={logoUrl} alt="report logo" style={{ height: 40, maxWidth: 220, objectFit: 'contain', display: 'block' }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>Container Details</h2>
        <div className="grid2">
          <label className="fld"><span>PO number</span>
            <input className="txt" disabled={!editable} value={cl.po_no}
              onChange={e => patch({ po_no: e.target.value })}
              onBlur={e => loadPoItems(e.target.value)} /></label>
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

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Shipping Details</h2>
        <div className="grid2">
          <label className="fld"><span>Date Loaded</span>
            <input className="txt" type="date" disabled={!editable} value={cl.data.date_loaded || ''} onChange={e => setData({ ...cl.data, date_loaded: e.target.value })} /></label>
          <label className="fld"><span>BL Number</span>
            <input className="txt" disabled={!editable} value={cl.data.bl_no || ''} onChange={e => setData({ ...cl.data, bl_no: e.target.value })} /></label>
          <label className="fld"><span>Estimated Port Departure Date</span>
            <input className="txt" type="date" disabled={!editable} value={cl.data.etd || ''} onChange={e => setData({ ...cl.data, etd: e.target.value })} /></label>
          <label className="fld"><span>Estimated Port Arrival Date</span>
            <input className="txt" type="date" disabled={!editable} value={cl.data.eta || ''} onChange={e => setData({ ...cl.data, eta: e.target.value })} /></label>
          <label className="fld"><span>Departure Port</span>
            <input className="txt" disabled={!editable} value={cl.data.dep_port || ''} onChange={e => setData({ ...cl.data, dep_port: e.target.value })} /></label>
          <label className="fld"><span>Destination Port</span>
            <input className="txt" disabled={!editable} value={cl.data.dest_port || ''} onChange={e => setData({ ...cl.data, dest_port: e.target.value })} /></label>
        </div>
      </div>

      <datalist id="cl-skus">{skuList.map(s => <option key={s} value={s} />)}</datalist>

      {loadingType === 'non_pallet' && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>SKUs Loaded: Non-Pallet Loading</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Add each part number loaded into the container and the quantity.</p>
          {(cl.data.non_pallet_contents || []).map((c, ci) => {
            const set = (contents: Content[]) => setData({ ...cl.data, non_pallet_contents: contents })
            const arr = cl.data.non_pallet_contents || []
            return (
              <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <PartPicker value={c.part_no} disabled={!editable} poParts={poParts}
                  onChange={(part, offPo) => { const a = [...arr]; a[ci] = { ...a[ci], part_no: part, off_po: offPo || undefined }; set(a) }} />
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
          <h2>SKUs Loaded: Pallet Loading</h2>
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
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Pallet label photo {labelPhotos.length === 0 && <span style={{ color: 'var(--ink-soft)' }}>· no photo yet</span>}</div>
                  {editable && <MediaCapture label="Label" onUploaded={async (path, type) => { const ok = await insertPhoto('pallet_label', n, true, path, type); if (ok) { loadPhotos(cl.id); if (type === 'photo') runScan(n, path) } }} />}
                  {editable && labelPhotos.length > 0 && (
                    <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13, marginTop: 6 }}
                      onClick={() => runScan(n, labelPhotos[labelPhotos.length - 1].storage_path)}>🔍 Scan label with AI</button>
                  )}
                  <PhotoStrip itemKey="pallet_label" pieceNo={n} />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Contents (part no. + quantity)</div>
                  {(pd.contents || []).map((c, ci) => (
                    <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <PartPicker value={c.part_no} disabled={!editable} poParts={poParts}
                        onChange={(part, offPo) => { const arr = [...pd.contents]; arr[ci] = { ...arr[ci], part_no: part, off_po: offPo || undefined }; updateContents(n, arr) }} />
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
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Add a photo for each item below. Photos are recommended but not required — you'll be asked to confirm at submission if any are missing.</p>
        {CONTAINER_PHOTO_ITEMS.map(item => {
          const ph = photosFor(item.key, 0)
          return (
            <div key={item.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{bi(item.label)} {ph.length === 0 && <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>· no photo yet</span>}</div>
              <div className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>{bi(item.instruction)}</div>
              <CamBtn itemKey={item.key} pieceNo={0} label="📷 Add photo / video" />
              <PhotoStrip itemKey={item.key} pieceNo={0} />
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Submit &amp; Sign-off</h2>
        {cl.insp_status === 'rejected' && cl.review_note && <div className="banner bad" style={{ marginBottom: 10 }}>↩ {cl.review_note}</div>}

        {['draft', 'rejected'].includes(cl.insp_status) && editable &&
          <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={submit}>Submit for approval</button>}

        {cl.insp_status === 'submitted' && profile.role !== 'admin' &&
          <p className="muted" style={{ marginTop: 10 }}>Submitted — awaiting admin sign-off.</p>}

        {cl.insp_status === 'submitted' && profile.role === 'admin' && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Admin sign-off</div>
            <input className="txt" placeholder="Review note (optional)…" value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn ok" style={{ flex: 1 }} onClick={() => decide('approved')}>Approve</button>
              <button className="btn danger" style={{ flex: 1 }} onClick={() => decide('rejected')}>Reject</button>
            </div>
          </div>
        )}

        {cl.insp_status === 'approved' && <p style={{ color: 'var(--pass)', fontWeight: 600, marginTop: 12 }}>✓ Approved</p>}
      </div>

      {photoModal?.type === 'reassign' && (
        <ReassignModal photo={{ ...photoModal.photo, defect_id: null }} allItems={allItemsForReassign} maxPiece={palletCount || 0}
          onDone={() => { setPhotoModal(null); loadPhotos(cl.id) }} onClose={() => setPhotoModal(null)} />
      )}
      {photoModal?.type === 'copy' && (
        <CopyModal containerLoadingId={cl.id} photo={photoModal.photo} allItems={allItemsForReassign}
          onDone={() => { setPhotoModal(null); loadPhotos(cl.id) }} onClose={() => setPhotoModal(null)} />
      )}

      {capture && (
        <div className="modal-overlay" onClick={() => setCapture(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 12 }}>Add photo / video</h2>
            <MediaCapture label="Photo" onUploaded={onCaptured} />
            <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setCapture(null)}>Cancel</button>
          </div>
        </div>
      )}
      {scan && (
        <div className="modal-overlay" onClick={() => !scan.busy && setScan(null)}>
          <div className="modal" style={{ width: 'min(480px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Label scan — Pallet {scan.pallet}</h2>
            {scan.busy && <p className="muted">Reading the label…</p>}
            {!scan.busy && scan.err && (
              <>
                <p style={{ color: 'var(--fail)' }}>{scan.err}</p>
                <button className="btn ghost" onClick={() => setScan(null)}>Close</button>
              </>
            )}
            {!scan.busy && scan.fields && (
              <>
                <p className="muted" style={{ fontSize: 13 }}>Check the values read from the label. Nothing is saved until you confirm.</p>
                {(scan.warn || []).map((w, i) => (
                  <div key={i} style={{ background: '#FCF2DD', border: '1px solid var(--amber, #B7791F)', color: '#7A5514', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 8 }}>⚠ {w}</div>
                ))}
                <label className="fld"><span>Part number</span>
                  <PartPicker value={scan.fields.part_no} poParts={poParts}
                    onChange={(part) => setScan({ ...scan, fields: { ...scan.fields!, part_no: part } })} /></label>
                <label className="fld"><span>Quantity on label</span>
                  <input className="txt" inputMode="numeric" value={scan.fields.qty}
                    onChange={e => setScan({ ...scan, fields: { ...scan.fields!, qty: e.target.value } })} /></label>
                <label className="fld"><span>Pallet no. on label</span>
                  <input className="txt" value={scan.fields.pallet_no}
                    onChange={e => setScan({ ...scan, fields: { ...scan.fields!, pallet_no: e.target.value } })} /></label>
                <div className="row" style={{ marginTop: 12, gap: 8 }}>
                  <button className="btn" onClick={confirmScan}>Confirm & add to contents</button>
                  <button className="btn ghost" onClick={() => setScan(null)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {emailOpen && <EmailModal title="Email container report" allowBlank sending={emailBusy}
        onSend={doEmail} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}
