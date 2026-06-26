import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'

interface InspRow { id: string; po_no: string | null; updated_at: string }
interface ContRow { id: string; po_no: string | null; updated_at: string }
interface POGroup { po: string; inspCount: number; contCount: number; latest: string }

export default function Home({ profile }: { profile: Profile }) {
  const nav = useNavigate()
  const [groups, setGroups] = useState<POGroup[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const { data: i } = await supabase.from('inspections').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500)
    const { data: c } = await supabase.from('container_loadings').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500)
    const map = new Map<string, POGroup>()
    const bump = (key: string, when: string, kind: 'insp' | 'cont') => {
      const g = map.get(key) || { po: key, inspCount: 0, contCount: 0, latest: when }
      if (kind === 'insp') g.inspCount++; else g.contCount++
      if (when > g.latest) g.latest = when
      map.set(key, g)
    }
    for (const r of (i as InspRow[]) || []) bump(r.po_no || '', r.updated_at, 'insp')
    for (const r of (c as ContRow[]) || []) bump(r.po_no || '', r.updated_at, 'cont')
    setGroups([...map.values()].sort((a, b) => b.latest.localeCompare(a.latest)))
    setLoaded(true)
  }
  useEffect(() => { load() }, [])

  const newPO = () => {
    const po = window.prompt('Enter the PO number:')
    if (po === null) return
    nav(`/po/${encodeURIComponent(po.trim())}`)
  }

  const delPO = async (g: POGroup) => {
    const label = g.po || '(No PO)'
    if (!confirm(`Delete the ENTIRE PO “${label}”?\n\nThis permanently deletes its ${g.inspCount} wheel inspection(s) and ${g.contCount} container loading(s), including their photos.\n\nThis cannot be undone.`)) return
    const { error: e1 } = await supabase.from('inspections').delete().eq('po_no', g.po)
    const { error: e2 } = await supabase.from('container_loadings').delete().eq('po_no', g.po)
    if (e1 || e2) { alert('Delete failed: ' + (e1?.message || e2?.message)); return }
    load()
  }

  return (
    <div className="page">
      <button className="btn" style={{ width: '100%', marginBottom: 16 }} onClick={newPO}>＋ New PO</button>
      <div className="card">
        <h2>Purchase Orders / 采购订单</h2>
        {loaded && groups.length === 0 && <p className="muted">No POs yet. Tap “＋ New PO” to start.</p>}
        {groups.map(g => (
          <div key={g.po} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to={`/po/${encodeURIComponent(g.po)}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--navy)' }}>{g.po || '(No PO)'}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                {g.inspCount} wheel inspection(s) · {g.contCount} container loading(s)
              </div>
            </Link>
            {profile.role === 'approver' && (
              <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delPO(g)}>🗑</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
