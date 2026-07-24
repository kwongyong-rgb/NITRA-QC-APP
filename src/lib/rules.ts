// ============================================================
// NITRA Live Pass-Fail Rule Engine — v2
//
// Rule:
//   - Visual/Form parameters: base sample = appSample; if 1 fail → inspect 4 extra pieces
//   - Technical/Measure parameters: base sample = funSample; if 1 fail → inspect 2 extra pieces
//   - 2+ failures in the initial sample → immediate 100% inspection for that parameter
//   - Any failure in the extra sample → 100% inspection for that parameter
//   - Pallet tab failures do NOT count toward the rule engine
// ============================================================

export type PFNA = 'P' | 'F' | 'NA' | undefined
export type ItemStatus = 'clean' | 'extra_needed' | 'monitor' | 'full_inspection'

export interface ItemVerdict {
  key: string                       // item_key or param_key
  label: string                     // human-readable
  tab: 'form' | 'measure'
  group: 'A' | 'Fn'
  baseFailures: number
  extraResults: PFNA[]              // results for the extra pieces
  status: ItemStatus
  extrasStillNeeded: number         // how many more to inspect (0 if done)
  extrasRequired: number            // total extras this parameter needs (lot-capped)
  baseSample: number                // lot-capped base sample — extras start after this
}

// ---------------------------------------------------------------------------
// LOT-SIZE CAPS (v101). The sampling plan must never ask for more pieces than the
// lot actually contains. Two caps:
//   1. The base sample itself: a lot of 5 gets a base sample of 5, not 8.
//   2. The extra sample: capped by how many pieces remain UNINSPECTED.
//      Lot 10, base 8 → only 2 remain, so 2 extras, not the standard 4.
// ---------------------------------------------------------------------------

// The base sample actually used: never more pieces than exist in the lot.
export function effectiveSample(sample: number, lotSize: number): number {
  if (!Number.isFinite(lotSize) || lotSize <= 0) return sample
  return Math.max(0, Math.min(sample, lotSize))
}

// How many extra pieces this parameter needs: the standard extra count, capped by
// the pieces left over after the base sample. Zero when the base already covered
// the whole lot (there is physically nothing more to inspect).
export function extrasRequiredFor(standard: number, lotSize: number, baseSample: number): number {
  if (!Number.isFinite(lotSize) || lotSize <= 0) return standard
  return Math.max(0, Math.min(standard, lotSize - baseSample))
}

// Extra pieces are the NEXT pieces in the lot after the base sample — sequential,
// because inspectors finish the base sample before pulling any more. With a base
// of 8, extra #1 IS lot piece 9. Giving extras their real piece number is what
// lets them carry into the 100% check and into the pass/fail counts; before this
// they were stored anonymously ("one pass, one fail") and were silently dropped.
export const extraPieceNo = (baseSample: number, index: number) => baseSample + index + 1

export interface FormData {
  results: Record<string, PFNA>              // "item_key:piece_no" → P/F/NA
  extra_results: Record<string, PFNA[]>      // "item_key" → array of extra results
  meas_results: Record<string, PFNA>         // "param_key:piece_no" → P/F/NA
  meas_extra_results: Record<string, PFNA[]> // "param_key" → array of extra results
  pallet: Record<string, PFNA>
}

export function emptyFormData(): FormData {
  return { results: {}, extra_results: {}, meas_results: {}, meas_extra_results: {}, pallet: {} }
}

function evalItem(
  key: string, label: string, tab: 'form' | 'measure', group: 'A' | 'Fn',
  baseResults: PFNA[], extraResults: PFNA[], extrasRequired: number, baseSample: number
): ItemVerdict {
  const common = { key, label, tab, group, extrasRequired, baseSample }
  const baseFailures = baseResults.filter(r => r === 'F').length
  if (baseFailures === 0) {
    return { ...common, baseFailures: 0, extraResults: [], status: 'clean', extrasStillNeeded: 0 }
  }
  // 2+ failures in the initial sample → immediate 100% inspection.
  if (baseFailures >= 2) {
    return { ...common, baseFailures, extraResults, status: 'full_inspection', extrasStillNeeded: 0 }
  }
  // Any F in extras → immediate 100% inspection.
  if (extraResults.includes('F')) {
    return { ...common, baseFailures, extraResults, status: 'full_inspection', extrasStillNeeded: 0 }
  }
  const done = extraResults.filter(r => r === 'P' || r === 'F').length
  // extrasRequired is lot-capped, so when the base already covered the whole lot
  // this is 0 and we fall straight through to 'monitor' — there is nothing left to
  // inspect, and one failure in a fully-inspected lot is the final answer.
  if (done < extrasRequired) {
    return { ...common, baseFailures, extraResults, status: 'extra_needed', extrasStillNeeded: extrasRequired - done }
  }
  return { ...common, baseFailures, extraResults, status: 'monitor', extrasStillNeeded: 0 }
}

export function evaluateAll(
  fd: FormData,
  formItems: { key: string; label: string; group: 'A' | 'Fn' }[],
  measItems: { key: string; label: string }[],
  appSample: number,
  funSample: number,
  lotSize: number,
  visualExtrasRequired = 4,
  technicalExtrasRequired = 2
): ItemVerdict[] {
  const out: ItemVerdict[] = []
  // Everything below works off the LOT-CAPPED sample sizes, so the engine can
  // never ask for a piece that doesn't exist.
  const appBase = effectiveSample(appSample, lotSize)
  const funBase = effectiveSample(funSample, lotSize)
  const visExtras = extrasRequiredFor(visualExtrasRequired, lotSize, appBase)
  const techExtras = extrasRequiredFor(technicalExtrasRequired, lotSize, funBase)

  // Form/Visual items: every parameter under the Visual tab uses the Visual sample size.
  for (const item of formItems) {
    const base: PFNA[] = Array.from({ length: appBase }, (_, i) => fd.results[`${item.key}:${i + 1}`])
    const extras: PFNA[] = fd.extra_results[item.key] || []
    const v = evalItem(item.key, item.label, 'form', 'A', base, extras, visExtras, appBase)
    if (v.status !== 'clean') out.push(v)
  }

  // Measure/Technical items: every parameter under the Technical tab uses the Technical sample size.
  for (const item of measItems) {
    const base: PFNA[] = Array.from({ length: funBase }, (_, i) => fd.meas_results[`${item.key}:${i + 1}`])
    const extras: PFNA[] = fd.meas_extra_results[item.key] || []
    const v = evalItem(item.key, item.label, 'measure', 'Fn', base, extras, techExtras, funBase)
    if (v.status !== 'clean') out.push(v)
  }

  return out.sort((a, b) => {
    const order = { full_inspection: 0, extra_needed: 1, monitor: 2, clean: 3 }
    return order[a.status] - order[b.status]
  })
}

export interface SamplingSettings {
  app_base: number; app_inc: number
  fun_base: number; fun_inc: number
  extra_on_defect: number
}
export function sampleSizes(lot: number, s: SamplingSettings) {
  const blocks = Math.max(0, Math.ceil(lot / 100) - 1)
  return { app: s.app_base + s.app_inc * blocks, fun: s.fun_base + s.fun_inc * blocks }
}
