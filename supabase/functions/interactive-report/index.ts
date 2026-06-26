// Supabase Edge Function: interactive-report
//
// Returns the inspection report as JSON. Deliberately does NOT return an
// HTML page: Supabase forces any HTML-shaped Edge Function response into
// Content-Type: text/plain with a locked-down sandboxed CSP, to stop the
// shared *.supabase.co domain being used to host arbitrary live webpages.
// That cannot be overridden from function code. The real report page is
// rendered by the NITRA app itself (src/pages/ReportPage.tsx) on its own
// domain, which simply calls this function for the data.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const pieceLabel = (pieceNo: unknown) => {
  const n = Number(pieceNo)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 0) return 'Additional'
  return `Piece ${n}`
}

const LABELS: Record<string, string> = {
  area_a: 'Area A — Front / design',
  area_b: 'Area B — Window',
  area_c: 'Area C — Rim well outside',
  area_c1: 'Area C1 — Rim well inside',
  area_d: 'Area D — Rim horn inside',
  area_e: 'Area E — Valve hole',
  axial_bot: 'Axial bottom',
  axial_top: 'Axial top',
  bal_b: 'Balance B (g)',
  bal_bc: 'Balance B+C (g)',
  bal_c: 'Balance C (g)',
  batch_laser: 'Batch no. / laser engraving',
  bolt_cone_paint: 'Bolt hole / cone free of paint',
  box_label: 'Box label + UPC',
  bx_design: 'Box design matches sample',
  bx_label: 'Box label format & size',
  bx_proddate: 'Production date below UPC',
  bx_stick: 'Stick-on label square, no slant',
  bx_upc: 'UPC-A scans',
  cap_color: 'Cap Color vs Wheel Color',
  cap_finish: 'Cap surface finish',
  cap_fitment: 'Cap fitment',
  cb: 'Center bore CB',
  coating_machined: 'Machined-area coating',
  coating_total: 'Total coating thickness',
  container_door: 'Container door (# legible)',
  container_empty: 'Container empty + damage',
  container_full: 'Container full',
  container_half: 'Container half full',
  container_seal: 'Seal # (legible)',
  counter_bore: 'Counter bore',
  ct_labels_doors: 'Box labels + hand-holes face doors',
  ct_net: 'Net/rope before closing doors',
  ct_no_loose: 'No loose wheels',
  ct_photo_before: 'Container damage + empty photographed',
  ct_spares_front: 'Spare boxes/caps at front',
  hat_marks: 'No hat marks',
  laser_format: 'Laser engraving format',
  logo: 'Logo',
  lug_hole: 'Lug hole',
  lug_seat_type: 'Lug seat type',
  mark_cb: 'Back marking — CB',
  mark_et: 'Back marking — ET',
  mark_nitra: 'Back marking — NITRA brand',
  mark_pcd: 'Back marking — PCD',
  mark_sae: 'Back marking — SAE J2530',
  mark_size: 'Back marking — SIZE',
  offset: 'Offset ET',
  orange_peel: 'Smooth surface, no orange peel',
  packing_inside: 'Packing layers inside box',
  pallet_full: 'Each pallet w/ labels',
  pk_bag: 'Step 4 — plastic bag',
  pk_cap: 'Step 1 — cap on wheel',
  pk_cloth: 'Step 2 — face cloth cover',
  pk_foam: 'Foam/cling on gloss black',
  pk_fullface: 'Full-face cap taped at box bottom',
  pk_hoop: 'Step 3 — plastic hoop',
  pk_sideboard: 'Side boards each side',
  pk_toppad: 'Step 5 — protective top pad',
  pl_grouped: 'Wheels stacked & grouped by part no.',
  pl_height: 'Height ≤254 cm, 3-inch fork gap',
  pl_label4: 'Pallet label on all 4 sides',
  pl_photo: 'Photo of each pallet taken',
  pl_straps: '4 straps tight',
  pl_wood: 'Fumigation-free solid-wood pallet',
  pl_wrap: 'Wrap ≥3 layers, ≥0.35 mm, tight',
  radial_bot: 'Radial bottom',
  radial_top: 'Radial top',
  rear_bore_paint: 'Rear centre bore + mounting face paint-free',
  seat_thick: 'Seat thickness',
  tpms_hole: 'TPMS Dimension',
  wheel_back: 'Wheel back + markings',
  wheel_front: 'Wheel front face',
  wheel_weight: 'Wheel weight',
  required_shots: 'Required Photos',
}
const labelOf = (key: unknown) => LABELS[String(key)] || String(key ?? '').replace(/_/g, ' ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  try {
    const url = new URL(req.url)
    const inspectionId = url.searchParams.get('id') || url.searchParams.get('inspection_id')
    if (!inspectionId) return json({ ok: false, error: 'Missing inspection id' }, 400)

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: insp, error: inspErr } = await supa.from('inspections').select('*').eq('id', inspectionId).single()
    if (inspErr || !insp) return json({ ok: false, error: 'Inspection not found' }, 404)

    const [{ data: sku }, { data: defectsRaw }, { data: photosRaw }] = await Promise.all([
      supa.from('skus').select('*').eq('part_no', insp.part_no).maybeSingle(),
      supa.from('defects').select('*').eq('inspection_id', inspectionId).order('created_at'),
      supa.from('photos').select('*').eq('inspection_id', inspectionId).order('created_at'),
    ])
    const defects = defectsRaw || []
    const photos = photosRaw || []

    const ids = [insp.inspector_id, insp.reviewed_by].filter(Boolean)
    const names: Record<string, string> = {}
    if (ids.length) {
      const { data: profs } = await supa.from('profiles').select('id, full_name').in('id', ids)
      for (const p of profs || []) names[p.id] = p.full_name
    }

    const storagePaths = [...new Set(photos.map((p: any) => p.storage_path).filter(Boolean))]
    const mediaUrls: Record<string, string> = {}
    if (storagePaths.length) {
      const { data: signed } = await supa.storage.from('qc-photos').createSignedUrls(storagePaths, 60 * 60 * 24 * 7)
      for (const item of signed || []) if (item.path && item.signedUrl) mediaUrls[item.path] = item.signedUrl
    }

    const firstPhotoForDefect = (d: any) => photos.find((p: any) => p.defect_id === d.id)
    const sortedDefects = [...defects].sort((a: any, b: any) => {
      const pa = String(a.item_label || labelOf(a.item_key) || '')
      const pb = String(b.item_label || labelOf(b.item_key) || '')
      return pa.localeCompare(pb) || Number(a.piece_no || 0) - Number(b.piece_no || 0)
    })

    // ---- Inspection Outcome (one row per inspected parameter) ----
    const fdata = insp.form_data || {}
    const baseV: Record<string, string> = fdata.results || {}
    const baseT: Record<string, string> = fdata.meas_results || {}
    const extraV: Record<string, string[]> = fdata.extra_results || {}
    const extraT: Record<string, string[]> = fdata.meas_extra_results || {}
    const hundred: Record<string, Record<string, string>> = fdata.hundred_pct || {}

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

    const keySet = new Set<string>()
    for (const k of Object.keys(baseV)) keySet.add(k.split(':')[0])
    for (const k of Object.keys(baseT)) keySet.add(k.split(':')[0])
    for (const k of Object.keys(extraV)) keySet.add(k)
    for (const k of Object.keys(extraT)) keySet.add(k)
    for (const k of Object.keys(hundred)) keySet.add(k)

    const rank = (o: string) => (o === '100% Inspection' ? 0 : o.startsWith('Additional') ? 1 : 2)
    const liveFails = new Set<string>()
    const outcomes = [...keySet].map((key) => {
      const bV = scanBase(baseV, key), bT = scanBase(baseT, key)
      const baseFails = [...bV.fails, ...bT.fails]
      const ex = scanArr(extraV[key] || extraT[key])
      // Mirror the rule engine: base sample is the gate. 0 base fails = clean
      // (extras AND any old 100% data are ignored). 100% only when the base has
      // >=2 fails, or exactly 1 base fail plus a failed extra-sample piece.
      const triggers100 = baseFails.length >= 2 || (baseFails.length >= 1 && ex.failIdx.length >= 1)
      // Per piece: 100% fills pieces in first (only if triggered), then the base
      // verdict OVERRIDES — base is the first authority and is never overturned.
      const mergedV: Record<number, string> = {}
      if (triggers100) { for (const [pc, v] of Object.entries(hundred[key] || {})) { if (v === 'P' || v === 'F') mergedV[Number(pc)] = v } }
      for (const [k, v] of Object.entries(baseV)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
      for (const [k, v] of Object.entries(baseT)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
      const failPieces = Object.entries(mergedV).filter(([, v]) => v === 'F').map(([pc]) => Number(pc)).sort((a, b) => a - b)
      const checked = Object.keys(mergedV).length
      const fail = failPieces.length
      const dedup = failPieces.map((n) => `#${n}`)
      for (const pc of failPieces) liveFails.add(`${key}:${pc}`)
      let outcome: string
      if (baseFails.length === 0) outcome = 'Pass'
      else if (triggers100) outcome = '100% Inspection'
      else if (ex.checked > 0) outcome = 'Additional Inspection — Pass'
      else outcome = 'Additional Inspection Required'
      return {
        parameter: labelOf(key),
        checked,
        pass: checked - fail,
        fail,
        defectPieces: dedup.length ? dedup.join(', ') : '—',
        outcome,
      }
    }).filter((o) => o.checked > 0)
      .sort((a, b) => rank(a.outcome) - rank(b.outcome) || a.parameter.localeCompare(b.parameter))

    // Only defects that correspond to a CURRENTLY-failing piece (filters out
    // orphaned rows left over from amended-away fails / old 100% data), one per piece.
    const seenDefect = new Set<string>()
    const defectRows = sortedDefects
      .filter((d: any) => liveFails.has(`${d.item_key}:${Number(d.piece_no)}`))
      .filter((d: any) => { const k = `${d.item_key}:${Number(d.piece_no)}`; if (seenDefect.has(k)) return false; seenDefect.add(k); return true })
      .map((d: any) => {
        const p = firstPhotoForDefect(d)
        return {
          parameter: d.item_label || labelOf(d.item_key) || '—',
          pieceLabel: pieceLabel(d.piece_no),
          mediaUrl: p ? mediaUrls[p.storage_path] || null : null,
          mediaType: p?.media_type || null,
        }
      })
    const defectCount = liveFails.size

    // Photo appendix groups. A photo's Pass/Fail follows the CURRENT verdict of its
    // piece (so amended F→P / P→F is reflected without deleting anything). Photos with
    // no piece (required shots, appendix) keep their saved flag.
    const photoPass = (p: any, key: string) => (p.piece_no ? !liveFails.has(`${key}:${Number(p.piece_no)}`) : !!p.is_pass_photo)
    const photosByParam = new Map<string, any[]>()
    for (const p of photos) {
      const key = p.item_key || p.checklist_key || 'required_shots'
      if (!photosByParam.has(key)) photosByParam.set(key, [])
      photosByParam.get(key)!.push(p)
    }
    const photoGroups = [...photosByParam.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a: any, b: any) => {
        const passSort = Number(photoPass(b, key)) - Number(photoPass(a, key))
        if (passSort !== 0) return passSort
        return Number(a.piece_no || 0) - Number(b.piece_no || 0)
      })
      return {
        key,
        label: key === 'appendix' ? 'Appendix' : labelOf(key),
        photos: sorted.map((p: any) => ({
          isPass: photoPass(p, key),
          pieceLabel: p.piece_no ? pieceLabel(p.piece_no) : 'Photo',
          mediaUrl: mediaUrls[p.storage_path] || null,
          mediaType: p.media_type || 'photo',
          comment: p.comment || '',
        })),
      }
    })

    const lang = (url.searchParams.get('lang') || 'en').toLowerCase()
    let correctiveAction = insp.summary?.corrective_action || insp.summary?.remarks || ''
    let dispositionCustom = insp.summary?.disposition_custom || ''
    let translationNote: string | null = null

    if (lang === 'de' || lang === 'zh') {
      const strings = new Set<string>()
      for (const o of outcomes) if (o.parameter) strings.add(o.parameter)
      for (const d of defectRows) { if (d.parameter) strings.add(d.parameter); if (d.pieceLabel) strings.add(d.pieceLabel) }
      for (const g of photoGroups) {
        if (g.label) strings.add(g.label)
        for (const p of g.photos) { if (p.comment) strings.add(p.comment); if (p.pieceLabel) strings.add(p.pieceLabel) }
      }
      if (correctiveAction) strings.add(correctiveAction)
      if (dispositionCustom) strings.add(dispositionCustom)
      const list = [...strings].filter((s) => s && s !== '—')
      const { map: tx, error } = await translateBatch(list, lang, inspectionId, supa)
      if (error) translationNote = error
      const tr = (s: string) => (s && s !== '—' && tx[s]) ? tx[s] : s
      for (const o of outcomes) o.parameter = tr(o.parameter)
      for (const d of defectRows) { d.parameter = tr(d.parameter); d.pieceLabel = tr(d.pieceLabel) }
      for (const g of photoGroups) {
        g.label = tr(g.label)
        for (const p of g.photos) { p.comment = tr(p.comment); p.pieceLabel = tr(p.pieceLabel) }
      }
      correctiveAction = tr(correctiveAction)
      dispositionCustom = tr(dispositionCustom)
    }

    let logoUrl: string | null = null
    if (insp.report_logo_path) {
      const { data: lu } = await supa.storage.from('qc-photos').createSignedUrl(insp.report_logo_path, 60 * 60 * 6)
      logoUrl = lu?.signedUrl || null
    }

    return json({
      ok: true,
      lang,
      translationNote,
      logoUrl,
      insp: {
        part_no: insp.part_no,
        po_no: insp.po_no,
        batch: insp.batch,
        lot_size: insp.lot_size,
        app_sample: insp.app_sample,
        fun_sample: insp.fun_sample,
        submitted_at: insp.submitted_at,
        reviewed_at: insp.reviewed_at,
        disposition: insp.summary?.disposition || null,
        disposition_custom: dispositionCustom || null,
        disposition_cls: insp.summary?.disposition_cls || null,
        remarks: insp.summary?.remarks || '',
        corrective_action: correctiveAction,
      },
      sku: sku ? { model: sku.model, size: sku.size, pcd: sku.pcd, offset_txt: sku.offset_txt, cb_mm: sku.cb_mm, finish: sku.finish } : null,
      inspectorName: names[insp.inspector_id] || '—',
      reviewerName: insp.reviewed_by ? (names[insp.reviewed_by] || '—') : '—',
      defects: defectRows,
      defectCount,
      photoGroups,
      outcomes,
    })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

// Translate a batch of English strings into the target language with Claude, caching
// the result per (inspection, language). Only re-calls Claude when the set of source
// strings changes (hash mismatch), so a public report view never triggers a fresh
// translation once it has been generated once.
async function translateBatch(
  list: string[], lang: string, inspectionId: string, supa: any,
): Promise<{ map: Record<string, string>; error: string | null }> {
  if (!list.length) return { map: {}, error: null }
  const source_hash = hashStrings(list)
  try {
    const { data: cached } = await supa.from('report_translations')
      .select('content_hash, payload').eq('inspection_id', inspectionId).eq('lang', lang).maybeSingle()
    if (cached && cached.content_hash === source_hash && cached.payload && Object.keys(cached.payload).length) {
      return { map: cached.payload as Record<string, string>, error: null }
    }
  } catch (_) { /* cache read best-effort */ }

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
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 8000, system,
        messages: [{ role: 'user', content: JSON.stringify(obj) }],
      }),
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
      inspection_id: inspectionId, lang, content_hash: source_hash, payload: map, updated_at: new Date().toISOString(),
    })
  } catch (_) { /* cache write best-effort */ }
  return { map, error: null }
}

function hashStrings(arr: string[]): string {
  const s = arr.join('\u0001')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}
