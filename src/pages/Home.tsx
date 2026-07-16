import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { isOffline } from '../lib/connectivity'
import { cacheGetWithMeta, cacheSet, poListKey, type CachedPoGroup as POGroup } from '../lib/refCache'
import type { Profile } from '../App'

interface InspRow { id: string; po_no: string | null; updated_at: string }
interface ContRow { id: string; po_no: string | null; updated_at: string }
interface PoMaster { po_no: string; customer_name: string | null; destination: string | null; created_at: string }

export default function Home({ profile }: { profile: Profile }) {
  const nav = useNavigate()
  const { t } = useI18n()
  const [groups, setGroups] = useState<POGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  // Non-null => the list on screen came from the on-device cache, saved at this
  // time. Drives the offline banner so stale data is never passed off as live.
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [newPo, setNewPo] = useState<{ po_no: string; customer_name: string; po_date: string; destination: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [resume, setResume] = useState<{ kind: 'inspection' | 'container'; id: string; label: string; po: string; at: string } | null>(null)

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
      void cacheSet(key, next)
      return
    } catch { /* offline / fetch failed — fall through to the cache */ }
    const cached = await cacheGetWithMeta<POGroup[]>(key)
    if (cached) { setGroups(cached.value); setCachedAt(cached.savedAt) }
    setLoaded(true)
  }, [profile.id])
  useEffect(() => { load() }, [load])

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
    // letting the insert fail with a raw network error.
    if (isOffline()) { setErr(t('offlinePoSetup')); return }
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
    if (isOffline()) { alert(t('offlinePoSetup')); return }
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
          isOffline()
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
