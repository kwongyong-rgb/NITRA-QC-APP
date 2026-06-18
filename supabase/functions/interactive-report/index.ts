// Supabase Edge Function: interactive-report
// Public, token-style report page using the inspection UUID in the link.
// It renders an interactive HTML report with clickable/zoomable photos and playable videos.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string))
const pieceLabel = (pieceNo: unknown) => {
  const n = Number(pieceNo)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 0) return `Extra ${Math.abs(n)}`
  return `Piece ${n}`
}
const pieceShort = (pieceNo: unknown) => {
  const n = Number(pieceNo)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 0) return `#E${Math.abs(n)}`
  return `#${n}`
}
const dispositionLabel: Record<string, { text: string; cls: string }> = {
  release: { text: 'RELEASE', cls: 'pass' },
  release_record: { text: 'RELEASE WITH RECORD', cls: 'pass' },
  hold_100: { text: 'HOLD — 100% INSPECTION', cls: 'hold' },
  reject: { text: 'REJECT', cls: 'fail' },
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
  required_shots: 'Required Photos',
  seat_thick: 'Seat thickness',
  tpms_hole: 'TPMS Inspection — dimension matches SKU',
  wheel_back: 'Wheel back + markings',
  wheel_front: 'Wheel front face',
  wheel_weight: 'Wheel weight',
}
const labelOf = (key: unknown) => LABELS[String(key)] || String(key ?? '').replace(/_/g, ' ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  try {
    const url = new URL(req.url)
    const inspectionId = url.searchParams.get('id') || url.searchParams.get('inspection_id')
    if (!inspectionId) return htmlResponse(errorHtml('Missing inspection id'), 400)

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: insp, error: inspErr } = await supa.from('inspections').select('*').eq('id', inspectionId).single()
    if (inspErr || !insp) return htmlResponse(errorHtml('Inspection not found'), 404)

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
      for (const item of signed || []) {
        if (item.path && item.signedUrl) mediaUrls[item.path] = item.signedUrl
      }
    }

    const firstPhotoForDefect = (d: any) => photos.find((p: any) => p.defect_id === d.id)
    const sortedDefects = [...defects].sort((a: any, b: any) => {
      const pa = String(a.item_label || a.item_key || '')
      const pb = String(b.item_label || b.item_key || '')
      return pa.localeCompare(pb) || Number(a.piece_no || 0) - Number(b.piece_no || 0)
    })

    const defectRows = sortedDefects.map((d: any) => {
      const p = firstPhotoForDefect(d)
      const mediaUrl = p ? mediaUrls[p.storage_path] : ''
      const icon = p?.media_type === 'video' ? '🎥' : '📷'
      const mediaButton = mediaUrl
        ? `<button class="media-icon" data-url="${esc(mediaUrl)}" data-type="${esc(p.media_type || 'photo')}">${icon}</button>`
        : '—'
      return `<tr>
        <td>${esc(d.item_label || labelOf(d.item_key) || '—')}</td>
        <td>${esc(pieceShort(d.piece_no))}</td>
        <td>${mediaButton}</td>
      </tr>`
    }).join('')

    const photosByParam = new Map<string, any[]>()
    for (const p of photos) {
      const key = p.item_key || p.checklist_key || 'required_shots'
      if (!photosByParam.has(key)) photosByParam.set(key, [])
      photosByParam.get(key)!.push(p)
    }

    const labelFor = (p: any) => labelOf(p.item_key || p.checklist_key || 'required_shots')
    const photoGroups = [...photosByParam.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a: any, b: any) => {
        const passSort = Number(b.is_pass_photo) - Number(a.is_pass_photo) // pass photos first
        if (passSort !== 0) return passSort
        return Number(a.piece_no || 0) - Number(b.piece_no || 0)
      })
      return `<section class="photo-group">
        <h4>${esc(labelOf(key))}</h4>
        <div class="gallery">${sorted.map((p: any) => mediaCard(p, mediaUrls[p.storage_path], labelFor(p))).join('')}</div>
      </section>`
    }).join('')

    const disp = dispositionLabel[insp.summary?.disposition] || { text: insp.summary?.disposition || '—', cls: 'hold' }
    const generatedAt = new Date().toLocaleString()

    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NITRA QC Interactive Report — ${esc(insp.part_no)}</title>
<style>${css()}</style></head><body>
<header class="head">
  <div><img src="${esc((Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/$/, ''))}/logo-white.png" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" /><b style="display:none">NITRA</b></div>
  <div class="doc">QC Interactive Report<small>Live report with clickable media evidence</small></div>
