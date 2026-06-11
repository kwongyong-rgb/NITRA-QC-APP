import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { SECTIONS, MEAS_COLS, PHOTO_SLOTS, PALLET_ITEMS, type Sku } from '../lib/standard'
import { evaluateAll, emptyFormData, type FormData, type PFNA, type ItemVerdict } from '../lib/rules'
import { DefectModal, PassPhotoModal, getMeasUnit } from '../components/PhotoModal'
import ExtraPieceScreen from '../components/ExtraPieceScreen'
import HundredPctCheck from '../components/HundredPctCheck'
import type { Profile } from '../App'

interface Insp {
  id: string; part_no: string; po_no: string; batch: string; lot_size: number
  app_sample: number; fun_sample: number; status: string; inspector_id: string
  form_data: FormData & { hundred_pct?: Record<string, Record<string, string | undefined>> }; measurements: Record<string, unknown>
  pallet_data: Record<string, PFNA>
  summary: { remarks?: string; disposition?: string }
  review_note: string
}
interface Photo { id: string; storage_path: string; defect_id: string | null; is_pass_photo: boolean; item_key: string; piece_no: number; comment: string; checklist_key: string }
interface Defect { id: string; piece_no: number; item_key: string; item_label: string; defect_type: string; severity: string; measurement_value: number | null; measurement_unit: string; comment: string; tab: string }

type ModalState =
  | { type: 'fail'; itemKey: string; itemLabel: string; pieceNo: number; tab: 'form' | 'measure' | 'pallet' }
  | { type: 'pass'; itemKey: string; itemLabel: string; pieceNo: number; tab: 'form' | 'measure' | 'pallet' }
  | { type: 'extra'; verdict: import('../lib/rules').ItemVerdict; result: 'P' | 'F' }
  | null

