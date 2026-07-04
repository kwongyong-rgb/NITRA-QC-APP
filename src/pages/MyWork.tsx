import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'

// B1 — "My Work": everything the signed-in user has open, in priority order:
// returned items (need fixing) first, then drafts in progress. Self-serve
// model per Kwong's decision — no admin assignment concept.

interface WorkItem {
  kind: 'inspection' | 'container'
  id: string
  label: string
  po: string
  status: string
  at: string
  note?: string
}

const fmt = (dt: string) => new Date(dt).toLocaleDateString() + ' ' + new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function MyWork({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      const [{ data: i }, { data: c }] = await Promise.all([
        supabase.from('inspections').select('id,part_no,po_no,status,updated_at,review_note')
          .eq('inspector_id', profile.id).in('status', ['draft', 'rejected'])
          .order('updated_at', { ascending: false }).limit(50),
        supabase.from('container_loadings').select('id,container_no,po_no,insp_status,updated_at,review_note')
          .eq('inspector_id', profile.id).in('insp_status', ['draft', 'rejected'])
          .order('updated_at', { ascending: false }).limit(50),
      ])
      const out: WorkItem[] = []
      for (const r of (i as any[]) || []) out.push({ kind: 'inspection', id: r.id, label: r.part_no || '(no part no.)', po: r.po_no || '', status: r.status, at: r.updated_at, note: r.review_note || undefined })
      for (const r of (c as any[]) || []) out.push({ kind: 'container', id: r.id, label: r.container_no || '(no container no.)', po: r.po_no || '', status: r.insp_status, at: r.updated_at, note: r.review_note || undefined })
      // Returned first (they block approval), then newest drafts.
      out.sort((a, b) => (a.status === 'rejected' ? 0 : 1) - (b.status === 'rejected' ? 0 : 1) || b.at.localeCompare(a.at))
      setItems(out)
      setLoaded(true)
    })()
  }, [profile.id])

  const returned = items.filter(x => x.status === 'rejected')
  const drafts = items.filter(x => x.status !== 'rejected')

  const row = (x: WorkItem) => (
    <Link key={x.kind + x.id} to={x.kind === 'inspection' ? `/inspection/${x.id}` : `/container/${x.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 18 }}>{x.kind === 'inspection' ? '🛞' : '📦'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {x.label} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· PO {x.po || '—'}</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {x.kind === 'inspection' ? 'Wheel inspection' : 'Container loading'} · {fmt(x.at)}
            </div>
            {x.status === 'rejected' && x.note && (
              <div style={{ fontSize: 12, marginTop: 4, color: '#7A5514', background: '#FCF2DD', borderRadius: 6, padding: '4px 8px' }}>↩ {x.note}</div>
            )}
          </div>
          <span className={`pill ${x.status}`}>{x.status}</span>
        </div>
      </div>
    </Link>
  )

  return (
    <div className="page">
      {returned.length > 0 && (
        <div className="card" style={{ border: '1.5px solid var(--amber, #B7791F)' }}>
          <h2 style={{ marginTop: 0 }}>↩ Returned to you ({returned.length})</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>These were sent back by an admin and need fixing before they can be approved.</p>
          {returned.map(row)}
        </div>
      )}
      <div className="card" style={{ marginTop: returned.length ? 14 : 0 }}>
        <h2 style={{ marginTop: 0 }}>In progress ({drafts.length})</h2>
        {loaded && drafts.length === 0 && <p className="muted">Nothing in progress. Open a PO to start an inspection or container loading.</p>}
        {drafts.map(row)}
      </div>
    </div>
  )
}
