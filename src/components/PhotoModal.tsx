import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { isOffline } from '../lib/connectivity'
import { saveLocalMedia, savePendingPhotoRow, mediaUrlFor, currentUserId, syncPendingMedia, type PendingPhotoRow } from '../lib/offlineMedia'

const fmtMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

// v104 — downscale + re-encode a captured PHOTO to ~1.2 MB so uploads are quick
// on weak signal and storage stays small. Targets ~2000px on the long edge (a
// deliberate middle ground: the appearance standard judges 0.8 mm paint spots, so
// this keeps defects readable while cutting file size ~60–70% from a raw 3–5 MB
// camera photo). FAIL-SAFE: any problem returns the original file untouched, so a
// photo is never lost or corrupted by compression. Videos are never touched.
async function compressImage(file: Blob, maxDim = 2000, targetBytes = 1_200_000): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file)
    let w = bmp.width, h = bmp.height
    const scale = Math.min(1, maxDim / Math.max(w, h))
    w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bmp.close?.(); return file }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const encode = (q: number) => new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', q))
    let q = 0.82
    let out = await encode(q)
    while (out && out.size > targetBytes && q > 0.45) { q -= 0.1; out = await encode(q) }
    // Only use it if it actually helped (a tiny photo can re-encode larger).
    return (out && out.size < file.size) ? out : file
  } catch { return file }
}

