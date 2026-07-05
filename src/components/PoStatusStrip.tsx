import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n, type Bi } from '../lib/i18n'
import { computeStages, getOrCreatePoId, type PoStages, type StageState } from '../lib/poStatus'
import type { Profile } from '../App'

// The PO command center's status strip: Items ▸ Inspection ▸ Loading ▸ Loaded,
// followed by a de-emphasised "Shipping" cap that marks where this QC app's job
// ends and the separate shipping app takes over (until the two systems merge).

const NAMES: Record<keyof PoStages, Bi> = {
  items:      { en: 'Items',      zh: '订单项目' },
  inspection: { en: 'Inspection', zh: '检验' },
  loading:    { en: 'Loading',    zh: '装柜' },
  loaded:     { en: 'Loaded',     zh: '已装载' },
}

// Per-stage state label (some stages read more naturally than a generic word).
const STATE_LABEL: Record<keyof PoStages, Record<StageState, Bi>> = {
  items: {
    done:   { en: '✓ entered',     zh: '✓ 已录入' },
    active: { en: 'in progress',   zh: '进行中' },
    todo:   { en: 'no items',      zh: '暂无项目' },
  },
  inspection: {
    done:   { en: '✓ approved',    zh: '✓ 已批准' },
    active: { en: 'in progress',   zh: '进行中' },
    todo:   { en: 'not started',   zh: '未开始' },
  },
  loading: {
    done:   { en: '✓ approved',    zh: '✓ 已批准' },
    active: { en: 'in progress',   zh: '进行中' },
    todo:   { en: 'not started',   zh: '未开始' },
  },
  loaded: {
    done:   { en: '✓ all pieces',  zh: '✓ 全部装载' },
    active: { en: 'partial',       zh: '部分装载' },
    todo:   { en: '—',             zh: '—' },
  },
}

const SHIPPING: Bi = { en: 'Shipping', zh: '发运' }
const SHIPPING_NOTE: Bi = { en: 'separate app', zh: '独立系统' }

const ORDER: (keyof PoStages)[] = ['items', 'inspection', 'loading', 'loaded']

export default function PoStatusStrip({ po, profile, refreshKey }: { po: string; profile: Profile; refreshKey?: number }) {
  const { bi } = useI18n()
  const [stages, setStages] = useState<PoStages | null>(null)

  const load = useCallback(async () => {
    const poId = await getOrCreatePoId(po, profile.role === 'admin')
    const [itemsRes, inspRes, contRes] = await Promise.all([
      poId
        ? supabase.from('po_items').select('part_no,qty_ordered').eq('po_id', poId)
        : Promise.resolve({ data: [] as { part_no: string; qty_ordered: number }[] }),
      supabase.from('inspections').select('status').eq('po_no', po),
      supabase.from('container_loadings').select('insp_status,data').eq('po_no', po),
    ])
    setStages(computeStages({
      items: (itemsRes.data as { part_no: string; qty_ordered: number }[]) || [],
      insps: (inspRes.data as { status: string }[]) || [],
      conts: (contRes.data as { insp_status: string; data: unknown }[]) || [],
    }))
  }, [po, profile.role])

  useEffect(() => { load() }, [load, refreshKey])

  const view: PoStages = stages || { items: 'todo', inspection: 'todo', loading: 'todo', loaded: 'todo' }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="pstrip">
        {ORDER.map(key => (
          <div key={key} className={`pseg ${view[key]}`}>
            <span className="pseg-name">{bi(NAMES[key])}</span>
            <span className="pseg-state">{bi(STATE_LABEL[key][view[key]])}</span>
          </div>
        ))}
        <div className="pseg ext" aria-hidden="true">
          <span className="pseg-name">{bi(SHIPPING)}</span>
          <span className="pseg-state">{bi(SHIPPING_NOTE)}</span>
        </div>
      </div>
    </div>
  )
}
