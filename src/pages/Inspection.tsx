import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { SECTIONS, MEAS_SECTIONS, MEAS_COLS, PHOTO_SLOTS, PALLET_ITEMS, isGlossBlack, type Sku } from '../lib/standard'
import { evaluateAll, emptyFormData, type FormData, type PFNA, type ItemVerdict } from '../lib/rules'
import { DefectModal, PassPhotoModal, ReassignModal, MediaThumb } from '../components/PhotoModal'
import ExtraPieceScreen from '../components/ExtraPieceScreen'
import HundredPctCheck from '../components/HundredPctCheck'
import { REF_MAP } from '../lib/refmap'
import type { Profile } from '../App'

type Tab5 = 'form'|'measure'|'pallet'|'extra'|'100pct'

interface Insp {
  id: string; part_no: string; po_no: string; batch: string; lot_size: number
  app_sample: number; fun_sample: number; status: string; inspector_id: string
  form_data: FormData & {
    hundred_pct?: Record<string, Record<string, PFNA>>
    na_overrides?: Record<string, boolean>
  }
  pallet_data: Record<string, PFNA>
  summary: { remarks?: string; disposition?: string }
  review_note: string
}
interface Photo {
  id: string; storage_path: string; defect_id: string|null
  is_pass_photo: boolean; item_key: string; piece_no: number
  comment: string; checklist_key: string; media_type?: string
}
interface Defect {
  id: string; piece_no: number; item_key: string; item_label: string
  defect_type: string; severity: string; measurement_value: number|null
  measurement_unit: string; comment: string; tab: string
}
interface HistoryEntry {
  type: 'set_result'|'set_meas'|'select_all'|'set_pallet'|'set_na'
  key: string; prev: PFNA; isMeas?: boolean
  prevMap?: Record<string,PFNA>
}

type ModalState =
  | { type:'fail'; itemKey:string; itemLabel:string; pieceNo:number; tab:Tab5 }
  | { type:'pass'; itemKey:string; itemLabel:string; pieceNo:number; tab:Tab5 }
  | { type:'extra'; verdict:ItemVerdict; result:'P'|'F' }
  | { type:'preview'; url:string; mediaType?:string }
  | { type:'assign'; slotKey:string; slotLabel:string }
  | { type:'refimg'; src:string; label:string }
  | { type:'reassign'; photo:Photo }
  | { type:'na_setup' }
  | null

const TABS = ['form','measure','photos','pallet','summary','100pct'] as const

const SLOT_SUGGEST: Record<string,string[]> = {
  batch_laser:['laser_format'],
  wheel_front:['area_a','area_b','area_c','hat_marks','cap_color','orange_peel'],
  wheel_back:['area_c1','area_d','area_e','mark_sae','mark_size','mark_pcd','mark_cb','mark_et','mark_nitra','rear_bore_paint'],
  box_label:['bx_label','bx_upc','bx_proddate','bx_stick','bx_design'],
  packing_inside:['pk_cap','pk_foam','pk_cloth','pk_hoop','pk_bag','pk_toppad','pk_sideboard','pk_fullface'],
  pallet_full:['pl_grouped','pl_wood','pl_height','pl_straps','pl_wrap','pl_label4','pl_photo'],
  container_empty:['ct_photo_before'],
  container_door:['ct_labels_doors'],
}

