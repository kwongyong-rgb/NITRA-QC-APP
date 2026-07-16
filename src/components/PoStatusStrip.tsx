import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n, type Bi } from '../lib/i18n'
import { computeStages, getOrCreatePoId, type PoStages, type StageResult, type StageUnit } from '../lib/poStatus'
import { cacheGet, cacheSet, poStagesKey } from '../lib/refCache'
import type { Profile } from '../App'

// The PO command center's status strip: PO Ordered Items ▸ Inspection ▸ Loading,
// each with a live done/total count, followed by a de-emphasised dashed
// "Shipped" cap marking where this QC app's job ends and the separate shipping
// app takes over (until the two systems merge). "Loaded" is not a stage: an
// approved container-loading inspection already means those pieces are loaded.

const NAMES: Record<keyof PoStages, Bi> = {
  items:      { en: 'PO Ordered Items', zh: '订购项目' },
  inspection: { en: 'Inspection',       zh: '检验' },
  loading:    { en: 'Loading',          zh: '装柜' },
}

const STATE_WORD = {
  done:   { en: 'Done',        zh: '完成' } as Bi,
  active: { en: 'In progress', zh: '进行中' } as Bi,
  todo:   { en: 'Not started', zh: '未开始' } as Bi,
}

const UNIT: Record<StageUnit, Bi> = {
  sku:  { en: 'SKUs', zh: 'SKU' },
  pcs:  { en: 'pcs',  zh: '件' },
  none: { en: '',     zh: '' },
}

const NO_ITEMS: Bi = { en: 'No items yet', zh: '暂无项目' }
const SHIPPED: Bi = { en: 'Shipped', zh: '已发货' }
const SHIPPED_NOTE: Bi = { en: 'separate app', zh: '独立系统' }

const ORDER: (keyof PoStages)[] = ['items', 'inspection', 'loading']

export default function PoStatusStrip({ po, profile, refreshKey }: { po: string; profile: Profile; refreshKey?: number }) {
  const { bi } = useI18n()
  const [stages, setStages] = useState<PoStages | null>(null)

  // Read-through: try live → cache on success → fall back to the on-device copy.
  // (No banner here — PoHub shows one banner for the whole PO page.)
  const load = useCallback(async () => {
    const key = poStagesKey(profile.id, po)
    try {
      // getOrCreatePoId self-guards against the offline lazy-create (v87).
      const poId = await getOrCreatePoId(po, profile.role === 'admin')
      const linkRes = await supabase.from('inspection_pos').select('inspection_id').eq('po_no', po)
      if (linkRes.error) throw new Error(linkRes.error.message)
      const inspIds = ((linkRes.data as { inspection_id: string }[]) || []).map(r => r.inspection_id)
      const [itemsRes, inspRes, contRes] = await Promise.all([
        poId
          ? supabase.from('po_items').select('part_no,qty_ordered').eq('po_id', poId)
          : Promise.resolve({ data: [] as { part_no: string; qty_ordered: number }[], error: null }),
        inspIds.length
          ? supabase.from('inspections').select('status,part_no').in('id', inspIds)
          : Promise.resolve({ data: [] as { status: string; part_no: string | null }[], error: null }),
        supabase.from('container_loadings').select('insp_status,data').eq('po_no', po),
      ])
      if (itemsRes.error || inspRes.error || contRes.error) throw new Error('stage fetch failed')
      const next = computeStages({
        items: (itemsRes.data as { part_no: string; qty_ordered: number }[]) || [],
        insps: (inspRes.data as { status: string; part_no: string | null }[]) || [],
        conts: (contRes.data as { insp_status: string; data: unknown }[]) || [],
      })
      setStages(next)
      void cacheSet(key, next)
      return
    } catch { /* offline / fetch failed — fall through to the cache */ }
    const cached = await cacheGet<PoStages>(key)
    if (cached) setStages(cached)
  }, [po, profile.role, profile.id])

  useEffect(() => { load() }, [load, refreshKey])

  const blank: StageResult = { state: 'todo', done: 0, total: 0, unit: 'none' }
  const view: PoStages = stages || { items: blank, inspection: blank, loading: blank }

  // Subtitle for a stage: the "PO Ordered Items" stage just shows its count;
  // the others show a state word plus a done/total count so progress is clear
  // (e.g. "In progress · 5/6 SKUs", "✓ 600/600 pcs").
  const subtitle = (key: keyof PoStages, s: StageResult): string => {
    const unit = bi(UNIT[s.unit])
    const count = s.total > 0 ? `${s.done}/${s.total} ${unit}` : `${s.done} ${unit}`
    if (key === 'items') return s.total > 0 ? `${s.total} ${unit}` : bi(NO_ITEMS)
    if (s.state === 'todo') return bi(STATE_WORD.todo)
    if (s.state === 'done') return `✓ ${count}`
    return `${bi(STATE_WORD.active)} · ${count}`
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="pstrip">
        {ORDER.map(key => (
          <div key={key} className={`pseg ${view[key].state}`}>
            <span className="pseg-name">{bi(NAMES[key])}</span>
            <span className="pseg-state">{subtitle(key, view[key])}</span>
          </div>
        ))}
        <div className="pseg ext" aria-hidden="true">
          <span className="pseg-name">{bi(SHIPPED)}</span>
          <span className="pseg-state">{bi(SHIPPED_NOTE)}</span>
        </div>
      </div>
    </div>
  )
}
