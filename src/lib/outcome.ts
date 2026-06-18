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
    const checked = bV.checked + bT.checked + ex.checked + h.checked
    const dedup = [...new Set([
      ...baseFails.map((n) => `#${n}`),
      ...ex.failIdx.map((n) => `Extra ${n}`),
      ...h.fails.map((n) => `#${n}`),
    ])]
    const fail = baseFails.length + ex.failIdx.length + h.fails.length
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

export function summaryText(rows: OutcomeRow[]): string {
  const hundred = rows.filter((x) => x.outcome === '100% Inspection')
  const additional = rows.filter((x) => x.outcome.startsWith('Additional Inspection — Pass'))
  const parts: string[] = []
  if (hundred.length) parts.push(`${hundred.length} parameter${hundred.length > 1 ? 's' : ''} required 100% inspection: ${hundred.map((x) => x.parameter).join('; ')}.`)
  if (additional.length) parts.push(`${additional.length} parameter${additional.length > 1 ? 's' : ''} passed after additional sampling: ${additional.map((x) => x.parameter).join('; ')}.`)
  if (!hundred.length && !additional.length) parts.push('All inspected parameters passed on the initial sample.')
  else parts.push('All other inspected parameters passed.')
  return parts.join(' ')
}

export const outcomeColor = (o: string) =>
  o === '100% Inspection' ? 'var(--fail)' : o.startsWith('Additional') ? 'var(--amber)' : 'var(--pass)'