// Queue a photos-table row that couldn't be inserted (offline). Returns true if
// it was queued, so callers can distinguish "saved locally" from "lost".
async function queuePhotoRow(row: Omit<PendingPhotoRow, 'id' | 'savedAt' | 'inspector_id'>): Promise<boolean> {
  return savePendingPhotoRow({
    ...row,
    inspector_id: await currentUserId(),
    id: (globalThis.crypto?.randomUUID?.()) || `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    savedAt: new Date().toISOString(),
  })
}

export const MEAS_UNIT: Record<string, string> = {
  coating_total: 'µm', coating_machined: 'µm',
  bal_b: 'g', bal_c: 'g', bal_bc: 'g', wheel_weight: 'kg',
}
export const getMeasUnit = (key: string) => MEAS_UNIT[key] || 'mm'

// Defect-type options apply ONLY to the appearance areas. Every other
// parameter just needs a photo (a fail already means it missed the standard).
const APPEARANCE_DEFECTS = [
  { value: 'paint_inclusion', label: 'Paint Inclusions / 漆点杂质' },
  { value: 'casting_porosity', label: 'Casting Failure / Porosity / 铸造缺陷·砂孔' },
  { value: 'scratch_hair_lint', label: 'Scratches / Hair Lint / 划痕·毛丝' },
]
const DEFECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  area_a: APPEARANCE_DEFECTS, area_b: APPEARANCE_DEFECTS, area_c: APPEARANCE_DEFECTS,
  area_c1: APPEARANCE_DEFECTS, area_d: APPEARANCE_DEFECTS,
  area_e: [{ value: 'burrs_tpms_hole', label: 'Burrs on TPMS Hole / TPMS孔毛刺' }],
}

interface BaseProps {
  inspectionId: string
  itemKey: string; itemLabel: string; pieceNo: number
  tab: 'form'|'measure'|'pallet'|'extra'|'100pct'
  onDone: () => void; onClose: () => void
}

// ── Media capture: photo or video ──
// deferUpload (v104): for INSPECTION photos, don't upload here at all — compress,
// save to the device, and return immediately so the inspector can save and move to
// the next parameter without waiting. The row is queued by the modal and the
// background sync uploads it (then deletes the local copy). This is also what fixes
// "save before the upload finishes and the +1 doesn't show": the photo is recorded
// from the local queue instantly, not gated on the upload. Container photos leave
// deferUpload off and keep uploading inline (they're online-only).
export function MediaCapture({ onUploaded, label, deferUpload }: { onUploaded: (path: string, type: 'photo'|'video') => void; label: string; deferUpload?: boolean }) {
  const { t } = useI18n()
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // B6 Stage 3: the storage path is minted HERE, before any network call, so an
  // offline capture can be stored under the exact path it will eventually occupy
  // in the bucket. Sync then uploads to that same path — nothing to reconcile.
  const upload = async (f: File, type: 'photo'|'video') => {
    const ext = type === 'video' ? 'mp4' : 'jpg'
    const path = `${crypto.randomUUID()}.${ext}`

    // Videos can be hundreds of MB. Offline they sit on the phone until sync, so
    // let the inspector decide whether this one is worth the space.
    if (type === 'video' && isOffline()) {
      if (!confirm(t('offlineVideoWarn').replace('{SIZE}', fmtMB(f.size)))) return
    }

    setUploading(true)
    // Compress photos (never videos). Fail-safe: returns the original on any error.
    const blob: Blob = type === 'photo' ? await compressImage(f) : f

    const keepLocally = async (): Promise<boolean> => {
      const ok = await saveLocalMedia(path, blob, type)
      if (!ok) { alert(t('mediaSaveFailed')); return false }
      onUploaded(path, type)   // caller carries on exactly as if it had uploaded
      return true
    }

    // Inspection photos: defer the upload to the background queue (non-blocking).
    // Same local-save path as offline — the modal queues the row + kicks a sync.
    if (deferUpload || isOffline()) { setUploading(false); await keepLocally(); return }

    // Container / online-only: weak-WiFi retry up to 3 times before falling back.
    let error: { message: string } | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await supabase.storage.from('qc-photos').upload(path, blob, { contentType: blob.type, upsert: true })
        error = res.error
      } catch (e) { error = { message: e instanceof Error ? e.message : String(e) } }
      if (!error) break
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
    }
    setUploading(false)
    if (!error) { onUploaded(path, type); return }
    // Upload failed (dead uplink, captive portal, weak signal) — keep it and let
    // the background sync upload on reconnect.
    await keepLocally()
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {/* These handlers are DELIBERATELY synchronous fire-and-forget, exactly the
          shape that shipped online uploads reliably from day one. v97 made them
          async (await upload, then clear the input) on a timing theory that the
          evidence disproves — online uploads always read the File AFTER the input
          was cleared and always worked — and the async form broke ONLINE capture
          on iOS (v98 revert). DO NOT re-introduce an await here. */}
      <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f,'photo'); e.currentTarget.value='' }} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f,'video'); e.currentTarget.value='' }} />
      <button className="btn ghost" style={{ flex: 1 }} disabled={uploading} onClick={() => photoRef.current?.click()}>
        📷 {label || 'Photo'}
      </button>
      <button className="btn ghost" style={{ flex: 1 }} disabled={uploading} onClick={() => videoRef.current?.click()}>
        🎥 Video
      </button>
    </div>
  )
}

// ── Media preview thumbnail ──
export function MediaThumb({ type, url, onClick }: { path?: string; type?: string; url: string; onClick?: () => void }) {
  if (!url) return <div style={{ width: 80, height: 80, background: 'var(--steel)', borderRadius: 8, display:'grid', placeItems:'center', fontSize:12 }}>…</div>
  if (type === 'video') {
    return (
      <div style={{ position:'relative', width:80, height:80, borderRadius:8, overflow:'hidden', cursor:'pointer', background:'#000' }} onClick={onClick}>
        <video src={url} style={{ width:'100%', height:'100%', objectFit:'cover' }} muted />
        <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', background:'rgba(0,0,0,.35)' }}>
          <span style={{ fontSize:24 }}>▶</span>
        </div>
      </div>
    )
  }
  return <img src={url} style={{ width:80, height:80, objectFit:'cover', borderRadius:8, cursor:'pointer' }} onClick={onClick} />
}

// ── FAIL MODAL ──────────────────────────────────────────────
export function DefectModal({ inspectionId, itemKey, itemLabel, pieceNo, tab, onDone, onClose }: BaseProps) {
  const { t } = useI18n()
  const defectOptions = DEFECT_OPTIONS[itemKey]
  const [defectType, setDefectType] = useState(defectOptions ? defectOptions[0].value : 'unspecified')
  const [measValue, setMeasValue] = useState('')
  const [comment, setComment] = useState('')
  const [mediaPath, setMediaPath] = useState<string|null>(null)
  const [mediaType, setMediaType] = useState<'photo'|'video'>('photo')
  const [mediaUrl, setMediaUrl] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const unit = tab === 'measure' ? getMeasUnit(itemKey) : ''

  const save = async () => {
    setSaving(true)
    const fields = {
      inspection_id: inspectionId, piece_no: pieceNo, tab,
      section: tab.toUpperCase(), item_key: itemKey, item_label: itemLabel,
      defect_type: defectType, severity: 'na',
      measurement_value: measValue !== '' ? +measValue : null,
      measurement_unit: unit || 'mm', comment, is_extra_piece: tab === 'extra',
    }
    // Offline the defect row can't be written — offlineSync.rebuildDefects
    // recreates it from form_data at sync time, so losing it here is safe.
    // Known-offline: skip these entirely rather than waiting for each one to time
    // out. They HANG offline (they don't fail fast), which is what made the first
    // offline photo save take about a minute.
    let defectId: string | undefined
    if (!isOffline()) {
      try {
        const { data: existing } = await supabase.from('defects').select('id')
          .eq('inspection_id', inspectionId).eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tab)
          .limit(1).maybeSingle()
        defectId = existing?.id as string | undefined
        if (defectId) await supabase.from('defects').update(fields).eq('id', defectId)
        else { const { data } = await supabase.from('defects').insert(fields).select('id').single(); defectId = data?.id }
      } catch { /* offline — defect is rebuilt at sync */ }
    }

    if (mediaPath) {
      // v104 — ALWAYS queue the photo (online too) so saving is instant and the
      // upload happens in the background. The +1 reflects immediately because the
      // photo comes from the local queue, not from a completed upload. defect_id is
      // linked during sync by matching item_key + piece_no against the defect.
      const ok = await queuePhotoRow({
        inspection_id: inspectionId, container_loading_id: null,
        storage_path: mediaPath, media_type: mediaType, is_pass_photo: false,
        item_key: itemKey, piece_no: pieceNo, comment,
      })
      if (!ok) { setSaving(false); alert(t('mediaSaveFailed')); return }
      void syncPendingMedia(await currentUserId())   // kick the background upload now (no-op offline)
    }
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ color:'var(--fail)', marginBottom:14 }}>⚠ {t('failDefect')}</h2>
        <div className="card" style={{ background:'var(--fail-bg)', marginBottom:14, padding:10 }}>
          <div><b>{t('inspParam')}:</b> {itemLabel}</div>
          <div><b>{t('piece')}:</b> {pieceNo > 0 ? pieceNo : `extra ${-pieceNo}`}</div>
        </div>
        <div style={{ display:'grid', gap:10 }}>
          {defectOptions && (
            <label className="fld"><span>{t('defectType')}</span>
              <select className="sel" value={defectType} onChange={e => setDefectType(e.target.value)}>
                {defectOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
          )}
          {(tab === 'measure' || tab === 'form') && unit && (
            <label className="fld"><span>{t('measurement')} ({unit}) — optional</span>
              <input className="txt" type="number" step="0.01" inputMode="decimal" value={measValue}
                onChange={e => setMeasValue(e.target.value)} placeholder={`Value in ${unit}`} />
            </label>
          )}
          <label className="fld"><span>{t('comment')}</span>
            <textarea className="txt" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
          </label>
          <div>
            <div className="fld"><span>Media (optional)</span></div>
            {mediaUrl
              ? <div style={{ marginBottom:8 }}>
                  {mediaType === 'video'
                    ? <video src={mediaUrl} controls style={{ width:'100%', maxHeight:200, borderRadius:8 }} />
                    : <img src={mediaUrl} style={{ width:'100%', maxHeight:200, objectFit:'cover', borderRadius:8 }} />}
                </div>
              : <div style={{ background:'var(--steel)', height:80, borderRadius:8, display:'grid', placeItems:'center', color:'var(--ink-soft)', marginBottom:8 }}>No media yet</div>}
            <MediaCapture deferUpload label={mediaUrl ? 'Retake' : t('takePhoto')} onUploaded={async (path, type) => { setMediaPath(path); setMediaType(type); const u = await mediaUrlFor(path); if (u) setMediaUrl(u) }} />
          </div>
        </div>
        <div className="row" style={{ marginTop:16 }}>
          <button className="btn danger" style={{ flex:1 }} disabled={saving} onClick={save}>
            {saving ? '…' : t('saveDefect')}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── PASS MODAL ──────────────────────────────────────────────
export function PassPhotoModal({ inspectionId, itemKey, itemLabel, pieceNo, tab: _tab, onDone, onClose }: BaseProps) {
  const { t } = useI18n()
  const [comment, setComment] = useState('')
  const [mediaPath, setMediaPath] = useState<string|null>(null)
  const [mediaType, setMediaType] = useState<'photo'|'video'>('photo')
  const [mediaUrl, setMediaUrl] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!mediaPath) { onDone(); return }
    setSaving(true)
    // v104 — always queue + background-upload (see DefectModal.save). Instant save,
    // upload in the background, +1 reflects immediately, local copy auto-deleted
    // once uploaded. No inline insert to hang on a slow/failing connection.
    {
      const ok = await queuePhotoRow({
        inspection_id: inspectionId, container_loading_id: null,
        storage_path: mediaPath, media_type: mediaType, is_pass_photo: true,
        item_key: itemKey, piece_no: pieceNo, comment,
      })
      if (!ok) { setSaving(false); alert(t('mediaSaveFailed')); return }
      void syncPendingMedia(await currentUserId())
    }
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ color:'var(--pass)', marginBottom:14 }}>✓ {t('passPhoto')}</h2>
        <div className="card" style={{ background:'var(--pass-bg)', marginBottom:14, padding:10 }}>
          <div><b>{t('inspParam')}:</b> {itemLabel}</div>
          <div><b>{t('piece')}:</b> {pieceNo > 0 ? pieceNo : `extra ${-pieceNo}`}</div>
        </div>
        {mediaUrl
          ? <div style={{ marginBottom:10 }}>
              {mediaType === 'video'
                ? <video src={mediaUrl} controls style={{ width:'100%', maxHeight:220, borderRadius:8 }} />
                : <img src={mediaUrl} style={{ width:'100%', maxHeight:220, objectFit:'cover', borderRadius:8 }} />}
            </div>
          : <div style={{ background:'var(--steel)', height:100, borderRadius:8, display:'grid', placeItems:'center', color:'var(--ink-soft)', marginBottom:10 }}>No media yet</div>}
        <MediaCapture deferUpload label={mediaUrl ? 'Retake' : t('takePhoto')} onUploaded={async (path, type) => { setMediaPath(path); setMediaType(type); const u = await mediaUrlFor(path); if (u) setMediaUrl(u) }} />
        <label className="fld" style={{ marginTop:10 }}><span>{t('comment')}</span>
          <textarea className="txt" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
        </label>
        <div className="row" style={{ marginTop:14 }}>
          <button className="btn ok" style={{ flex:1 }} disabled={saving} onClick={save}>
            {saving ? '…' : t('save')}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── REASSIGN MODAL ──────────────────────────────────────────
interface ReassignProps {
  photo: { id: string; item_key: string; piece_no: number; is_pass_photo: boolean; defect_id: string|null }
  allItems: { key: string; label: string }[]
  maxPiece: number
  onDone: () => void; onClose: () => void
}
export function ReassignModal({ photo, allItems, maxPiece, onDone, onClose }: ReassignProps) {
  const { t } = useI18n()
  const [itemKey, setItemKey] = useState(photo.item_key)
  const [pieceNo, setPieceNo] = useState(photo.piece_no)
  const [isPass, setIsPass] = useState(photo.is_pass_photo)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    // Update photo record (return the row so we can detect a silent RLS 0-row update)
    const { data, error } = await supabase.from('photos').update({
      item_key: itemKey, piece_no: pieceNo, is_pass_photo: isPass,
      reassigned_from: { item_key: photo.item_key, piece_no: photo.piece_no },
    }).eq('id', photo.id).select('id')
    if (error) { setSaving(false); alert('Reassign failed: ' + error.message); return }
    if (!data || data.length === 0) {
      setSaving(false)
      alert('Reassignment did not save — the database blocked the update (photos RLS). Run migration 06 in the Supabase SQL Editor, then try again.')
      return
    }
    // If it was linked to a defect and now it's pass, unlink
    if (isPass && photo.defect_id) {
      await supabase.from('photos').update({ defect_id: null }).eq('id', photo.id)
    }
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom:14 }}>🔄 Reassign Photo/Video</h2>
        <div style={{ display:'grid', gap:10 }}>
          <label className="fld"><span>Inspection parameter</span>
            <select className="sel" value={itemKey} onChange={e => setItemKey(e.target.value)}>
              {allItems.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </label>
          <label className="fld"><span>{t('piece')}</span>
            <input className="txt" type="number" min={0} max={maxPiece} value={pieceNo}
              onChange={e => setPieceNo(+e.target.value)} />
          </label>
          <label className="fld"><span>Result</span>
            <select className="sel" value={isPass ? 'pass' : 'fail'} onChange={e => setIsPass(e.target.value === 'pass')}>
              <option value="pass">Pass ✓</option>
              <option value="fail">Fail ✗</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop:16 }}>
          <button className="btn" style={{ flex:1 }} disabled={saving} onClick={save}>
            {saving ? '…' : 'Save reassignment'}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── COPY MODAL ──────────────────────────────────────────────
interface CopyProps {
  inspectionId?: string
  containerLoadingId?: string
  photo: { storage_path: string; media_type?: string; is_pass_photo: boolean; piece_no: number; item_key: string; comment?: string }
  allItems: { key: string; label: string }[]
  onDone: () => void; onClose: () => void
}
export function CopyModal({ inspectionId, containerLoadingId, photo, allItems, onDone, onClose }: CopyProps) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const toggle = (k: string) => setSelected(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })

  const save = async () => {
    if (selected.size === 0) { onClose(); return }
    setSaving(true)
    const rows = [...selected].map(k => ({
      ...(containerLoadingId ? { container_loading_id: containerLoadingId } : { inspection_id: inspectionId }),
      storage_path: photo.storage_path, media_type: photo.media_type || 'photo',
      is_pass_photo: photo.is_pass_photo, item_key: k, piece_no: photo.piece_no, comment: photo.comment || '',
      reassigned_from: { item_key: photo.item_key, piece_no: photo.piece_no, copied: true },
    }))
    const { error } = await supabase.from('photos').insert(rows)
    setSaving(false)
    if (error) { alert('Copy failed: ' + error.message); return }
    onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom:6 }}>⧉ Copy to parameters</h2>
        <p className="muted" style={{ fontSize:13, marginTop:0, marginBottom:12 }}>
          Attach this same {photo.media_type === 'video' ? 'video' : 'photo'} to other inspection parameters
          (e.g. one back-of-wheel shot for every back-marking check). The original stays where it is.
        </p>
        <div style={{ maxHeight:'46vh', overflowY:'auto', display:'grid', gap:4 }}>
          {allItems.filter(i => i.key !== photo.item_key).map(i => {
            const on = selected.has(i.key)
            return (
              <button key={i.key} onClick={() => toggle(i.key)}
                style={{ display:'flex', alignItems:'center', gap:8, textAlign:'left', padding:'9px 10px', borderRadius:8,
                  border:`1.5px solid ${on ? 'var(--navy)' : 'var(--line)'}`, background: on ? 'var(--navy)' : '#fff',
                  color: on ? '#fff' : 'inherit', cursor:'pointer', fontSize:14 }}>
                <span style={{ fontWeight:700 }}>{on ? '☑' : '☐'}</span> {i.label}
              </button>
            )
          })}
        </div>
        <div className="row" style={{ marginTop:16 }}>
          <button className="btn" style={{ flex:1 }} disabled={saving || selected.size === 0} onClick={save}>
            {saving ? '…' : `Copy to ${selected.size} parameter${selected.size === 1 ? '' : 's'}`}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}