</header>
<div class="status ${esc(disp.cls)}"><span>${esc(disp.text)}</span><small>Generated ${esc(generatedAt)}</small></div>
<main>
  <section class="card">
    <h2>Inspection Summary</h2>
    <table class="meta">
      <tr><td>Part No. / SKU</td><td>${esc(insp.part_no)}</td><td>Finish</td><td>${esc(sku?.finish || '—')}</td></tr>
      <tr><td>Model / Size</td><td>${esc(sku?.model || '—')} ${esc(sku?.size || '')}</td><td>PCD · ET · CB</td><td>${esc(sku?.pcd || '—')} · ${esc(sku?.offset_txt || '')} · ${esc(sku?.cb_mm ?? '')}</td></tr>
      <tr><td>PO No.</td><td>${esc(insp.po_no || '—')}</td><td>Batch</td><td>${esc(insp.batch || '—')}</td></tr>
      <tr><td>Lot Size</td><td>${esc(insp.lot_size)} pcs</td><td>Samples</td><td>Visual ${esc(insp.app_sample)} / Technical ${esc(insp.fun_sample)}</td></tr>
      <tr><td>Inspector</td><td>${esc(names[insp.inspector_id] || '—')}</td><td>Submitted</td><td>${esc(insp.submitted_at ? new Date(insp.submitted_at).toLocaleString() : '—')}</td></tr>
      <tr><td>Approved By</td><td>${esc(insp.reviewed_by ? (names[insp.reviewed_by] || '—') : '—')}</td><td>Approved On</td><td>${esc(insp.reviewed_at ? new Date(insp.reviewed_at).toLocaleString() : '—')}</td></tr>
    </table>
    ${insp.summary?.remarks ? `<div class="remarks"><b>Remarks</b><br>${esc(insp.summary.remarks)}</div>` : ''}
  </section>

  <section class="card">
    <h2>Inspection Evaluation Criteria</h2>
    <p><b>Visual:</b> ≤100 pcs inspect 8; each additional 100 pcs inspect +4. If 1 piece fails for a specific defect, inspect +4 for that defect; if the same defect fails again, conduct 100% inspection. If 2+ pieces fail in the initial sample, conduct 100% inspection immediately.</p>
    <p><b>Technical:</b> ≤100 pcs inspect 4; each additional 100 pcs inspect +2. If 1 piece fails for a specific defect, inspect +2 for that defect; if the same defect fails again, conduct 100% inspection. If 2+ pieces fail in the initial sample, conduct 100% inspection immediately.</p>
    <p>100% inspection applies only to the specific defect/parameter that triggered the rule.</p>
  </section>

  <section class="card">
    <h2>Defect Log</h2>
    ${defects.length ? `<table class="grid"><thead><tr><th>Inspected Parameter</th><th>Piece #</th><th>Photo / Video</th></tr></thead><tbody>${defectRows}</tbody></table>` : '<p class="oktxt">No defects logged.</p>'}
  </section>

  <section class="card">
    <h2>Photo / Video Appendix</h2>
    ${photos.length ? photoGroups : '<p class="muted">No photos or videos taken.</p>'}
  </section>
