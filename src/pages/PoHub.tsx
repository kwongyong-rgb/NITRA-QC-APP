import { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import type { Profile } from '../App'
import PoInfo from './PoInfo'
import EmailModal from '../components/EmailModal'
import AttachInspectionModal from '../components/AttachInspectionModal'
import { linkedInspectionIds, deletePoLinksAndOrphans } from '../lib/inspectionPos'
import PoStatusStrip from '../components/PoStatusStrip'
import CustomerAccessCard from '../components/CustomerAccessCard'
import { isOffline } from '../lib/connectivity'
import { cacheGetWithMeta, cacheSet, poHubKey, type CachedPoHub } from '../lib/refCache'

type Insp = CachedPoHub['insps'][number]
type Cont = CachedPoHub['conts'][number]

function fmt(dt: string | null) {
  if (!dt) return '—'
  const d = new Date(dt)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function PoHub({ profile }: { profile: Profile }) {
  const { poNo } = useParams()
  const po = decodeURIComponent(poNo || '')
  const nav = useNavigate()
  const { t } = useI18n()
  const [insps, setInsps] = useState<Insp[]>([])
  const [conts, setConts] = useState<Cont[]>([])
  const [busy, setBusy] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  // Set when this page is rendering from cache. PoHub owns the ONE offline
  // banner for the whole PO page — PoInfo and PoStatusStrip fall back to cache
  // silently, so the user sees a single clear notice, not three stacked ones.
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  // Read-through: try live → cache on success → fall back to the on-device copy.
  const load = useCallback(async () => {
    const key = poHubKey(profile.id, po)
    try {
      const { ids, offPo } = await linkedInspectionIds(po)
      let inspList: Insp[] = []
      if (ids.length) {
        const { data: i, error } = await supabase.from('inspections').select('id,part_no,status,updated_at,inspector_id').in('id', ids).order('updated_at', { ascending: false })
        if (error) throw new Error(error.message)
        inspList = ((i as Insp[]) || []).map(x => ({ ...x, off_po: offPo[x.id] || false }))
      }
      const { data: c, error: cErr } = await supabase.from('container_loadings').select('id,container_no,seal_no,status,insp_status,updated_at,inspector_id').eq('po_no', po).order('updated_at', { ascending: false })
      if (cErr) throw new Error(cErr.message)
      const contList = (c as Cont[]) || []
      setInsps(inspList); setConts(contList); setCachedAt(null)
      void cacheSet(key, { insps: inspList, conts: contList } satisfies CachedPoHub)
      return
    } catch { /* offline / fetch failed — fall through to the cache */ }
    const cached = await cacheGetWithMeta<CachedPoHub>(key)
    if (cached) { setInsps(cached.value.insps); setConts(cached.value.conts); setCachedAt(cached.savedAt) }
    else if (isOffline()) setCachedAt(null)
  }, [po, profile.id])
  useEffect(() => { load() }, [load])

  const addContainer = async () => {
    // Container loadings can't be created offline yet (still on the Stage 2 list).
    if (isOffline()) { alert(t('offlinePoSetup')); return }
    setBusy(true)
    const { data, error } = await supabase.from('container_loadings').insert({ inspector_id: profile.id, po_no: po }).select('id').single()
    setBusy(false)
    if (error) { alert(error.message); return }
    if (data) nav(`/container/${data.id}`)
  }

  const [emailOpen, setEmailOpen] = useState(false)
  const emailPoReport = () => setEmailOpen(true)
  const doEmailPo = async (emails: string[]) => {
    setBusy(true)
    const { error } = await supabase.functions.invoke('send-po-report', { body: { po, emails } })
    setBusy(false)
    if (error) { alert('Email failed: ' + error.message); return }
    setEmailOpen(false)
    alert('Consolidated PO report link sent.')
  }

  const delInsp = async (r: Insp) => {
    if (isOffline()) { alert(t('offlinePoSetup')); return }
    if (!confirm(t('delWheelConfirm'))) return
    await supabase.from('inspection_pos').delete().eq('inspection_id', r.id).eq('po_no', po)
    const { data: still } = await supabase.from('inspection_pos').select('inspection_id').eq('inspection_id', r.id).limit(1)
    if (!still || still.length === 0) {
      const { error } = await supabase.from('inspections').delete().eq('id', r.id)
      if (error) { alert('Delete failed: ' + error.message); return }
    }
    load()
  }
  const delCont = async (c: Cont) => {
    if (isOffline()) { alert(t('offlinePoSetup')); return }
    if (!confirm(t('delContConfirm'))) return
    const { error } = await supabase.from('container_loadings').delete().eq('id', c.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }
  const canDelInsp = (r: Insp) => profile.role === 'admin' || (r.status === 'draft' && r.inspector_id === profile.id)
  const canDelCont = (c: Cont) => profile.role === 'admin' || (['draft', 'rejected'].includes(c.insp_status) && c.inspector_id === profile.id)

  const delPO = async () => {
    if (isOffline()) { alert(t('offlinePoSetup')); return }
    if (!confirm(`Delete the ENTIRE PO “${po || '(No PO)'}”?\n\nThis permanently deletes its ${insps.length} wheel inspection(s) and ${conts.length} container loading(s), including their photos.\n\nThis cannot be undone.`)) return
    await deletePoLinksAndOrphans(po)
    const { error: e2 } = await supabase.from('container_loadings').delete().eq('po_no', po)
    if (e2) { alert('Delete failed: ' + e2.message); return }
    await supabase.from('pos').delete().eq('po_no', po) // master row + items (cascade)
    nav('/')
  }

  return (
    <div className="page">
      <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, marginBottom: 12 }} onClick={() => nav('/')}>← {t('allPos')}</button>
      {cachedAt && (
        <div className="banner warn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📴</span><span>{t('offlineCachedData')} {new Date(cachedAt).toLocaleString()}</span>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>PO: {po || t('noPo')}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{insps.length} {t('wheelInspections')} · {conts.length} {t('containerLoadings')}</p>
        {profile.role === 'admin' && (insps.length > 0 || conts.length > 0) &&
          <button className="btn danger" style={{ minHeight: 36, padding: '6px 12px', fontSize: 13, marginTop: 8 }} onClick={delPO}>🗑 {t('deleteEntirePo')}</button>}
      </div>

      <PoStatusStrip po={po} profile={profile} refreshKey={insps.length + conts.length} />

      <PoInfo po={po} profile={profile} refreshKey={insps.length + conts.length} />

      {profile.role === 'admin' && <CustomerAccessCard po={po} />}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('wheelInspections')}</h2>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => setAttachOpen(true)}>🔗 {t('attachInspection')}</button>
            <Link to={`/new?po=${encodeURIComponent(po)}`}><button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}>＋ {t('addSku')}</button></Link>
          </div>
        </div>
        {insps.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noWheelInspections')}</p>}
        {insps.map(r => (
          <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Link to={`/inspection/${r.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{r.part_no}</Link>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                  {r.off_po && <span className="pill" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>⚠ {t('offPo')}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{t('updated')}: {fmt(r.updated_at)}</div>
              </div>
              {canDelInsp(r) && <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delInsp(r)}>🗑</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('containerLoadings')}</h2>
          <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} disabled={busy} onClick={addContainer}>＋ {t('addContainer')}</button>
        </div>
        {conts.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noContainerLoadings')}</p>}
        {conts.map(c => (
          <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Link to={`/container/${c.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{c.container_no || t('noContainerNo')}</Link>
                  <span className={`pill ${c.insp_status}`}>{c.insp_status}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{t('seal')}: {c.seal_no || '—'} · {t('status')}: {c.status} · {t('updated')}: {fmt(c.updated_at)}</div>
              </div>
              {canDelCont(c) && <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delCont(c)}>🗑</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: '0 0 10px' }}>Consolidated PO report</h2>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5 }}>One shareable report with a container-loading and wheel-inspection overview for this PO. Each row links out to its own interactive report.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to={`/po-report/${encodeURIComponent(po)}`} target="_blank">
            <button className="btn" style={{ minHeight: 40, padding: '6px 16px' }}>Open consolidated report</button>
          </Link>
          <button className="btn ghost" style={{ minHeight: 40, padding: '6px 16px' }} disabled={busy} onClick={emailPoReport}>✉ Email consolidated report</button>
        </div>
      </div>
      {attachOpen && <AttachInspectionModal po={po} profile={profile} onClose={() => setAttachOpen(false)} onAttached={load} />}
      {emailOpen && <EmailModal title="Email consolidated PO report" sending={busy}
        onSend={doEmailPo} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}
