// Supabase Edge Function: ocr-label
// Reads a pallet-label photo from the qc-photos bucket and extracts structured
// fields with Claude vision. STAFF ONLY (admin/approver/inspector) — deployed
// WITH jwt verification (no --no-verify-jwt).
//
// Input  (POST): { path: string }   — storage path inside qc-photos
// Output: { ok, fields: { part_no, qty, pallet_no, container_no, model, size, finish }, raw_text }
// The client always shows the fields for human confirmation before saving.
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Caller must be signed-in staff.
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ ok: false, error: 'Not signed in.' }, 401)
    const { data: caller } = await admin.auth.getUser(jwt)
    if (!caller?.user) return json({ ok: false, error: 'Invalid session.' }, 401)
    const { data: prof } = await admin.from('profiles').select('role').eq('id', caller.user.id).single()
    if (!prof || !['admin', 'approver', 'inspector'].includes(prof.role)) {
      return json({ ok: false, error: 'Staff access required.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const path = String(body.path || '')
    if (!path) return json({ ok: false, error: 'Missing photo path.' }, 400)

    // Download the photo server-side (service role bypasses RLS).
    const dl = await admin.storage.from('qc-photos').download(path)
    if (dl.error || !dl.data) return json({ ok: false, error: `Could not read photo: ${dl.error?.message || 'not found'}` }, 404)
    const buf = new Uint8Array(await dl.data.arrayBuffer())
    if (buf.length > 9_500_000) return json({ ok: false, error: 'Photo too large for OCR (max ~9 MB). Retake at lower resolution.' }, 400)
    let b64 = ''
    const CHUNK = 32768
    for (let i = 0; i < buf.length; i += CHUNK) b64 += String.fromCharCode(...buf.subarray(i, i + CHUNK))
    b64 = btoa(b64)
    const mediaType = path.toLowerCase().endsWith('.png') ? 'image/png' : path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg'

    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) return json({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }, 500)

    const system = `You read photos of NITRA alloy-wheel pallet labels taken on a factory floor (angles, glare, shrink wrap are common). The label follows a fixed template with fields like: SKU / PART NUMBER, MODEL, SIZE/GRANDEUR, BOLT PATTERN, OFFSET, HUB, FINISH/FINI, a barcode, QTY PER PALLET (often handwritten), PALLET NO. and CONTAINER NO. (often handwritten).
Respond ONLY with a JSON object, no markdown fences, no commentary:
{"part_no": string|null, "qty": number|null, "pallet_no": string|null, "container_no": string|null, "model": string|null, "size": string|null, "finish": string|null, "raw_text": string}
Rules: part_no is the full SKU (e.g. PU18KH80511440671GM-01 — strip a trailing "-01" style pallet suffix into pallet_no if present and return the base SKU in part_no). qty is QTY PER PALLET as a number. Use null for anything unreadable — never guess. raw_text is all legible text on the label.`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 1500, system,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: 'Extract the label fields as specified.' },
          ],
        }],
      }),
    })
    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      return json({ ok: false, error: `Vision request failed (${resp.status}). ${t.slice(0, 200)}` }, 502)
    }
    const data = await resp.json()
    const text = (data.content || []).map((c: any) => c.type === 'text' ? c.text : '').join('').trim()
    let fields: any = null
    try { fields = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, '')) } catch { /* fall through */ }
    if (!fields || typeof fields !== 'object') {
      return json({ ok: false, error: 'Could not read the label. Retake the photo (fill the frame, avoid glare) or enter values manually.', raw: text.slice(0, 400) }, 422)
    }
    const qty = Number(fields.qty)
    return json({
      ok: true,
      fields: {
        part_no: fields.part_no ? String(fields.part_no).trim() : null,
        qty: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : null,
        pallet_no: fields.pallet_no ? String(fields.pallet_no).trim() : null,
        container_no: fields.container_no ? String(fields.container_no).trim() : null,
        model: fields.model ? String(fields.model).trim() : null,
        size: fields.size ? String(fields.size).trim() : null,
        finish: fields.finish ? String(fields.finish).trim() : null,
      },
      raw_text: String(fields.raw_text || '').slice(0, 2000),
    })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...cors(), 'Content-Type': 'application/json' } })
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}
