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
  extraResults: PFNA[]              // results for up to 4 extra pieces
  status: ItemStatus
  extrasStillNeeded: number         // how many more to inspect (0 if done)
}

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
  baseResults: PFNA[], extraResults: PFNA[], extrasRequired: number
): ItemVerdict {
  const baseFailures = baseResults.filter(r => r === 'F').length
  if (baseFailures === 0) {
    return { key, label, tab, group, baseFailures: 0, extraResults: [], status: 'clean', extrasStillNeeded: 0 }
  }
  // 2+ failures in the initial sample → immediate 100% inspection.
  if (baseFailures >= 2) {
    return { key, label, tab, group, baseFailures, extraResults, status: 'full_inspection', extrasStillNeeded: 0 }
  }
  // Any F in extras → immediate 100% inspection.
  if (extraResults.includes('F')) {
    return { key, label, tab, group, baseFailures, extraResults, status: 'full_inspection', extrasStillNeeded: 0 }
  }
  const done = extraResults.filter(r => r === 'P' || r === 'F').length
  if (done < extrasRequired) {
    return { key, label, tab, group, baseFailures, extraResults, status: 'extra_needed', extrasStillNeeded: extrasRequired - done }
  }
  return { key, label, tab, group, baseFailures, extraResults, status: 'monitor', extrasStillNeeded: 0 }
}

export function evaluateAll(
  fd: FormData,
  formItems: { key: string; label: string; group: 'A' | 'Fn' }[],
  measItems: { key: string; label: string }[],
  appSample: number,
  funSample: number,
  visualExtrasRequired = 4,
  technicalExtrasRequired = 2
): ItemVerdict[] {
  const out: ItemVerdict[] = []

  // Form/Visual items: every parameter under the Visual tab uses the Visual sample size.
  for (const item of formItems) {
    const base: PFNA[] = Array.from({ length: appSample }, (_, i) => fd.results[`${item.key}:${i + 1}`])
    const extras: PFNA[] = fd.extra_results[item.key] || []
    const v = evalItem(item.key, item.label, 'form', 'A', base, extras, visualExtrasRequired)
    if (v.status !== 'clean') out.push(v)
  }

  // Measure/Technical items: every parameter under the Technical tab uses the Technical sample size.
  for (const item of measItems) {
    const base: PFNA[] = Array.from({ length: funSample }, (_, i) => fd.meas_results[`${item.key}:${i + 1}`])
    const extras: PFNA[] = fd.meas_extra_results[item.key] || []
    const v = evalItem(item.key, item.label, 'measure', 'Fn', base, extras, technicalExtrasRequired)
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
