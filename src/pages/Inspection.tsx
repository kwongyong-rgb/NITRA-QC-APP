import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { SECTIONS, MEAS_SECTIONS, MEAS_COLS, PHOTO_SLOTS, PALLET_ITEMS, type Sku } from '../lib/standard'
import { evaluateAll, emptyFormData, type FormData, type PFNA, type ItemVerdict } from '../lib/rules'
import { DefectModal, PassPhotoModal } from '../components/PhotoModal'
import ExtraPieceScreen from '../components/ExtraPieceScreen'
import HundredPctCheck from '../components/HundredPctCheck'
import type { Profile } from '../App'

type Tab5 = 'form' | 'measure' | 'pallet' | 'extra' | '100pct'

interface Insp {
  id: string; part_no: string; po_no: string; batch: string; lot_size: number
  app_sample: number; fun_sample: number; status: string; inspector_id: string
  form_data: FormData & { hundred_pct?: Record<string, Record<string, PFNA>> }
  pallet_data: Record<string, PFNA>
  summary: { remarks?: string; disposition?: string }
  review_note: string
}
interface Photo { id: string; storage_path: string; defect_id: string | null; is_pass_photo: boolean; item_key: string; piece_no: number; comment: string; checklist_key: string }
interface Defect { id: string; piece_no: number; item_key: string; item_label: string; defect_type: string; severity: string; measurement_value: number | null; measurement_unit: string; comment: string; tab: string }

type ModalState =
  | { type: 'fail'; itemKey: string; itemLabel: string; pieceNo: number; tab: Tab5 }
  | { type: 'pass'; itemKey: string; itemLabel: string; pieceNo: number; tab: Tab5 }
  | { type: 'extra'; verdict: ItemVerdict; result: 'P' | 'F' }
  | { type: 'preview'; url: string }
  | { type: 'assign'; slotKey: string; slotLabel: string }
  | null

const TABS = ['form', 'measure', 'photos', 'pallet', 'summary', '100pct'] as const

// Auto-suggest mapping: item_key prefix → photo slot
const SLOT_SUGGEST: Record<string, string[]> = {
  batch_laser: ['laser_format'],
  wheel_front: ['area_a', 'area_b', 'area_c', 'hat_marks', 'colour_match', 'orange_peel'],
  wheel_back: ['area_c1', 'area_d', 'area_e', 'mark_sae', 'mark_size', 'mark_pcd', 'mark_cb', 'mark_et', 'mark_nitra', 'rear_bore_paint'],
  box_label: ['bx_label', 'bx_upc', 'bx_proddate', 'bx_stick', 'bx_design'],
  packing_inside: ['pk_cap', 'pk_foam', 'pk_cloth', 'pk_hoop', 'pk_bag', 'pk_toppad', 'pk_sideboard', 'pk_fullface'],
  pallet_full: ['pl_grouped', 'pl_wood', 'pl_height', 'pl_straps', 'pl_wrap', 'pl_label4', 'pl_photo'],
  container_empty: ['ct_photo_before'],
  container_door: ['ct_labels_doors'],
}

