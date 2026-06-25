// Supabase Edge Function: po-report
//
// Aggregates a whole PO into one JSON for the consolidated report page:
//  - every wheel inspection's full report (reusing the interactive-report function,
//    so the per-SKU data + translation stay identical to the single report), and
//  - every container loading's summary (built here, with its dynamic text translated).
// Public (deploy with --no-verify-jwt). The page is src/pages/PoReportPage.tsx.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const PALLET_LABELS: Record<string, string> = {
  pl_wrap: 'Stretch-wrapped', pl_corner: 'Corner protectors', pl_strap: 'Strapped',
  pl_label4: 'Pallet label on all 4 sides', pallet_full: 'Each pallet w/ labels',
  pl_stack: 'Stacking within limit', pl_shrink: 'Shrink film intact',
}
const labelOf = (k: string) => PALLET_LABELS[k] || k.replace(/_/g, ' ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const url = new URL(req.url)
    const po = url.searchParams.get('po') || ''
    const lang = (url.searchParams.get('lang') || 'en').toLowerCase()
    if (!po) return json({ ok: false, error: 'Missing po' }, 400)

    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const supa = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const [{ data: insps }, { data: conts }] = await Promise.all([
      supa.from('inspections').select('id,part_no,status,updated_at').eq('po_no', po).order('part_no'),
      supa.from('container_loadings').select('*').eq('po_no', po).order('container_no'),
    ])

    // ---- SKU sections: reuse interactive-report per inspection ----
    const skus = await Promise.all((insps || []).map(async (r: any) => {
      try {
        const resp = await fetch(`${supaUrl}/functions/v1/interactive-report?id=${encodeURIComponent(r.id)}&lang=${lang}`)
        const data = await resp.json()
        if (data && data.ok) return { id: r.id, status: r.status, ...data }
      } catch (_) { /* fall through */ }
      return { id: r.id, status: r.status, ok: false, insp: { part_no: r.part_no } }
    }))

    // ---- Container sections ----
    const contIds = (conts || []).map((c: any) => c.id)
    const { data: contPhotosRaw } = contIds.length
      ? await supa.from('photos').select('*').in('container_loading_id', contIds)
      : { data: [] as any[] }
    const contPhotos = contPhotosRaw || []

    const signed = async (path: string) => {
      const { data } = await supa.storage.from('qc-photos').createSignedUrl(path, 60 * 60 * 6)
      return data?.signedUrl || null
    }

    const containers = await Promise.all((conts || []).map(async (c: any) => {
      const d = c.data || {}
      const type = d.loading_type || 'pallet'
      // contents
      const contents: string[] = []
      if (type === 'pallet') {
        for (const [n, pd] of Object.entries(d.pallets || {})) {
          for (const ct of ((pd as any).contents || [])) if (ct.part_no) contents.push(`Pallet ${n}: ${ct.part_no} × ${ct.qty}`)
        }
      } else {
        for (const ct of (d.non_pallet_contents || [])) if (ct.part_no) contents.push(`${ct.part_no} × ${ct.qty}`)
      }
      // pallet checks roll-up
      let checkPass = 0, checkFail = 0
      const failedChecks: string[] = []
      for (const pd of Object.values(d.pallets || {})) {
        for (const [k, v] of Object.entries((pd as any).checks || {})) {
          if (v === 'P') checkPass++
          else if (v === 'F') { checkFail++; if (!failedChecks.includes(labelOf(k))) failedChecks.push(labelOf(k)) }
        }
      }
      // photos
      const mine = contPhotos.filter((p: any) => p.container_loading_id === c.id)
      const photos = await Promise.all(mine.map(async (p: any) => ({
        url: await signed(p.storage_path),
        isPass: !!p.is_pass_photo, mediaType: p.media_type || 'photo', comment: p.comment || '',
      })))
      return {
        id: c.id, container_no: c.container_no || '', seal_no: c.seal_no || '',
        status: c.status || '', insp_status: c.insp_status || '',
        loading_type: type, pallet_count: d.pallet_count ?? 0,
        contents, checkPass, checkFail, failedChecks,
        disposition: c.summary?.disposition || null,
        disposition_custom: c.summary?.disposition_custom || null,
        disposition_cls: c.summary?.disposition_cls || null,
        corrective_action: c.summary?.corrective_action || '',
        photos,
      }
    }))

    // ---- translate container dynamic text (SKU text already translated upstream) ----
    let translationNote: string | null = null
    if (lang === 'de' || lang === 'zh') {
      const strings = new Set<string>()
      for (const c of containers) {
        if (c.disposition_custom) strings.add(c.disposition_custom)
        if (c.corrective_action) strings.add(c.corrective_action)
        for (const f of c.failedChecks) strings.add(f)
        for (const p of c.photos) if (p.comment) strings.add(p.comment)
      }
      const list = [...strings].filter(Boolean)
      if (list.length) {
        const { map, error } = await translateBatch(list, lang, 'po:' + po, supa)
        if (error) translationNote = error
        const tr = (s: string) => (s && map[s]) ? map[s] : s
        for (const c of containers) {
          if (c.disposition_custom) c.disposition_custom = tr(c.disposition_custom)
          if (c.corrective_action) c.corrective_action = tr(c.corrective_action)
          c.failedChecks = c.failedChecks.map(tr)
          for (const p of c.photos) if (p.comment) p.comment = tr(p.comment)
        }
      }
    }

    const logoUrl = (skus.find((s: any) => s.logoUrl)?.logoUrl) || null
    return json({ ok: true, po, lang, translationNote, logoUrl, skus, containers })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

// Same translation+cache approach as interactive-report, keyed by an arbitrary id
// (here 'po:<PO>') so container text is only translated once per PO + language.
async function translateBatch(
  list: string[], lang: string, cacheId: string, supa: any,
): Promise<{ map: Record<string, string>; error: string | null }> {
  if (!list.length) return { map: {}, error: null }
  const source_hash = hashStrings(list)
  try {
    const { data: cached } = await supa.from('report_translations')
      .select('content_hash, payload').eq('inspection_id', cacheId).eq('lang', lang).maybeSingle()
    if (cached && cached.content_hash === source_hash && cached.payload && Object.keys(cached.payload).length) {
      return { map: cached.payload as Record<string, string>, error: null }
    }
  } catch (_) { /* best-effort */ }

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return { map: {}, error: 'no_key' }
  const obj: Record<string, string> = {}
  list.forEach((s, i) => { obj[String(i)] = s })
  const langName = lang === 'de' ? 'German' : 'Simplified Chinese'
  const system = `You are a professional translator for automotive alloy-wheel manufacturing and quality-control documents. Translate the VALUE of each entry in the given JSON object from English into ${langName}, using correct industry terminology. Do NOT translate or alter: part numbers, SKU codes, numeric measurements, units (mm, g, kg, cm), or piece references such as "#3". Preserve all numbers exactly. Some values may contain simple HTML tags (<b>, <i>, <u>, <p>, <ul>, <ol>, <li>, <br>, <span>); keep every tag exactly where it is and translate ONLY the human-readable text between the tags. Return ONLY a valid JSON object with exactly the same keys and the translated values — no markdown, no code fences, no extra commentary.`
  let parsed: Record<string, string> = {}
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, system, messages: [{ role: 'user', content: JSON.stringify(obj) }] }),
    })
    if (!resp.ok) return { map: {}, error: 'api_' + resp.status }
    const j = await resp.json()
    let text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
    parsed = JSON.parse(text)
  } catch (_) {
    return { map: {}, error: 'translate_failed' }
  }
  const map: Record<string, string> = {}
  list.forEach((s, i) => { const t = parsed[String(i)]; if (typeof t === 'string' && t.trim()) map[s] = t })
  try {
    await supa.from('report_translations').upsert({
      inspection_id: cacheId, lang, content_hash: source_hash, payload: map, updated_at: new Date().toISOString(),
    })
  } catch (_) { /* best-effort */ }
  return { map, error: null }
}
function hashStrings(arr: string[]): string {
  const s = arr.join('\u0001')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return String(h)
}