</main>
<div id="viewer" class="viewer" role="dialog" aria-modal="true"><button id="closeViewer">×</button><div id="viewerBody"></div></div>
<script>${clientJs()}</script>
</body></html>`

    return htmlResponse(html)
  } catch (e) {
    return htmlResponse(errorHtml(e instanceof Error ? e.message : String(e)), 500)
  }
})

function mediaCard(p: any, mediaUrl: string, label: string) {
  const result = p.is_pass_photo ? 'PASS' : 'FAIL'
  const cls = p.is_pass_photo ? 'pass' : 'fail'
  const piece = p.piece_no ? pieceLabel(p.piece_no) : 'Required photo'
  const isVideo = p.media_type === 'video'
  const preview = !mediaUrl
    ? `<div class="thumb missing">No media</div>`
    : isVideo
      ? `<button class="thumb video" data-url="${esc(mediaUrl)}" data-type="video">▶</button>`
      : `<button class="thumb" data-url="${esc(mediaUrl)}" data-type="photo"><img src="${esc(mediaUrl)}" /></button>`
  return `<figure>${preview}<figcaption><b class="${cls}">${result}</b> · ${esc(piece)} · ${esc(String(label).replace(/_/g, ' '))}${p.comment ? `<br>${esc(p.comment)}` : ''}</figcaption></figure>`
}

function htmlResponse(body: string, status = 200) {
  const headers = new Headers()
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  return new Response(body, { status, headers })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}
function errorHtml(message: string) {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:Arial;padding:40px;color:#C0392B"><h2>Report unavailable</h2><p>${esc(message)}</p></body>`
}
function css() {
  return `
:root{--navy:#1F3A5F;--steel:#9FB6D4;--line:#D5DBE4;--ink:#18222E;--muted:#5A6878;--pass:#1F8A4C;--fail:#C0392B;--amber:#B7791F;--bg:#F4F7FA}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:Arial,"Noto Sans CJK SC","Microsoft YaHei",sans-serif;color:var(--ink);font-size:14px;line-height:1.45}.head{background:var(--navy);color:white;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}.head img{height:32px}.doc{text-align:right;font-weight:800;font-size:18px}.doc small{display:block;color:var(--steel);font-size:12px;font-weight:500}.status{padding:12px 24px;display:flex;justify-content:space-between;font-weight:800}.status.pass{background:#E3F3EA;color:var(--pass);border-bottom:2px solid var(--pass)}.status.fail{background:#FBE9E7;color:var(--fail);border-bottom:2px solid var(--fail)}.status.hold{background:#FBF3E2;color:var(--amber);border-bottom:2px solid var(--amber)}main{max-width:1100px;margin:22px auto;padding:0 14px}.card{background:white;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px;box-shadow:0 4px 14px rgba(31,58,95,.08)}h2{margin:0 0 12px;color:var(--navy);font-size:18px}.meta,.grid{width:100%;border-collapse:collapse}.meta td{border-bottom:1px solid #EEF1F5;padding:8px}.meta td:nth-child(odd){color:var(--muted);font-size:12px}.meta td:nth-child(even){font-weight:700}.grid th{background:var(--navy);color:white;text-align:left;padding:9px}.grid td{border-bottom:1px solid var(--line);padding:9px}.media-icon{border:1px solid var(--line);background:white;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:18px}.remarks{background:#F7F9FB;border-radius:8px;padding:12px;margin-top:12px}.oktxt{color:var(--pass);font-weight:700}.muted{color:var(--muted)}.photo-group{margin-top:14px}.photo-group h4{text-transform:capitalize;margin:0 0 8px;color:var(--navy)}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}.thumb{width:100%;height:120px;border:0;background:#EEF1F5;display:flex;align-items:center;justify-content:center;cursor:pointer}.thumb img{width:100%;height:100%;object-fit:cover}.thumb.video{font-size:34px;color:var(--navy)}.thumb.missing{color:var(--muted);font-size:12px}figcaption{font-size:11px;color:var(--muted);padding:8px}.pass{color:var(--pass)}.fail{color:var(--fail)}.viewer{display:none;position:fixed;inset:0;background:rgba(0,0,0,.86);z-index:9999;align-items:center;justify-content:center;padding:22px}.viewer.open{display:flex}.viewer button#closeViewer{position:absolute;top:16px;right:20px;background:white;border:0;border-radius:999px;width:42px;height:42px;font-size:28px;cursor:pointer}.viewer img,.viewer video{max-width:96vw;max-height:90vh;border-radius:10px;background:#000}button{font-family:inherit}@media(max-width:720px){.status,.head{display:block}.doc{text-align:left;margin-top:10px}.meta td{display:block;width:100%}.meta tr{display:block;border-bottom:1px solid #EEF1F5}.meta td:nth-child(odd){padding-bottom:0}.meta td:nth-child(even){padding-top:2px}.grid{font-size:12px}.gallery{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}}
  `
}
function clientJs() {
  return `
const viewer=document.getElementById('viewer');const body=document.getElementById('viewerBody');const close=document.getElementById('closeViewer');
function openMedia(url,type){body.innerHTML=''; if(type==='video'){const v=document.createElement('video');v.src=url;v.controls=true;v.autoplay=true;body.appendChild(v);}else{const img=document.createElement('img');img.src=url;body.appendChild(img);} viewer.classList.add('open');}
document.addEventListener('click',function(e){const b=e.target.closest('[data-url]'); if(b){openMedia(b.getAttribute('data-url'),b.getAttribute('data-type')||'photo');}});
close.addEventListener('click',()=>viewer.classList.remove('open'));viewer.addEventListener('click',e=>{if(e.target===viewer)viewer.classList.remove('open')});
  `
}
