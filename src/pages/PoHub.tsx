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
import { useOnline } from '../lib/connectivity'
import { cacheGetWithMeta, cacheGet, cacheSet, poHubKey, poListKey, type CachedPoHub, type CachedPoGroup } from '../lib/refCache'
import { getPendingForUser } from '../lib/offlineSync'

type Insp = CachedPoHub['insps'][number] & { pending?: boolean }
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
  // Ping-confirmed; see the note in Home.tsx about iOS navigator.onLine.
  const online = useOnline()
  const [insps, setInsps] = useState<Insp[]>([])
  const [conts, setConts] = useState<Cont[]>([])
  const [busy, setBusy] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  // Set when this page is rendering from cache. PoHub owns the ONE offline
  // banner for the whole PO page — PoInfo and PoStatusStrip fall back to cache
  // silently, so the user sees a single clear notice, not three stacked ones.
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  // Offline-created inspections for THIS PO, deduped against whatever is already
  // shown (right after a sync the row is on the server and may still be in the
  // pending store for a moment). Never cached — the cache holds server truth.
  const withPending = useCallback(async (list: Insp[]): Promise<Insp[]> => {
    const have = new Set(list.map(i => i.id))
    const extra: Insp[] = (await getPendingForUser(profile.id))
      .filter(p => (p.po_no || '') === po && !have.has(p.id))
      .map(p => ({
        id: p.id, part_no: p.part_no, status: p.status || 'draft',
        updated_at: p.updated_at, inspector_id: p.inspector_id, pending: true,
      }))
    return [...extra, ...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [po, profile.id])

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
      // Cache the SERVER view, then display it with pending work merged in.
      void cacheSet(key, { insps: inspList, conts: contList } satisfies CachedPoHub)
      // v99: also fold THIS PO into the user's offline PO-list cache. A PO created
      // online after the last list-cache write (e.g. created just now from Home,
      // which navigates straight here) was otherwise missing from the list when
      // offline — making its inspections unreachable onsite.
      try {
        const listKey = poListKey(profile.id)
        const list = (await cacheGet<CachedPoGroup[]>(listKey)) || []
        let g = list.find(x => x.po === po)
        if (!g) { g = { po, inspCount: 0, contCount: 0, latest: new Date().toISOString() }; list.push(g) }
        g.inspCount = inspList.length
        g.contCount = contList.length
        if (inspList[0]?.updated_at && inspList[0].updated_at > g.latest) g.latest = inspList[0].updated_at
        await cacheSet(listKey, list.sort((a, b) => b.latest.localeCompare(a.latest)))
      } catch { /* cache fold is best-effort */ }
      setInsps(await withPending(inspList)); setConts(contList); setCachedAt(null)
      return
    } catch { /* offline / fetch failed — fall through to the cache */ }
    const cached = await cacheGetWithMeta<CachedPoHub>(key)
    if (cached) { setInsps(await withPending(cached.value.insps)); setConts(cached.value.conts); setCachedAt(cached.savedAt) }
    else setInsps(await withPending([]))   // no cache yet, but pending work still shows
  }, [po, profile.id, withPending])
  useEffect(() => { load() }, [load])

  const addContainer = async () => {
    // Container loadings can't be created offline yet (still on the Stage 2 list).
    if (!online) { alert(t('offlinePoSetup')); return }
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
    if (!online) { alert(t('offlinePoSetup')); return }
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
    if (!online) { alert(t('offlinePoSetup')); return }
    if (!confirm(t('delContConfirm'))) return
    const { error } = await supabase.from('container_loadings').delete().eq('id', c.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }
  // A pending inspection exists only on this device, so a server delete would
  // affect 0 rows and it would simply reappear. It becomes deletable once synced.
  const canDelInsp = (r: Insp) => !r.pending && (profile.role === 'admin' || (r.status === 'draft' && r.inspector_id === profile.id))
  const canDelCont = (c: Cont) => profile.role === 'admin' || (['draft', 'rejected'].includes(c.insp_status) && c.inspector_id === profile.id)

  const delPO = async () => {
    if (!online) { alert(t('offlinePoSetup')); return }
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
                  {r.pending
                    ? <span className="pill" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>⏳ {t('notSyncedBadge')}</span>
                    : <span className={`pill ${r.status}`}>{r.status}</span>}
                  {r.off_po && <span className="pill" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>⚠ {t('offPo')}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  {t('updated')}: {fmt(r.updated_at)}{r.pending && <> · {t('pendingOnDevice')}</>}
                </div>
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
