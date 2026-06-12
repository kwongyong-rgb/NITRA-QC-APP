import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

// Unit of measure per measurement parameter
export const MEAS_UNIT: Record<string, string> = {
  coating_total: 'µm', coating_machined: 'µm',
  bal_b: 'g', bal_c: 'g', bal_bc: 'g',
}
export const getMeasUnit = (key: string) => MEAS_UNIT[key] || 'mm'

const DEFECT_TYPES = [
  'paint_inclusion', 'porosity', 'scratch_hair_lint', 'hat_mark',
  'coating_issue', 'marking_error', 'out_of_tolerance', 'packing_defect', 'other'
]
const DEFECT_LABELS: Record<string, string> = {
  paint_inclusion: 'Paint Inclusion / 漆点',
  porosity: 'Porosity / 砂孔',
  scratch_hair_lint: 'Scratch / Hair Lint / 划痕',
  hat_mark: 'Hat Mark / 压痕',
  coating_issue: 'Coating Issue / 涂层问题',
  marking_error: 'Marking Error / 标识错误',
  out_of_tolerance: 'Out of Tolerance / 超出公差',
  packing_defect: 'Packing Defect / 包装缺陷',
  other: 'Other / 其他',
}

interface BaseProps {
  inspectionId: string
  itemKey: string
  itemLabel: string
  pieceNo: number
  tab: 'form' | 'measure' | 'pallet' | 'extra' | '100pct'
  onDone: () => void
  onClose: () => void
}

// ── FAIL MODAL ── full defect detail screen
export function DefectModal({ inspectionId, itemKey, itemLabel, pieceNo, tab, onDone, onClose }: BaseProps) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [defectType, setDefectType] = useState('porosity')
  const [severity, setSeverity] = useState('minor')
  const [measValue, setMeasValue] = useState('')
  const [comment, setComment] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const unit = tab === 'measure' ? getMeasUnit(itemKey) : ''

  const uploadPhoto = async (file: File) => {
    const path = `${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('qc-photos').upload(path, file, { contentType: file.type })
    if (!error) { setPhotoPath(path); setPhotoUrl(URL.createObjectURL(file)) }
  }

  const save = async () => {
    setSaving(true)
    // Upsert: an auto-logged defect may already exist for this item+piece
    const { data: existing } = await supabase.from('defects')
      .select('id').eq('inspection_id', inspectionId)
      .eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tab)
      .limit(1).maybeSingle()
    const fields = {
      inspection_id: inspectionId, piece_no: pieceNo, tab,
      section: tab.toUpperCase(), item_key: itemKey, item_label: itemLabel,
      defect_type: defectType, severity,
      measurement_value: measValue !== '' ? +measValue : null,
      measurement_unit: unit || 'mm',
      comment, is_extra_piece: tab === 'extra',
    }
    let defectId = existing?.id as string | undefined
    if (defectId) await supabase.from('defects').update(fields).eq('id', defectId)
    else {
      const { data: ins } = await supabase.from('defects').insert(fields).select('id').single()
      defectId = ins?.id
    }
    if (defectId && photoPath) {
      await supabase.from('photos').insert({
        inspection_id: inspectionId, defect_id: defectId,
        storage_path: photoPath, is_pass_photo: false,
        item_key: itemKey, piece_no: pieceNo, comment,
      })
    }
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ color: 'var(--fail)', marginBottom: 14 }}>⚠ Fail — Log Defect / 记录缺陷</h2>
        <div className="card" style={{ background: 'var(--fail-bg)', marginBottom: 14, padding: 10 }}>
          <div><b>Parameter / 检验项目:</b> {itemLabel}</div>
          <div><b>Piece / 件号:</b> {pieceNo}</div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <label className="fld"><span>Defect type / 缺陷类型</span>
            <select className="sel" value={defectType} onChange={e => setDefectType(e.target.value)}>
              {DEFECT_TYPES.map(d => <option key={d} value={d}>{DEFECT_LABELS[d]}</option>)}
            </select>
          </label>
          <label className="fld"><span>Severity / 严重度</span>
            <select className="sel" value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="critical">Critical / 严重</option>
              <option value="major">Major / 主要</option>
              <option value="minor">Minor / 轻微</option>
            </select>
          </label>
          {(tab === 'measure' || tab === 'form') && (
            <label className="fld">
              <span>Measurement {unit ? `(${unit})` : ''} / 测量值</span>
              <input className="txt" type="number" step="0.01" inputMode="decimal"
                value={measValue} onChange={e => setMeasValue(e.target.value)}
                placeholder={`Enter value in ${unit || 'mm'}`} />
            </label>
          )}
          <label className="fld"><span>Comment / 备注 (optional)</span>
            <textarea className="txt" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
          </label>
          <div>
            <span className="fld"><span>Photo / 照片</span></span>
            {photoUrl
              ? <img src={photoUrl} style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8 }} />
              : <div style={{ background: 'var(--steel)', height: 100, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--ink-soft)' }}>No photo yet</div>}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.currentTarget.value = '' }} />
            <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => fileRef.current?.click()}>
              📷 {photoUrl ? 'Retake photo' : t('takePhoto')}
            </button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn danger" style={{ flex: 1 }} disabled={saving} onClick={save}>
            {saving ? '…' : 'Save Defect / 保存缺陷'}
          </button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── PASS MODAL ── photo + optional comment only
export function PassPhotoModal({ inspectionId, itemKey, itemLabel, pieceNo, tab, onDone, onClose }: BaseProps) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [comment, setComment] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  void tab  // used for routing only

  const uploadPhoto = async (file: File) => {
    const path = `${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('qc-photos').upload(path, file, { contentType: file.type })
    if (!error) { setPhotoPath(path); setPhotoUrl(URL.createObjectURL(file)) }
  }

  const save = async () => {
    if (!photoPath) { onDone(); return }   // nothing to store — photo is optional
    setSaving(true)
    await supabase.from('photos').insert({
      inspection_id: inspectionId, storage_path: photoPath,
      is_pass_photo: true, item_key: itemKey, piece_no: pieceNo,
      comment, uploaded_by: null,
    })
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ color: 'var(--pass)', marginBottom: 14 }}>✓ Pass — Take Photo / 合格拍照</h2>
        <div className="card" style={{ background: 'var(--pass-bg)', marginBottom: 14, padding: 10 }}>
          <div><b>Item / 项目:</b> {itemLabel}</div>
          <div><b>Piece / 件号:</b> {pieceNo}</div>
        </div>
        {photoUrl
          ? <img src={photoUrl} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
          : <div style={{ background: 'var(--steel)', height: 120, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--ink-soft)', marginBottom: 10 }}>No photo yet</div>}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.currentTarget.value = '' }} />
        <button className="btn ghost" style={{ width: '100%', marginBottom: 10 }} onClick={() => fileRef.current?.click()}>
          📷 {photoUrl ? 'Retake' : t('takePhoto')}
        </button>
        <label className="fld"><span>Comment / 备注 (optional)</span>
          <textarea className="txt" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
        </label>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn ok" style={{ flex: 1 }} disabled={saving} onClick={save}>
            {saving ? '…' : 'Save / 保存'}
          </button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