export default function Inspection({ profile }: { profile: Profile }) {
  const { id } = useParams()
  const { t, bi } = useI18n()
  const [insp, setInsp] = useState<Insp | null>(null)
  const [sku, setSku] = useState<Sku | null>(null)
  const [defects, setDefects] = useState<Defect[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<typeof TABS[number]>('form')
  const [piece, setPiece] = useState(1)
  const [modal, setModal] = useState<ModalState>(null)
  const [submitMsg, setSubmitMsg] = useState('')
  const extrasRequired = 4
  const slotFileRef = useRef<HTMLInputElement>(null)
  const [slotForCapture, setSlotForCapture] = useState('')

  const load = useCallback(async () => {
    const { data: i } = await supabase.from('inspections').select('*').eq('id', id).single()
    if (!i) return
    const fi: Insp = {
      ...(i as Insp),
      form_data: { ...emptyFormData(), ...(i as Insp).form_data },
      pallet_data: (i as Insp).pallet_data || {},
      summary: (i as Insp).summary || {},
    }
    setInsp(fi)
    const { data: s } = await supabase.from('skus').select('*').eq('part_no', i.part_no).single()
    setSku(s as Sku)
    const { data: d } = await supabase.from('defects').select('*').eq('inspection_id', id).order('created_at')
    setDefects((d as Defect[]) || [])
    const { data: p } = await supabase.from('photos').select('*').eq('inspection_id', id).order('created_at')
    setPhotos((p as Photo[]) || [])
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    photos.forEach(async p => {
      if (!photoUrls[p.storage_path]) {
        const { data } = await supabase.storage.from('qc-photos').createSignedUrl(p.storage_path, 3600)
        if (data?.signedUrl) setPhotoUrls(prev => ({ ...prev, [p.storage_path]: data.signedUrl }))
      }
    })
  }, [photos]) // eslint-disable-line

  const editable = !!(insp && (insp.status === 'draft' || insp.status === 'rejected') && insp.inspector_id === profile.id)

  const saveFd = async (fd: Insp['form_data']) => {
    if (!insp) return
    setInsp({ ...insp, form_data: fd })
    const { error } = await supabase.from('inspections')
      .update({ form_data: fd, updated_at: new Date().toISOString() }).eq('id', insp.id)
    if (error) alert('Save failed: ' + error.message)
  }

  // ── AUTO DEFECT SYNC ─────────────────────────────────────────
  // Any F automatically creates a defect record (photo optional).
  // Removing the F removes the auto record (and its photos).
  const ensureDefect = async (itemKey: string, itemLabel: string, pieceNo: number, tabName: string) => {
    if (!insp) return
    const { data: existing } = await supabase.from('defects')
      .select('id').eq('inspection_id', insp.id)
      .eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tabName)
      .limit(1).maybeSingle()
    if (!existing) {
      await supabase.from('defects').insert({
        inspection_id: insp.id, piece_no: pieceNo, tab: tabName,
        section: tabName.toUpperCase(), item_key: itemKey, item_label: itemLabel,
        defect_type: 'unspecified', severity: 'minor',
        measurement_value: null, measurement_unit: 'mm',
        comment: '', is_extra_piece: tabName === 'extra',
      })
    }
  }
  const removeDefect = async (itemKey: string, pieceNo: number, tabName: string) => {
    if (!insp) return
    await supabase.from('defects').delete()
      .eq('inspection_id', insp.id).eq('item_key', itemKey)
      .eq('piece_no', pieceNo).eq('tab', tabName)
  }

  const setResult = async (itemKey: string, itemLabel: string, pieceNo: number, val: PFNA, isMeas: boolean) => {
    if (!insp) return
    const rkey = `${itemKey}:${pieceNo}`
    const fd = { ...insp.form_data }
    const old = isMeas ? fd.meas_results[rkey] : fd.results[rkey]
    if (isMeas) fd.meas_results = { ...fd.meas_results, [rkey]: val }
    else fd.results = { ...fd.results, [rkey]: val }
    await saveFd(fd)
    const tabName = isMeas ? 'measure' : 'form'
    if (val === 'F' && old !== 'F') await ensureDefect(itemKey, itemLabel, pieceNo, tabName)
    if (old === 'F' && val !== 'F') await removeDefect(itemKey, pieceNo, tabName)
    load()
  }

  // Undo all selections in a section (current piece)
  const undoAllSection = async (sectionKey: string) => {
    if (!insp) return
    const sec = SECTIONS.find(s => s.key === sectionKey)
    if (!sec) return
    const fd = { ...insp.form_data, results: { ...insp.form_data.results } }
    for (const item of sec.items) {
      const rkey = `${item.key}:${piece}`
      const old = fd.results[rkey]
      delete fd.results[rkey]
      if (old === 'F') await removeDefect(item.key, piece, 'form')
    }
    await saveFd(fd)
    load()
  }

  // Select all items in a section (current piece)
  const selectAllSection = async (sectionKey: string, val: PFNA) => {
    if (!insp) return
    const sec = SECTIONS.find(s => s.key === sectionKey)
    if (!sec) return
    const fd = { ...insp.form_data, results: { ...insp.form_data.results } }
    const changes: { itemKey: string; itemLabel: string; old: PFNA }[] = []
    for (const item of sec.items) {
      const n = item.group === 'A' ? insp.app_sample : insp.fun_sample
      if (piece > n) continue
      const rkey = `${item.key}:${piece}`
      changes.push({ itemKey: item.key, itemLabel: bi(item.label), old: fd.results[rkey] })
      fd.results[rkey] = val
    }
    await saveFd(fd)
    for (const c of changes) {
      if (val === 'F' && c.old !== 'F') await ensureDefect(c.itemKey, c.itemLabel, piece, 'form')
      if (c.old === 'F' && val !== 'F') await removeDefect(c.itemKey, piece, 'form')
    }
    load()
  }

  // ── RULE ENGINE ──────────────────────────────────────────────
  const allFormItems = useMemo(() => SECTIONS.flatMap(s => s.items.map(i => ({ key: i.key, label: bi(i.label), group: i.group }))), [bi])
  const allMeasItems = useMemo(() => MEAS_COLS.map(c => ({ key: c.key, label: bi(c.label) })), [bi])

  const verdicts = useMemo(() => {
    if (!insp) return []
    return evaluateAll(insp.form_data, allFormItems, allMeasItems, insp.app_sample, insp.fun_sample, extrasRequired)
  }, [insp, allFormItems, allMeasItems])

  const addExtra = async (verdict: ItemVerdict, result: 'P' | 'F') => {
    if (!insp) return
    const fd = { ...insp.form_data }
    let idx: number
    if (verdict.tab === 'form') {
      const prev = fd.extra_results[verdict.key] || []
      idx = prev.length + 1
      fd.extra_results = { ...fd.extra_results, [verdict.key]: [...prev, result] }
    } else {
      const prev = fd.meas_extra_results[verdict.key] || []
      idx = prev.length + 1
      fd.meas_extra_results = { ...fd.meas_extra_results, [verdict.key]: [...prev, result] }
    }
    await saveFd(fd)
    if (result === 'F') await ensureDefect(verdict.key, `${verdict.label} (extra)`, -idx, 'extra')
    load()
  }

  const undoExtra = async (verdict: ItemVerdict) => {
    if (!insp) return
    const fd = { ...insp.form_data }
    let popped: PFNA, idx: number
    if (verdict.tab === 'form') {
      const prev = [...(fd.extra_results[verdict.key] || [])]
      popped = prev.pop(); idx = prev.length + 1
      fd.extra_results = { ...fd.extra_results, [verdict.key]: prev }
    } else {
      const prev = [...(fd.meas_extra_results[verdict.key] || [])]
      popped = prev.pop(); idx = prev.length + 1
      fd.meas_extra_results = { ...fd.meas_extra_results, [verdict.key]: prev }
    }
    await saveFd(fd)
    if (popped === 'F') await removeDefect(verdict.key, -idx, 'extra')
    load()
  }

  // ── SUBMIT with validation + clear feedback ─────────────────
  const submit = async () => {
    if (!insp) return
    const missing: string[] = []
    if (!insp.summary.disposition) missing.push('Final disposition / 最终处置')
    const pending = verdicts.filter(v => v.status === 'extra_needed')
    if (pending.length) missing.push(`Extra pieces still needed for: ${pending.map(v => v.label).join(', ')}`)
    if (missing.length) {
      alert('Cannot submit yet — please complete the following:\n\n• ' + missing.join('\n• '))
      return
    }
    const confirmed = confirm(
      `Submit this inspection for approval?\n\n` +
      `Part: ${insp.part_no}\n` +
      `PO: ${insp.po_no || '—'}\n` +
      `Lot: ${insp.lot_size} pcs\n` +
      `Defects: ${defects.length}\n` +
      `Disposition: ${insp.summary.disposition}\n\n` +
      `Once submitted, you cannot make changes unless the approver returns it.`
    )
    if (!confirmed) return
    const { error } = await supabase.from('inspections')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', insp.id)
    if (error) { alert('Submit failed: ' + error.message); return }
    setSubmitMsg('✓ Submitted for approval / 已提交审批')
    load()
  }

  if (!insp || !sku) return <div className="page" style={{ textAlign: 'center', paddingTop: 40 }}>Loading…</div>

  const getPhotosFor = (itemKey: string, pNo: number) =>
    photos.filter(p => p.item_key === itemKey && p.piece_no === pNo)

  const PlusBtn = ({ itemKey, itemLabel, pieceNo, result, tabName }: { itemKey: string; itemLabel: string; pieceNo: number; result: PFNA; tabName: Tab5 }) => {
    if (!result || result === 'NA' || !editable) return null
    const ph = getPhotosFor(itemKey, pieceNo)
    const hasFail = ph.some(p => !p.is_pass_photo)
    const hasPass = ph.some(p => p.is_pass_photo)
    const cls = result === 'F' ? (hasFail ? 'plus-btn has-fail-photo' : 'plus-btn') : (hasPass ? 'plus-btn has-photo' : 'plus-btn')
    return (
      <button className={cls} onClick={() => setModal({ type: result === 'F' ? 'fail' : 'pass', itemKey, itemLabel, pieceNo, tab: tabName })}>
        {ph.length > 0 ? `📷 ${ph.length}` : '📷+'}
      </button>
    )
  }

  const PFNAButtons = ({ val, itemKey, itemLabel, pieceNo, isMeas, tabName, onSet }:
    { val: PFNA; itemKey: string; itemLabel: string; pieceNo: number; isMeas: boolean; tabName: Tab5; onSet?: (v: PFNA) => void }) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="pfna">
        {(['P', 'F', 'NA'] as const).map(v => (
          <button key={v} disabled={!editable}
            className={`${v === 'P' ? 'p' : v === 'F' ? 'f' : 'n'} ${val === v ? 'on' : ''}`}
            onClick={() => {
              const newVal = val === v ? undefined : v
              if (onSet) onSet(newVal)
              else setResult(itemKey, itemLabel, pieceNo, newVal, isMeas)
            }}>
            {v}
          </button>
        ))}
      </div>
      <PlusBtn itemKey={itemKey} itemLabel={itemLabel} pieceNo={pieceNo} result={val} tabName={tabName} />
    </div>
  )

  const triggeredItems = verdicts.filter(v => v.status === 'full_inspection').map(v => ({ key: v.key, label: v.label }))
  const nPieces = insp.app_sample   // Form pieces (Marking/Packing/Box stay Fn but shown up to their sample)

  return (
    <div className="page">
      {/* Header */}
      <div className="card">
        <div className="row">
          <h2 style={{ flex: 1 }}>{insp.part_no} <span className={`pill ${insp.status}`}>{insp.status}</span></h2>
        </div>
        <p className="muted">{sku.model} · {sku.size} · PCD {sku.pcd} · ET {sku.offset_txt} · CB {sku.cb_mm} · {sku.finish}</p>
        <p className="muted">PO: {insp.po_no || '—'} · Batch: {insp.batch || '—'} · Lot: {insp.lot_size} · App sample: {insp.app_sample} · Fun sample: {insp.fun_sample}</p>
        {insp.status === 'rejected' && insp.review_note && <div className="banner bad" style={{ marginTop: 8 }}>↩ {insp.review_note}</div>}
        {submitMsg && <div className="banner ok" style={{ marginTop: 8 }}>{submitMsg}</div>}
      </div>

      {/* Live rule engine banners */}
      {verdicts.length === 0
        ? <div className="banner ok">✓ No defects flagged — on track / 暂无缺陷</div>
        : verdicts.map(v => (
          <div key={v.key} className={`banner ${v.status === 'full_inspection' ? 'bad' : v.status === 'extra_needed' ? 'warn' : 'ok'}`}>
            {v.status === 'full_inspection' && <div>⛔ <b>100% INSPECTION — {v.label}</b> (whole batch / 整批全检) → see the ⛔ 100% Check tab</div>}
            {v.status === 'extra_needed' && (
              <div>
                <div>⚠ <b>Inspect {v.extrasStillNeeded} more extra piece(s) for: {v.label}</b></div>
                <div className="extra-recorder" style={{ marginTop: 6 }}>
                  {v.extraResults.map((r, i) => (
                    <div key={i} className={`extra-dot ${r === 'P' ? 'p' : 'f'}`}>{r}</div>
                  ))}
                  {editable && v.extrasStillNeeded > 0 && (
                    <>
                      <button className="btn ok" style={{ minHeight: 38, padding: '6px 14px', fontSize: 14 }} onClick={() => setModal({ type: 'extra', verdict: v, result: 'P' })}>+ Pass</button>
                      <button className="btn danger" style={{ minHeight: 38, padding: '6px 14px', fontSize: 14 }} onClick={() => setModal({ type: 'extra', verdict: v, result: 'F' })}>+ Fail</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {v.status === 'monitor' && <div>👁 Below trigger — record & monitor: <b>{v.label}</b></div>}
          </div>
        ))}

      {/* Tabs */}
      <div className="tabs">
        {TABS.filter(k => k !== '100pct' || triggeredItems.length > 0).map(k => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}
            style={k === '100pct' ? { background: 'var(--fail)', color: '#fff', borderColor: 'var(--fail)' } : {}}>
            {k === 'form' ? 'Visual / 外观' : k === 'measure' ? 'Technical / 技术' : k === 'photos' ? `📷 ${t('photos')} (${photos.length})` : k === 'pallet' ? t('pallet') : k === '100pct' ? '⛔ 100% Check' : t('summary')}
          </button>
        ))}
      </div>

      {/* ── FORM TAB ── */}
      {tab === 'form' && (
        <>
          <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Piece / 件号:</span>
            {Array.from({ length: nPieces }, (_, i) => i + 1).map(n => (
              <button key={n} className="btn ghost" style={{ minHeight: 44, minWidth: 44, padding: '8px 12px', ...(piece === n ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {}) }}
                onClick={() => setPiece(n)}>{n}</button>
            ))}
          </div>
          {SECTIONS.map(sec => {
            const visibleItems = sec.items.filter(item => {
              const n = item.group === 'A' ? insp.app_sample : insp.fun_sample
              return piece <= n
            })
            if (visibleItems.length === 0) return null
            return (
              <div className="card" key={sec.key}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <h2 style={{ flex: 1, marginBottom: 0 }}>{bi(sec.title)}</h2>
                  {editable && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ok" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => selectAllSection(sec.key, 'P')}>All P</button>
                      <button className="btn danger" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => selectAllSection(sec.key, 'F')}>All F</button>
                      <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => selectAllSection(sec.key, 'NA')}>All NA</button>
                      <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13, borderColor: 'var(--amber)', color: 'var(--amber)' }} onClick={() => undoAllSection(sec.key)}>↩ Undo</button>
                    </div>
                  )}
                </div>
                {sec.instruction && (
                  <div style={{ padding: '8px 12px', background: 'var(--steel)', borderRadius: 8, marginBottom: 10, fontSize: 13, color: 'var(--ink-soft)' }}>
                    ℹ️ {bi(sec.instruction)}
                  </div>
                )}
                {visibleItems.map(item => {
                  const rkey = `${item.key}:${piece}`
                  const val = insp.form_data.results[rkey]
                  return (
                    <div key={item.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="row" style={{ gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{bi(item.label)} <span className="pill draft" style={{ fontSize: 11 }}>{item.group}</span></div>
                          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{bi(item.standard)}</div>
                        </div>
                        <PFNAButtons val={val} itemKey={item.key} itemLabel={bi(item.label)} pieceNo={piece} isMeas={false} tabName="form" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </>
      )}

      {/* ── MEASURE TAB ── */}
      {tab === 'measure' && (
        <>
          <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Piece / 件号:</span>
            {Array.from({ length: insp.fun_sample }, (_, i) => i + 1).map(n => (
              <button key={n} className="btn ghost" style={{ minHeight: 44, minWidth: 44, padding: '8px 12px', ...(piece === n ? { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' } : {}) }}
                onClick={() => setPiece(n)}>{n}</button>
            ))}
          </div>
          {piece > insp.fun_sample
            ? <div className="banner warn">Functional sample is {insp.fun_sample} pieces — select piece 1–{insp.fun_sample}.</div>
            : MEAS_SECTIONS.map(msec => (
              <div className="card" key={msec.key}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <h2 style={{ flex: 1, marginBottom: 0 }}>{bi(msec.title)} — Piece {piece}</h2>
                  {editable && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ok" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}
                        onClick={async () => {
                          const fd = { ...insp.form_data, meas_results: { ...insp.form_data.meas_results } }
                          for (const col of msec.cols) {
                            const rkey = `${col.key}:${piece}`
                            const old = fd.meas_results[rkey]
                            fd.meas_results[rkey] = 'P'
                            if (old === 'F') await removeDefect(col.key, piece, 'measure')
                          }
                          await saveFd(fd); load()
                        }}>All P</button>
                      <button className="btn danger" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}
                        onClick={async () => {
                          const fd = { ...insp.form_data, meas_results: { ...insp.form_data.meas_results } }
                          for (const col of msec.cols) {
                            const rkey = `${col.key}:${piece}`
                            const old = fd.meas_results[rkey]
                            fd.meas_results[rkey] = 'F'
                            if (old !== 'F') await ensureDefect(col.key, bi(col.label), piece, 'measure')
                          }
                          await saveFd(fd); load()
                        }}>All F</button>
                      <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}
                        onClick={async () => {
                          const fd = { ...insp.form_data, meas_results: { ...insp.form_data.meas_results } }
                          for (const col of msec.cols) {
                            const rkey = `${col.key}:${piece}`
                            const old = fd.meas_results[rkey]
                            fd.meas_results[rkey] = 'NA'
                            if (old === 'F') await removeDefect(col.key, piece, 'measure')
                          }
                          await saveFd(fd); load()
                        }}>All NA</button>
                      <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13, borderColor: 'var(--amber)', color: 'var(--amber)' }}
                        onClick={async () => {
                          const fd = { ...insp.form_data, meas_results: { ...insp.form_data.meas_results } }
                          for (const col of msec.cols) {
                            const rkey = `${col.key}:${piece}`
                            const old = fd.meas_results[rkey]
                            delete fd.meas_results[rkey]
                            if (old === 'F') await removeDefect(col.key, piece, 'measure')
                          }
                          await saveFd(fd); load()
                        }}>↩ Undo</button>
                    </div>
                  )}
                </div>
                {msec.cols.map(col => {
                  const rkey = `${col.key}:${piece}`
                  const val = insp.form_data.meas_results?.[rkey]
                  const nom = col.nominal(sku)
                  return (
                    <div key={col.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="row" style={{ gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{bi(col.label)}</div>
                          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                            Nominal: <b>{nom !== null ? nom : '—'}</b> · Tolerance: <b>{bi(col.tol)}</b>
                          </div>
                        </div>
                        <PFNAButtons val={val} itemKey={col.key} itemLabel={bi(col.label)} pieceNo={piece} isMeas={true} tabName="measure" />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
        </>
      )}

      {/* ── PHOTOS TAB ── */}
      {tab === 'photos' && (
        <div className="card">
          <h2>📷 Required Shots / 必拍照片</h2>
          <input ref={slotFileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={async e => {
              const f = e.target.files?.[0]
              if (f && slotForCapture && insp) {
                const path = `${crypto.randomUUID()}.jpg`
                const { error } = await supabase.storage.from('qc-photos').upload(path, f, { contentType: f.type })
                if (!error) {
                  await supabase.from('photos').insert({
                    inspection_id: insp.id, storage_path: path, is_pass_photo: true,
                    checklist_key: slotForCapture, item_key: '', piece_no: 0, comment: '',
                  })
                  load()
                }
              }
              e.currentTarget.value = ''
            }} />
          {PHOTO_SLOTS.map(slot => {
            const slotPhotos = photos.filter(p => p.checklist_key === slot.key)
            return (
              <div key={slot.key} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ flex: 1, fontWeight: 600 }}>
                    {bi(slot.label)} {slotPhotos.length > 0 && <span style={{ color: 'var(--pass)' }}>✓ {slotPhotos.length}</span>}
                  </div>
                  {editable && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ghost" style={{ minHeight: 38, padding: '6px 12px', fontSize: 13 }}
                        onClick={() => { setSlotForCapture(slot.key); slotFileRef.current?.click() }}>📷 Take</button>
                      <button className="btn ghost" style={{ minHeight: 38, padding: '6px 12px', fontSize: 13 }}
                        onClick={() => setModal({ type: 'assign', slotKey: slot.key, slotLabel: bi(slot.label) })}>🔗 Assign</button>
                    </div>
                  )}
                </div>
                {slotPhotos.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {slotPhotos.map(p => photoUrls[p.storage_path] && (
                      <img key={p.id} className="camera-thumb" src={photoUrls[p.storage_path]}
                        onClick={() => setModal({ type: 'preview', url: photoUrls[p.storage_path] })} style={{ cursor: 'pointer' }} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <h2 style={{ marginTop: 20, marginBottom: 10 }}>All Photos / 所有照片 ({photos.length})</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {photos.map(p => (
              <div key={p.id} style={{ borderRadius: 10, overflow: 'hidden', border: `2px solid ${p.is_pass_photo ? 'var(--pass)' : 'var(--fail)'}`, cursor: 'pointer' }}
                onClick={() => photoUrls[p.storage_path] && setModal({ type: 'preview', url: photoUrls[p.storage_path] })}>
                {photoUrls[p.storage_path]
                  ? <img src={photoUrls[p.storage_path]} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                  : <div style={{ height: 120, background: 'var(--steel)', display: 'grid', placeItems: 'center' }}>…</div>}
                <div style={{ padding: '5px 8px', background: p.is_pass_photo ? 'var(--pass-bg)' : 'var(--fail-bg)', fontSize: 11 }}>
                  <b style={{ color: p.is_pass_photo ? 'var(--pass)' : 'var(--fail)' }}>{p.is_pass_photo ? '✓' : '✗'}</b>
                  {p.piece_no !== 0 && <> · Pc {p.piece_no}</>}
                  {p.item_key && <> · {p.item_key.replace(/_/g, ' ')}</>}
                  {p.checklist_key && <> · 🔗</>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PALLET TAB ── */}
      {tab === 'pallet' && (
        <div className="card">
          <h2>{t('pallet')}</h2>
          {PALLET_ITEMS.map(item => {
            const val = insp.pallet_data[item.key]
            const ph = photos.filter(p => p.item_key === item.key)
            return (
              <div key={item.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{bi(item.label)}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div className="pfna">
                      {(['P', 'F', 'NA'] as const).map(v => (
                        <button key={v} disabled={!editable}
                          className={`${v === 'P' ? 'p' : v === 'F' ? 'f' : 'n'} ${val === v ? 'on' : ''}`}
                          onClick={async () => {
                            const newVal = val === v ? undefined : v
                            const pd = { ...insp.pallet_data, [item.key]: newVal }
                            setInsp({ ...insp, pallet_data: pd })
                            await supabase.from('inspections').update({ pallet_data: pd, updated_at: new Date().toISOString() }).eq('id', insp.id)
                            if (newVal === 'F' && val !== 'F') { await ensureDefect(item.key, bi(item.label), 0, 'pallet'); setModal({ type: 'fail', itemKey: item.key, itemLabel: bi(item.label), pieceNo: 0, tab: 'pallet' }) }
                            if (val === 'F' && newVal !== 'F') await removeDefect(item.key, 0, 'pallet')
                            load()
                          }}>
                          {v}
                        </button>
                      ))}
                    </div>
                    {editable && val && val !== 'NA' && (
                      <button className={`plus-btn ${ph.length > 0 ? (val === 'P' ? 'has-photo' : 'has-fail-photo') : ''}`}
                        onClick={() => setModal({ type: val === 'F' ? 'fail' : 'pass', itemKey: item.key, itemLabel: bi(item.label), pieceNo: 0, tab: 'pallet' })}>
                        {ph.length > 0 ? `📷 ${ph.length}` : '📷+'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 100% CHECK TAB ── */}
      {tab === '100pct' && (
        <HundredPctCheck
          inspectionId={insp.id}
          lotSize={insp.lot_size}
          triggeredItems={triggeredItems}
          results={(insp.form_data.hundred_pct || {}) as Record<string, Record<string, PFNA>>}
          editable={editable}
          onSave={async (itemKey, pieceNo, result) => {
            const fd = { ...insp.form_data }
            const hp: Record<string, Record<string, PFNA>> = { ...(fd.hundred_pct || {}) }
            const old = hp[itemKey]?.[String(pieceNo)]
            hp[itemKey] = { ...(hp[itemKey] || {}), [String(pieceNo)]: result }
            fd.hundred_pct = hp
            await saveFd(fd)
            const label = triggeredItems.find(i => i.key === itemKey)?.label || itemKey
            if (result === 'F' && old !== 'F') await ensureDefect(itemKey, `${label} (100%)`, pieceNo, '100pct')
            if (old === 'F' && result !== 'F') await removeDefect(itemKey, pieceNo, '100pct')
            load()
          }} />
      )}

      {/* ── SUMMARY TAB ── */}
      {tab === 'summary' && (
        <div className="card">
          <h2>Summary / 汇总</h2>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="card" style={{ flex: 1, marginBottom: 0, textAlign: 'center' }}>
              <div className="muted">Defects logged</div>
              <div style={{ fontSize: 32, fontFamily: 'var(--display)', fontWeight: 700, color: defects.length > 0 ? 'var(--fail)' : 'var(--pass)' }}>{defects.length}</div>
            </div>
            <div className="card" style={{ flex: 1, marginBottom: 0, textAlign: 'center' }}>
              <div className="muted">Photos taken</div>
              <div style={{ fontSize: 32, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--navy)' }}>{photos.length}</div>
            </div>
          </div>
          {triggeredItems.length > 0 && (
            <div className="banner bad">⛔ 100% INSPECTION required for: {triggeredItems.map(v => v.label).join(', ')}</div>
          )}
          {defects.length > 0 && (
            <>
              <h2 style={{ marginBottom: 10 }}>Defect Log / 缺陷记录</h2>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Piece</th><th>Parameter</th><th>Type</th><th>Severity</th><th>Value</th><th>Photo</th></tr></thead>
                  <tbody>
                    {defects.map(d => {
                      const dPhotos = photos.filter(p => p.defect_id === d.id)
                      return (
                        <tr key={d.id}>
                          <td>{d.tab === 'extra' ? `extra ${-d.piece_no}` : d.tab === '100pct' ? `${d.piece_no} (100%)` : d.piece_no || '—'}</td>
                          <td>{d.item_label || d.item_key}</td>
                          <td>{d.defect_type?.replace(/_/g, ' ')}</td>
                          <td><span className={`pill ${d.severity === 'critical' ? 'rejected' : d.severity === 'major' ? 'submitted' : 'draft'}`}>{d.severity}</span></td>
                          <td>{d.measurement_value !== null ? `${d.measurement_value} ${d.measurement_unit}` : '—'}</td>
                          <td>
                            {dPhotos.length > 0
                              ? <button className="btn ghost" style={{ minHeight: 34, padding: '4px 10px', fontSize: 13 }}
                                  onClick={() => photoUrls[dPhotos[0].storage_path] && setModal({ type: 'preview', url: photoUrls[dPhotos[0].storage_path] })}>
                                  📷 {dPhotos.length}
                                </button>
                              : <span className="muted">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div style={{ height: 14 }} />
          <label className="fld"><span>Final disposition / 最终处置 *</span>
            <select className="sel" disabled={!editable} value={insp.summary.disposition || ''}
              onChange={async e => {
                const s = { ...insp.summary, disposition: e.target.value }
                setInsp({ ...insp, summary: s })
                await supabase.from('inspections').update({ summary: s, updated_at: new Date().toISOString() }).eq('id', insp.id)
              }}>
              <option value="">— Select —</option>
              <option value="release">RELEASE / 放行</option>
              <option value="release_record">RELEASE WITH RECORD / 记录放行</option>
              <option value="hold_100">HOLD — 100% INSPECTION / 全检</option>
              <option value="reject">REJECT / 拒收</option>
            </select>
          </label>
          <div style={{ height: 10 }} />
          <label className="fld"><span>Remarks / 备注</span>
            <textarea className="txt" rows={3} disabled={!editable} value={insp.summary.remarks || ''}
              onChange={async e => {
                const s = { ...insp.summary, remarks: e.target.value }
                setInsp({ ...insp, summary: s })
                await supabase.from('inspections').update({ summary: s, updated_at: new Date().toISOString() }).eq('id', insp.id)
              }} />
          </label>
          {editable && (
            <button className="btn" style={{ width: '100%', marginTop: 16 }} onClick={submit}>
              {t('submit')}
            </button>
          )}
        </div>
      )}

      {/* ── MODALS ── */}
      {modal?.type === 'fail' && (
        <DefectModal
          inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel}
          pieceNo={modal.pieceNo} tab={modal.tab}
          onDone={() => { setModal(null); load() }} onClose={() => { setModal(null); load() }} />
      )}
      {modal?.type === 'pass' && (
        <PassPhotoModal
          inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel}
          pieceNo={modal.pieceNo} tab={modal.tab}
          onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'extra' && (
        <ExtraPieceScreen
          inspectionId={insp.id}
          itemKey={modal.verdict.key}
          itemLabel={modal.verdict.label}
          result={modal.result}
          existingExtras={modal.verdict.extraResults}
          extrasRequired={extrasRequired}
          onSave={(r) => addExtra(modal.verdict, r)}
          onUndo={() => undoExtra(modal.verdict)}
          onClose={() => setModal(null)} />
      )}
      {modal?.type === 'preview' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <img src={modal.url} style={{ maxWidth: '94vw', maxHeight: '88vh', borderRadius: 12 }} onClick={e => e.stopPropagation()} />
        </div>
      )}
      {modal?.type === 'assign' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 10 }}>🔗 Assign photo → {modal.slotLabel}</h2>
            <p className="muted" style={{ marginBottom: 12 }}>Tap a photo taken during this inspection. Suggested matches shown first.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
              {[...photos].sort((a, b) => {
                const sug = SLOT_SUGGEST[modal.slotKey] || []
                return (sug.includes(b.item_key) ? 1 : 0) - (sug.includes(a.item_key) ? 1 : 0)
              }).map(p => {
                const suggested = (SLOT_SUGGEST[modal.slotKey] || []).includes(p.item_key)
                return (
                  <div key={p.id} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: suggested ? '3px solid var(--amber)' : '1px solid var(--line)' }}
                    onClick={async () => {
                      await supabase.from('photos').update({ checklist_key: modal.slotKey }).eq('id', p.id)
                      setModal(null); load()
                    }}>
                    {photoUrls[p.storage_path]
                      ? <img src={photoUrls[p.storage_path]} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                      : <div style={{ height: 100, background: 'var(--steel)' }} />}
                    {suggested && <div style={{ position: 'absolute', top: 4, left: 4, background: 'var(--amber)', color: '#fff', borderRadius: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px' }}>SUGGESTED</div>}
                    <div style={{ fontSize: 10, padding: '3px 6px', background: '#fff' }}>{p.item_key ? p.item_key.replace(/_/g, ' ') : 'photo'}{p.piece_no ? ` · pc ${p.piece_no}` : ''}</div>
                  </div>
                )
              })}
              {photos.length === 0 && <p className="muted">No photos in this inspection yet.</p>}
            </div>
            <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
