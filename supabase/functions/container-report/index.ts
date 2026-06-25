// Supabase Edge Function: container-report
// Public JSON for the container loading interactive report (src/pages/ContainerReportPage.tsx).
// Deploy with --no-verify-jwt.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const LABELS: Record<string, { en: string; zh: string }> = {
  container_no_photo: { en: 'Container number', zh: '集装箱号' },
  seal_no_photo: { en: 'Seal number', zh: '封条号' },
  pallet_label: { en: 'Pallet label', zh: '托盘标签' },
  pl_grouped: { en: 'Wheels stacked & grouped by part no.', zh: '按产品编号分类堆叠' },
  pl_wood: { en: 'Fumigation-free solid-wood pallet', zh: '免熏蒸实木托盘' },
  pl_height: { en: 'Height ≤254 cm, 3-inch fork gap', zh: '高≤254cm，留3英寸叉车位' },
  pl_straps: { en: '4 straps tight', zh: '4根打包带捆扎牢固' },
  pl_wrap: { en: 'Wrap ≥3 layers, ≥0.35 mm, tight', zh: '缠绕≥3层，≥0.35mm，紧实' },
  pl_label4: { en: 'Pallet label on all 4 sides', zh: '四面贴托盘标签' },
  pl_photo: { en: 'Photo of each pallet taken', zh: '每托盘拍照' },
  cc_exterior: { en: 'Container Condition: Exterior', zh: '集装箱状况：外部' },
  cc_interior: { en: 'Container Condition: Interior', zh: '集装箱状况：内部' },
  cl_empty: { en: 'Container Loading: Empty', zh: '装柜：空柜' },
  cl_half: { en: 'Container Loading: Half Full', zh: '装柜：半满' },
  cl_full: { en: 'Container Loading: Full', zh: '装柜：满柜' },
  cl_by_size: { en: 'Wheels loaded by size & part number', zh: '按尺寸与产品编号装载' },
  cl_box_labels: { en: 'Box labels & hand-holes facing container door', zh: '箱标签与提手孔朝向柜门' },
  cl_spares: { en: 'Spare boxes & caps at front', zh: '备用箱与盖置于柜门口' },
  cl_net: { en: 'Protective net after loading', zh: '装载后防护网' },
}
const PHOTO_ORDER = ['container_no_photo', 'seal_no_photo', 'cc_exterior', 'cc_interior', 'cl_empty', 'cl_half', 'cl_full', 'cl_by_size', 'cl_box_labels', 'cl_spares', 'cl_net', 'pallet_label']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id') || ''
    const lang = (url.searchParams.get('lang') || 'en').toLowerCase()
    if (!id) return json({ ok: false, error: 'Missing id' }, 400)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: cl, error } = await supa.from('container_loadings').select('*').eq('id', id).single()
    if (error || !cl) return json({ ok: false, error: error?.message || 'Not found' }, 404)

    const ids = [cl.inspector_id, cl.reviewed_by].filter(Boolean)
    const { data: profs } = ids.length ? await supa.from('profiles').select('id,full_name,email').in('id', ids) : { data: [] as any[] }
    const nameOf = (pid: string) => { const p = (profs || []).find((x: any) => x.id === pid); return p?.full_name || p?.email || '' }

    const d = cl.data || {}
    const type = d.loading_type || 'pallet'

    const { data: photoRows } = await supa.from('photos').select('*').eq('container_loading_id', id)
    const signed = async (p: string) => (await supa.storage.from('qc-photos').createSignedUrl(p, 60 * 60 * 6)).data?.signedUrl || null

    // contents
    const contents: string[] = []
    if (type === 'pallet') {
      for (const [n, pd] of Object.entries(d.pallets || {})) for (const c of ((pd as any).contents || [])) if (c.part_no) contents.push(`Pallet ${n}: ${c.part_no} × ${c.qty}`)
    } else {
      for (const c of (d.non_pallet_contents || [])) if (c.part_no) contents.push(`${c.part_no} × ${c.qty}`)
    }

    // per-pallet packing checks
    const pallets: any[] = []
    if (type === 'pallet') {
      const cnt = d.pallet_count || 0
      for (let n = 1; n <= cnt; n++) {
        const pd = (d.pallets || {})[n] || { checks: {}, contents: [] }
        const checks = Object.entries(pd.checks || {}).map(([k, v]) => ({ key: k, value: v }))
        pallets.push({ n, checks, failCount: checks.filter((c: any) => c.value === 'F').length })
      }
    }

    // photo groups by item_key
    const byKey: Record<string, any[]> = {}
    for (const p of (photoRows || [])) { (byKey[p.item_key] = byKey[p.item_key] || []).push(p) }
    const groupKeys = Object.keys(byKey).sort((a, b) => (PHOTO_ORDER.indexOf(a) + 1 || 99) - (PHOTO_ORDER.indexOf(b) + 1 || 99))
    const photoGroups = await Promise.all(groupKeys.map(async (k) => ({
      key: k,
      labelEn: LABELS[k]?.en || k.replace(/_/g, ' '),
      labelZh: LABELS[k]?.zh || k.replace(/_/g, ' '),
      photos: await Promise.all(byKey[k].map(async (p: any) => ({
        url: await signed(p.storage_path), isPass: !!p.is_pass_photo, mediaType: p.media_type || 'photo',
        comment: p.comment || '', pieceNo: p.piece_no || 0,
      }))),
    })))

    const logoUrl = cl.report_logo_path ? await signed(cl.report_logo_path) : null

    // ---- translation ----
    let translationNote: string | null = null
    const labelLang = (k: string) => lang === 'zh' ? (LABELS[k]?.zh || k) : (LABELS[k]?.en || k)
    let resolveLabel = labelLang
    let txComment = (s: string) => s
    if (lang === 'de' || lang === 'zh') {
      const strings = new Set<string>()
      if (lang === 'de') for (const g of photoGroups) strings.add(g.labelEn)
      if (lang === 'de') for (const pl of pallets) for (const c of pl.checks) strings.add(LABELS[c.key]?.en || c.key)
      for (const g of photoGroups) for (const p of g.photos) if (p.comment) strings.add(p.comment)
      const list = [...strings].filter(Boolean)
      if (list.length) {
        const { map, error: terr } = await translateBatch(list, lang, 'cl:' + id, supa)
        if (terr) translationNote = terr
        const tr = (s: string) => (s && map[s]) ? map[s] : s
        if (lang === 'de') resolveLabel = (k: string) => tr(LABELS[k]?.en || k)
        txComment = tr
      }
    }

    const outGroups = photoGroups.map((g) => ({
      key: g.key, label: lang === 'zh' ? g.labelZh : resolveLabel(g.key),
      photos: g.photos.map((p) => ({ ...p, comment: txComment(p.comment) })),
    }))
    const outPallets = pallets.map((pl) => ({
      ...pl, checks: pl.checks.map((c: any) => ({ label: resolveLabel(c.key), value: c.value })),
    }))

    return json({
      ok: true, lang, translationNote, logoUrl,
      container: {
        po_no: cl.po_no || '', container_no: cl.container_no || '', seal_no: cl.seal_no || '',
        status: cl.status || '', insp_status: cl.insp_status || '',
        submitted_at: cl.submitted_at || null, reviewed_at: cl.reviewed_at || null,
        loading_type: type, pallet_count: d.pallet_count || 0,
        date_loaded: d.date_loaded || '', etd: d.etd || '', eta: d.eta || '',
        bl_no: d.bl_no || '', dest_port: d.dest_port || '', dep_port: d.dep_port || '',
        inspectorName: nameOf(cl.inspector_id), reviewerName: cl.reviewed_by ? nameOf(cl.reviewed_by) : '',
      },
      contents, pallets: outPallets, photoGroups: outGroups,
    })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
}
async function translateBatch(list: string[], lang: string, cacheId: string, supa: any): Promise<{ map: Record<string, string>; error: string | null }> {
  if (!list.length) return { map: {}, error: null }
  const source_hash = hashStrings(list)
  try {
    const { data: cached } = await supa.from('report_translations').select('content_hash, payload').eq('inspection_id', cacheId).eq('lang', lang).maybeSingle()
    if (cached && cached.content_hash === source_hash && cached.payload && Object.keys(cached.payload).length) return { map: cached.payload, error: null }
  } catch (_) { /* best effort */ }
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return { map: {}, error: 'no_key' }
  const obj: Record<string, string> = {}
  list.forEach((s, i) => { obj[String(i)] = s })
  const langName = lang === 'de' ? 'German' : 'Simplified Chinese'
  const system = `You are a professional translator for automotive alloy-wheel manufacturing, packing and shipping documents. Translate the VALUE of each entry in the given JSON object from English into ${langName}, using correct industry terminology. Do NOT translate part numbers, SKU codes, container numbers, seal numbers, BL numbers, port names, numeric measurements or units. Preserve numbers exactly. Return ONLY a valid JSON object with the same keys and translated values — no markdown, no code fences.`
  let parsed: Record<string, string> = {}
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system, messages: [{ role: 'user', content: JSON.stringify(obj) }] }),
    })
    if (!resp.ok) return { map: {}, error: 'api_' + resp.status }
    const j = await resp.json()
    let text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
    parsed = JSON.parse(text)
  } catch (_) { return { map: {}, error: 'translate_failed' } }
  const map: Record<string, string> = {}
  list.forEach((s, i) => { const t = parsed[String(i)]; if (typeof t === 'string' && t.trim()) map[s] = t })
  try { await supa.from('report_translations').upsert({ inspection_id: cacheId, lang, content_hash: source_hash, payload: map, updated_at: new Date().toISOString() }) } catch (_) { /* best effort */ }
  return { map, error: null }
}
function hashStrings(arr: string[]): string {
  const s = arr.join('\u0001'); let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return String(h)
}
