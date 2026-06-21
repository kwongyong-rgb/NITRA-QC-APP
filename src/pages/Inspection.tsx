import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { SECTIONS, MEAS_SECTIONS, MEAS_COLS, PHOTO_SLOTS, PALLET_ITEMS, isGlossBlack, type Sku } from '../lib/standard'
import { evaluateAll, emptyFormData, type FormData, type PFNA, type ItemVerdict } from '../lib/rules'
import { computeOutcomes, summaryItems, outcomeColor } from '../lib/outcome'
import { DefectModal, PassPhotoModal, ReassignModal, CopyModal, MediaThumb } from '../components/PhotoModal'
import ExtraPieceScreen from '../components/ExtraPieceScreen'
import HundredPctCheck from '../components/HundredPctCheck'
import { REF_MAP } from '../lib/refmap'
import { openInspectionReport } from '../lib/report'
import type { Profile } from '../App'

type Tab5 = 'form'|'measure'|'pallet'|'extra'|'100pct'

interface Insp {
  id: string; part_no: string; po_no: string; batch: string; lot_size: number
  app_sample: number; fun_sample: number; status: string; inspector_id: string
  form_data: FormData & {
    hundred_pct?: Record<string, Record<string, PFNA>>
    na_overrides?: Record<string, boolean>
    pallet_count?: number
  }
  pallet_data: Record<string, PFNA>
  summary: { remarks?: string; disposition?: string; corrective_action?: string }
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
  type: 'set_result'|'set_meas'|'select_all'|'set_pallet'|'pallet_all'|'set_na'
  key: string; prev: PFNA; isMeas?: boolean
  prevMap?: Record<string,PFNA>
}

type ModalState =
  | { type:'fail'; itemKey:string; itemLabel:string; pieceNo:number; tab:Tab5 }
  | { type:'pass'; itemKey:string; itemLabel:string; pieceNo:number; tab:Tab5 }
  | { type:'extra'; verdict:ItemVerdict; result:'P'|'F' }
  | { type:'preview'; url:string; mediaType?:string }
  | { type:'refimg'; src:string; label:string }
  | { type:'reassign'; photo:Photo }
  | { type:'copy'; photo:Photo }
  | { type:'na_setup' }
  | null

const TABS = ['form','measure','photos','summary','100pct'] as const

const CORRECTIVE_TEMPLATES: { label: string; text: (f: string) => string }[] = [
  { label: 'Rework failed param + load', text: f => `Factory to rework wheels with failed parameter(s): ${f} (100% inspection conducted), and load after rework.` },
  { label: '100% inspect + rework + reinspect', text: f => `Factory to conduct 100% inspection and rework all wheels affected by: ${f}, then re-submit for QC re-inspection before loading.` },
  { label: 'Exclude failed pieces', text: f => `Wheels with failed parameter(s): ${f} to be segregated and excluded from loading. Only pieces passing 100% inspection may be shipped.` },
  { label: 'Pending customer', text: f => `Findings for: ${f} to be communicated to the customer; shipment pending customer acceptance of the noted defects.` },
  { label: 'Acceptable — load', text: () => `Findings are within acceptable limits. Container approved for loading.` },
]

