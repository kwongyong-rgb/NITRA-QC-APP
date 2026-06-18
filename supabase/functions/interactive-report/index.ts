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
  if (n < 0) return `Extra ${Math.abs(n)}`
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
  tpms_hole: 'TPMS Inspection — dimension matches SKU',
  wheel_back: 'Wheel back + markings',
  wheel_front: 'Wheel front face',
  wheel_weight: 'Wheel weight',
  required_shots: 'Required Photos',
}
const labelOf = (key: unknown) => LABELS[String(key)] || String(key ?? '').replace(/_/g, ' ')

const TECH_KEYS = new Set([
  'counter_bore','lug_hole','seat_thick','offset','cb','wheel_weight','barrel_tol','barrel_tolerance',
  'radial_top','radial_bot','axial_top','axial_bot','head','bal_b','bal_c','bal_bc'
])
const resultKey = (raw: string) => raw.includes(':') ? raw.split(':')[0] : raw
const resultPiece = (raw: string) => {
  const n = Number(raw.includes(':') ? raw.split(':')[1] : raw)
  return Number.isFinite(n) ? n : 0
}
const pieceHash = (pieceNo: unknown) => {
  const n = Number(pieceNo)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 0) return `#E${Math.abs(n)}`
  return `#${n}`
}
const isDone = (r: unknown) => r === 'P' || r === 'F' || r === 'NA'
const isPF = (r: unknown) => r === 'P' || r === 'F'

function buildOutcomes(insp: any, defects: any[]) {
  const fd = insp.form_data || {}
  const results = fd.results || {}
  const measResults = fd.meas_results || {}
  const extraResults = fd.extra_results || {}
  const measExtraResults = fd.meas_extra_results || {}
  const hundred = fd.hundred_pct || {}

  const keys = new Set<string>()
  for (const k of Object.keys(results)) keys.add(resultKey(k))
  for (const k of Object.keys(measResults)) keys.add(resultKey(k))
  for (const k of Object.keys(extraResults)) keys.add(k)
  for (const k of Object.keys(measExtraResults)) keys.add(k)
  for (const k of Object.keys(hundred)) keys.add(k)
  for (const d of defects) if (d.item_key) keys.add(String(d.item_key))

  const rows = [...keys].map(key => {
    const technical = TECH_KEYS.has(key)
    const baseMap = technical ? measResults : results
    const extrasMap = technical ? measExtraResults : extraResults
    const sample = technical ? Number(insp.fun_sample || 4) : Number(insp.app_sample || 8)
    const extraRequired = technical ? 2 : 4

    const baseEntries = Object.entries(baseMap).filter(([k]) => resultKey(k) === key)
    const baseDone = baseEntries.filter(([, r]) => isDone(r))
    const basePass = baseEntries.filter(([, r]) => r === 'P' || r === 'NA')
    const baseFail = baseEntries.filter(([, r]) => r === 'F')
    const extras = Array.isArray(extrasMap[key]) ? extrasMap[key] : []
    const extraDone = extras.filter(isPF)
    const extraPass = extras.filter(r => r === 'P')
    const extraFail = extras.filter(r => r === 'F')
    const hMap = hundred[key] || {}
    const hEntries = Object.entries(hMap).filter(([, r]) => r === 'P' || r === 'F')

    let checked = 0, pass = 0, fail = 0
    if (hEntries.length) {
      checked = hEntries.length
      pass = hEntries.filter(([, r]) => r === 'P').length
      fail = hEntries.filter(([, r]) => r === 'F').length
    } else {
      checked = baseDone.length + extraDone.length
      pass = basePass.length + extraPass.length
      fail = baseFail.length + extraFail.length
    }

    const defectPieces = [...new Set(defects
      .filter((d: any) => String(d.item_key || '') === key && Number(d.piece_no || 0) > 0)
      .map((d: any) => Number(d.piece_no))
      .sort((a: number, b: number) => a - b)
      .map(pieceHash))]
    if (!defectPieces.length) {
      for (const [rk, r] of baseEntries) if (r === 'F') defectPieces.push(pieceHash(resultPiece(rk)))
      if (hEntries.length) for (const [pc, r] of hEntries) if (r === 'F') defectPieces.push(pieceHash(pc))
    }

    let outcome = 'Pass'
    if (hEntries.length || baseFail.length >= 2 || extraFail.length > 0) outcome = '100% Inspection'
    else if (baseFail.length === 1 && extraDone.length >= extraRequired) outcome = 'Additional Inspection + Pass'
    else if (baseFail.length === 1) outcome = 'Additional Inspection Pending'

    return {
      parameter: labelOf(key), key, checked, pass, fail,
      defectPieces: [...new Set(defectPieces)].join(', ') || '—',
      outcome,
      sortStatus: outcome === '100% Inspection' ? 0 : outcome.includes('Additional') ? 1 : 2,
    }
  }).filter(r => r.checked > 0 || r.fail > 0 || r.defectPieces !== '—')

  rows.sort((a, b) => a.sortStatus - b.sortStatus || String(a.parameter).localeCompare(String(b.parameter)))
  return rows
}

