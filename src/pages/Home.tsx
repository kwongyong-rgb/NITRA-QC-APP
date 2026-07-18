import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useOnline } from '../lib/connectivity'
import {
  cacheGetWithMeta, cacheSet, poListKey, cacheAllKeys, cacheAvailable,
  getLastWrite, getLastWarm, type CachedPoGroup as POGroup,
} from '../lib/refCache'
import type { Profile } from '../App'

interface InspRow { id: string; po_no: string | null; updated_at: string }
interface ContRow { id: string; po_no: string | null; updated_at: string }
interface PoMaster { po_no: string; customer_name: string | null; destination: string | null; created_at: string }

// v88 diagnostic snapshot — temporary scaffolding while we chase why the PO
// cache read comes back empty on a real device. Remove once resolved.
interface Diag {
  navOnLine: boolean; idbOk: boolean; uid: string; key: string
  found: boolean; savedAt: string; count: number
  keys: string[]; lastWrite: string; lastWarm: string
}

export default function Home({ profile }: { profile: Profile }) {
  const nav = useNavigate()
  const { t } = useI18n()
  // Ping-confirmed connectivity. NOT isOffline() — on iOS standalone PWAs
  // navigator.onLine wrongly reports true in airplane mode, which is exactly the
  // v87 bug that showed the wrong empty-state message. Rendering decisions use
  // this hook; only write-blocking guards may use isOffline().
  const online = useOnline()
  const [groups, setGroups] = useState<POGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  // Non-null => the list on screen came from the on-device cache, saved at this
  // time. Drives the offline banner so stale data is never passed off as live.
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [newPo, setNewPo] = useState<{ po_no: string; customer_name: string; po_date: string; destination: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [resume, setResume] = useState<{ kind: 'inspection' | 'container'; id: string; label: string; po: string; at: string } | null>(null)
  const [diag, setDiag] = useState<Diag | null>(null)

  // Read-through: try live → cache the result on success → fall back to the
  // on-device copy when the fetch fails (offline). Before v87 this screen was
  // simply blank offline.
  const load = useCallback(async () => {
    const key = poListKey(profile.id)
    try {
      const [i, c, p] = await Promise.all([
        supabase.from('inspections').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500),
        supabase.from('container_loadings').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500),
        supabase.from('pos').select('po_no,customer_name,destination,created_at').order('created_at', { ascending: false }).limit(500),
      ])
      if (i.error || c.error || p.error) throw new Error(i.error?.message || c.error?.message || p.error?.message)
      const map = new Map<string, POGroup>()
      const bump = (key: string, when: string, kind: 'insp' | 'cont') => {
        const g = map.get(key) || { po: key, inspCount: 0, contCount: 0, latest: when }
        if (kind === 'insp') g.inspCount++; else g.contCount++
        if (when > g.latest) g.latest = when
        map.set(key, g)
      }
      for (const r of (i.data as InspRow[]) || []) bump(r.po_no || '', r.updated_at, 'insp')
      for (const r of (c.data as ContRow[]) || []) bump(r.po_no || '', r.updated_at, 'cont')
      // Merge PO master rows: POs created ahead of any inspection still appear,
      // and customer/destination annotate every group that has them.
      for (const m of (p.data as PoMaster[]) || []) {
        const g = map.get(m.po_no) || { po: m.po_no, inspCount: 0, contCount: 0, latest: m.created_at }
        g.customer = m.customer_name || undefined
        g.destination = m.destination || undefined
        map.set(m.po_no, g)
      }
      const next = [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest))
      setGroups(next); setCachedAt(null); setLoaded(true)
      // v88: AWAIT the write (was fire-and-forget). If the user went offline
      // moments later, an unfinished write was one candidate for the empty cache.
      await cacheSet(key, next)
      return
    } catch { /* offline / fetch failed — fall through to the cache */ }
    const cached = await cacheGetWithMeta<POGroup[]>(key)
    if (cached) { setGroups(cached.value); setCachedAt(cached.savedAt) }
    setLoaded(true)
  }, [profile.id])
  useEffect(() => { load() }, [load])

  // v88 diagnostic snapshot, refreshed alongside every load.
  useEffect(() => {
    (async () => {
      const key = poListKey(profile.id)
      const [idbOk, keys, entry] = await Promise.all([
        cacheAvailable(), cacheAllKeys(), cacheGetWithMeta<POGroup[]>(key),
      ])
      const w = getLastWrite(); const wa = getLastWarm()
      setDiag({
        navOnLine: typeof navigator !== 'undefined' ? navigator.onLine : true,
        idbOk,
        uid: profile.id,
        key,
        found: !!entry,
        savedAt: entry ? new Date(entry.savedAt).toLocaleString() : '—',
        count: entry ? (entry.value?.length ?? 0) : 0,
        keys,
        lastWrite: w ? `${w.ok ? 'OK' : 'FAILED'} · ${w.key} · ${new Date(w.at).toLocaleTimeString()}` : 'none this session',
        lastWarm: wa ? `${wa.ok ? 'OK' : 'FAILED'} · ${wa.poCount} POs · ${wa.note} · ${new Date(wa.at).toLocaleTimeString()}` : 'not run this session',
      })
    })()
  }, [profile.id, groups, cachedAt, loaded])

  // "Continue where you left off": the newest draft/rejected item started by me.
  useEffect(() => {
    (async () => {
      const [{ data: i }, { data: c }] = await Promise.all([
        supabase.from('inspections').select('id,part_no,po_no,updated_at').eq('inspector_id', profile.id).in('status', ['draft', 'rejected']).order('updated_at', { ascending: false }).limit(1),
        supabase.from('container_loadings').select('id,container_no,po_no,updated_at').eq('inspector_id', profile.id).in('insp_status', ['draft', 'rejected']).order('updated_at', { ascending: false }).limit(1),
      ])
      const insp = (i || [])[0] as { id: string; part_no: string; po_no: string; updated_at: string } | undefined
      const cont = (c || [])[0] as { id: string; container_no: string; po_no: string; updated_at: string } | undefined
      if (insp && (!cont || insp.updated_at > cont.updated_at)) {
        setResume({ kind: 'inspection', id: insp.id, label: insp.part_no || '(no part no.)', po: insp.po_no || '', at: insp.updated_at })
      } else if (cont) {
        setResume({ kind: 'container', id: cont.id, label: cont.container_no || '(no container no.)', po: cont.po_no || '', at: cont.updated_at })
      }
    })()
  }, [profile.id])

  const newPO = () => {
    if (profile.role === 'admin') {
      setErr(''); setNewPo({ po_no: '', customer_name: '', po_date: '', destination: '' })
      return
    }
    // Inspectors keep the quick open-a-PO flow (no master-data editing rights).
    const po = window.prompt('Enter the PO number:')
    if (po === null) return
    nav(`/po/${encodeURIComponent(po.trim())}`)
  }

  const createPO = async () => {
    if (!newPo) return
    const po_no = newPo.po_no.trim()
    if (!po_no) { setErr('PO number is required.'); return }
    // PO setup is online-only by design (§5 scope). Say so plainly instead of
    // letting the insert fail with a raw network error. Uses the ping-confirmed
    // hook, not isOffline() — iOS PWAs report navigator.onLine=true in airplane
    // mode, so isOffline() would let this through and surface a raw error.
    if (!online) { setErr(t('offlinePoSetup')); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('pos').upsert({
      po_no,
      customer_name: newPo.customer_name.trim() || null,
      po_date: newPo.po_date || null,
      destination: newPo.destination.trim() || null,
    }, { onConflict: 'po_no' })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setNewPo(null)
    nav(`/po/${encodeURIComponent(po_no)}`)
  }

  const delPO = async (g: POGroup) => {
    const label = g.po || '(No PO)'
    // Offline this would fail on the first delete and alert a raw network error —
    // and a cached list may be stale, so deleting from it is doubly wrong.
    if (!online) { alert(t('offlinePoSetup')); return }
    if (!confirm(`Delete the ENTIRE PO “${label}”?\n\nThis permanently deletes its ${g.inspCount} wheel inspection(s) and ${g.contCount} container loading(s), including their photos.\n\nThis cannot be undone.`)) return
    const { error: e1 } = await supabase.from('inspections').delete().eq('po_no', g.po)
    const { error: e2 } = await supabase.from('container_loadings').delete().eq('po_no', g.po)
    if (e1 || e2) { alert('Delete failed: ' + (e1?.message || e2?.message)); return }
    await supabase.from('pos').delete().eq('po_no', g.po) // master row + items (cascade)
    load()
  }

  return (
    <div className="page">
      {cachedAt && (
        <div className="banner warn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📴</span><span>{t('offlineCachedData')} {new Date(cachedAt).toLocaleString()}</span>
        </div>
      )}
      {resume && (
        <Link to={resume.kind === 'inspection' ? `/inspection/${resume.id}` : `/container/${resume.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card" style={{ marginBottom: 12, border: '1.5px solid var(--navy)', cursor: 'pointer' }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: .5 }}>▶ CONTINUE WHERE YOU LEFT OFF</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
              {resume.kind === 'inspection' ? 'Wheel inspection' : 'Container loading'} · {resume.label}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>PO {resume.po || '—'} · last edited {new Date(resume.at).toLocaleString()}</div>
          </div>
        </Link>
      )}
      <button className="btn" style={{ width: '100%', marginBottom: 16 }} onClick={newPO}>＋ New PO</button>
      <div className="card">
        <h2>Purchase Orders / 采购订单</h2>
        {loaded && groups.length === 0 && (
          !online
            ? <p className="muted">{t('offlineNoCachedPos')}</p>
            : <p className="muted">No POs yet. Tap “＋ New PO” to start.</p>
        )}
        {groups.map(g => (
          <div key={g.po} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to={`/po/${encodeURIComponent(g.po)}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--navy)' }}>{g.po || '(No PO)'}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                {g.customer ? <>{g.customer}{g.destination ? ` → ${g.destination}` : ''} · </> : (g.destination ? <>→ {g.destination} · </> : null)}
                {g.inspCount} wheel inspection(s) · {g.contCount} container loading(s)
              </div>
            </Link>
            {profile.role === 'admin' && (
              <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delPO(g)}>🗑</button>
            )}
          </div>
        ))}
      </div>

      {/* v88 TEMPORARY diagnostic — staff only, remove once the empty-cache
          issue is resolved. Read these lines out to diagnose in one round trip
          instead of guessing from symptoms. */}
      {profile.role !== 'customer' && diag && (
        <div className="card" style={{ borderColor: 'var(--amber)', background: '#FFFDF6' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--amber)', marginBottom: 6 }}>
            🔧 OFFLINE CACHE DIAGNOSTIC (temporary — v88)
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.7, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            <div><b>A. ping says:</b> {online ? 'ONLINE' : 'OFFLINE'} · <b>navigator.onLine:</b> {String(diag.navOnLine)}{online !== diag.navOnLine ? '  ⚠ DISAGREE' : ''}</div>
            <div><b>B. IndexedDB usable:</b> {diag.idbOk ? 'YES' : 'NO ⚠'}</div>
            <div><b>C. my user id:</b> {diag.uid}</div>
            <div><b>D. looking for key:</b> {diag.key}</div>
            <div><b>E. entry found:</b> {diag.found ? `YES — ${diag.count} POs, saved ${diag.savedAt}` : 'NO ⚠'}</div>
            <div><b>F. last write:</b> {diag.lastWrite}</div>
            <div><b>G. last warm:</b> {diag.lastWarm}</div>
            <div><b>H. keys in cache ({diag.keys.length}):</b> {diag.keys.length ? diag.keys.slice(0, 12).join(' | ') + (diag.keys.length > 12 ? ` | …+${diag.keys.length - 12} more` : '') : '(none) ⚠'}</div>
          </div>
        </div>
      )}

      {newPo && (
        <div className="modal-overlay" onClick={() => setNewPo(null)}>
          <div className="modal" style={{ width: 'min(460px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>New Purchase Order</h2>
            <label className="fld"><span>PO number *</span>
              <input className="txt" value={newPo.po_no} autoFocus onChange={e => setNewPo({ ...newPo, po_no: e.target.value })} /></label>
            <label className="fld"><span>Customer name</span>
              <input className="txt" value={newPo.customer_name} onChange={e => setNewPo({ ...newPo, customer_name: e.target.value })} /></label>
            <label className="fld"><span>PO date</span>
              <input className="txt" type="date" value={newPo.po_date} onChange={e => setNewPo({ ...newPo, po_date: e.target.value })} /></label>
            <label className="fld"><span>Destination</span>
              <input className="txt" value={newPo.destination} onChange={e => setNewPo({ ...newPo, destination: e.target.value })} /></label>
            <p className="muted" style={{ fontSize: 12 }}>Ordered part numbers and quantities are added on the next screen (manually or by Excel upload).</p>
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={createPO}>{busy ? 'Creating…' : 'Create PO'}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setNewPo(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
