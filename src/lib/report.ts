// ============================================================
// NITRA QC — browser-generated PDF report (Option A)
// Self-contained: fetches its own data, builds bilingual HTML,
// opens a print window and triggers Save-as-PDF.
// ============================================================
import { supabase } from './supabase'
import { SECTIONS, MEAS_COLS, PHOTO_SLOTS, PALLET_ITEMS, type Bi } from './standard'
import { evaluateAll, emptyFormData, type FormData, type PFNA } from './rules'

type Lang = 'en' | 'zh'

interface PhotoRow {
  id: string; storage_path: string; defect_id: string | null
  is_pass_photo: boolean; item_key: string; piece_no: number
  comment: string; checklist_key: string; media_type?: string
}
interface DefectRow {
  id: string; piece_no: number; item_key: string; item_label: string
  defect_type: string; severity: string; measurement_value: number | null
  measurement_unit: string; comment: string; tab: string
}
type Fd = FormData & {
  hundred_pct?: Record<string, Record<string, PFNA>>
  na_overrides?: Record<string, boolean>
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const DISPOSITION: Record<string, { en: string; zh: string; cls: 'pass' | 'hold' | 'fail' }> = {
  release:        { en: 'RELEASE',                  zh: '放行',     cls: 'pass' },
  release_record: { en: 'RELEASE WITH RECORD',      zh: '记录放行', cls: 'pass' },
  hold_100:       { en: 'HOLD — 100% INSPECTION',   zh: '全检待定', cls: 'hold' },
  reject:         { en: 'REJECT',                   zh: '拒收',     cls: 'fail' },
}

const CSS = `
:root{--navy:#1F3A5F;--steel:#9FB6D4;--line:#D5DBE4;--ink:#18222E;--ink-soft:#5A6878;
--pass:#1F8A4C;--pass-bg:#E3F3EA;--fail:#C0392B;--fail-bg:#FBE9E7;--amber:#B7791F;--amber-bg:#FBF3E2;}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:var(--ink);font-family:Arial,"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.45}
.head{background:var(--navy);color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}
.head img.logo{height:30px;display:block}
.head .brand{font-size:20px;font-weight:800;letter-spacing:1px}
.head .doc{text-align:right;font-size:14px;font-weight:700}
.head .doc small{display:block;font-size:11px;color:var(--steel);font-weight:500}
.disp{padding:11px 24px;font-weight:800;font-size:16px;display:flex;justify-content:space-between;align-items:center}
.disp.pass{background:var(--pass-bg);color:var(--pass);border-bottom:2px solid var(--pass)}
.disp.fail{background:var(--fail-bg);color:var(--fail);border-bottom:2px solid var(--fail)}
.disp.hold{background:var(--amber-bg);color:var(--amber);border-bottom:2px solid var(--amber)}
.disp small{font-weight:600;font-size:12px;opacity:.85}
.body{padding:18px 24px}
h3{color:var(--navy);font-size:14px;margin:22px 0 8px;border-bottom:2px solid var(--navy);padding-bottom:4px}
h3 small{color:var(--ink-soft);font-weight:500;font-size:12px}
.legend{background:#F7F9FB;border-left:3px solid var(--steel);border-radius:4px;padding:8px 12px;font-size:11px;color:var(--ink-soft);margin-bottom:8px}
.meta{width:100%;border-collapse:collapse}
.meta td{padding:5px 6px;border-bottom:1px solid #EEF1F5;vertical-align:top}
.meta td.k{color:var(--ink-soft);font-size:11px;width:24%}
.meta td.k small{display:block;font-size:10px;color:#9AA7B5}
.meta td.v{font-weight:600;width:26%}
table.grid{width:100%;border-collapse:collapse;margin-top:4px}
table.grid th{background:var(--navy);color:#fff;font-size:11px;font-weight:700;padding:7px 8px;text-align:left}
table.grid th small{display:block;font-weight:500;color:var(--steel);font-size:10px}
table.grid td{padding:7px 8px;border-bottom:1px solid var(--line);font-size:12px;vertical-align:middle}
.pill{display:inline-block;border-radius:10px;padding:1px 8px;font-size:10px;font-weight:700;color:#fff}
.pill.minor{background:#7A8794}.pill.major{background:var(--amber)}.pill.critical{background:var(--fail)}
.tag{display:inline-block;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap}
.tag.full{background:var(--fail-bg);color:var(--fail)}.tag.monitor{background:var(--amber-bg);color:var(--amber)}.tag.extra{background:#EEF1F5;color:var(--ink-soft)}
.stage{display:inline-block;border-radius:5px;padding:1px 7px;font-size:10px;font-weight:700;background:#EEF1F5;color:var(--ink-soft)}
.stage.s100{background:var(--fail-bg);color:var(--fail)}
.pcs{font-weight:700;color:var(--fail)}
.grp{margin-top:12px}
.grp .lbl{font-weight:700;color:var(--navy);font-size:12.5px;margin-bottom:6px}
.gal{display:flex;flex-wrap:wrap;gap:10px}
.gal figure{margin:0;width:104px}
.gal .ph,.gal img.ph{width:104px;height:78px;border-radius:8px;background:#EEF1F5;display:flex;align-items:center;justify-content:center;color:#9AA7B5;font-size:22px;border:2px solid var(--line);object-fit:cover}
.gal .ph.f,.gal img.ph.f{border-color:var(--fail)}.gal .ph.p,.gal img.ph.p{border-color:var(--pass)}
.gal figcaption{font-size:10px;color:var(--ink-soft);margin-top:3px;line-height:1.3}
.gal figcaption b.p{color:var(--pass)}.gal figcaption b.f{color:var(--fail)}
.remarks{background:#F7F9FB;border-radius:8px;padding:11px 14px;margin-top:6px}
.foot{padding:10px 24px;color:#9AA7B5;font-size:10px;letter-spacing:2px;display:flex;justify-content:space-between;border-top:1px solid var(--line);margin-top:18px}
@media print{.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}
h3{break-after:avoid}.grp{break-inside:avoid}tr{break-inside:avoid}
@page{size:A4;margin:12mm}}
`

export async function openInspectionReport(inspectionId: string, lang: Lang = 'en') {
  // Open the window synchronously (inside the click gesture) to avoid pop-up blocking.
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to generate the PDF report. / 请允许弹出窗口以生成PDF报告。'); return }
  w.document.write('<!doctype html><meta charset="utf-8"><title>QC Report</title><body style="font-family:Arial;padding:40px;color:#1F3A5F">Generating report… / 正在生成报告…</body>')

  try {
    const L = (b: Bi) => b[lang]

    const { data: insp } = await supabase.from('inspections').select('*').eq('id', inspectionId).single()
    if (!insp) throw new Error('Inspection not found')
    const fd: Fd = { ...emptyFormData(), na_overrides: {}, ...(insp.form_data || {}) }

    const { data: sku } = await supabase.from('skus').select('*').eq('part_no', insp.part_no).single()
    const { data: defectsRaw } = await supabase.from('defects').select('*').eq('inspection_id', inspectionId).order('created_at')
    const { data: photosRaw } = await supabase.from('photos').select('*').eq('inspection_id', inspectionId).order('created_at')
    const defects = (defectsRaw as DefectRow[]) || []
    const photos = (photosRaw as PhotoRow[]) || []

    // Names
    const ids = [insp.inspector_id, insp.reviewed_by].filter(Boolean)
    const names: Record<string, string> = {}
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      for (const p of profs || []) names[p.id] = p.full_name
    }

    // Signed URLs for photos (batch)
    const urlMap: Record<string, string> = {}
    const paths = [...new Set(photos.map(p => p.storage_path))]
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('qc-photos').createSignedUrls(paths, 3600)
      for (const s of signed || []) if (s.signedUrl && s.path) urlMap[s.path] = s.signedUrl
    }

    // ── Label maps ──
    const formItemMap: Record<string, string> = {}
    for (const sec of SECTIONS) for (const it of sec.items) formItemMap[it.key] = L(it.label)
    const measMap: Record<string, string> = {}
    for (const c of MEAS_COLS) measMap[c.key] = L(c.label)
    const palletMap: Record<string, string> = {}
    for (const it of PALLET_ITEMS) palletMap[it.key] = L(it.label)
    const slotMap: Record<string, string> = {}
    for (const s of PHOTO_SLOTS) slotMap[s.key] = L(s.label)
    const paramLabel = (key: string) => formItemMap[key] || measMap[key] || palletMap[key] || key.replace(/_/g, ' ')

    // ── Rule outcome ──
    const allFormItems = SECTIONS.flatMap(s => s.items.map(i => ({ key: i.key, label: L(i.label), group: i.group })))
    const allMeasItems = MEAS_COLS.map(c => ({ key: c.key, label: L(c.label) }))
    const verdicts = evaluateAll(fd, allFormItems, allMeasItems, insp.app_sample, insp.fun_sample, 4)

    const baseFailPieces = (key: string, isMeas: boolean, n: number) => {
      const out: number[] = []
      for (let p = 1; p <= n; p++) {
        const r = isMeas ? fd.meas_results?.[`${key}:${p}`] : fd.results?.[`${key}:${p}`]
        if (r === 'F') out.push(p)
      }
      return out
    }

    const outcomeRows = verdicts.map(v => {
      const isMeas = v.tab === 'measure'
      const n = isMeas ? insp.fun_sample : (v.group === 'A' ? insp.app_sample : insp.fun_sample)
      const baseList = baseFailPieces(v.key, isMeas, n).map(p => `#${p}`).join(', ')
      const extraN = v.extraResults.length
      const extraFail = v.extraResults.map((r, i) => (r === 'F' ? `+${i + 1}` : '')).filter(Boolean).join(', ')
      let en: string, zh: string, tag: string, cls: string
      const headEn = `${v.baseFailures} of ${n} sampled failed — piece ${baseList}`
      const headZh = `${n} 件抽样中 ${v.baseFailures} 件不合格（${baseList}）`
      if (v.status === 'full_inspection') {
        en = `${headEn} → ${extraN} extra inspected, ${v.extraResults.filter(r => r === 'F').length} failed (extra ${extraFail}) → 100% inspection`
        zh = `${headZh} → 加检 ${extraN} 件，${v.extraResults.filter(r => r === 'F').length} 件不合格（${extraFail}）→ 全检`
        tag = lang === 'en' ? '100% INSPECTION' : '100%全检'; cls = 'full'
      } else if (v.status === 'monitor') {
        en = `${headEn} → ${extraN} extra inspected, all passed`
        zh = `${headZh} → 加检 ${extraN} 件，全部合格`
        tag = lang === 'en' ? 'RECORD & MONITOR' : '记录监控'; cls = 'monitor'
      } else { // extra_needed
        en = `${headEn} → ${v.extrasStillNeeded} more extra piece(s) to inspect`
        zh = `${headZh} → 尚需加检 ${v.extrasStillNeeded} 件`
        tag = lang === 'en' ? 'EXTRA PENDING' : '待加检'; cls = 'extra'
      }
      return `<tr><td>${esc(v.label)}</td><td>${esc(lang === 'en' ? en : zh)}</td><td><span class="tag ${cls}">${esc(tag)}</span></td></tr>`
    }).join('')

    // ── 100% inspection results ──
    const hundred = fd.hundred_pct || {}
    const triggered = verdicts.filter(v => v.status === 'full_inspection')
    const hundredRows = triggered.map(v => {
      const map = hundred[v.key] || {}
      const entries = Object.entries(map).filter(([, r]) => r === 'P' || r === 'F')
      const fails = entries.filter(([, r]) => r === 'F').map(([pc]) => Number(pc)).sort((a, b) => a - b)
      const checked = entries.length
      const pass = checked - fails.length
      return `<tr><td>${esc(v.label)}</td><td>${checked} / ${insp.lot_size}</td>
        <td style="color:var(--pass);font-weight:700">${pass}</td>
        <td style="color:var(--fail);font-weight:700">${fails.length}</td>
        <td style="font-size:11px">${fails.length ? fails.map(f => `#${f}`).join(', ') : '—'}</td></tr>`
    }).join('')

    // ── Defect log ──
    const stageOf = (tab: string) =>
      tab === 'extra' ? { en: 'Extra', zh: '加检', cls: '' } :
      tab === '100pct' ? { en: '100%', zh: '全检', cls: 's100' } :
      tab === 'pallet' ? { en: 'Pallet', zh: '托盘', cls: '' } :
      { en: 'Sample', zh: '抽样', cls: '' }
    const sevPill = (s: string) => s === 'critical' ? 'critical' : s === 'major' ? 'major' : 'minor'
    const defectRows = defects.map(d => {
      const st = stageOf(d.tab)
      const pieceTxt = d.tab === 'extra' ? `+${-d.piece_no}` : (d.tab === 'pallet' ? '—' : d.piece_no || '—')
      const ph = photos.filter(p => p.defect_id === d.id)
      const phTxt = ph.length ? `${ph.some(p => p.media_type === 'video') ? '🎥' : '📷'} ${ph.length}` : '—'
      return `<tr><td><span class="stage ${st.cls}">${esc(lang === 'en' ? st.en : st.zh)}</span></td>
        <td>${esc(pieceTxt)}</td><td>${esc(d.item_label || paramLabel(d.item_key))}</td>
        <td>${esc((d.defect_type || '').replace(/_/g, ' '))}</td>
        <td><span class="pill ${sevPill(d.severity)}">${esc(d.severity)}</span></td>
        <td>${d.measurement_value !== null ? `${esc(d.measurement_value)} ${esc(d.measurement_unit)}` : '—'}</td>
        <td>${phTxt}</td></tr>`
    }).join('')

    // ── Photo appendix ──
    const figFor = (p: PhotoRow, caption?: string) => {
      const cls = p.is_pass_photo ? 'p' : 'f'
      const tag = p.is_pass_photo ? (lang === 'en' ? 'PASS' : '合格') : (lang === 'en' ? 'FAIL' : '不合格')
      const url = urlMap[p.storage_path]
      const piece = p.piece_no < 0 ? `extra +${-p.piece_no}` : p.piece_no > 0 ? `pc${p.piece_no}` : ''
      const media = p.media_type === 'video'
        ? `<div class="ph ${cls}">🎥</div>`
        : url ? `<img class="ph ${cls}" src="${esc(url)}">` : `<div class="ph ${cls}">📷</div>`
      const capParts = [piece, caption].filter(Boolean).map(esc).join(' · ')
      return `<figure>${media}<figcaption><b class="${cls}">${tag}</b>${capParts ? ` · ${capParts}` : ''}</figcaption></figure>`
    }

    const reqShots = photos.filter(p => !p.item_key && p.checklist_key)
    const reqGroup = reqShots.length
      ? `<div class="grp"><div class="lbl">${lang === 'en' ? 'Required Shots · 必拍照片' : '必拍照片 · Required Shots'}</div>
         <div class="gal">${reqShots.map(p => figFor(p, slotMap[p.checklist_key] || p.checklist_key)).join('')}</div></div>`
      : ''

    // Parameter groups, ordered by section then measure then pallet
    const orderedKeys = [
      ...SECTIONS.flatMap(s => s.items.map(i => i.key)),
      ...MEAS_COLS.map(c => c.key),
      ...PALLET_ITEMS.map(i => i.key),
    ]
    const paramPhotos = photos.filter(p => p.item_key)
    const seen = new Set<string>()
    const paramGroups = orderedKeys.filter(k => paramPhotos.some(p => p.item_key === k) && !seen.has(k) && seen.add(k))
      .map(k => {
        const list = paramPhotos.filter(p => p.item_key === k)
          .sort((a, b) => (a.is_pass_photo === b.is_pass_photo ? a.piece_no - b.piece_no : (a.is_pass_photo ? -1 : 1)))
        // pass photos first, then defect photos; piece order within each
        return `<div class="grp"><div class="lbl">${esc(paramLabel(k))}</div>
          <div class="gal">${list.map(p => figFor(p)).join('')}</div></div>`
      }).join('')

    const appendix = (reqGroup || paramGroups)
      ? `<h3>${lang === 'en' ? 'Photo Appendix' : '照片附录'} <small>${lang === 'en' ? '照片附录' : 'Photo Appendix'}</small></h3>${reqGroup}${paramGroups}`
      : ''

    // ── Meta ──
    const disp = DISPOSITION[insp.summary?.disposition] || { en: insp.summary?.disposition || '—', zh: '—', cls: 'hold' as const }
    const dt = (s?: string) => s ? new Date(s).toLocaleString() : '—'
    const wt = sku?.wheel_weight_kg != null ? `${Number(sku.wheel_weight_kg).toFixed(2)} kg <span style="color:var(--ink-soft);font-weight:400">(± ${Number(sku.wheel_weight_tol_kg ?? 0.4)} kg)</span>` : '—'

    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>NITRA QC Report — ${esc(insp.part_no)}</title><style>${CSS}</style></head><body>
<div class="head">
  <img class="logo" src="${esc(window.location.origin)}/logo-white.png" alt="NITRA"
       onerror="this.outerHTML='<span class=&quot;brand&quot;>NITRA</span>'">
  <div class="doc">QC Inspection Report<small>质量检验报告</small></div>
</div>
<div class="disp ${disp.cls}">
  <span>${esc(disp.en)} <small>· ${esc(disp.zh)}</small></span>
  <small>${lang === 'en' ? 'Report generated' : '报告生成'} ${esc(new Date().toLocaleString())}</small>
</div>
<div class="body">
  <table class="meta">
    <tr><td class="k">Part No. / SKU<small>产品编号</small></td><td class="v">${esc(insp.part_no)}</td>
        <td class="k">Finish<small>表面处理</small></td><td class="v">${esc(sku?.finish || '—')}</td></tr>
    <tr><td class="k">Model / Size<small>型号 / 尺寸</small></td><td class="v">${esc(sku?.model || '—')} · ${esc(sku?.size || '')}</td>
        <td class="k">Wheel weight<small>轮毂重量</small></td><td class="v">${wt}</td></tr>
    <tr><td class="k">PCD · ET · CB</td><td class="v">${esc(sku?.pcd || '—')} · ${esc(sku?.offset_txt || '')} · ${esc(sku?.cb_mm ?? '')}</td>
        <td class="k">TPMS sensor<small>TPMS 传感器</small></td><td class="v">${esc(sku?.tpms_sensor_mm || '—')}</td></tr>
    <tr><td class="k">PO No.<small>订单号</small></td><td class="v">${esc(insp.po_no || '—')}</td>
        <td class="k">Batch / date<small>批次/日期</small></td><td class="v">${esc(insp.batch || '—')}</td></tr>
    <tr><td class="k">Lot size<small>批量</small></td><td class="v">${esc(insp.lot_size)} pcs</td>
        <td class="k">Samples (App / Fun)<small>抽样 外观/功能</small></td><td class="v">${esc(insp.app_sample)} / ${esc(insp.fun_sample)} pcs</td></tr>
    <tr><td class="k">Inspector<small>检验员</small></td><td class="v">${esc(names[insp.inspector_id] || '—')}</td>
        <td class="k">Submitted<small>提交时间</small></td><td class="v">${esc(dt(insp.submitted_at))}</td></tr>
    <tr><td class="k">Approved by<small>批准人</small></td><td class="v">${esc(insp.reviewed_by ? (names[insp.reviewed_by] || '—') : '—')}</td>
        <td class="k">Approved on<small>批准时间</small></td><td class="v">${esc(dt(insp.reviewed_at))}</td></tr>
  </table>

  <h3>${lang === 'en' ? 'Inspection Outcome' : '检验结果'} <small>${lang === 'en' ? '检验结果' : 'Inspection Outcome'}</small></h3>
  <div class="legend">
    ${lang === 'en'
      ? '<b>How to read this:</b> if a parameter fails on any sampled piece, 4 extra pieces are inspected. All extras pass → recorded &amp; monitored (batch released). Any extra fails → 100% inspection of the whole lot for that parameter.'
      : '<b>检验规则：</b>某项目在抽样件中出现不合格时，须加检 4 件。全部合格 → 记录监控（放行）；任一不合格 → 该项目全检整批。'}
  </div>
  ${outcomeRows
    ? `<table class="grid"><tr><th>${lang === 'en' ? 'Parameter' : '项目'}</th><th>${lang === 'en' ? 'What happened' : '过程'}</th><th>${lang === 'en' ? 'Outcome' : '结果'}</th></tr>${outcomeRows}</table>
       <div style="font-size:11px;color:var(--ink-soft);margin-top:6px">${lang === 'en' ? 'All other parameters passed.' : '其余项目均合格。'}</div>`
    : `<div class="tag monitor" style="display:inline-block">${lang === 'en' ? 'All parameters passed — no failures flagged' : '所有项目合格 — 无不合格'}</div>`}

  ${hundredRows
    ? `<h3>${lang === 'en' ? '100% Inspection Results' : '全检结果'} <small>${lang === 'en' ? '全检结果' : '100% Inspection Results'}</small></h3>
       <table class="grid"><tr><th>${lang === 'en' ? 'Parameter' : '项目'}</th><th>${lang === 'en' ? 'Checked' : '已检'}</th><th>${lang === 'en' ? 'Pass' : '合格'}</th><th>${lang === 'en' ? 'Fail' : '不合格'}</th><th>${lang === 'en' ? 'Failing pieces' : '不合格件号'}</th></tr>${hundredRows}</table>`
    : ''}

  <h3>${lang === 'en' ? 'Defect Log' : '缺陷记录'} <small>${defects.length} ${lang === 'en' ? 'logged (one row per failed piece)' : '条（每件一行）'}</small></h3>
  ${defects.length
    ? `<table class="grid"><tr><th>${lang === 'en' ? 'Stage' : '阶段'}</th><th>${lang === 'en' ? 'Piece' : '件号'}</th><th>${lang === 'en' ? 'Parameter' : '项目'}</th><th>${lang === 'en' ? 'Type' : '类型'}</th><th>${lang === 'en' ? 'Severity' : '严重度'}</th><th>${lang === 'en' ? 'Value' : '测量值'}</th><th>${lang === 'en' ? 'Photo' : '照片'}</th></tr>${defectRows}</table>`
    : `<div style="color:var(--ink-soft)">${lang === 'en' ? 'No defects logged.' : '暂无缺陷记录。'}</div>`}

  ${insp.summary?.remarks
    ? `<div class="remarks"><div style="font-size:11px;color:var(--ink-soft);margin-bottom:3px">${lang === 'en' ? 'REMARKS · 备注' : '备注 · REMARKS'}</div>${esc(insp.summary.remarks)}</div>`
    : ''}

  ${appendix}
</div>
<div class="foot"><span>CONFIDENTIAL — PROPERTY OF NITRA</span><span>Generated by NITRA QC App</span></div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},500);});</script>
</body></html>`

    w.document.open()
    w.document.write(html)
    w.document.close()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try { w.document.body.innerHTML = '<p style="font-family:Arial;padding:40px;color:#C0392B">Failed to generate report: ' + esc(msg) + '</p>' } catch { /* ignore */ }
  }
}
