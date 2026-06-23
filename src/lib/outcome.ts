// Per-parameter inspection outcome — shared by the in-app Summary tab.
// Mirrors the logic in supabase/functions/interactive-report so the in-app
// Summary and the emailed interactive report show identical results.

export interface OutcomeRow {
  key: string
  parameter: string
  checked: number
  pass: number
  fail: number
  defectPieces: string
  outcome: string
}

type AnyFd = {
  results?: Record<string, string>
  meas_results?: Record<string, string>
  extra_results?: Record<string, string[]>
  meas_extra_results?: Record<string, string[]>
  hundred_pct?: Record<string, Record<string, string>>
} | null | undefined

export function computeOutcomes(fdInput: unknown, labelOf: (k: string) => string): OutcomeRow[] {
  const fd = (fdInput || {}) as AnyFd
  const baseV = fd?.results || {}
  const baseT = fd?.meas_results || {}
  const extraV = fd?.extra_results || {}
  const extraT = fd?.meas_extra_results || {}
  const hundred = fd?.hundred_pct || {}

  const scanBase = (map: Record<string, string>, key: string) => {
    let checked = 0; const fails: number[] = []
    for (const [k, v] of Object.entries(map)) {
      if (k.split(':')[0] !== key) continue
      if (v === 'P' || v === 'F') { checked++; if (v === 'F') fails.push(Number(k.split(':')[1])) }
    }
    return { checked, fails }
  }
  const scanArr = (arr: string[] | undefined) => {
    let checked = 0; const failIdx: number[] = []
    ;(arr || []).forEach((v, i) => { if (v === 'P' || v === 'F') { checked++; if (v === 'F') failIdx.push(i + 1) } })
    return { checked, failIdx }
  }
  const scanHundred = (map: Record<string, string> | undefined) => {
    let checked = 0; const fails: number[] = []
    for (const [pc, v] of Object.entries(map || {})) { if (v === 'P' || v === 'F') { checked++; if (v === 'F') fails.push(Number(pc)) } }
    return { checked, fails }
  }

  const keySet = new Set<string>()
  for (const k of Object.keys(baseV)) keySet.add(k.split(':')[0])
  for (const k of Object.keys(baseT)) keySet.add(k.split(':')[0])
  for (const k of Object.keys(extraV)) keySet.add(k)
  for (const k of Object.keys(extraT)) keySet.add(k)
  for (const k of Object.keys(hundred)) keySet.add(k)

  const rank = (o: string) => (o === '100% Inspection' ? 0 : o.startsWith('Additional') ? 1 : 2)
  return [...keySet].map((key) => {
    const bV = scanBase(baseV, key), bT = scanBase(baseT, key)
    const baseFails = [...bV.fails, ...bT.fails]
    const ex = scanArr(extraV[key] || extraT[key])
    const h = scanHundred(hundred[key])
    // Per piece: the 100% set fills in pieces, but the base (Visual/Technical)
    // verdict is the first authority and OVERRIDES it for any base-inspected
    // piece — so a base fail can never be flipped to pass by a stray 100% mark.
    const mergedV: Record<number, string> = {}
    for (const [pc, v] of Object.entries(hundred[key] || {})) { if (v === 'P' || v === 'F') mergedV[Number(pc)] = v }
    for (const [k, v] of Object.entries(baseV)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
    for (const [k, v] of Object.entries(baseT)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
    const failPieces = Object.entries(mergedV).filter(([, v]) => v === 'F').map(([pc]) => Number(pc)).sort((a, b) => a - b)
    const checked = Object.keys(mergedV).length
    const fail = failPieces.length
    const dedup = failPieces.map((n) => `#${n}`)
    let outcome: string
    if (h.checked > 0) outcome = '100% Inspection'
    else if (baseFails.length >= 2) outcome = '100% Inspection'
    else if (ex.failIdx.length >= 1) outcome = '100% Inspection'
    else if (ex.checked > 0) outcome = 'Additional Inspection — Pass'
    else if (baseFails.length === 0) outcome = 'Pass'
    else outcome = 'Additional Inspection Required'
    return { key, parameter: labelOf(key), checked, pass: checked - fail, fail, defectPieces: dedup.length ? dedup.join(', ') : '—', outcome }
  }).filter((o) => o.checked > 0)
    .sort((a, b) => rank(a.outcome) - rank(b.outcome) || a.parameter.localeCompare(b.parameter))
}

export function summaryItems(rows: Array<{ parameter: string; outcome: string }>): string[] {
  const hundred = rows.filter((x) => x.outcome === '100% Inspection')
  const additional = rows.filter((x) => x.outcome.startsWith('Additional Inspection — Pass'))
  const items: string[] = []
  for (const r of hundred) items.push(`${r.parameter} — required 100% inspection`)
  for (const r of additional) items.push(`${r.parameter} — passed after additional sampling`)
  if (!hundred.length && !additional.length) items.push('All inspected parameters passed on the initial sample.')
  else items.push('All other inspected parameters passed.')
  return items
}

export const outcomeColor = (o: string) =>
  o === '100% Inspection' ? 'var(--fail)' : o.startsWith('Additional') ? 'var(--amber)' : 'var(--pass)'
