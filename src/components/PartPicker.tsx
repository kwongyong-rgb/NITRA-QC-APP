import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cacheGet, cacheSet } from '../lib/refCache'

// Mobile-first searchable part-number picker (Phase 4).
// - Live-filters the active SKU master on part number, model, size, finish.
// - Big touch targets; keyboard also works on desktop.
// - Optional PO awareness: pass poParts (part numbers on the current PO) and
//   items on the PO sort first and are badged; picking an off-PO part asks
//   "not listed on the selected PO — continue anyway?" and reports the flag
//   to the parent via onChange(part, offPo).

export interface SkuLite { part_no: string; model: string | null; size: string | null; finish: string | null }

let skuCache: SkuLite[] | null = null
export async function loadSkuLite(): Promise<SkuLite[]> {
  if (skuCache) return skuCache
  const { data, error } = await supabase.from('skus').select('part_no,model,size,finish').eq('active', true).order('part_no')
  if (data && !error) {
    skuCache = data as SkuLite[]                 // memoize only a real online result
    void cacheSet('skus_lite', data)             // persist for offline reads
    return skuCache
  }
  // Offline / fetch failed — fall back to the on-device copy WITHOUT memoizing,
  // so a later online call still refreshes from the server.
  return (await cacheGet<SkuLite[]>('skus_lite')) || []
}

export default function PartPicker({ value, disabled, poParts, placeholder, allowFreeText, onChange }: {
  value: string
  disabled?: boolean
  poParts?: Set<string> | null   // part numbers on the current PO (null/undefined = no PO context)
  placeholder?: string
  allowFreeText?: boolean         // when true, typed text propagates live (a part not in the SKU master is still allowed)
  onChange: (part: string, offPo: boolean) => void
}) {
  const [skus, setSkus] = useState<SkuLite[]>([])
  const [q, setQ] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadSkuLite().then(setSkus) }, [])
  useEffect(() => { setQ(value) }, [value])
  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close) }
  }, [])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hay = skus.filter(s => !needle
      || s.part_no.toLowerCase().includes(needle)
      || (s.model || '').toLowerCase().includes(needle)
      || (s.size || '').toLowerCase().includes(needle)
      || (s.finish || '').toLowerCase().includes(needle))
    // PO items first, then alphabetical
    const rank = (s: SkuLite) => (poParts && poParts.has(s.part_no) ? 0 : 1)
    return hay.sort((a, b) => rank(a) - rank(b) || a.part_no.localeCompare(b.part_no)).slice(0, 40)
  }, [q, skus, poParts])

  const pick = (part: string) => {
    const offPo = !!(poParts && poParts.size > 0 && !poParts.has(part))
    if (offPo && !confirm(`${part} is not listed on the selected PO.\n\nContinue anyway? (It will be flagged.)`)) return
    onChange(part, offPo)
    setQ(part); setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 2, minWidth: 0 }}>
      <input className="txt" style={{ width: '100%' }} disabled={disabled}
        placeholder={placeholder || 'Search part / model / size…'}
        value={q}
        onFocus={() => !disabled && setOpen(true)}
        onChange={e => { const v = e.target.value; setQ(v); setOpen(true); if (allowFreeText || v === '') onChange(v, false) }}
        onKeyDown={e => { if (e.key === 'Enter' && results.length) { e.preventDefault(); pick(results[0].part_no) } if (e.key === 'Escape') setOpen(false) }}
      />
      {open && !disabled && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 40, top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#fff', border: '1.5px solid var(--line)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(16,32,54,.14)', maxHeight: 288, overflowY: 'auto' }}>
          {results.map(s => {
            const onPo = !!(poParts && poParts.has(s.part_no))
            return (
              <div key={s.part_no}
                onMouseDown={e => { e.preventDefault(); pick(s.part_no) }}
                style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', minHeight: 48 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{s.part_no}</span>
                  {onPo && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pass, #1F8A4C)', border: '1px solid var(--pass, #1F8A4C)', borderRadius: 6, padding: '1px 6px' }}>ON PO</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {[s.model, s.size, s.finish].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