const TABS = ['form', 'measure', 'photos', 'pallet', 'summary', '100pct'] as const

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
  const [extrasRequired] = useState(4)

  const load = useCallback(async () => {
    const { data: i } = await supabase.from('inspections').select('*').eq('id', id).single()
    if (!i) return
    const fi: Insp = {
      ...i as Insp,
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

  // Load signed URLs for photos
  useEffect(() => {
    photos.forEach(async p => {
      if (!photoUrls[p.storage_path]) {
        const { data } = await supabase.storage.from('qc-photos').createSignedUrl(p.storage_path, 3600)
        if (data?.signedUrl) setPhotoUrls(prev => ({ ...prev, [p.storage_path]: data.signedUrl }))
      }
    })
  }, [photos]) // eslint-disable-line

  const editable = !!(insp && (insp.status === 'draft' || insp.status === 'rejected') && insp.inspector_id === profile.id)

  const saveFd = async (fd: FormData) => {
    if (!insp) return
    setInsp({ ...insp, form_data: fd })
    await supabase.from('inspections').update({ form_data: fd, updated_at: new Date().toISOString() }).eq('id', insp.id)
  }

  const savePallet = async (pd: Record<string, PFNA>) => {
    if (!insp) return
    setInsp({ ...insp, pallet_data: pd })
    await supabase.from('inspections').update({ pallet_data: pd, updated_at: new Date().toISOString() }).eq('id', insp.id)
  }

  const saveSummary = async (s: Insp['summary']) => {
    if (!insp) return
    setInsp({ ...insp, summary: s })
    await supabase.from('inspections').update({ summary: s, updated_at: new Date().toISOString() }).eq('id', insp.id)
  }

  // Rule engine
  const allFormItems = useMemo(() => SECTIONS.flatMap(s => s.items.map(i => ({ key: i.key, label: bi(i.label), group: i.group }))), [bi])
  const allMeasItems = useMemo(() => MEAS_COLS.map(c => ({ key: c.key, label: bi(c.label) })), [bi])

  const verdicts = useMemo(() => {
    if (!insp) return []
    return evaluateAll(insp.form_data, allFormItems, allMeasItems, insp.app_sample, insp.fun_sample, extrasRequired)
  }, [insp, allFormItems, allMeasItems, extrasRequired])

  const openExtra = (verdict: ItemVerdict, result: 'P' | 'F') => {
    setModal({ type: 'extra', verdict, result })
  }

  const addExtra = async (verdict: ItemVerdict, result: 'P' | 'F') => {
    if (!insp) return
    const fd = { ...insp.form_data }
    if (verdict.tab === 'form') {
      const prev = fd.extra_results[verdict.key] || []
      fd.extra_results = { ...fd.extra_results, [verdict.key]: [...prev, result] }
    } else {
      const prev = fd.meas_extra_results[verdict.key] || []
      fd.meas_extra_results = { ...fd.meas_extra_results, [verdict.key]: [...prev, result] }
    }
    await saveFd(fd)
  }

  const undoExtra = async (verdict: ItemVerdict) => {
    if (!insp) return
    const fd = { ...insp.form_data }
    if (verdict.tab === 'form') {
      const prev = [...(fd.extra_results[verdict.key] || [])]
      prev.pop()
      fd.extra_results = { ...fd.extra_results, [verdict.key]: prev }
    } else {
      const prev = [...(fd.meas_extra_results[verdict.key] || [])]
      prev.pop()
      fd.meas_extra_results = { ...fd.meas_extra_results, [verdict.key]: prev }
    }
    await saveFd(fd)
  }

  const setResult = async (rkey: string, val: PFNA, isMeas = false) => {
    if (!insp) return
    const fd = { ...insp.form_data }
    if (isMeas) fd.meas_results = { ...fd.meas_results, [rkey]: val }
    else fd.results = { ...fd.results, [rkey]: val }
    await saveFd(fd)
  }

  if (!insp || !sku) return <div className="page" style={{ textAlign: 'center', paddingTop: 40 }}>Loading…</div>

  const getPhotosFor = (itemKey: string, pNo: number) =>
    photos.filter(p => p.item_key === itemKey && p.piece_no === pNo)

  const PlusBtn = ({ itemKey, itemLabel, pieceNo, result, tabName }: { itemKey: string; itemLabel: string; pieceNo: number; result: PFNA; tabName: 'form' | 'measure' | 'pallet' }) => {
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

  const PFNAButtons = ({ rkey, val, isMeas, itemKey, itemLabel, pieceNo, tabName }:
    { rkey: string; val: PFNA; isMeas: boolean; itemKey: string; itemLabel: string; pieceNo: number; tabName: 'form' | 'measure' | 'pallet' }) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="pfna">
        {(['P', 'F', 'NA'] as const).map(v => (
          <button key={v} disabled={!editable}
            className={`${v === 'P' ? 'p' : v === 'F' ? 'f' : 'n'} ${val === v ? 'on' : ''}`}
            onClick={() => setResult(rkey, val === v ? undefined : v, isMeas)}>
            {v}
          </button>
        ))}
      </div>
      <PlusBtn itemKey={itemKey} itemLabel={itemLabel} pieceNo={pieceNo} result={val} tabName={tabName} />
    </div>
  )

  const nPieces = Math.max(insp.app_sample, insp.fun_sample)

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
      </div>

      {/* Live rule engine banners */}
      {verdicts.length === 0
        ? <div className="banner ok">✓ No defects flagged — on track / 暂无缺陷</div>
        : verdicts.map(v => (
          <div key={v.key} className={`banner ${v.status === 'full_inspection' ? 'bad' : v.status === 'extra_needed' ? 'warn' : 'ok'}`}>
            {v.status === 'full_inspection' && <div>⛔ <b>100% INSPECTION — {v.label}</b> (whole batch / 整批全检)</div>}
            {v.status === 'extra_needed' && (
              <div>
                <div>⚠ <b>Inspect {v.extrasStillNeeded} more extra piece(s) for: {v.label}</b></div>
                <div className="extra-recorder" style={{ marginTop: 6 }}>
                  {v.extraResults.map((r, i) => (
                    <div key={i} className={`extra-dot ${r === 'P' ? 'p' : 'f'}`}>{r}</div>
                  ))}
                  {editable && v.extrasStillNeeded > 0 && (
                    <>
                      <button className="btn ok" style={{ minHeight: 38, padding: '6px 14px', fontSize: 14 }} onClick={() => openExtra(v, 'P')}>+ Pass</button>
                      <button className="btn danger" style={{ minHeight: 38, padding: '6px 14px', fontSize: 14 }} onClick={() => openExtra(v, 'F')}>+ Fail</button>
                      {v.extraResults.length > 0 && <button className="btn ghost" style={{ minHeight: 38, padding: '6px 10px', fontSize: 14 }} onClick={() => undoExtra(v)}>↩</button>}
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
        {TABS.filter(k => k !== '100pct' || verdicts.some(v => v.status === 'full_inspection')).map(k => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}
            style={k === '100pct' ? { background: 'var(--fail)', color: '#fff', borderColor: 'var(--fail)' } : {}}>
            {k === 'form' ? t('form') : k === 'measure' ? t('measure') : k === 'photos' ? `📷 ${t('photos')} (${photos.length})` : k === 'pallet' ? t('pallet') : k === '100pct' ? '⛔ 100% Check' : t('summary')}
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
          {SECTIONS.map(sec => (
            <div className="card" key={sec.key}>
              <h2>{bi(sec.title)}</h2>
              {sec.items.map(item => {
                const inApp = item.group === 'A'
                if ((inApp && piece > insp.app_sample) || (!inApp && piece > insp.fun_sample)) return null
                const rkey = `${item.key}:${piece}`
                const val = insp.form_data.results[rkey]
                return (
                  <div key={item.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="row" style={{ gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{bi(item.label)} <span className="pill draft" style={{ fontSize: 11 }}>{item.group}</span></div>
                        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{bi(item.standard)}</div>
                      </div>
                      <PFNAButtons rkey={rkey} val={val} isMeas={false} itemKey={item.key} itemLabel={bi(item.label)} pieceNo={piece} tabName="form" />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
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
          <div className="card">
            <h2>Piece {piece} — Measurements / 测量</h2>
            {MEAS_COLS.map(col => {
              const rkey = `${col.key}:${piece}`
              const val = insp.form_data.meas_results?.[rkey]
              const nom = col.nominal(sku)
              const unit = getMeasUnit(col.key)
              return (
                <div key={col.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
                  <div className="row" style={{ gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{bi(col.label)}</div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                        Nominal: <b>{nom !== null ? `${nom} ${unit}` : '—'}</b> · Tolerance: <b>{bi(col.tol)}</b>
                      </div>
                    </div>
                    <PFNAButtons rkey={rkey} val={val} isMeas={true} itemKey={col.key} itemLabel={bi(col.label)} pieceNo={piece} tabName="measure" />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── PHOTOS TAB ── */}
      {tab === 'photos' && (
        <div className="card">
          <h2>📷 All Photos / 所有照片 ({photos.length})</h2>
          {photos.length === 0 && <p className="muted">No photos yet. Photos are taken inline using the 📷+ button on Form, Measure and Pallet tabs.</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
            {photos.map(p => (
              <div key={p.id} style={{ borderRadius: 10, overflow: 'hidden', border: `2px solid ${p.is_pass_photo ? 'var(--pass)' : 'var(--fail)'}` }}>
                {photoUrls[p.storage_path]
                  ? <img src={photoUrls[p.storage_path]} style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
                  : <div style={{ height: 140, background: 'var(--steel)', display: 'grid', placeItems: 'center' }}>…</div>}
                <div style={{ padding: '6px 8px', background: p.is_pass_photo ? 'var(--pass-bg)' : 'var(--fail-bg)' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: p.is_pass_photo ? 'var(--pass)' : 'var(--fail)' }}>
                    {p.is_pass_photo ? '✓ Pass' : '✗ Fail'} · Piece {p.piece_no}
                  </div>
                  {p.item_key && <div className="muted" style={{ fontSize: 11 }}>{p.item_key.replace(/_/g, ' ')}</div>}
                  {p.comment && <div className="muted" style={{ fontSize: 11 }}>{p.comment}</div>}
                </div>
              </div>
            ))}
          </div>
          {/* Required checklist shots */}
          <h2 style={{ marginTop: 20, marginBottom: 10 }}>Required Shots / 必拍照片</h2>
          {PHOTO_SLOTS.map(slot => {
            const slotPhotos = photos.filter(p => p.checklist_key === slot.key)
            return (
              <div key={slot.key} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, fontWeight: 600 }}>{bi(slot.label)} {slotPhotos.length > 0 && <span style={{ color: 'var(--pass)' }}>✓</span>}</div>
                {slotPhotos.length === 0 && <span className="muted">Not taken</span>}
              </div>
            )
          })}
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
                          onClick={() => savePallet({ ...insp.pallet_data, [item.key]: val === v ? undefined : v })}>
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
          {verdicts.filter(v => v.status === 'full_inspection').length > 0 && (
            <div className="banner bad">⛔ 100% INSPECTION required for: {verdicts.filter(v => v.status === 'full_inspection').map(v => v.label).join(', ')}</div>
          )}
          {defects.length > 0 && (
            <>
              <h2 style={{ marginBottom: 10 }}>Defect Log / 缺陷记录</h2>
              <table className="tbl">
                <thead><tr><th>Piece</th><th>Parameter</th><th>Type</th><th>Severity</th><th>Value</th></tr></thead>
                <tbody>
                  {defects.map(d => (
                    <tr key={d.id}>
                      <td>{d.piece_no || '—'}</td>
                      <td>{d.item_label || d.item_key}</td>
                      <td>{d.defect_type?.replace(/_/g, ' ')}</td>
                      <td><span className={`pill ${d.severity === 'critical' ? 'rejected' : d.severity === 'major' ? 'submitted' : 'draft'}`}>{d.severity}</span></td>
                      <td>{d.measurement_value !== null ? `${d.measurement_value} ${d.measurement_unit}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div style={{ height: 14 }} />
          <label className="fld"><span>Final disposition / 最终处置</span>
            <select className="sel" disabled={!editable} value={insp.summary.disposition || ''}
              onChange={e => saveSummary({ ...insp.summary, disposition: e.target.value })}>
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
              onChange={e => saveSummary({ ...insp.summary, remarks: e.target.value })} />
          </label>
          {editable && (
            <button className="btn" style={{ width: '100%', marginTop: 16 }}
              onClick={() => supabase.from('inspections').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', insp.id).then(load)}>
              {t('submit')}
            </button>
          )}
        </div>
      )}

      {/* ── 100% CHECK TAB ── */}
      {tab === '100pct' && (
        <HundredPctCheck
          inspectionId={insp.id}
          lotSize={insp.lot_size}
          triggeredItems={verdicts.filter(v => v.status === 'full_inspection').map(v => ({ key: v.key, label: v.label }))}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          results={(insp.form_data.hundred_pct || {}) as any}
          editable={editable}
          onSave={async (itemKey, pieceNo, result) => {
            const fd = { ...insp.form_data }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hp: any = { ...(fd.hundred_pct || {}) }; hp[itemKey] = { ...(hp[itemKey] || {}), [pieceNo]: result }; fd.hundred_pct = hp
            await saveFd(fd)
          }} />
      )}

      {/* ── MODALS ── */}
      {modal?.type === 'fail' && sku && (
        <DefectModal
          inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel}
          pieceNo={modal.pieceNo} tab={modal.tab} onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />
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
    </div>
  )
}
