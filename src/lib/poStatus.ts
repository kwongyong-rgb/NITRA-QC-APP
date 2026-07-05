import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Shared PO status logic — used by the PO command-center strip (PoStatusStrip)
// AND by PoInfo's Ordered / Loaded / Remaining table. The loaded-quantity
// summation lives here once (sumLoadedByPart) so both agree on the maths.
// ---------------------------------------------------------------------------

export type StageState = 'todo' | 'active' | 'done'
export type StageUnit = 'sku' | 'pcs' | 'none'

// One stage's progress: state + a done/total count in a unit.
// total = 0 means "no baseline to measure against" (e.g. no order list yet) —
// the strip then shows just the done figure without a denominator.
export interface StageResult {
  state: StageState
  done: number
  total: number
  unit: StageUnit
}

export interface PoStageInput {
  items: { part_no: string; qty_ordered: number }[]
  insps: { status: string; part_no: string | null }[]
  conts: { insp_status: string; data: unknown }[]
}

// Three QC lifecycle stages (a 4th "Loaded" was folded into Loading: an
// approved container-loading inspection already means those pieces are loaded).
export interface PoStages {
  items: StageResult
  inspection: StageResult
  loading: StageResult
}

// Sum loaded quantity per part number across the container loadings passed in.
// Mirrors the two container shapes: pallet loadings (data.pallets[*].contents)
// and non-pallet loadings (data.non_pallet_contents). It sums whatever
// containers the caller gives it — the caller decides which to include: the
// strip's Loading stage passes APPROVED loadings only, while PoInfo's running
// Ordered/Loaded/Remaining table passes all recorded loadings.
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

// Compute the three QC lifecycle stages, each with a done/total count.
// - PO Ordered Items: order list entered            -> count = ordered SKUs
// - Inspection:       ordered SKUs with an APPROVED inspection / ordered SKUs
// - Loading:          APPROVED-loaded pieces / ordered pieces
//   (approved container-loading inspection = those pieces are loaded)
// A stage is 'active' while under way but incomplete, 'todo' before it starts.
export function computeStages(input: PoStageInput): PoStages {
  const { items, insps, conts } = input

  const orderedSkus = items.length
  const orderedPcs = items.reduce((a, b) => a + (b.qty_ordered || 0), 0)
  const orderedParts = new Set(items.map(i => i.part_no))

  // ---- PO Ordered Items ----
  const itemsStage: StageResult = {
    state: orderedSkus > 0 ? 'done' : 'todo',
    done: orderedSkus,
    total: orderedSkus,
    unit: 'sku',
  }

  // ---- Inspection: ordered SKUs that have an approved inspection ----
  const approvedInspParts = new Set(
    insps.filter(i => i.status === 'approved' && i.part_no).map(i => i.part_no as string),
  )
  let inspDone: number
  let inspTotal: number
  if (orderedSkus > 0) {
    inspTotal = orderedSkus
    inspDone = [...orderedParts].filter(p => approvedInspParts.has(p)).length
  } else {
    // No order list — fall back to the distinct SKUs actually inspected.
    const anyParts = new Set(insps.filter(i => i.part_no).map(i => i.part_no as string))
    inspTotal = anyParts.size
    inspDone = approvedInspParts.size
  }
  const inspState: StageState =
    insps.length === 0 ? 'todo' : (inspTotal > 0 && inspDone >= inspTotal ? 'done' : 'active')

  // ---- Loading: approved-loaded pieces vs ordered pieces ----
  const approvedConts = conts.filter(c => c.insp_status === 'approved')
  const loadedPcs = Object.values(sumLoadedByPart(approvedConts)).reduce((a, b) => a + b, 0)
  let loadState: StageState
  if (conts.length === 0) {
    loadState = 'todo'
  } else if (orderedPcs > 0) {
    loadState = loadedPcs >= orderedPcs ? 'done' : 'active'
  } else {
    // No order baseline — done only if every recorded loading is approved.
    loadState = conts.every(c => c.insp_status === 'approved') ? 'done' : 'active'
  }

  return {
    items: itemsStage,
    inspection: { state: inspState, done: inspDone, total: inspTotal, unit: 'sku' },
    loading: { state: loadState, done: loadedPcs, total: orderedPcs, unit: 'pcs' },
  }
}