export default function Inspection({ profile }: { profile: Profile }) {
  const { id } = useParams()
  const { t, bi } = useI18n()
  const [insp, setInsp] = useState<Insp|null>(null)
  const [sku, setSku] = useState<Sku|null>(null)
  const [defects, setDefects] = useState<Defect[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string,string>>({})
  const [tab, setTab] = useState<typeof TABS[number]>('form')
  const [piece, setPiece] = useState(1)
  const [modal, setModal] = useState<ModalState>(null)
  const [submitMsg, setSubmitMsg] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const extrasRequired = 4
  const slotFileRef = useRef<HTMLInputElement>(null)
  const [slotForCapture, setSlotForCapture] = useState('')

  const load = useCallback(async () => {
    const { data: i } = await supabase.from('inspections').select('*').eq('id', id).single()
    if (!i) return
    const fi: Insp = {
      ...(i as Insp),
      form_data: { ...emptyFormData(), na_overrides: {}, ...(i as Insp).form_data },
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

  const editable = !!(insp && (insp.status==='draft'||insp.status==='rejected') && insp.inspector_id===profile.id)

  const saveFd = async (fd: Insp['form_data']) => {
    if (!insp) return
    setInsp({ ...insp, form_data: fd })
    const { error } = await supabase.from('inspections').update({ form_data: fd, updated_at: new Date().toISOString() }).eq('id', insp.id)
    if (error) alert('Save failed: ' + error.message)
  }

  const ensureDefect = async (itemKey: string, itemLabel: string, pieceNo: number, tabName: string) => {
    if (!insp) return
    const { data } = await supabase.from('defects').select('id')
      .eq('inspection_id', insp.id).eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tabName)
      .limit(1).maybeSingle()
    if (!data) await supabase.from('defects').insert({
      inspection_id: insp.id, piece_no: pieceNo, tab: tabName,
      section: tabName.toUpperCase(), item_key: itemKey, item_label: itemLabel,
      defect_type: 'unspecified', severity: 'minor', measurement_value: null, measurement_unit: 'mm', comment: '',
    })
  }
  const removeDefect = async (itemKey: string, pieceNo: number, tabName: string) => {
    if (!insp) return
    await supabase.from('defects').delete()
      .eq('inspection_id', insp.id).eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tabName)
  }

  // N/A overrides — apply N/A for a param across ALL pieces at once
  const naOverrides = insp?.form_data.na_overrides || {}
  const toggleNaOverride = async (itemKey: string, _itemLabel: string, isMeas: boolean) => {
    if (!insp) return
    const fd = { ...insp.form_data, na_overrides: { ...naOverrides } }
    if (fd.na_overrides![itemKey]) {
      delete fd.na_overrides![itemKey]
    } else {
      fd.na_overrides![itemKey] = true
      // Apply NA to all pieces for this item
      const n = isMeas ? insp.fun_sample : insp.app_sample
      for (let p = 1; p <= n; p++) {
        const rkey = `${itemKey}:${p}`
        const old = isMeas ? fd.meas_results?.[rkey] : fd.results[rkey]
        if (isMeas) fd.meas_results = { ...fd.meas_results, [rkey]: 'NA' }
        else fd.results = { ...fd.results, [rkey]: 'NA' }
        if (old === 'F') await removeDefect(itemKey, p, isMeas ? 'measure' : 'form')
      }
    }
    await saveFd(fd)
    load()
  }

  // Auto-NA for gloss-black-only items when finish is not gloss black
  const autoNaItems = useMemo(() => {
    if (!sku || isGlossBlack(sku.finish)) return new Set<string>()
    return new Set(SECTIONS.flatMap(s => s.items).filter(i => i.glossBlackOnly).map(i => i.key))
  }, [sku])

  const setResult = async (itemKey: string, itemLabel: string, pieceNo: number, val: PFNA, isMeas: boolean) => {
    if (!insp) return
    if (autoNaItems.has(itemKey)) return  // blocked — auto-NA
    if (naOverrides[itemKey]) return       // blocked — global NA override
    const rkey = `${itemKey}:${pieceNo}`
    const fd = { ...insp.form_data }
    const old = isMeas ? fd.meas_results?.[rkey] : fd.results[rkey]
    setHistory(h => [...h, { type: isMeas?'set_meas':'set_result', key: rkey, prev: old, isMeas }])
    if (isMeas) fd.meas_results = { ...fd.meas_results, [rkey]: val }
    else fd.results = { ...fd.results, [rkey]: val }
    await saveFd(fd)
    const tabName = isMeas ? 'measure' : 'form'
    if (val==='F' && old!=='F') await ensureDefect(itemKey, itemLabel, pieceNo, tabName)
    if (old==='F' && val!=='F') await removeDefect(itemKey, pieceNo, tabName)
    load()
  }

  const undoLast = async () => {
    if (!insp || history.length===0) return
    const last = history[history.length-1]
    setHistory(h => h.slice(0,-1))
    const fd = { ...insp.form_data }
    if (last.type==='set_result'||last.type==='set_meas') {
      const old = last.isMeas ? fd.meas_results?.[last.key] : fd.results[last.key]
      if (last.isMeas) {
        if (last.prev===undefined) delete fd.meas_results[last.key]
        else fd.meas_results = { ...fd.meas_results, [last.key]: last.prev }
      } else {
        if (last.prev===undefined) delete fd.results[last.key]
        else fd.results = { ...fd.results, [last.key]: last.prev }
      }
      await saveFd(fd)
      const [ik, pn] = last.key.split(':')
      const tn = last.isMeas ? 'measure' : 'form'
      if (old==='F' && last.prev!=='F') await removeDefect(ik, +pn, tn)
      if (old!=='F' && last.prev==='F') await ensureDefect(ik, ik, +pn, tn)
    } else if (last.type==='select_all' && last.prevMap) {
      if (last.isMeas) fd.meas_results = { ...fd.meas_results, ...last.prevMap }
      else fd.results = { ...fd.results, ...last.prevMap }
      await saveFd(fd)
      for (const rkey of Object.keys(last.prevMap)) {
        const [ik, pn] = rkey.split(':'); const tn = last.isMeas?'measure':'form'
        const curVal = last.isMeas ? fd.meas_results[rkey] : fd.results[rkey]
        const prevVal = last.prevMap[rkey]
        if (curVal==='F' && prevVal!=='F') await removeDefect(ik, +pn, tn)
        if (curVal!=='F' && prevVal==='F') await ensureDefect(ik, ik, +pn, tn)
      }
    } else if (last.type==='set_pallet') {
      const pd = { ...insp.pallet_data }
      if (last.prev===undefined) delete pd[last.key]; else pd[last.key]=last.prev
      setInsp({ ...insp, pallet_data: pd })
      await supabase.from('inspections').update({ pallet_data: pd, updated_at: new Date().toISOString() }).eq('id', insp.id)
    }
    load()
  }

  const selectAllSection = async (sectionKey: string, val: PFNA, isMeas: boolean, cols?: string[]) => {
    if (!insp) return
    const fd = { ...insp.form_data }
    const prevMap: Record<string,PFNA> = {}
    if (isMeas && cols) {
      for (const key of cols) {
        if (naOverrides[key]) continue
        const rkey = `${key}:${piece}`
        prevMap[rkey] = fd.meas_results?.[rkey]
        fd.meas_results = { ...fd.meas_results, [rkey]: val }
        if (val==='F' && prevMap[rkey]!=='F') await ensureDefect(key, key, piece, 'measure')
        if (val!=='F' && prevMap[rkey]==='F') await removeDefect(key, piece, 'measure')
      }
    } else {
      const sec = SECTIONS.find(s => s.key===sectionKey); if (!sec) return
      for (const item of sec.items) {
        if (naOverrides[item.key] || autoNaItems.has(item.key)) continue
        const n = item.group==='A' ? insp.app_sample : insp.fun_sample
        if (piece > n) continue
        const rkey = `${item.key}:${piece}`
        prevMap[rkey] = fd.results[rkey]
        fd.results = { ...fd.results, [rkey]: val }
        if (val==='F' && prevMap[rkey]!=='F') await ensureDefect(item.key, bi(item.label), piece, 'form')
        if (val!=='F' && prevMap[rkey]==='F') await removeDefect(item.key, piece, 'form')
      }
    }
    setHistory(h => [...h, { type:'select_all', key:sectionKey, prev:undefined, isMeas, prevMap }])
    await saveFd(fd)
    load()
  }

  // Rule engine
  const allFormItems = useMemo(() => SECTIONS.flatMap(s => s.items.map(i => ({ key:i.key, label:bi(i.label), group:i.group }))), [bi])
  const allMeasItems = useMemo(() => MEAS_COLS.map(c => ({ key:c.key, label:bi(c.label) })), [bi])
  const verdicts = useMemo(() => {
    if (!insp) return []
    return evaluateAll(insp.form_data, allFormItems, allMeasItems, insp.app_sample, insp.fun_sample, extrasRequired)
  }, [insp, allFormItems, allMeasItems])

  const addExtra = async (verdict: ItemVerdict, result: 'P'|'F') => {
    if (!insp) return
    const fd = { ...insp.form_data }; let idx: number
    if (verdict.tab==='form') { const prev=fd.extra_results[verdict.key]||[]; idx=prev.length+1; fd.extra_results={...fd.extra_results,[verdict.key]:[...prev,result]} }
    else { const prev=fd.meas_extra_results[verdict.key]||[]; idx=prev.length+1; fd.meas_extra_results={...fd.meas_extra_results,[verdict.key]:[...prev,result]} }
    await saveFd(fd)
    if (result==='F') await ensureDefect(verdict.key, `${verdict.label} (extra)`, -idx, 'extra')
    load()
  }
  const undoExtra = async (verdict: ItemVerdict) => {
    if (!insp) return
    const fd = { ...insp.form_data }; let popped: PFNA, idx: number
    if (verdict.tab==='form') { const prev=[...(fd.extra_results[verdict.key]||[])]; popped=prev.pop(); idx=prev.length+1; fd.extra_results={...fd.extra_results,[verdict.key]:prev} }
    else { const prev=[...(fd.meas_extra_results[verdict.key]||[])]; popped=prev.pop(); idx=prev.length+1; fd.meas_extra_results={...fd.meas_extra_results,[verdict.key]:prev} }
    await saveFd(fd)
    if (popped==='F') await removeDefect(verdict.key, -idx, 'extra')
    load()
  }

  const submit = async () => {
    if (!insp) return
    const missing: string[] = []
    if (!insp.summary.disposition) missing.push(t('disposition'))
    const pending = verdicts.filter(v => v.status==='extra_needed')
    if (pending.length) missing.push(`${t('extraNeeded')}: ${pending.map(v=>v.label).join(', ')}`)
    if (missing.length) { alert('Cannot submit yet:\n\n• '+missing.join('\n• ')); return }
    const confirmed = confirm(`${t('submitConfirm')}\n\n${t('partNo')}: ${insp.part_no}\n${t('poNo')}: ${insp.po_no||'—'}\n${t('lotSize')}: ${insp.lot_size}\nDefects: ${defects.length}\n${t('disposition')}: ${insp.summary.disposition}\n\n${t('submitWarning')}`)
    if (!confirmed) return
    const { error } = await supabase.from('inspections').update({ status:'submitted', submitted_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id', insp.id)
    if (error) { alert('Submit failed: '+error.message); return }
    setSubmitMsg('✓ '+t('submit')); load()
  }

  if (!insp || !sku) return <div className="page" style={{ textAlign:'center', paddingTop:40 }}>Loading…</div>

  const getPhotosFor = (itemKey: string, pNo: number) => photos.filter(p => p.item_key===itemKey && p.piece_no===pNo)
  const allItems = SECTIONS.flatMap(s => s.items.map(i => ({ key:i.key, label:bi(i.label) })))
  const allMeasItemsFlat = MEAS_COLS.map(c => ({ key:c.key, label:bi(c.label) }))
  const allItemsForReassign = [...allItems, ...allMeasItemsFlat]

  const RefIcon = ({ itemKey, label }: { itemKey:string; label:string }) => {
    const src = REF_MAP[itemKey]; if (!src) return null
    return <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:16, padding:'0 4px', color:'var(--navy)', minHeight:36 }} onClick={e => { e.stopPropagation(); setModal({ type:'refimg', src, label }) }}>📋</button>
  }

  const PlusBtn = ({ itemKey, itemLabel, pieceNo, result, tabName }: { itemKey:string; itemLabel:string; pieceNo:number; result:PFNA; tabName:Tab5 }) => {
    if (!result || result==='NA' || !editable) return null
    const ph = getPhotosFor(itemKey, pieceNo)
    const cls = result==='F' ? (ph.some(p=>!p.is_pass_photo)?'plus-btn has-fail-photo':'plus-btn') : (ph.some(p=>p.is_pass_photo)?'plus-btn has-photo':'plus-btn')
    return <button className={cls} onClick={() => setModal({ type:result==='F'?'fail':'pass', itemKey, itemLabel, pieceNo, tab:tabName })}>{ph.length>0?`📷 ${ph.length}`:'📷+'}</button>
  }

  // NA Override toggle button
  const NaOverrideBtn = ({ itemKey, itemLabel, isMeas }: { itemKey:string; itemLabel:string; isMeas:boolean }) => {
    if (!editable) return null
    const on = naOverrides[itemKey]
    return (
      <button className="btn ghost" style={{ minHeight:32, padding:'2px 10px', fontSize:12, borderColor: on?'var(--amber)':'var(--line)', color:on?'var(--amber)':'var(--ink-soft)', background: on?'var(--amber-bg)':'transparent' }}
        title={on ? 'Click to remove N/A override' : 'Mark N/A for ALL pieces of this inspection'} onClick={() => toggleNaOverride(itemKey, itemLabel, isMeas)}>
        {on ? '🔒 NA all' : 'NA all'}
      </button>
    )
  }

  const PFNAButtons = ({ val, itemKey, itemLabel, pieceNo, isMeas, tabName }: { val:PFNA; itemKey:string; itemLabel:string; pieceNo:number; isMeas:boolean; tabName:Tab5 }) => {
    const blocked = autoNaItems.has(itemKey) || naOverrides[itemKey]
    const effVal = (autoNaItems.has(itemKey) || naOverrides[itemKey]) ? 'NA' : val
    return (
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <div className="pfna">
          {(['P','F','NA'] as const).map(v => (
            <button key={v} disabled={!editable || blocked}
              className={`${v==='P'?'p':v==='F'?'f':'n'} ${effVal===v?'on':''}`}
              onClick={() => setResult(itemKey, itemLabel, pieceNo, effVal===v?undefined:v, isMeas)}>{v}</button>
          ))}
        </div>
        <PlusBtn itemKey={itemKey} itemLabel={itemLabel} pieceNo={pieceNo} result={effVal} tabName={tabName} />
      </div>
    )
  }

  const SectionControls = ({ sectionKey, isMeas, cols }: { sectionKey:string; isMeas:boolean; cols?:string[] }) => {
    if (!editable) return null
    return (
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <button className="btn ok" style={{ minHeight:36, padding:'4px 12px', fontSize:13 }} onClick={() => selectAllSection(sectionKey,'P',isMeas,cols)}>{t('allPass')}</button>
        <button className="btn danger" style={{ minHeight:36, padding:'4px 12px', fontSize:13 }} onClick={() => selectAllSection(sectionKey,'F',isMeas,cols)}>{t('allFail')}</button>
        <button className="btn ghost" style={{ minHeight:36, padding:'4px 12px', fontSize:13 }} onClick={() => selectAllSection(sectionKey,'NA',isMeas,cols)}>{t('allNA')}</button>
        <button className="btn ghost" style={{ minHeight:36, padding:'4px 12px', fontSize:13, borderColor:'var(--amber)', color:'var(--amber)' }}
          onClick={undoLast} disabled={history.length===0}>{t('undo')} {history.length>0?`(${history.length})`:''}</button>
      </div>
    )
  }

  const triggeredItems = verdicts.filter(v=>v.status==='full_inspection').map(v=>({ key:v.key, label:v.label }))
  const nPieces = insp.app_sample

  // ── Photos tab grouping ──────────────────────────────────
  const groupedPhotos = useMemo(() => {
    const sectionMap: Record<string, { title:string; params: Record<string,{ label:string; photos: Photo[] }> }> = {}
    const sectionOrder: string[] = []

    const getSec = (itemKey: string) => {
      const formItem = SECTIONS.flatMap(s => s.items.map(i => ({...i,secKey:s.key,secTitle:bi(s.title)}))).find(i=>i.key===itemKey)
      if (formItem) return { secKey:formItem.secKey, secTitle:formItem.secTitle, paramLabel: bi(formItem.label) }
      const measSec = MEAS_SECTIONS.find(ms => ms.cols.some(c=>c.key===itemKey))
      if (measSec) { const col = measSec.cols.find(c=>c.key===itemKey)!; return { secKey:measSec.key, secTitle:bi(measSec.title), paramLabel:bi(col.label) } }
      if (itemKey==='') { return { secKey:'required', secTitle:'Required Shots', paramLabel:'' } }
      return { secKey:'other', secTitle:'Other', paramLabel:itemKey.replace(/_/g,' ') }
    }

    for (const p of photos) {
      const { secKey, secTitle, paramLabel } = getSec(p.item_key)
      if (!sectionMap[secKey]) { sectionMap[secKey]={ title:secTitle, params:{} }; sectionOrder.push(secKey) }
      const pk = p.item_key || p.checklist_key || 'uncategorised'
      const pl = paramLabel || p.checklist_key || 'Uncategorised'
      if (!sectionMap[secKey].params[pk]) sectionMap[secKey].params[pk]={ label:pl, photos:[] }
      sectionMap[secKey].params[pk].photos.push(p)
    }
    // Sort each param: fail first, then pass, then by piece_no
    for (const sec of Object.values(sectionMap))
      for (const param of Object.values(sec.params))
        param.photos.sort((a,b) => (a.is_pass_photo?1:0)-(b.is_pass_photo?1:0) || a.piece_no-b.piece_no)

    return { map: sectionMap, order: sectionOrder }
  }, [photos, bi])

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="card">
        <div className="row"><h2 style={{ flex:1 }}>{insp.part_no} <span className={`pill ${insp.status}`}>{insp.status}</span></h2></div>
        <p className="muted">{sku.model} · {sku.size} · PCD {sku.pcd} · ET {sku.offset_txt} · CB {sku.cb_mm} · {sku.finish}
          {sku.wheel_weight_kg && <> · {sku.wheel_weight_kg} kg</>}</p>
        <p className="muted">{t('poNo')}: {insp.po_no||'—'} · {t('batch')}: {insp.batch||'—'} · {t('lotSize')}: {insp.lot_size} · App: {insp.app_sample} · Fun: {insp.fun_sample}</p>
        {insp.status==='rejected' && insp.review_note && <div className="banner bad" style={{ marginTop:8 }}>↩ {insp.review_note}</div>}
        {submitMsg && <div className="banner ok" style={{ marginTop:8 }}>{submitMsg}</div>}
      </div>

      {/* Rule engine banners */}
      {verdicts.length===0
        ? <div className="banner ok">✓ {t('allClean')}</div>
        : verdicts.map(v => (
          <div key={v.key} className={`banner ${v.status==='full_inspection'?'bad':v.status==='extra_needed'?'warn':'ok'}`}>
            {v.status==='full_inspection' && <div>⛔ <b>{t('fullInsp')} — {v.label}</b></div>}
            {v.status==='extra_needed' && (
              <div>
                <div>⚠ <b>{t('extraNeeded')} {v.extrasStillNeeded} — {v.label}</b></div>
                <div className="extra-recorder" style={{ marginTop:6 }}>
                  {v.extraResults.map((r,i) => <div key={i} className={`extra-dot ${r==='P'?'p':'f'}`}>{r}</div>)}
                  {editable && v.extrasStillNeeded>0 && (
                    <><button className="btn ok" style={{ minHeight:38, padding:'6px 14px', fontSize:14 }} onClick={() => setModal({ type:'extra', verdict:v, result:'P' })}>+ P</button>
                    <button className="btn danger" style={{ minHeight:38, padding:'6px 14px', fontSize:14 }} onClick={() => setModal({ type:'extra', verdict:v, result:'F' })}>+ F</button></>
                  )}
                </div>
              </div>
            )}
            {v.status==='monitor' && <div>👁 {t('monitor')}: <b>{v.label}</b></div>}
          </div>
        ))}

      {/* Tabs */}
      <div className="tabs">
        {TABS.filter(k => k!=='100pct'||triggeredItems.length>0).map(k => (
          <button key={k} className={tab===k?'on':''} onClick={() => setTab(k)}
            style={k==='100pct'?{ background:'var(--fail)', color:'#fff', borderColor:'var(--fail)' }:{}}>
            {k==='form'?t('tabVisual'):k==='measure'?t('tabTechnical'):k==='photos'?`📷 ${t('tabPhotos')} (${photos.length})`:k==='pallet'?t('tabPallet'):k==='100pct'?t('tab100pct'):t('tabSummary')}
          </button>
        ))}
      </div>

      {/* ── VISUAL TAB ── */}
      {tab==='form' && (
        <>
          <div className="row" style={{ marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:15 }}>{t('piece')}:</span>
            {Array.from({ length:nPieces }, (_,i) => i+1).map(n => (
              <button key={n} className="btn ghost" style={{ minHeight:44, minWidth:44, padding:'8px 12px', ...(piece===n?{ background:'var(--navy)', color:'#fff', borderColor:'var(--navy)' }:{}) }} onClick={() => setPiece(n)}>{n}</button>
            ))}
          </div>
          {SECTIONS.map(sec => {
            const visibleItems = sec.items.filter(item => piece<=(item.group==='A'?insp.app_sample:insp.fun_sample))
            if (visibleItems.length===0) return null
            return (
              <div className="card" key={sec.key}>
                <div className="row" style={{ marginBottom:8, alignItems:'flex-start' }}>
                  <h2 style={{ flex:1, marginBottom:0 }}>{bi(sec.title)}</h2>
                  <SectionControls sectionKey={sec.key} isMeas={false} />
                </div>
                {sec.instruction && <div style={{ padding:'8px 12px', background:'var(--steel)', borderRadius:8, marginBottom:10, fontSize:13, color:'var(--ink-soft)' }}>ℹ️ {bi(sec.instruction)}</div>}
                {visibleItems.map(item => {
                  const rkey = `${item.key}:${piece}`
                  const rawVal = insp.form_data.results[rkey]
                  const val: PFNA = (autoNaItems.has(item.key)||naOverrides[item.key]) ? 'NA' : rawVal
                  // For TPMS show the dimension from SKU
                  const subtext = item.key==='tpms_hole' && sku.tpms_sensor_mm ? `Dimension: ${sku.tpms_sensor_mm} mm` : null
                  return (
                    <div key={item.key} style={{ padding:'11px 0', borderBottom:'1px solid var(--line)', opacity: (autoNaItems.has(item.key)||naOverrides[item.key]) ? 0.6 : 1 }}>
                      <div className="row" style={{ gap:8 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <span style={{ fontWeight:600, fontSize:15 }}>{bi(item.label)}</span>
                            <span className="pill draft" style={{ fontSize:11 }}>{item.group}</span>
                            <RefIcon itemKey={item.key} label={bi(item.label)} />
                            <NaOverrideBtn itemKey={item.key} itemLabel={bi(item.label)} isMeas={false} />
                            {autoNaItems.has(item.key) && <span className="pill draft" style={{ fontSize:10 }}>auto-NA</span>}
                          </div>
                          <div className="muted" style={{ fontSize:13, marginTop:3 }}>{bi(item.standard)}</div>
                          {subtext && <div style={{ fontSize:12, color:'var(--navy)', fontWeight:600, marginTop:2 }}>📐 {subtext}</div>}
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

      {/* ── TECHNICAL TAB ── */}
      {tab==='measure' && (
        <>
          <div className="row" style={{ marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:15 }}>{t('piece')}:</span>
            {Array.from({ length:insp.fun_sample }, (_,i) => i+1).map(n => (
              <button key={n} className="btn ghost" style={{ minHeight:44, minWidth:44, padding:'8px 12px', ...(piece===n?{ background:'var(--navy)', color:'#fff', borderColor:'var(--navy)' }:{}) }} onClick={() => setPiece(n)}>{n}</button>
            ))}
          </div>
          {piece>insp.fun_sample
            ? <div className="banner warn">{t('funSample')}: {insp.fun_sample}</div>
            : MEAS_SECTIONS.map(msec => (
              <div className="card" key={msec.key}>
                <div className="row" style={{ marginBottom:8, alignItems:'flex-start' }}>
                  <h2 style={{ flex:1, marginBottom:0 }}>{bi(msec.title)} — {t('piece')} {piece}</h2>
                  <SectionControls sectionKey={msec.key} isMeas={true} cols={msec.cols.map(c=>c.key)} />
                </div>
                {msec.cols.map(col => {
                  const rkey = `${col.key}:${piece}`
                  const rawVal = insp.form_data.meas_results?.[rkey]
                  const val: PFNA = naOverrides[col.key] ? 'NA' : rawVal
                  const nom = col.nominal(sku)
                  return (
                    <div key={col.key} style={{ padding:'11px 0', borderBottom:'1px solid var(--line)', opacity:naOverrides[col.key]?0.6:1 }}>
                      <div className="row" style={{ gap:8 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <span style={{ fontWeight:600, fontSize:15 }}>{bi(col.label)}</span>
                            <RefIcon itemKey={col.key} label={bi(col.label)} />
                            <NaOverrideBtn itemKey={col.key} itemLabel={bi(col.label)} isMeas={true} />
                          </div>
                          <div className="muted" style={{ fontSize:13, marginTop:3 }}>
                            {t('nominal')}: <b>{nom!==null?`${nom} ${col.unit}`:'—'}</b> · {t('tolerance')}: <b>{bi(col.tol)}</b>
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
      {tab==='photos' && (
        <div className="card">
          <h2>{t('requiredShots')}</h2>
          <input ref={slotFileRef} type="file" accept="image/*,video/*" capture="environment" hidden
            onChange={async e => {
              const f = e.target.files?.[0]
              if (f && slotForCapture && insp) {
                const isVideo = f.type.startsWith('video/')
                const path = `${crypto.randomUUID()}.${isVideo?'mp4':'jpg'}`
                const { error } = await supabase.storage.from('qc-photos').upload(path, f, { contentType:f.type })
                if (!error) { await supabase.from('photos').insert({ inspection_id:insp.id, storage_path:path, is_pass_photo:true, checklist_key:slotForCapture, item_key:'', piece_no:0, comment:'', media_type:isVideo?'video':'photo' }); load() }
              }
              e.currentTarget.value=''
            }} />
          {PHOTO_SLOTS.map(slot => {
            const slotPhotos = photos.filter(p => p.checklist_key===slot.key)
            return (
              <div key={slot.key} style={{ padding:'10px 0', borderBottom:'1px solid var(--line)' }}>
                <div className="row" style={{ gap:10 }}>
                  <div style={{ flex:1, fontWeight:600 }}>{bi(slot.label)} {slotPhotos.length>0&&<span style={{ color:'var(--pass)' }}>✓ {slotPhotos.length}</span>}</div>
                  {editable && (
                    <div style={{ display:'flex', gap:6 }}>
                      <button className="btn ghost" style={{ minHeight:38, padding:'6px 12px', fontSize:13 }} onClick={() => { setSlotForCapture(slot.key); slotFileRef.current?.click() }}>📷 {t('take')}</button>
                      <button className="btn ghost" style={{ minHeight:38, padding:'6px 12px', fontSize:13 }} onClick={() => setModal({ type:'assign', slotKey:slot.key, slotLabel:bi(slot.label) })}>🔗 {t('assign')}</button>
                    </div>
                  )}
                </div>
                {slotPhotos.length>0 && <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  {slotPhotos.map(p => photoUrls[p.storage_path]&&<MediaThumb key={p.id} path={p.storage_path} type={p.media_type} url={photoUrls[p.storage_path]} onClick={() => setModal({ type:'preview', url:photoUrls[p.storage_path], mediaType:p.media_type })} />)}
                </div>}
              </div>
            )
          })}

          {/* Grouped photo gallery */}
          <h2 style={{ marginTop:20, marginBottom:10 }}>{t('allPhotos')} ({photos.length})</h2>
          {groupedPhotos.order.map(secKey => {
            const sec = groupedPhotos.map[secKey]
            const collapsed = collapsedSections.has(secKey)
            return (
              <div key={secKey} style={{ marginBottom:16 }}>
                <button onClick={() => toggleSection(secKey)}
                  style={{ width:'100%', background:'var(--navy)', color:'#fff', border:'none', borderRadius:8, padding:'10px 14px', textAlign:'left', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', fontWeight:700, fontFamily:'var(--display)' }}>
                  <span>{sec.title}</span><span>{collapsed?'▶':'▼'}</span>
                </button>
                {!collapsed && Object.entries(sec.params).map(([pk, param]) => (
                  <div key={pk} style={{ marginLeft:12, marginTop:10 }}>
                    <div style={{ fontWeight:600, color:'var(--navy)', marginBottom:8, fontSize:14 }}>{param.label}</div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {param.photos.map(p => {
                        const url = photoUrls[p.storage_path]
                        return (
                          <div key={p.id} style={{ position:'relative' }}>
                            <div style={{ border:`2px solid ${p.is_pass_photo?'var(--pass)':'var(--fail)'}`, borderRadius:10, overflow:'hidden', cursor:'pointer' }}
                              onClick={() => url && setModal({ type:'preview', url, mediaType:p.media_type })}>
                              <MediaThumb path={p.storage_path} type={p.media_type} url={url||''} />
                              <div style={{ padding:'3px 6px', background:p.is_pass_photo?'var(--pass-bg)':'var(--fail-bg)', fontSize:10 }}>
                                <b style={{ color:p.is_pass_photo?'var(--pass)':'var(--fail)' }}>{p.is_pass_photo?'✓P':'✗F'}</b>
                                {p.piece_no>0&&<> · pc{p.piece_no}</>}
                              </div>
                            </div>
                            {editable && (
                              <button style={{ position:'absolute', top:4, right:4, background:'rgba(0,0,0,.6)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                                onClick={() => setModal({ type:'reassign', photo:p })}>↻</button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
          {photos.length===0 && <p className="muted">{t('noPhotoYet')}</p>}
        </div>
      )}

      {/* ── PALLET TAB ── */}
      {tab==='pallet' && (
        <div className="card">
          <h2>{t('tabPallet')}</h2>
          {PALLET_ITEMS.map(item => {
            const val = insp.pallet_data[item.key]
            const ph = photos.filter(p => p.item_key===item.key)
            return (
              <div key={item.key} style={{ padding:'11px 0', borderBottom:'1px solid var(--line)' }}>
                <div className="row" style={{ gap:10 }}>
                  <div style={{ flex:1, display:'flex', alignItems:'center', gap:4 }}>
                    <span style={{ fontWeight:600, fontSize:15 }}>{bi(item.label)}</span>
                    <RefIcon itemKey={item.key} label={bi(item.label)} />
                  </div>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <div className="pfna">
                      {(['P','F','NA'] as const).map(v => (
                        <button key={v} disabled={!editable}
                          className={`${v==='P'?'p':v==='F'?'f':'n'} ${val===v?'on':''}`}
                          onClick={async () => {
                            const prev=val; const newVal=val===v?undefined:v
                            setHistory(h => [...h, { type:'set_pallet', key:item.key, prev }])
                            const pd={...insp.pallet_data,[item.key]:newVal}
                            setInsp({...insp, pallet_data:pd})
                            await supabase.from('inspections').update({ pallet_data:pd, updated_at:new Date().toISOString() }).eq('id', insp.id)
                            if (newVal==='F' && prev!=='F') await ensureDefect(item.key, bi(item.label), 0, 'pallet')
                            if (prev==='F' && newVal!=='F') await removeDefect(item.key, 0, 'pallet')
                            load()
                          }}>{v}</button>
                      ))}
                    </div>
                    {editable && val && val!=='NA' && (
                      <button className={`plus-btn ${ph.length>0?(val==='P'?'has-photo':'has-fail-photo'):''}`}
                        onClick={() => setModal({ type:val==='F'?'fail':'pass', itemKey:item.key, itemLabel:bi(item.label), pieceNo:0, tab:'pallet' })}>
                        {ph.length>0?`📷 ${ph.length}`:'📷+'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {editable && history.length>0 && <button className="btn ghost" style={{ marginTop:12, minHeight:36, padding:'4px 12px', fontSize:13, borderColor:'var(--amber)', color:'var(--amber)' }} onClick={undoLast}>{t('undo')} ({history.length})</button>}
        </div>
      )}

      {/* ── 100% CHECK TAB ── */}
      {tab==='100pct' && (
        <HundredPctCheck inspectionId={insp.id} lotSize={insp.lot_size} triggeredItems={triggeredItems}
          results={(insp.form_data.hundred_pct||{}) as Record<string,Record<string,PFNA>>}
          editable={editable}
          onSave={async (itemKey, pieceNo, result) => {
            const fd={...insp.form_data}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const hp:any={...(fd.hundred_pct||{})}
            const old=hp[itemKey]?.[String(pieceNo)]
            hp[itemKey]={...(hp[itemKey]||{}),[String(pieceNo)]:result}
            fd.hundred_pct=hp; await saveFd(fd)
            const label=triggeredItems.find(i=>i.key===itemKey)?.label||itemKey
            if (result==='F'&&old!=='F') await ensureDefect(itemKey, `${label} (100%)`, pieceNo, '100pct')
            if (old==='F'&&result!=='F') await removeDefect(itemKey, pieceNo, '100pct')
            load()
          }} />
      )}

      {/* ── SUMMARY TAB ── */}
      {tab==='summary' && (
        <div className="card">
          <h2>{t('tabSummary')}</h2>
          <div className="row" style={{ marginBottom:14 }}>
            <div className="card" style={{ flex:1, marginBottom:0, textAlign:'center' }}>
              <div className="muted">{t('defectsLogged')}</div>
              <div style={{ fontSize:32, fontFamily:'var(--display)', fontWeight:700, color:defects.length>0?'var(--fail)':'var(--pass)' }}>{defects.length}</div>
            </div>
            <div className="card" style={{ flex:1, marginBottom:0, textAlign:'center' }}>
              <div className="muted">{t('photosTaken')}</div>
              <div style={{ fontSize:32, fontFamily:'var(--display)', fontWeight:700, color:'var(--navy)' }}>{photos.length}</div>
            </div>
          </div>
          {triggeredItems.length>0 && <div className="banner bad">⛔ {t('fullInsp')}: {triggeredItems.map(v=>v.label).join(', ')}</div>}
          {defects.length>0 && (
            <><h2 style={{ marginBottom:10 }}>Defect Log</h2>
            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr><th>{t('piece')}</th><th>{t('inspParam')}</th><th>Type</th><th>{t('severity')}</th><th>Value</th><th>Media</th></tr></thead>
                <tbody>
                  {defects.map(d => {
                    const dPhotos = photos.filter(p => p.defect_id===d.id)
                    return (
                      <tr key={d.id}>
                        <td>{d.tab==='extra'?`+${-d.piece_no}`:d.tab==='100pct'?`${d.piece_no}(100%)`:d.piece_no||'—'}</td>
                        <td>{d.item_label||d.item_key}</td>
                        <td>{d.defect_type?.replace(/_/g,' ')}</td>
                        <td><span className={`pill ${d.severity==='critical'?'rejected':d.severity==='major'?'submitted':'draft'}`}>{d.severity}</span></td>
                        <td>{d.measurement_value!==null?`${d.measurement_value} ${d.measurement_unit}`:'—'}</td>
                        <td>{dPhotos.length>0
                          ? <button className="btn ghost" style={{ minHeight:34, padding:'4px 10px', fontSize:13 }}
                              onClick={() => { const p=dPhotos[0]; const u=photoUrls[p.storage_path]; if(u) setModal({ type:'preview', url:u, mediaType:p.media_type }) }}>
                              {dPhotos[0].media_type==='video'?'🎥':'📷'} {dPhotos.length}</button>
                          : <span className="muted">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div></>
          )}
          <div style={{ height:14 }} />
          <label className="fld"><span>{t('disposition')} *</span>
            <select className="sel" disabled={!editable} value={insp.summary.disposition||''}
              onChange={async e => { const s={...insp.summary,disposition:e.target.value}; setInsp({...insp,summary:s}); await supabase.from('inspections').update({ summary:s, updated_at:new Date().toISOString() }).eq('id',insp.id) }}>
              <option value="">— {t('status')} —</option>
              <option value="release">{t('release')}</option>
              <option value="release_record">{t('releaseRecord')}</option>
              <option value="hold_100">{t('hold100')}</option>
              <option value="reject">{t('rejectDisp')}</option>
            </select>
          </label>
          <div style={{ height:10 }} />
          <label className="fld"><span>{t('remarks')}</span>
            <textarea className="txt" rows={3} disabled={!editable} value={insp.summary.remarks||''}
              onChange={async e => { const s={...insp.summary,remarks:e.target.value}; setInsp({...insp,summary:s}); await supabase.from('inspections').update({ summary:s, updated_at:new Date().toISOString() }).eq('id',insp.id) }} />
          </label>
          {editable && <button className="btn" style={{ width:'100%', marginTop:16 }} onClick={submit}>{t('submit')}</button>}
        </div>
      )}

      {/* ── MODALS ── */}
      {modal?.type==='fail' && <DefectModal inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel} pieceNo={modal.pieceNo} tab={modal.tab} onDone={() => { setModal(null); load() }} onClose={() => { setModal(null); load() }} />}
      {modal?.type==='pass' && <PassPhotoModal inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel} pieceNo={modal.pieceNo} tab={modal.tab} onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />}
      {modal?.type==='extra' && <ExtraPieceScreen inspectionId={insp.id} itemKey={modal.verdict.key} itemLabel={modal.verdict.label} result={modal.result} existingExtras={modal.verdict.extraResults} extrasRequired={extrasRequired} onSave={r => addExtra(modal.verdict, r)} onUndo={() => undoExtra(modal.verdict)} onClose={() => setModal(null)} />}
      {modal?.type==='preview' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          {modal.mediaType==='video'
            ? <video src={modal.url} controls autoPlay style={{ maxWidth:'94vw', maxHeight:'88vh', borderRadius:12 }} onClick={e=>e.stopPropagation()} />
            : <img src={modal.url} style={{ maxWidth:'94vw', maxHeight:'88vh', borderRadius:12 }} onClick={e=>e.stopPropagation()} />}
        </div>
      )}
      {modal?.type==='refimg' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth:700 }}>
            <div className="row" style={{ marginBottom:10 }}>
              <h2 style={{ flex:1, fontSize:16 }}>📋 {modal.label}</h2>
              <button className="btn ghost" style={{ minHeight:36, padding:'4px 12px' }} onClick={() => setModal(null)}>{t('close')}</button>
            </div>
            <img src={modal.src} style={{ width:'100%', borderRadius:8, border:'1px solid var(--line)' }} />
          </div>
        </div>
      )}
      {modal?.type==='assign' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h2 style={{ marginBottom:10 }}>🔗 {t('assign')} → {modal.slotLabel}</h2>
            <p className="muted" style={{ marginBottom:12 }}>Tap a photo/video to assign it. Suggested matches highlighted.</p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(110px, 1fr))', gap:10 }}>
              {[...photos].sort((a,b) => { const sug=SLOT_SUGGEST[modal.slotKey]||[]; return (sug.includes(b.item_key)?1:0)-(sug.includes(a.item_key)?1:0) }).map(p => {
                const suggested=(SLOT_SUGGEST[modal.slotKey]||[]).includes(p.item_key)
                return (
                  <div key={p.id} style={{ position:'relative', cursor:'pointer', borderRadius:8, overflow:'hidden', border:suggested?'3px solid var(--amber)':'1px solid var(--line)' }}
                    onClick={async () => { const { error }=await supabase.from('photos').update({ checklist_key:modal.slotKey }).eq('id',p.id); if(error){ alert('Assign failed: '+error.message); return } setModal(null); load() }}>
                    <MediaThumb path={p.storage_path} type={p.media_type} url={photoUrls[p.storage_path]||''} />
                    {suggested && <div style={{ position:'absolute', top:4, left:4, background:'var(--amber)', color:'#fff', borderRadius:6, fontSize:10, fontWeight:700, padding:'2px 6px' }}>✓</div>}
                    <div style={{ fontSize:10, padding:'3px 6px', background:'#fff' }}>{p.is_pass_photo?'✓P':'✗F'}{p.piece_no?` · pc${p.piece_no}`:''}</div>
                  </div>
                )
              })}
              {photos.length===0 && <p className="muted">{t('noPhotoYet')}</p>}
            </div>
            <button className="btn ghost" style={{ width:'100%', marginTop:14 }} onClick={() => setModal(null)}>{t('close')}</button>
          </div>
        </div>
      )}
      {modal?.type==='reassign' && (
        <ReassignModal photo={modal.photo} allItems={allItemsForReassign} maxPiece={Math.max(insp.app_sample, insp.fun_sample)}
          onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
