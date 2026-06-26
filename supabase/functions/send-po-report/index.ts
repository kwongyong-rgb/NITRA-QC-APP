// Supabase Edge Function: send-po-report
// Emails a link to the consolidated PO report (overview + every SKU & container).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string))
const normEmails = (items: unknown): string[] => {
  if (!items) return []
  const arr = Array.isArray(items) ? items : String(items).split(',')
  return [...new Set(arr.map(v => String(v).trim()).filter(v => /.+@.+\..+/.test(v)))]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const { po, emails: requestedEmails } = await req.json()
    if (!po) return json({ ok: false, error: 'Missing po' }, 400)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const [{ data: insps }, { data: conts }, { data: dist }] = await Promise.all([
      supa.from('inspections').select('id,part_no,status').eq('po_no', po),
      supa.from('container_loadings').select('id,container_no,insp_status').eq('po_no', po),
      supa.from('settings').select('value').eq('key', 'distribution').maybeSingle(),
    ])
    const skuCount = (insps || []).length
    const contCount = (conts || []).length

    const emails = (normEmails(requestedEmails).length ? normEmails(requestedEmails) : normEmails(dist?.value?.emails))
    if (!emails.includes('kyong@nitrawheels.com')) emails.push('kyong@nitrawheels.com')
    if (!emails.length) return json({ ok: false, error: 'No recipient emails provided' }, 400)

    const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')
    const reportUrl = `${appUrl}/po-report/${encodeURIComponent(po)}`

    const rows = (insps || []).map((r: any) => `<tr><td style="padding:5px 0;color:#5A6878">${esc(r.part_no)}</td><td style="text-align:right">${esc(r.status)}</td></tr>`).join('')
    const crows = (conts || []).map((c: any) => `<tr><td style="padding:5px 0;color:#5A6878">${esc(c.container_no || '(no container no.)')}</td><td style="text-align:right">${esc(c.insp_status)}</td></tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:720px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">Consolidated PO Report</div>
</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px">
  <p style="margin-top:0">The consolidated QC report for <b>PO ${esc(po)}</b> is ready. It contains an overview plus every wheel inspection and container loading in this PO, with clickable photo/video evidence and an EN / DE / 中文 language toggle.</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0">
    <tr><td style="padding:6px 0;color:#5A6878;width:60%">Wheel inspections</td><td style="font-weight:600;text-align:right">${skuCount}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Container loadings</td><td style="font-weight:600;text-align:right">${contCount}</td></tr>
  </table>
  ${rows ? `<div style="font-size:12px;color:#5A6878;margin:6px 0 2px">SKUs</div><table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>` : ''}
  ${crows ? `<div style="font-size:12px;color:#5A6878;margin:10px 0 2px">Containers</div><table style="width:100%;border-collapse:collapse;font-size:13px">${crows}</table>` : ''}
  <p style="text-align:center;margin:26px 0"><a href="${esc(reportUrl)}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;display:inline-block">Open Consolidated PO Report</a></p>
  <p style="font-size:12px;color:#5A6878">If the button does not work, copy and paste this link into your browser:<br><a href="${esc(reportUrl)}">${esc(reportUrl)}</a></p>
</div>
<div style="background:#F7F9FB;border:1px solid #D5DBE4;border-top:none;padding:12px 24px;border-radius:0 0 10px 10px">
  <p style="color:#5A6878;font-size:11px;margin:0">CONFIDENTIAL — PROPERTY OF NITRA</p>
</div></body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('REPORT_FROM_EMAIL') || 'NITRA QC <qc@nitrawheels.com>',
        to: emails,
        subject: `Consolidated QC Report — PO ${po} · ${skuCount} SKU(s) · ${contCount} container(s)`,
        html,
      }),
    })
    const result = await res.json().catch(() => ({}))
    return json({ ok: res.ok, emails, report_url: reportUrl, result }, res.ok ? 200 : 500)
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
