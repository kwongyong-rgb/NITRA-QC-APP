import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Shared SKU inspections — helpers over the inspection_pos junction table.
// One wheel inspection (a verdict on a production lot) can be linked to many
// POs. The link is association-only: per-PO quantities live in the ordered-items
// table, not here. off_po marks a link where the SKU is not on that PO's order.
// ---------------------------------------------------------------------------

export interface PoLink { po_no: string; off_po: boolean }

// Inspection ids linked to a PO, with each link's off_po flag.
export async function linkedInspectionIds(po: string): Promise<{ ids: string[]; offPo: Record<string, boolean> }> {
  const { data } = await supabase.from('inspection_pos').select('inspection_id, off_po').eq('po_no', po)
  const rows = (data as { inspection_id: string; off_po: boolean }[]) || []
  const offPo: Record<string, boolean> = {}
  for (const r of rows) offPo[r.inspection_id] = r.off_po
  return { ids: rows.map(r => r.inspection_id), offPo }
}

// POs an inspection is linked to.
export async function posForInspection(inspId: string): Promise<PoLink[]> {
  const { data } = await supabase.from('inspection_pos').select('po_no, off_po').eq('inspection_id', inspId).order('po_no')
  return (data as PoLink[]) || []
}

// PO numbers that ordered a given part number (eligible to attach), minus any to exclude.
export async function posOrderingPart(partNo: string, exclude: string[] = []): Promise<string[]> {
  const { data } = await supabase.from('po_items').select('pos!inner(po_no)').eq('part_no', partNo)
  const rows = (data as { pos: { po_no: string } | { po_no: string }[] | null }[]) || []
  const ex = new Set(exclude)
  const out = new Set<string>()
  for (const r of rows) {
    const p = r.pos
    if (!p) continue
    for (const x of (Array.isArray(p) ? p : [p])) {
      if (x?.po_no && !ex.has(x.po_no)) out.add(x.po_no)
    }
  }
  return [...out].sort()
}

// Every PO number (for the off-PO override), minus any to exclude.
export async function allPoNos(exclude: string[] = []): Promise<string[]> {
  const { data } = await supabase.from('pos').select('po_no').order('po_no')
  const ex = new Set(exclude)
  return ((data as { po_no: string }[]) || []).map(r => r.po_no).filter(p => !ex.has(p))
}

export async function attachToPo(inspId: string, po: string, offPo: boolean, createdBy?: string) {
  return supabase.from('inspection_pos').insert({ inspection_id: inspId, po_no: po, off_po: offPo, created_by: createdBy ?? null })
}

export async function detachFromPo(inspId: string, po: string) {
  return supabase.from('inspection_pos').delete().eq('inspection_id', inspId).eq('po_no', po)
}

// Delete a PO's links, then delete only the inspections that are now orphaned
// (no remaining PO). Shared inspections still linked elsewhere are preserved.
export async function deletePoLinksAndOrphans(po: string): Promise<void> {
  const { ids } = await linkedInspectionIds(po)
  await supabase.from('inspection_pos').delete().eq('po_no', po)
  if (!ids.length) return
  const { data: still } = await supabase.from('inspection_pos').select('inspection_id').in('inspection_id', ids)
  const stillSet = new Set(((still as { inspection_id: string }[]) || []).map(s => s.inspection_id))
  const orphans = ids.filter(id => !stillSet.has(id))
  if (orphans.length) await supabase.from('inspections').delete().in('id', orphans)
}
