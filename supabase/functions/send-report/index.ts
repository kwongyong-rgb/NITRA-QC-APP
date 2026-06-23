// Supabase Edge Function: send-report
// Sends a concise email with a secure live interactive report link.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string))
const normEmails = (items: unknown): string[] => {
  if (!items) return []
  const arr = Array.isArray(items) ? items : String(items).split(',')
  return [...new Set(arr.map(v => String(v).trim()).filter(v => /.+@.+\..+/.test(v)))]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  try {
    const { inspection_id, emails: requestedEmails } = await req.json()
    if (!inspection_id) return json({ ok: false, error: 'Missing inspection_id' }, 400)

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: insp } = await supa.from('inspections').select('*').eq('id', inspection_id).single()
    if (!insp) return json({ ok: false, error: 'Inspection not found' }, 404)

    const [{ data: sku }, { data: defects }, { data: inspector }, { data: reviewer }, { data: dist }] = await Promise.all([
      supa.from('skus').select('*').eq('part_no', insp.part_no).maybeSingle(),
      supa.from('defects').select('*').eq('inspection_id', inspection_id),
      supa.from('profiles').select('full_name').eq('id', insp.inspector_id).maybeSingle(),
      insp.reviewed_by ? supa.from('profiles').select('full_name').eq('id', insp.reviewed_by).maybeSingle() : Promise.resolve({ data: null } as any),
      supa.from('settings').select('value').eq('key', 'distribution').maybeSingle(),
    ])

    const distributionEmails = normEmails(dist?.value?.emails)
    const directEmails = normEmails(requestedEmails)
    const emails = directEmails.length ? directEmails : distributionEmails
    if (!emails.includes('kyong@nitrawheels.com')) emails.push('kyong@nitrawheels.com')
    if (!emails.length) return json({ ok: false, error: 'No recipient emails provided' }, 400)

    const dispositionLabel: Record<string, string> = {
      approved_loading: 'APPROVED FOR LOADING',
      hold_rework: 'HOLD FOR REWORK & REINSPECTION',
      conditional_loading: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED',
      pending_customer: 'PENDING CUSTOMER APPROVAL',
      release: 'RELEASE', release_record: 'RELEASE WITH RECORD',
      hold_100: 'HOLD — 100% INSPECTION', reject: 'REJECT',
    }
    const disposition = dispositionLabel[insp.summary?.disposition] || insp.summary?.disposition || '—'
    const isPass = insp.summary?.disposition === 'approved_loading' || disposition === 'RELEASE' || disposition === 'RELEASE WITH RECORD'
    const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')
    const reportUrl = `${appUrl}/report/${encodeURIComponent(inspection_id)}`

    const defectCount = (defects || []).length
    let logoHtml = '<div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>'
    if (insp.report_logo_path) {
      const { data: lu } = await supa.storage.from('qc-photos').createSignedUrl(insp.report_logo_path, 60 * 60 * 24 * 7)
      if (lu?.signedUrl) logoHtml = `<img src="${lu.signedUrl}" alt="logo" style="max-height:46px;max-width:260px;display:block" />`
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:720px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  ${logoHtml}
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">QC Interactive Report</div>
</div>
<div style="background:${isPass?'#E3F3EA':'#FBE9E7'};border:1px solid ${isPass?'#1F8A4C':'#C0392B'};padding:12px 24px;font-weight:700;font-size:16px;color:${isPass?'#1F8A4C':'#C0392B'}">${esc(disposition)}</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px">
  <p style="margin-top:0">A NITRA QC inspection report is ready for review. Click the button below to open the live interactive report with clickable photo/video evidence.</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0 20px">
    <tr><td style="padding:6px 0;color:#5A6878;width:38%">Part No.</td><td style="font-weight:600">${esc(insp.part_no)}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Model / Size</td><td>${esc(sku?.model||'—')} ${esc(sku?.size||'')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">PO No.</td><td>${esc(insp.po_no||'—')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Batch</td><td>${esc(insp.batch||'—')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Lot size</td><td>${esc(insp.lot_size)} pcs</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Defects logged</td><td style="font-weight:600;color:${defectCount>0?'#C0392B':'#1F8A4C'}">${defectCount}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Inspector</td><td>${esc(inspector?.full_name||'—')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Approved by</td><td>${esc(reviewer?.full_name||'—')}</td></tr>
  </table>
  <p style="text-align:center;margin:26px 0"><a href="${esc(reportUrl)}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;display:inline-block">View Full Interactive Report</a></p>
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
        subject: `QC Interactive Report — ${insp.part_no} · ${disposition} · PO ${insp.po_no || '—'}`,
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
