import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Shared PO status logic — used by the PO command-center strip (PoStatusStrip)
// AND by PoInfo's Ordered / Loaded / Remaining table. Both MUST agree on what
// "loaded" means, so the summation lives here once. If this changes, the strip
// and the table move together.
// ---------------------------------------------------------------------------

export type StageState = 'todo' | 'active' | 'done'

export interface PoStageInput {
  items: { part_no: string; qty_ordered: number }[]
  insps: { status: string }[]
  conts: { insp_status: string; data: unknown }[]
}

export interface PoStages {
  items: StageState
  inspection: StageState
  loading: StageState
  loaded: StageState
}

// Sum loaded quantity per part number across all container loadings for a PO.
// Mirrors the two container shapes: pallet loadings (data.pallets[*].contents)
// and non-pallet loadings (data.non_pallet_contents). It sums whatever
// containers the caller passes in — the caller decides which to include:
// the strip's Loaded terminal passes APPROVED loadings only, while PoInfo's
// running Ordered/Loaded/Remaining table passes all recorded loadings.
export function sumLoadedByPart(conts: { data: unknown }[]): Record<string, number> {
  const sums: Record<string, number> = {}
  const add = (ct: unknown) => {
    const c = ct as { part_no?: string; qty?: unknown }
    if (c && c.part_no) sums[c.part_no] = (sums[c.part_no] || 0) + (Number(c.qty) || 0)
  }
  for (const cont of conts || []) {
    const d = (cont?.data || {}) as {
      loading_type?: string
      pallets?: Record<string, { contents?: unknown[] }>
      non_pallet_contents?: unknown[]
    }
    if ((d.loading_type || 'pallet') === 'pallet') {
      for (const pd of Object.values(d.pallets || {})) {
        for (const ct of (pd?.contents || [])) add(ct)
      }
    } else {
      for (const ct of (d.non_pallet_contents || [])) add(ct)
    }
  }
  return sums
}

// Read the pos.id for a PO number, lazily creating the master row when an admin
// opens a PO that predates the pos table (mirrors PoInfo). Conflict-safe: if a
// concurrent create wins the unique index, we simply re-read.
export async function getOrCreatePoId(po: string, canCreate: boolean): Promise<string | null> {
  if (!po || !po.trim()) return null
  const { data } = await supabase.from('pos').select('id').eq('po_no', po).maybeSingle()
  if (data) return (data as { id: string }).id
  if (!canCreate) return null
  const ins = await supabase.from('pos').insert({ po_no: po }).select('id').single()
  if (!ins.error && ins.data) return (ins.data as { id: string }).id
  const re = await supabase.from('pos').select('id').eq('po_no', po).maybeSingle()
  return re.data ? (re.data as { id: string }).id : null
}

// Compute the four QC lifecycle stages for the strip.
// - items:      order list entered
// - inspection: wheel inspections all APPROVED (approver sign-off, not just submitted)
// - loading:    container-loading inspections all APPROVED
// - loaded:     every ordered piece covered by loaded container contents (Remaining = 0)
// A stage is 'active' while its work exists but isn't complete, 'todo' before it starts.
export function computeStages(input: PoStageInput): PoStages {
  const { items, insps, conts } = input

  const items_ = items.length ? 'done' : 'todo'

  const inspection: StageState = insps.length === 0
    ? 'todo'
    : insps.every(i => i.status === 'approved') ? 'done' : 'active'

  const loading: StageState = conts.length === 0
    ? 'todo'
    : conts.every(c => c.insp_status === 'approved') ? 'done' : 'active'

  // "Loaded" counts only APPROVED container loadings — a piece isn't loaded
  // until the container-loading inspection is signed off. This keeps the Loaded
  // terminal consistent with the Loading stage above and with the rule that
  // approval = loaded. (PoInfo's Ordered/Loaded/Remaining table still counts all
  // recorded loadings; the two can differ while a loading awaits approval.)
  const approvedConts = conts.filter(c => c.insp_status === 'approved')
  const loadedByPart = sumLoadedByPart(approvedConts)
  const totalLoaded = Object.values(loadedByPart).reduce((a, b) => a + b, 0)
  let loaded: StageState
  if (items.length === 0) {
    loaded = totalLoaded > 0 ? 'active' : 'todo'
  } else {
    const hasOrder = items.some(it => (it.qty_ordered || 0) > 0)
    const fullyCovered = hasOrder && items.every(it => (loadedByPart[it.part_no] || 0) >= (it.qty_ordered || 0))
    loaded = fullyCovered ? 'done' : (totalLoaded > 0 ? 'active' : 'todo')
  }

  return { items: items_, inspection, loading, loaded }
}