export default function Inspection({ profile }: { profile: Profile }) {
  const { id } = useParams()
  const { t, bi, lang } = useI18n()
  const [insp, setInsp] = useState<Insp|null>(null)
  const [sku, setSku] = useState<Sku|null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [defects, setDefects] = useState<Defect[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string,string>>({})
  const [tab, setTab] = useState<typeof TABS[number]>('form')
  const [piece, setPiece] = useState(1)
  const [modal, setModal] = useState<ModalState>(null)
  const [submitMsg, setSubmitMsg] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [photoFilter, setPhotoFilter] = useState<'all'|'approved'|'failed'>('all')
  const extrasRequiredFor = (tab: 'form' | 'measure') => tab === 'measure' ? 2 : 4

  const load = useCallback(async () => {
    const { data: i, error: ie } = await supabase.from('inspections').select('*').eq('id', id).single()
    if (ie || !i) { setLoadErr(ie?.message || 'Inspection not found'); return }
    const fi: Insp = {
      ...(i as Insp),
      form_data: { ...emptyFormData(), na_overrides: {}, ...(i as Insp).form_data },
      pallet_data: (i as Insp).pallet_data || {},
      summary: (i as Insp).summary || {},
    }
    setInsp(fi)
    const { data: s, error: se } = await supabase.from('skus').select('*').eq('part_no', i.part_no).single()
    if (se || !s) { setLoadErr(`SKU "${i.part_no}" not found` + (se ? `: ${se.message}` : '')); return }
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

  // Per-parameter undo for the pallet/container tab (reverts the latest matching action)
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
    } else if (last.type==='pallet_all' && last.prevMap) {
      const pd = { ...insp.pallet_data }
      for (const [k,v] of Object.entries(last.prevMap)) { if (v===undefined) delete pd[k]; else pd[k]=v }
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
        const n = insp.app_sample
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
  const labelOf = useMemo(() => {
    const m: Record<string,string> = {}
    for (const s of SECTIONS) for (const it of s.items) m[it.key] = bi(it.label)
    for (const c of MEAS_COLS) m[c.key] = bi(c.label)
    for (const it of PALLET_ITEMS) m[it.key] = bi(it.label)
    for (const sl of PHOTO_SLOTS) m[sl.key] = bi(sl.label)
    return (k: string) => m[k] || k.replace(/_/g,' ')
  }, [bi])
  const outcomeRows = useMemo(() => computeOutcomes(insp?.form_data, labelOf), [insp, labelOf])
  const failedParamStr = useMemo(() => {
    const f = outcomeRows.filter(r => r.fail > 0).map(r => r.parameter)
    return f.length ? f.join(', ') : 'the affected parameter(s)'
  }, [outcomeRows])
  const verdicts = useMemo(() => {
    if (!insp) return []
    return evaluateAll(insp.form_data, allFormItems, allMeasItems, insp.app_sample, insp.fun_sample, 4, 2)
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



  const emailInteractiveReport = async () => {
    if (!insp) return
    const raw = prompt('Enter recipient email(s), separated by commas. Leave blank to use the saved distribution list.')
    if (raw === null) return
    const emails = raw.split(',').map(v => v.trim()).filter(Boolean)
    const { data, error } = await supabase.functions.invoke('send-report', { body: { inspection_id: insp.id, emails } })
    if (error) { alert('Email failed: ' + error.message); return }
    if (data?.ok === false) { alert('Email failed: ' + (data?.error || 'Unknown error')); return }
    alert('Interactive report email sent.\n\nReport link:\n' + (data?.report_url || ''))
  }

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
  const baseFailsByKey: Record<string, number[]> = (() => {
    const out: Record<string, number[]> = {}
    const scan = (map: Record<string, PFNA> | undefined) => {
      for (const [k, v] of Object.entries(map || {})) {
        if (v !== 'F') continue
        const [key, pc] = k.split(':'); const n = Number(pc)
        if (!n) continue; (out[key] ||= []).push(n)
      }
    }
    scan(insp?.form_data?.results); scan(insp?.form_data?.meas_results)
    for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort((a, b) => a - b)
    return out
  })()
  const nPieces = insp?.app_sample ?? 0

  // ── Photos tab: every parameter (even empty) grouped by section header ──
  const photoSections = useMemo(() => {
    const byKey: Record<string, Photo[]> = {}
    for (const p of photos) { if (!p.item_key) continue; (byKey[p.item_key] ||= []).push(p) }
    for (const k in byKey) byKey[k].sort((a, b) => (a.is_pass_photo ? 1 : 0) - (b.is_pass_photo ? 1 : 0) || a.piece_no - b.piece_no)
    const secs: { title: string; params: { key: string; label: string; photos: Photo[] }[] }[] = []
    for (const s of SECTIONS) secs.push({ title: bi(s.title), params: s.items.map(i => ({ key: i.key, label: bi(i.label), photos: byKey[i.key] || [] })) })
    for (const ms of MEAS_SECTIONS) secs.push({ title: bi(ms.title), params: ms.cols.map(c => ({ key: c.key, label: bi(c.label), photos: byKey[c.key] || [] })) })
    return secs
  }, [photos, bi])

  const deletePhoto = async (p: Photo) => {
    if (!confirm('Delete this photo/video? This cannot be undone.')) return
    const { data, error } = await supabase.from('photos').delete().eq('id', p.id).select('id')
    if (error) { alert('Delete failed: ' + error.message); return }
    if (!data || data.length === 0) { alert('Delete was blocked by the database (photos RLS). Run migration 06 in the Supabase SQL Editor, then try again.'); return }
    load()
  }

  // Report appendix: section header → parameter, split Approved / Failed (mirrors the Photos tab)
  const appendixSections = (pass: boolean) => {
    const secs = photoSections
      .map(sec => ({
        title: sec.title,
        params: sec.params
          .map(pm => ({ label: pm.label, photos: pm.photos.filter(p => p.is_pass_photo === pass) }))
          .filter(pm => pm.photos.length),
      }))
      .filter(sec => sec.params.length)
    const known = new Set<string>()
    for (const sec of photoSections) for (const pm of sec.params) known.add(pm.key)
    const otherByKey = new Map<string, Photo[]>()
    for (const p of photos) {
      if (!p.item_key || known.has(p.item_key) || p.is_pass_photo !== pass) continue
      if (!otherByKey.has(p.item_key)) otherByKey.set(p.item_key, [])
      otherByKey.get(p.item_key)!.push(p)
    }
    if (otherByKey.size) secs.push({ title: 'Other', params: [...otherByKey.entries()].map(([k, ph]) => ({ label: labelOf(k), photos: ph })) })
    return secs
  }

  // Keep all hooks above these early returns. React error #310 can happen if a hook is skipped on the loading render.
  if (loadErr) return (
    <div className="page" style={{ paddingTop:24 }}>
      <div className="card" style={{ border:'2px solid var(--fail)' }}>
        <h2 style={{ color:'var(--fail)' }}>Could not load inspection / 无法加载检验单</h2>
        <p className="muted" style={{ whiteSpace:'pre-wrap' }}>{loadErr}</p>
      </div>
    </div>
  )
  if (!insp || !sku) return <div className="page" style={{ textAlign:'center', paddingTop:40 }}>Loading…</div>

  return (
    <div className="page">
      {/* Header */}
      <div className="card">
        <div className="row"><h2 style={{ flex:1 }}>{insp.part_no} <span className={`pill ${insp.status}`}>{insp.status}</span></h2></div>
        <p className="muted">{sku.model} · {sku.size} · PCD {sku.pcd} · ET {sku.offset_txt} · CB {sku.cb_mm} · {sku.finish}
          {sku.wheel_weight_kg && <> · {sku.wheel_weight_kg.toFixed(2)} kg</>}</p>
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
        {TABS.filter(k => k!=='100pct'||triggeredItems.length>0).map(k => {
          const label = k==='form'?t('tabVisual'):k==='measure'?t('tabTechnical'):k==='photos'?`${t('tabPhotos')} (${photos.length})`:k==='100pct'?t('tab100pct'):t('tabSummary')
          const icon = k==='form'?'👁':k==='measure'?'📏':k==='photos'?'📷':k==='100pct'?'⛔':'📋'
          return (
            <button key={k} className={`${tab===k?'on':''}${k==='100pct'?' crit':''}`} onClick={() => setTab(k)}>
              <span className="tab-ico" aria-hidden="true">{icon}</span>
              <span className="tab-txt">{label}</span>
            </button>
          )
        })}
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
            const visibleItems = sec.items.filter(() => piece <= insp.app_sample)
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
          <h2 style={{ marginBottom:10 }}>{t('allPhotos')} ({photos.filter(p=>p.item_key).length})</h2>
          <p className="muted" style={{ marginTop:0, fontSize:13 }}>
            Every parameter is listed below — even empty ones — so you can fill a blank parameter by tapping ↻ Reassign or ⧉ Copy on a photo elsewhere and choosing it as the target.
          </p>
          <div style={{ display:'flex', gap:6, margin:'10px 0 14px' }}>
            {([['all','All'],['approved','Approved'],['failed','Failed']] as const).map(([f,lbl]) => (
              <button key={f} className="btn ghost"
                style={{ minHeight:36, padding:'5px 16px', fontSize:13, ...(photoFilter===f?{ background:'var(--navy)', color:'#fff', borderColor:'var(--navy)' }:{}) }}
                onClick={() => setPhotoFilter(f)}>{lbl}</button>
            ))}
          </div>

          {photoSections.map(sec => (
            <div key={sec.title} style={{ marginBottom:16 }}>
              <div style={{ background:'var(--navy)', color:'#fff', borderRadius:8, padding:'9px 14px', fontWeight:700, fontFamily:'var(--display)' }}>{sec.title}</div>
              {sec.params.map(param => {
                const visible = param.photos.filter(p => photoFilter==='all' ? true : photoFilter==='approved' ? p.is_pass_photo : !p.is_pass_photo)
                return (
                  <div key={param.key} style={{ marginLeft:6, marginTop:12, paddingBottom:10, borderBottom:'1px solid var(--line)' }}>
                    <div style={{ fontWeight:600, color:'var(--navy)', marginBottom:8, fontSize:14 }}>{param.label}</div>
                    {visible.length>0 ? (
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        {visible.map(p => {
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
                                <div style={{ position:'absolute', top:4, right:4, display:'flex', gap:4 }}>
                                  <button title="Reassign to another parameter" style={{ background:'rgba(0,0,0,.62)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                                    onClick={() => setModal({ type:'reassign', photo:p })}>↻</button>
                                  <button title="Copy to other parameters" style={{ background:'rgba(0,0,0,.62)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                                    onClick={() => setModal({ type:'copy', photo:p })}>⧉</button>
                                  <button title="Delete" style={{ background:'rgba(204,17,34,.85)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                                    onClick={() => deletePhoto(p)}>🗑</button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : <span className="muted" style={{ fontSize:12 }}>— no photos —</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── 100% CHECK TAB ── */}
      {tab==='100pct' && (
        <HundredPctCheck inspectionId={insp.id} lotSize={insp.lot_size} triggeredItems={triggeredItems}
          baseFails={baseFailsByKey}
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
          <div className="row" style={{ alignItems:'center' }}>
            <h2 style={{ flex:1, marginBottom:0 }}>Inspection Report</h2>
            <button className="btn ghost" style={{ minHeight:40, padding:'6px 14px' }} onClick={() => openInspectionReport(insp.id, lang)}>{t('pdfReport')}</button>
            <button className="btn" style={{ minHeight:40, padding:'6px 14px' }} onClick={emailInteractiveReport}>Email Interactive Report</button>
          </div>
          <div style={{ height:14 }} />

          <h2 style={{ marginBottom:8, fontSize:18 }}>{t('inspectionFindings')}</h2>
          <ul style={{ marginTop:0, paddingLeft:20 }}>
            {summaryItems(outcomeRows).map((s,i) => <li key={i} style={{ marginBottom:4 }}>{s}</li>)}
          </ul>
          {triggeredItems.length>0 && <div className="banner bad">⛔ {t('fullInsp')}: {triggeredItems.map(v=>v.label).join(', ')}</div>}

          <label className="fld" style={{ marginTop:14 }}><span>{t('correctiveAction')}</span>
            <textarea className="txt" rows={4} disabled={!editable} value={insp.summary.corrective_action||''}
              onChange={async e => { const s={...insp.summary,corrective_action:e.target.value}; setInsp({...insp,summary:s}); await supabase.from('inspections').update({ summary:s, updated_at:new Date().toISOString() }).eq('id',insp.id) }} />
          </label>
          {editable && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
              <span className="muted" style={{ fontSize:12, alignSelf:'center', marginRight:2 }}>{t('insertTemplate')}:</span>
              {CORRECTIVE_TEMPLATES.map((tpl,i) => (
                <button key={i} className="btn ghost" style={{ minHeight:34, padding:'4px 10px', fontSize:12 }}
                  onClick={async () => {
                    const line=tpl.text(failedParamStr)
                    const cur=insp.summary.corrective_action||''
                    const s={...insp.summary, corrective_action: cur ? `${cur}\n${line}` : line}
                    setInsp({...insp,summary:s}); await supabase.from('inspections').update({ summary:s, updated_at:new Date().toISOString() }).eq('id',insp.id)
                  }}>{tpl.label}</button>
              ))}
            </div>
          )}

          <h2 style={{ margin:'18px 0 8px', fontSize:18 }}>Inspection Outcome</h2>
          {outcomeRows.length>0 ? (
            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr><th>{t('inspParam')}</th><th>Checked</th><th>Pass</th><th>Fail</th><th>Defect Pieces</th><th>Outcome</th></tr></thead>
                <tbody>
                  {outcomeRows.map((o,i) => (
                    <tr key={i}>
                      <td>{o.parameter}</td>
                      <td>{o.checked}</td>
                      <td style={{ fontWeight:700, color:'var(--pass)' }}>{o.pass}</td>
                      <td style={{ fontWeight:700, color:o.fail>0?'var(--fail)':'var(--ink-soft)' }}>{o.fail}</td>
                      <td>{o.defectPieces}</td>
                      <td style={{ fontWeight:700, color:outcomeColor(o.outcome) }}>{o.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No parameters inspected yet.</p>}

          <h2 style={{ margin:'18px 0 8px', fontSize:18 }}>Photo / Video Appendix</h2>
          {(['pass','fail'] as const).map(kind => {
            const pass = kind==='pass'
            const secs = appendixSections(pass)
            return (
              <div key={kind} style={{ marginBottom:14 }}>
                <div style={{ background: pass?'var(--pass)':'var(--fail)', color:'#fff', borderRadius:8, padding:'7px 12px', fontWeight:700, fontFamily:'var(--display)' }}>
                  {pass?'✓ Approved Inspection Photos':'✗ Failed Inspection Photos'}
                </div>
                {secs.length>0 ? secs.map(sec => (
                  <div key={sec.title} style={{ marginTop:10 }}>
                    <div style={{ fontWeight:700, color:'var(--navy)', fontSize:13, margin:'6px 0 4px' }}>{sec.title}</div>
                    {sec.params.map(pm => (
                      <div key={pm.label} style={{ marginLeft:8, marginBottom:8 }}>
                        <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{pm.label}</div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(110px, 1fr))', gap:8 }}>
                          {pm.photos.map(p => {
                            const u = photoUrls[p.storage_path]
                            const pieceTxt = p.piece_no ? (p.piece_no<0?`Additional`:`Piece ${p.piece_no}`) : 'Required photo'
                            return (
                              <figure key={p.id} style={{ margin:0, border:'1px solid var(--line)', borderRadius:10, overflow:'hidden', background:'#fff' }}>
                                <button onClick={() => { if(u) setModal({ type:'preview', url:u, mediaType:p.media_type }) }}
                                  style={{ width:'100%', height:90, border:0, background:'#EEF1F5', cursor:'pointer', padding:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  {p.media_type==='video' ? <span style={{ fontSize:26, color:'var(--navy)' }}>▶</span>
                                    : u ? <img src={u} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <span className="muted" style={{ fontSize:12 }}>…</span>}
                                </button>
                                <figcaption style={{ fontSize:11, color:'var(--ink-soft)', padding:6 }}>
                                  <b style={{ color: pass?'var(--pass)':'var(--fail)' }}>{pass?'PASS':'FAIL'}</b> · {pieceTxt}
                                </figcaption>
                              </figure>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )) : <p className="muted" style={{ marginTop:8, marginBottom:0 }}>{pass?'No approved photos.':'No failed photos.'}</p>}
              </div>
            )
          })}

          <div style={{ height:14 }} />
          <label className="fld"><span>{t('disposition')} *</span>
            <select className="sel" disabled={!editable} value={insp.summary.disposition||''}
              onChange={async e => { const s={...insp.summary,disposition:e.target.value}; setInsp({...insp,summary:s}); await supabase.from('inspections').update({ summary:s, updated_at:new Date().toISOString() }).eq('id',insp.id) }}>
              <option value="">— {t('status')} —</option>
              <option value="approved_loading">{t('dispApprovedLoading')}</option>
              <option value="hold_rework">{t('dispHoldRework')}</option>
              <option value="conditional_loading">{t('dispConditional')}</option>
              <option value="pending_customer">{t('dispPendingCustomer')}</option>
            </select>
          </label>
          {editable && <button className="btn" style={{ width:'100%', marginTop:16 }} onClick={submit}>{t('submit')}</button>}
        </div>
      )}

      {/* ── MODALS ── */}
      {modal?.type==='fail' && <DefectModal inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel} pieceNo={modal.pieceNo} tab={modal.tab} onDone={() => { setModal(null); load() }} onClose={() => { setModal(null); load() }} />}
      {modal?.type==='pass' && <PassPhotoModal inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel} pieceNo={modal.pieceNo} tab={modal.tab} onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />}
      {modal?.type==='extra' && <ExtraPieceScreen inspectionId={insp.id} itemKey={modal.verdict.key} itemLabel={modal.verdict.label} result={modal.result} existingExtras={modal.verdict.extraResults} extrasRequired={extrasRequiredFor(modal.verdict.tab)} onSave={r => addExtra(modal.verdict, r)} onUndo={() => undoExtra(modal.verdict)} onClose={() => setModal(null)} />}
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
      {modal?.type==='reassign' && (
        <ReassignModal photo={modal.photo} allItems={allItemsForReassign} maxPiece={Math.max(insp.app_sample, insp.fun_sample)}
          onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />
      )}
      {modal?.type==='copy' && (
        <CopyModal inspectionId={insp.id} photo={modal.photo} allItems={allItemsForReassign}
          onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
