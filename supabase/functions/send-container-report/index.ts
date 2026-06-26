// Supabase Edge Function: send-container-report
// Emails a self-contained Container Loading report (details, contents,
// pallet packing summary, and clickable photo evidence) via Resend.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string))
const normEmails = (items: unknown): string[] => {
  if (!items) return []
  const arr = Array.isArray(items) ? items : String(items).split(',')
  return [...new Set(arr.map(v => String(v).trim()).filter(v => /.+@.+\..+/.test(v)))]
}

const CONTAINER_PHOTO_LABELS: Record<string, string> = {
  cc_exterior: 'Container Condition: Exterior', cc_interior: 'Container Condition: Interior',
  cl_empty: 'Container Loading: Empty', cl_half: 'Container Loading: Half Full', cl_full: 'Container Loading: Full',
  cl_by_size: 'Wheels loaded by size & part number', cl_box_labels: 'Box labels & hand-holes facing container door',
  cl_spares: 'Spare boxes & caps at front', cl_net: 'Protective net after loading',
}
const CONTAINER_PHOTO_ORDER = ['cc_exterior','cc_interior','cl_empty','cl_half','cl_full','cl_by_size','cl_box_labels','cl_spares','cl_net']
const PACKING_LABELS: Record<string, string> = {
  pl_grouped: 'Wheels stacked & grouped by part no.', pl_wood: 'Fumigation-free solid-wood pallet',
  pl_height: 'Height ≤254 cm, 3-inch fork gap', pl_straps: '4 straps tight', pl_wrap: 'Wrap ≥3 layers, ≥0.35 mm, tight',
  pl_label4: 'Pallet label on all 4 sides', pl_photo: 'Photo of each pallet taken',
}
const PACKING_ORDER = ['pl_grouped','pl_wood','pl_height','pl_straps','pl_wrap','pl_label4','pl_photo']
const STATUS_LABEL: Record<string, string> = { in_progress: 'IN PROGRESS', loaded: 'LOADED', hold: 'HOLD' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const { container_loading_id, emails: requestedEmails } = await req.json()
    if (!container_loading_id) return json({ ok: false, error: 'Missing container_loading_id' }, 400)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: cl } = await supa.from('container_loadings').select('*').eq('id', container_loading_id).single()
    if (!cl) return json({ ok: false, error: 'Container loading not found' }, 404)

    const [{ data: photos }, { data: inspector }, { data: reviewer }, { data: dist }] = await Promise.all([
      supa.from('photos').select('storage_path,media_type,item_key,piece_no').eq('container_loading_id', container_loading_id).order('created_at'),
      supa.from('profiles').select('full_name').eq('id', cl.inspector_id).maybeSingle(),
      cl.reviewed_by ? supa.from('profiles').select('full_name').eq('id', cl.reviewed_by).maybeSingle() : Promise.resolve({ data: null } as any),
      supa.from('settings').select('value').eq('key', 'distribution').maybeSingle(),
    ])

    const ph = (photos || []) as { storage_path: string; media_type: string; item_key: string; piece_no: number }[]
    const paths = [...new Set(ph.map(p => p.storage_path))]
    const urlMap: Record<string, string> = {}
    if (paths.length) {
      const { data: signed } = await supa.storage.from('qc-photos').createSignedUrls(paths, 60 * 60 * 24 * 7)
      for (const s of signed || []) if (s.path && s.signedUrl) urlMap[s.path] = s.signedUrl
    }
    const photosFor = (key: string, piece: number) => ph.filter(p => p.item_key === key && p.piece_no === piece)
    const linkList = (items: { storage_path: string; media_type: string }[]) =>
      items.length
        ? items.map((p, i) => `<a href="${esc(urlMap[p.storage_path] || '#')}" style="color:#1F3A5F;font-weight:600;margin-right:10px">${p.media_type === 'video' ? '🎥' : '📷'} ${i + 1}</a>`).join('')
        : '<span style="color:#C0392B">— none —</span>'

    const data = cl.data || {}
    const loadingType = data.loading_type || 'pallet'
    const palletCount = data.pallet_count || 0

    // totals
    const totals: Record<string, number> = {}
    if (loadingType === 'pallet') {
      for (let n = 1; n <= palletCount; n++) for (const c of (data.pallets?.[n]?.contents || [])) if (c.part_no) totals[c.part_no] = (totals[c.part_no] || 0) + (Number(c.qty) || 0)
    } else {
      for (const c of (data.non_pallet_contents || [])) if (c.part_no) totals[c.part_no] = (totals[c.part_no] || 0) + (Number(c.qty) || 0)
    }
    const totalsRow = Object.keys(totals).length ? Object.entries(totals).map(([p, q]) => `${esc(p)} × ${q}`).join(' · ') : '—'

    // contents section
    let contentsHtml = ''
    if (loadingType === 'pallet') {
      for (let n = 1; n <= palletCount; n++) {
        const pd = data.pallets?.[n] || { contents: [], checks: {} }
        const items = (pd.contents || []).filter((c: { part_no: string }) => c.part_no)
        const fails = PACKING_ORDER.filter(k => pd.checks?.[k] === 'F').map(k => PACKING_LABELS[k])
        contentsHtml += `<div style="border:1px solid #D5DBE4;border-radius:8px;padding:12px;margin:8px 0">
          <div style="font-weight:700;color:#1F3A5F">Pallet ${n}</div>
          <div style="font-size:13px;margin:4px 0">Contents: ${items.length ? items.map((c: { part_no: string; qty: number }) => `${esc(c.part_no)} × ${esc(c.qty)}`).join(', ') : '—'}</div>
          <div style="font-size:13px;margin:4px 0">Label photo: ${linkList(photosFor('pallet_label', n))}</div>
          <div style="font-size:13px;margin:4px 0">Packing: ${fails.length ? `<span style="color:#C0392B;font-weight:600">${fails.length} fail(s): ${esc(fails.join(', '))}</span>` : '<span style="color:#1F8A4C;font-weight:600">all OK / N/A</span>'}</div>
        </div>`
      }
    } else {
      const items = (data.non_pallet_contents || []).filter((c: { part_no: string }) => c.part_no)
      contentsHtml = `<div style="font-size:14px">${items.length ? items.map((c: { part_no: string; qty: number }) => `${esc(c.part_no)} × ${esc(c.qty)}`).join('<br>') : '—'}</div>`
    }

    const inspPhotoHtml = CONTAINER_PHOTO_ORDER.map(k =>
      `<tr><td style="padding:6px 0;color:#5A6878;width:55%">${esc(CONTAINER_PHOTO_LABELS[k])}</td><td>${linkList(photosFor(k, 0))}</td></tr>`).join('')

    const distributionEmails = normEmails(dist?.value?.emails)
    const directEmails = normEmails(requestedEmails)
    const emails = directEmails.length ? directEmails : distributionEmails
    if (!emails.includes('kyong@nitrawheels.com')) emails.push('kyong@nitrawheels.com')
    if (!emails.length) return json({ ok: false, error: 'No recipient emails provided' }, 400)

    const statusTxt = STATUS_LABEL[cl.status] || cl.status || '—'
    const signedOff = cl.insp_status === 'approved'
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:720px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">Container Loading Report</div>
</div>
<div style="background:${signedOff ? '#E3F3EA' : '#FFF6E5'};border:1px solid ${signedOff ? '#1F8A4C' : '#C99A00'};padding:12px 24px;font-weight:700;font-size:16px;color:${signedOff ? '#1F8A4C' : '#9A7400'}">${esc(statusTxt)}${signedOff ? ' · APPROVED' : ''}</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px">
  <p style="text-align:center;margin:0 0 18px"><a href="${(Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')}/container-report/${cl.id}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:13px 22px;border-radius:8px;font-weight:700;display:inline-block">Open Interactive Report (EN / DE / 中文)</a></p>
  <h3 style="color:#1F3A5F;margin:0 0 10px">Shipping &amp; Container Details</h3>
  <table style="width:100%;border-collapse:collapse;margin:0 0 8px;font-size:14px">
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5;width:18%">PO No.</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5;width:32%">${esc(cl.po_no || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5;width:18%">Container No.</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5;width:32%">${esc(cl.container_no || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Seal No.</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(cl.seal_no || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">BL Number</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.bl_no || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Loading Type</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${loadingType === 'pallet' ? 'Palletised' : 'Non-palletised'}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Date Loaded</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.date_loaded || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Est. Port Departure</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.etd || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Est. Port Arrival</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.eta || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Departure Port</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.dep_port || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Destination Port</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.dest_port || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878">Inspector</td><td style="padding:7px 8px;font-weight:600">${esc(inspector?.full_name || '—')}</td><td style="padding:7px 8px;color:#5A6878">Approved By</td><td style="padding:7px 8px;font-weight:600">${esc(reviewer?.full_name || '—')}</td></tr>
  </table>
  ${cl.summary?.corrective_action ? `<div style="background:#FBE9E7;border:1px solid #C0392B;border-radius:6px;padding:10px 12px;margin-top:14px;font-size:13px"><b>Notes:</b> ${esc(cl.summary.corrective_action)}</div>` : ''}
</div>
<div style="background:#F7F9FB;border:1px solid #D5DBE4;border-top:none;padding:12px 24px;border-radius:0 0 10px 10px">
  <p style="color:#5A6878;font-size:11px;margin:0">CONFIDENTIAL — PROPERTY OF NITRA · Photo links are private and expire after 7 days.</p>
</div></body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('REPORT_FROM_EMAIL') || 'NITRA QC <qc@nitrawheels.com>',
        to: emails,
        subject: `Container Loading — ${cl.container_no || '(no container)'} · PO ${cl.po_no || '—'} · ${statusTxt}`,
        html,
      }),
    })
    const result = await res.json().catch(() => ({}))
    return json({ ok: res.ok, emails, result }, res.ok ? 200 : 500)
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
