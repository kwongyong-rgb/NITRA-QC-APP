// Supabase Edge Function: send-report
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const { inspection_id } = await req.json()
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: insp } = await supa.from('inspections').select('*').eq('id', inspection_id).single()
    if (!insp) return new Response('not found', { status: 404 })
    const { data: sku } = await supa.from('skus').select('*').eq('part_no', insp.part_no).single()
    const { data: defects } = await supa.from('defects').select('*').eq('inspection_id', inspection_id)
    const { data: inspector } = await supa.from('profiles').select('full_name').eq('id', insp.inspector_id).single()
    const { data: reviewer } = await supa.from('profiles').select('full_name').eq('id', insp.reviewed_by).single()
    const { data: dist } = await supa.from('settings').select('value').eq('key', 'distribution').single()
    const emails: string[] = dist?.value?.emails || []
    if (!emails.includes('kyong@nitrawheels.com')) emails.push('kyong@nitrawheels.com')

    const dispositionLabel: Record<string, string> = {
      release: 'RELEASE', release_record: 'RELEASE WITH RECORD',
      hold_100: 'HOLD — 100% INSPECTION', reject: 'REJECT',
    }
    const disposition = dispositionLabel[insp.summary?.disposition] || insp.summary?.disposition || '—'
    const isPass = disposition === 'RELEASE' || disposition === 'RELEASE WITH RECORD'
    const defectRows = (defects || []).map((d: Record<string, unknown>) =>
      `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${d.piece_no}</td>
       <td style="padding:6px 8px;border-bottom:1px solid #eee">${d.item_label || d.item_key}</td>
       <td style="padding:6px 8px;border-bottom:1px solid #eee">${String(d.defect_type||'').replace(/_/g,' ')}</td>
       <td style="padding:6px 8px;border-bottom:1px solid #eee">${d.severity}</td>
       <td style="padding:6px 8px;border-bottom:1px solid #eee">${d.measurement_value !== null ? `${d.measurement_value} ${d.measurement_unit}` : '—'}</td></tr>`
    ).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:700px;margin:0 auto;padding:20px">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  <div style="color:#fff;font-size:22px;font-weight:700">NITRA FLOWFORGED</div>
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">QC Inspection Report</div>
</div>
<div style="background:${isPass?'#E3F3EA':'#FBE9E7'};border:1px solid ${isPass?'#1F8A4C':'#C0392B'};
  padding:12px 24px;font-weight:700;font-size:16px;color:${isPass?'#1F8A4C':'#C0392B'}">${disposition}</div>
<div style="border:1px solid #D5DBE4;border-top:none;padding:20px 24px">
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px;width:40%">Part No.</td><td style="font-weight:600">${insp.part_no}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Model / Size</td><td>${sku?.model||'—'} ${sku?.size||''}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">PO No.</td><td>${insp.po_no||'—'}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Batch</td><td>${insp.batch||'—'}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Lot size</td><td>${insp.lot_size} pcs</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">App sample</td><td>${insp.app_sample} pcs</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Fun sample</td><td>${insp.fun_sample} pcs</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Inspector</td><td>${inspector?.full_name||'—'}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Submitted</td><td>${insp.submitted_at ? new Date(insp.submitted_at).toLocaleString() : '—'}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Approved by</td><td>${reviewer?.full_name||'—'}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Approved on</td><td>${insp.reviewed_at ? new Date(insp.reviewed_at).toLocaleString() : '—'}</td></tr>
  <tr><td style="padding:6px 0;color:#5A6878;font-size:13px">Defects</td>
    <td style="font-weight:600;color:${(defects||[]).length>0?'#C0392B':'#1F8A4C'}">${(defects||[]).length}</td></tr>
</table>
${insp.summary?.remarks ? `<div style="background:#F7F9FB;border-radius:8px;padding:12px 16px;margin-bottom:20px"><div style="font-size:12px;color:#5A6878;margin-bottom:4px">REMARKS</div><div>${insp.summary.remarks}</div></div>` : ''}
${defectRows ? `<h3 style="color:#1F3A5F;margin-bottom:10px">Defect Log</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px">
<thead><tr style="background:#1F3A5F;color:#fff">
  <th style="padding:8px;text-align:left">Piece</th><th style="padding:8px;text-align:left">Parameter</th>
  <th style="padding:8px;text-align:left">Type</th><th style="padding:8px;text-align:left">Severity</th>
  <th style="padding:8px;text-align:left">Value</th></tr></thead>
<tbody>${defectRows}</tbody></table>` : '<p style="color:#1F8A4C;font-weight:600">✓ No defects logged.</p>'}
</div>
<div style="background:#F7F9FB;border:1px solid #D5DBE4;border-top:none;padding:12px 24px;border-radius:0 0 10px 10px">
  <p style="color:#5A6878;font-size:11px;margin:0">CONFIDENTIAL — PROPERTY OF NITRA FLOWFORGED</p>
</div></body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'NITRA QC <kyong@nitrawheels.com>',
        to: emails,
        subject: `QC Report — ${insp.part_no} · ${disposition} · PO ${insp.po_no||'—'}`,
        html,
      }),
    })
    const result = await res.json()
    return new Response(JSON.stringify({ ok: res.ok, result }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(String(e), { status: 500 })
  }
})