function buildSummary(insp: any, outcomeRows: any[]) {
  const full = outcomeRows.filter(r => r.outcome === '100% Inspection')
  const addPass = outcomeRows.filter(r => r.outcome === 'Additional Inspection + Pass')
  const pending = outcomeRows.filter(r => r.outcome === 'Additional Inspection Pending')
  const parts: string[] = []
  if (full.length) parts.push(`100% inspection was required for: ${full.map(r => r.parameter).join(', ')}.`)
  if (pending.length) parts.push(`Additional inspection is pending for: ${pending.map(r => r.parameter).join(', ')}.`)
  if (addPass.length) parts.push(`Additional inspection was completed and passed for: ${addPass.map(r => r.parameter).join(', ')}.`)
  if (!parts.length) parts.push('Inspection completed with no additional or 100% inspection required.')
  const remarks = insp.summary?.remarks ? ` Remarks: ${insp.summary.remarks}` : ''
  return parts.join(' ') + remarks
}

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

    const defectRows = sortedDefects.map((d: any) => {
      const p = firstPhotoForDefect(d)
      return {
        parameter: d.item_label || labelOf(d.item_key) || '—',
        pieceLabel: pieceHash(d.piece_no),
        mediaUrl: p ? mediaUrls[p.storage_path] || null : null,
        mediaType: p?.media_type || null,
      }
    })

    const photosByParam = new Map<string, any[]>()
    for (const p of photos) {
      const key = p.item_key || p.checklist_key || 'required_shots'
      if (!photosByParam.has(key)) photosByParam.set(key, [])
      photosByParam.get(key)!.push(p)
    }
    const photoGroups = [...photosByParam.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a: any, b: any) => {
        const passSort = Number(a.is_pass_photo) - Number(b.is_pass_photo) // fail photos first
        if (passSort !== 0) return passSort
        return Number(a.piece_no || 0) - Number(b.piece_no || 0)
      })
      return {
        label: labelOf(key),
        photos: sorted.map((p: any) => ({
          isPass: !!p.is_pass_photo,
          pieceLabel: p.piece_no ? pieceLabel(p.piece_no) : 'Required photo',
          mediaUrl: mediaUrls[p.storage_path] || null,
          mediaType: p.media_type || 'photo',
          comment: p.comment || '',
        })),
      }
    })

    const outcomeRows = buildOutcomes(insp, defects)
    const summaryText = buildSummary(insp, outcomeRows)

    return json({
      ok: true,
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
        remarks: insp.summary?.remarks || '',
      },
      sku: sku ? { model: sku.model, size: sku.size, pcd: sku.pcd, offset_txt: sku.offset_txt, cb_mm: sku.cb_mm, finish: sku.finish } : null,
      inspectorName: names[insp.inspector_id] || '—',
      reviewerName: insp.reviewed_by ? (names[insp.reviewed_by] || '—') : '—',
      summaryText,
      outcomes: outcomeRows,
      defects: defectRows,
      photoGroups,
    })
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
