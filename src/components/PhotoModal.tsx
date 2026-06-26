import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

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
export function MediaCapture({ onUploaded, label }: { onUploaded: (path: string, type: 'photo'|'video') => void; label: string }) {
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const upload = async (f: File, type: 'photo'|'video') => {
    setUploading(true)
    const ext = type === 'video' ? 'mp4' : 'jpg'
    const path = `${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('qc-photos').upload(path, f, { contentType: f.type })
    setUploading(false)
    if (!error) onUploaded(path, type)
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
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
    const { data: existing } = await supabase.from('defects').select('id')
      .eq('inspection_id', inspectionId).eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tab)
      .limit(1).maybeSingle()
    const fields = {
      inspection_id: inspectionId, piece_no: pieceNo, tab,
      section: tab.toUpperCase(), item_key: itemKey, item_label: itemLabel,
      defect_type: defectType, severity: 'na',
      measurement_value: measValue !== '' ? +measValue : null,
      measurement_unit: unit || 'mm', comment, is_extra_piece: tab === 'extra',
    }
    let defectId = existing?.id as string|undefined
    if (defectId) await supabase.from('defects').update(fields).eq('id', defectId)
    else { const { data } = await supabase.from('defects').insert(fields).select('id').single(); defectId = data?.id }
    if (defectId && mediaPath) {
      await supabase.from('photos').insert({
        inspection_id: inspectionId, defect_id: defectId,
        storage_path: mediaPath, media_type: mediaType,
        is_pass_photo: false, item_key: itemKey, piece_no: pieceNo, comment,
      })
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
            <MediaCapture label={mediaUrl ? 'Retake' : t('takePhoto')} onUploaded={async (path, type) => { setMediaPath(path); setMediaType(type); const {data}=await supabase.storage.from('qc-photos').createSignedUrl(path,3600); if(data?.signedUrl) setMediaUrl(data.signedUrl) }} />
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
    await supabase.from('photos').insert({
      inspection_id: inspectionId, storage_path: mediaPath, media_type: mediaType,
      is_pass_photo: true, item_key: itemKey, piece_no: pieceNo, comment,
    })
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
        <MediaCapture label={mediaUrl ? 'Retake' : t('takePhoto')} onUploaded={async (path, type) => { setMediaPath(path); setMediaType(type); const {data}=await supabase.storage.from('qc-photos').createSignedUrl(path,3600); if(data?.signedUrl) setMediaUrl(data.signedUrl) }} />
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
