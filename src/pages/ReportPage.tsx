import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { SECTIONS, MEAS_SECTIONS } from '../lib/standard'

const APPENDIX_SECTION_DEFS: { title: string; keys: string[] }[] = [
  ...SECTIONS.map(s => ({ title: s.title.en, keys: s.items.map(i => i.key) })),
  ...MEAS_SECTIONS.map(ms => ({ title: ms.title.en, keys: ms.cols.map(c => c.key) })),
]
const SECTION_OF: Record<string, string> = {}
for (const s of APPENDIX_SECTION_DEFS) for (const k of s.keys) SECTION_OF[k] = s.title
const APPENDIX_TITLES = [...APPENDIX_SECTION_DEFS.map(s => s.title), 'Other']

interface DefectRow { parameter: string; pieceLabel: string; mediaUrl: string | null; mediaType: string | null }
interface PhotoItem { isPass: boolean; pieceLabel: string; mediaUrl: string | null; mediaType: string; comment: string }
interface PhotoGroup { key: string; label: string; photos: PhotoItem[] }
interface OutcomeRow { parameter: string; checked: number; pass: number; fail: number; defectPieces: string; outcome: string }
interface ReportData {
  ok: boolean
  error?: string
  lang?: string
  translationNote?: string | null
  logoUrl?: string | null
  insp: {
    part_no: string; po_no: string; batch: string; lot_size: number
    app_sample: number; fun_sample: number
    submitted_at: string | null; reviewed_at: string | null
    disposition: string | null; remarks: string; corrective_action: string
  }
  sku: { model: string; size: string; pcd: string; offset_txt: string; cb_mm: number | null; finish: string } | null
  inspectorName: string
  reviewerName: string
  defects: DefectRow[]
  photoGroups: PhotoGroup[]
  outcomes: OutcomeRow[]
}

type Lang = 'en' | 'de' | 'zh'
const LANG_LABELS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' },
]

// Disposition class (colour) is language-independent; the wording is localised below.
const DISPOSITION_CLS: Record<string, string> = {
  approved_loading: 'pass',
  hold_rework: 'hold',
  conditional_loading: 'hold',
  conditional_rework: 'hold',
  pending_customer: 'hold',
}

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'QC Interactive Report', subtitle: 'Live report · clickable photo & video evidence',
    viewed: 'Viewed', finalDisposition: 'FINAL DISPOSITION', pendingDisposition: 'PENDING DISPOSITION',
    inspectionReport: 'Inspection Report',
    partNo: 'Part No. / SKU', finish: 'Finish', modelSize: 'Model / Size', pcdEtCb: 'PCD · ET · CB',
    poNo: 'PO No.', batch: 'Batch', lotSize: 'Lot Size', samples: 'Samples', inspector: 'Inspector',
    submitted: 'Submitted', approvedBy: 'Approved By', approvedOn: 'Approved On',
    pcs: 'pcs', visualWord: 'Visual', technicalWord: 'Technical',
    findings: 'Inspection Findings', corrective: 'Corrective Action / Disposition',
    criteria: 'Inspection Evaluation Criteria',
    sampleSize: 'Sample size', onePieceFails: '1 piece fails', sameDefectAgain: 'Same defect fails again',
    twoPlusFail: '2+ fail in initial sample', pct100: '100% inspection', immediately: 'immediately',
    ruleSampleSize: '≤100 pcs → inspect {b}; +{a} for each additional 100 pcs',
    ruleOneFail: 'inspect +{a} more for that specific defect',
    criteriaNote: '100% inspection applies only to the specific defect / parameter that triggered the rule.',
    outcomeHeading: 'Inspection Outcome',
    thParameter: 'Inspected Parameter', thChecked: 'Checked', thPass: 'Pass', thFail: 'Fail',
    thDefectPieces: 'Defect Pieces', thOutcome: 'Outcome', noParams: 'No parameters inspected.',
    photoHeading: 'Photo / Video Appendix', approvedPhotos: 'Approved Inspection Photos',
    failedPhotos: 'Failed Inspection Photos', noApproved: 'No approved photos.', noFailed: 'No failed photos.',
    appendixHeading: 'Appendix — Additional Photos', noMedia: 'No media',
    passWord: 'PASS', failWord: 'FAIL', confidential: 'CONFIDENTIAL — PROPERTY OF NITRA',
    loadingReport: 'Loading report…', reportUnavailable: 'Report unavailable', translating: 'Translating…',
    txUnavailable: 'Automatic translation is unavailable — some fields are shown in the original language.',
    findRequired100: '{p} — required 100% inspection', findAddPass: '{p} — passed after additional sampling',
    findAllInitial: 'All inspected parameters passed on the initial sample.',
    findAllOther: 'All other inspected parameters passed.',
    out_pass: 'Pass', out_100: '100% Inspection',
    out_addpass: 'Additional Inspection — Pass', out_addreq: 'Additional Inspection Required',
    disp_approved_loading: 'APPROVED FOR LOADING', disp_hold_rework: 'HOLD FOR REWORK & REINSPECTION',
    disp_conditional_loading: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED',
    disp_conditional_rework: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD',
    disp_pending_customer: 'PENDING CUSTOMER APPROVAL',
  },
  de: {
    title: 'Interaktiver QC-Bericht', subtitle: 'Live-Bericht · anklickbare Foto- & Videonachweise',
    viewed: 'Angesehen', finalDisposition: 'ENDGÜLTIGE ENTSCHEIDUNG', pendingDisposition: 'ENTSCHEIDUNG AUSSTEHEND',
    inspectionReport: 'Prüfbericht',
    partNo: 'Teile-Nr. / SKU', finish: 'Oberfläche', modelSize: 'Modell / Größe', pcdEtCb: 'PCD · ET · CB',
    poNo: 'Bestell-Nr.', batch: 'Charge', lotSize: 'Losgröße', samples: 'Stichproben', inspector: 'Prüfer',
    submitted: 'Eingereicht', approvedBy: 'Genehmigt von', approvedOn: 'Genehmigt am',
    pcs: 'Stk.', visualWord: 'Visuell', technicalWord: 'Technisch',
    findings: 'Prüfergebnisse', corrective: 'Korrekturmaßnahme / Entscheidung',
    criteria: 'Bewertungskriterien der Prüfung',
    sampleSize: 'Stichprobengröße', onePieceFails: '1 Teil fällt durch', sameDefectAgain: 'Gleicher Fehler erneut',
    twoPlusFail: '2+ Teile in Erststichprobe durchgefallen', pct100: '100%-Prüfung', immediately: 'sofort',
    ruleSampleSize: '≤100 Stk. → {b} prüfen; +{a} je weitere 100 Stk.',
    ruleOneFail: '+{a} weitere für diesen spezifischen Fehler prüfen',
    criteriaNote: 'Die 100%-Prüfung gilt nur für den spezifischen Fehler / Parameter, der die Regel ausgelöst hat.',
    outcomeHeading: 'Prüfergebnis',
    thParameter: 'Geprüfter Parameter', thChecked: 'Geprüft', thPass: 'Bestanden', thFail: 'Durchgefallen',
    thDefectPieces: 'Fehlerhafte Teile', thOutcome: 'Ergebnis', noParams: 'Keine Parameter geprüft.',
    photoHeading: 'Foto- / Videoanhang', approvedPhotos: 'Freigegebene Prüffotos',
    failedPhotos: 'Fehlerhafte Prüffotos', noApproved: 'Keine freigegebenen Fotos.', noFailed: 'Keine fehlerhaften Fotos.',
    appendixHeading: 'Anhang — Zusätzliche Fotos', noMedia: 'Keine Medien',
    passWord: 'BESTANDEN', failWord: 'DURCHGEFALLEN', confidential: 'VERTRAULICH — EIGENTUM VON NITRA',
    loadingReport: 'Bericht wird geladen …', reportUnavailable: 'Bericht nicht verfügbar', translating: 'Übersetzen …',
    txUnavailable: 'Automatische Übersetzung nicht verfügbar — einige Felder werden im Original angezeigt.',
    findRequired100: '{p} — 100%-Prüfung erforderlich', findAddPass: '{p} — nach zusätzlicher Stichprobe bestanden',
    findAllInitial: 'Alle geprüften Parameter haben die Erststichprobe bestanden.',
    findAllOther: 'Alle übrigen geprüften Parameter bestanden.',
    out_pass: 'Bestanden', out_100: '100%-Prüfung',
    out_addpass: 'Zusätzliche Prüfung — Bestanden', out_addreq: 'Zusätzliche Prüfung erforderlich',
    disp_approved_loading: 'FÜR VERLADUNG FREIGEGEBEN', disp_hold_rework: 'ZURÜCKHALTEN FÜR NACHARBEIT & NACHPRÜFUNG',
    disp_conditional_loading: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE AUSGESCHLOSSEN',
    disp_conditional_rework: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE NACHARBEITEN & VERLADEN',
    disp_pending_customer: 'AUSSTEHENDE KUNDENFREIGABE',
  },
  zh: {
    title: 'QC 互动报告', subtitle: '实时报告 · 可点击的照片和视频证据',
    viewed: '查看时间', finalDisposition: '最终处置', pendingDisposition: '处置待定',
    inspectionReport: '检验报告',
    partNo: '零件号 / SKU', finish: '表面处理', modelSize: '型号 / 尺寸', pcdEtCb: 'PCD · ET · CB',
    poNo: '采购订单号', batch: '批次', lotSize: '批量', samples: '抽样', inspector: '检验员',
    submitted: '提交时间', approvedBy: '审批人', approvedOn: '审批时间',
    pcs: '件', visualWord: '外观', technicalWord: '技术',
    findings: '检验发现', corrective: '纠正措施 / 处置',
    criteria: '检验评估标准',
    sampleSize: '抽样数量', onePieceFails: '1 件不合格', sameDefectAgain: '同一缺陷再次出现',
    twoPlusFail: '初始样本中 2 件及以上不合格', pct100: '全检 (100%)', immediately: '（立即）',
    ruleSampleSize: '≤100 件 → 抽检 {b} 件；每增加 100 件加检 {a} 件',
    ruleOneFail: '针对该特定缺陷加检 {a} 件',
    criteriaNote: '全检仅适用于触发该规则的特定缺陷 / 参数。',
    outcomeHeading: '检验结果',
    thParameter: '检验参数', thChecked: '检验数', thPass: '合格', thFail: '不合格',
    thDefectPieces: '不合格件号', thOutcome: '结果', noParams: '未检验任何参数。',
    photoHeading: '照片 / 视频附录', approvedPhotos: '合格检验照片',
    failedPhotos: '不合格检验照片', noApproved: '无合格照片。', noFailed: '无不合格照片。',
    appendixHeading: '附录 — 补充照片', noMedia: '无媒体',
    passWord: '合格', failWord: '不合格', confidential: '机密 — NITRA 财产',
    loadingReport: '报告加载中…', reportUnavailable: '报告不可用', translating: '翻译中…',
    txUnavailable: '自动翻译不可用 — 部分字段显示原文。',
    findRequired100: '{p} — 需进行全检', findAddPass: '{p} — 加抽样后合格',
    findAllInitial: '所有检验参数在初始样本中均合格。',
    findAllOther: '所有其他检验参数均合格。',
    out_pass: '合格', out_100: '全检 (100%)',
    out_addpass: '加检 — 合格', out_addreq: '需加检',
    disp_approved_loading: '批准装柜', disp_hold_rework: '暂扣返工并重检',
    disp_conditional_loading: '有条件装柜 — 已剔除不合格件',
    disp_conditional_rework: '有条件装柜 — 返工不合格件后装柜',
    disp_pending_customer: '待客户批准',
  },
}

// Photo-appendix section group titles, keyed by their English title.
const SECT: Record<Lang, Record<string, string>> = {
  en: {},
  de: {
    'Wheel Finish & TPMS': 'Radoberfläche & TPMS', 'Cap Finish & Fitment': 'Nabenkappe — Oberfläche & Passung',
    'Marking': 'Kennzeichnung', 'Packing': 'Verpackung', 'Box & Label': 'Karton & Etikett',
    'Wheel Machining': 'Radbearbeitung', 'Wheel OOR': 'Rad-Rundlauf (OOR)', 'Wheel Balance': 'Radwuchtung',
    'Other': 'Sonstiges',
  },
  zh: {
    'Wheel Finish & TPMS': '轮毂表面处理与TPMS', 'Cap Finish & Fitment': '盖子表面处理与配合',
    'Marking': '标识', 'Packing': '包装', 'Box & Label': '纸箱标签',
    'Wheel Machining': '轮毂加工', 'Wheel OOR': '轮毂偏摆', 'Wheel Balance': '轮毂动平衡',
    'Other': '其他',
  },
}

const OUT_KEY: Record<string, string> = {
  'Pass': 'out_pass', '100% Inspection': 'out_100',
  'Additional Inspection — Pass': 'out_addpass', 'Additional Inspection Required': 'out_addreq',
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')
const outcomeColor = (o: string) => (o === '100% Inspection' ? 'var(--fail)' : o.startsWith('Additional') ? 'var(--amber)' : 'var(--pass)')

function buildFindings(rows: OutcomeRow[], L: Record<string, string>): string[] {
  const hundred = rows.filter(x => x.outcome === '100% Inspection')
  const additional = rows.filter(x => x.outcome.startsWith('Additional Inspection — Pass'))
  const items: string[] = []
  for (const r of hundred) items.push(L.findRequired100.replace('{p}', r.parameter))
  for (const r of additional) items.push(L.findAddPass.replace('{p}', r.parameter))
  items.push(!hundred.length && !additional.length ? L.findAllInitial : L.findAllOther)
  return items
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReportData | null>(null)
  const [err, setErr] = useState('')
  const [lang, setLang] = useState<Lang>('en')
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState<{ url: string; type: string } | null>(null)

  useEffect(() => {
    if (!id) return
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    setBusy(true)
    fetch(`${base}/functions/v1/interactive-report?id=${encodeURIComponent(id)}&lang=${lang}`)
      .then(r => r.json())
      .then((d: ReportData) => { if (d.ok) { setData(d); setErr('') } else setErr(d.error || 'Report unavailable') })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }, [id, lang])

  const L = DICT[lang]

  if (err) return <div style={page}><div style={{ ...card, borderColor: 'var(--fail)' }}><h2 style={{ color: 'var(--fail)' }}>{L.reportUnavailable}</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: 'var(--ink-soft)' }}>{L.loadingReport}</p></div>

  const dispCode = data.insp.disposition || ''
  const dispCls = DISPOSITION_CLS[dispCode] || 'pending'
  const dispText = (dispCode && L['disp_' + dispCode]) ? L['disp_' + dispCode] : L.pendingDisposition
  const bannerColor = dispCls === 'pass' ? 'var(--pass)' : dispCls === 'hold' ? 'var(--amber)' : '#5A6878'
  const bannerBg = dispCls === 'pass' ? '#E8F5EC' : dispCls === 'hold' ? '#FCF2DD' : '#EEF1F5'
  const sectTitle = (t: string) => (lang === 'en' ? t : (SECT[lang][t] || t))
  const outLabel = (o: string) => L[OUT_KEY[o]] || o

  return (
    <div style={page}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl
              ? <img src={data.logoUrl} alt="logo" style={{ height: 46, maxWidth: 240, objectFit: 'contain', display: 'block' }} />
              : <img src="/logo-white.png" alt="NITRA" style={{ height: 32 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: .3 }}>{L.title}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.10)', borderRadius: 999, padding: 3 }}>
              {LANG_LABELS.map(o => (
                <button key={o.id} onClick={() => setLang(o.id)} disabled={busy}
                  style={{
                    border: 0, borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
                    background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? 'var(--navy)' : '#CFE0F5',
                  }}>{o.label}</button>
              ))}
            </div>
            <div style={{ color: '#9FB6D4', fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
              {busy ? L.translating : `${L.viewed} ${new Date().toLocaleString()}`}
            </div>
          </div>
        </div>
        <div style={{ background: bannerBg, borderTop: `3px solid ${bannerColor}` }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: bannerColor, flexShrink: 0 }} />
              <span style={{ color: bannerColor, fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>{dispText}</span>
            </div>
            <span style={{ color: bannerColor, opacity: .6, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>{L.finalDisposition}</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '22px auto', padding: '0 14px' }}>
        {data.translationNote && (
          <div style={{ background: '#FCF2DD', border: '1px solid var(--amber)', color: '#7A5200', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
            {L.txUnavailable}
          </div>
        )}

        <section style={card}>
          <h2 style={h2}>{L.inspectionReport}</h2>
          <table style={metaTable}>
            <tbody>
              <tr><Td k>{L.partNo}</Td><Td>{data.insp.part_no}</Td><Td k>{L.finish}</Td><Td>{data.sku?.finish || '—'}</Td></tr>
              <tr><Td k>{L.modelSize}</Td><Td>{data.sku?.model || '—'} {data.sku?.size || ''}</Td><Td k>{L.pcdEtCb}</Td><Td>{data.sku?.pcd || '—'} · {data.sku?.offset_txt || ''} · {data.sku?.cb_mm ?? ''}</Td></tr>
              <tr><Td k>{L.poNo}</Td><Td>{data.insp.po_no || '—'}</Td><Td k>{L.batch}</Td><Td>{data.insp.batch || '—'}</Td></tr>
              <tr><Td k>{L.lotSize}</Td><Td>{data.insp.lot_size} {L.pcs}</Td><Td k>{L.samples}</Td><Td>{L.visualWord} {data.insp.app_sample} / {L.technicalWord} {data.insp.fun_sample}</Td></tr>
              <tr><Td k>{L.inspector}</Td><Td>{data.inspectorName}</Td><Td k>{L.submitted}</Td><Td>{fmt(data.insp.submitted_at)}</Td></tr>
              <tr><Td k>{L.approvedBy}</Td><Td>{data.reviewerName}</Td><Td k>{L.approvedOn}</Td><Td>{fmt(data.insp.reviewed_at)}</Td></tr>
            </tbody>
          </table>
        </section>

        <section style={card}>
          <h2 style={h2}>{L.findings}</h2>
          <ul style={{ marginTop: 0, paddingLeft: 20 }}>
            {buildFindings(data.outcomes, L).map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
          {data.insp.corrective_action && (
            <div style={{ marginTop: 14 }}>
              <h2 style={h2}>{L.corrective}</h2>
              <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{data.insp.corrective_action}</p>
            </div>
          )}
        </section>

        <section style={card}>
          <h2 style={h2}>{L.criteria}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {[{ title: L.visualWord, base: 8, add: 4 }, { title: L.technicalWord, base: 4, add: 2 }].map(c => (
              <div key={c.title} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 14px', fontWeight: 700 }}>{c.title}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <tbody>
                    <tr>
                      <td style={ruleK}>{L.sampleSize}</td>
                      <td style={ruleV} dangerouslySetInnerHTML={{ __html: L.ruleSampleSize.replace('{b}', `<b>${c.base}</b>`).replace('{a}', `<b>${c.add}</b>`) }} />
                    </tr>
                    <tr>
                      <td style={ruleK}>{L.onePieceFails}</td>
                      <td style={ruleV} dangerouslySetInnerHTML={{ __html: L.ruleOneFail.replace('{a}', `<b>${c.add}</b>`) }} />
                    </tr>
                    <tr>
                      <td style={ruleK}>{L.sameDefectAgain}</td>
                      <td style={ruleV}><b style={{ color: 'var(--fail)' }}>{L.pct100}</b></td>
                    </tr>
                    <tr>
                      <td style={{ ...ruleK, borderBottom: 0 }}>{L.twoPlusFail}</td>
                      <td style={{ ...ruleV, borderBottom: 0 }}><b style={{ color: 'var(--fail)' }}>{L.pct100}</b> {L.immediately}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: 'var(--ink-soft)' }}>{L.criteriaNote}</p>
        </section>

        <section style={card}>
          <h2 style={h2}>{L.outcomeHeading}</h2>
          {data.outcomes.length ? (
            <table style={gridTable}>
              <thead><tr><Th>{L.thParameter}</Th><Th>{L.thChecked}</Th><Th>{L.thPass}</Th><Th>{L.thFail}</Th><Th>{L.thDefectPieces}</Th><Th>{L.thOutcome}</Th></tr></thead>
              <tbody>
                {data.outcomes.map((o, i) => (
                  <tr key={i}>
                    <Td>{o.parameter}</Td>
                    <Td>{o.checked}</Td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: 'var(--pass)' }}>{o.pass}</td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: o.fail > 0 ? 'var(--fail)' : 'var(--ink-soft)' }}>{o.fail}</td>
                    <Td>{o.defectPieces}</Td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: outcomeColor(o.outcome) }}>{outLabel(o.outcome)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--ink-soft)' }}>{L.noParams}</p>}
        </section>

        <section style={card}>
          <h2 style={h2}>{L.photoHeading}</h2>
          {(['pass', 'fail'] as const).map(kind => {
            const pass = kind === 'pass'
            const secs = APPENDIX_TITLES.map(title => {
              const params = data.photoGroups
                .map(g => ({ key: g.key, label: g.label, photos: g.photos.filter(p => p.isPass === pass) }))
                .filter(g => g.photos.length && g.key !== 'appendix' && (SECTION_OF[g.key] || 'Other') === title)
              return { title, params }
            }).filter(s => s.params.length)
            return (
              <div key={kind} style={{ marginBottom: 16 }}>
                <div style={{ background: pass ? 'var(--pass)' : 'var(--fail)', color: '#fff', borderRadius: 8, padding: '7px 13px', fontWeight: 700 }}>
                  {pass ? L.approvedPhotos : L.failedPhotos}
                </div>
                {secs.length ? secs.map(sec => (
                  <div key={sec.title} style={{ marginTop: 10 }}>
                    <h4 style={{ margin: '4px 0', color: 'var(--navy)' }}>{sectTitle(sec.title)}</h4>
                    {sec.params.map((pm, pmi) => (
                      <div key={pmi} style={{ marginLeft: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{pm.label}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                          {pm.photos.map((p, pi) => (
                            <figure key={pi} style={{ margin: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                              {p.mediaUrl ? (
                                <button onClick={() => setLightbox({ url: p.mediaUrl!, type: p.mediaType })}
                                  style={{ width: '100%', height: 110, border: 0, background: '#EEF1F5', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {p.mediaType === 'video' ? <span style={{ fontSize: 32, color: 'var(--navy)' }}>▶</span>
                                    : <img src={p.mediaUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                </button>
                              ) : <div style={{ width: '100%', height: 110, background: '#EEF1F5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>{L.noMedia}</div>}
                              <figcaption style={{ fontSize: 11, color: 'var(--ink-soft)', padding: 8 }}>
                                <b style={{ color: pass ? 'var(--pass)' : 'var(--fail)' }}>{pass ? L.passWord : L.failWord}</b> · {p.pieceLabel}
                                {p.comment && <><br />{p.comment}</>}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )) : <p style={{ color: 'var(--ink-soft)', marginTop: 8 }}>{pass ? L.noApproved : L.noFailed}</p>}
              </div>
            )
          })}
          {(() => {
            const appx = data.photoGroups.find(g => g.key === 'appendix')
            if (!appx || !appx.photos.length) return null
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 8, padding: '7px 13px', fontWeight: 700 }}>{L.appendixHeading}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
                  {appx.photos.map((p, pi) => (
                    <figure key={pi} style={{ margin: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                      {p.mediaUrl ? (
                        <button onClick={() => setLightbox({ url: p.mediaUrl!, type: p.mediaType })}
                          style={{ width: '100%', height: 110, border: 0, background: '#EEF1F5', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {p.mediaType === 'video' ? <span style={{ fontSize: 32, color: 'var(--navy)' }}>▶</span>
                            : <img src={p.mediaUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </button>
                      ) : <div style={{ width: '100%', height: 110, background: '#EEF1F5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>{L.noMedia}</div>}
                      {p.comment && <figcaption style={{ fontSize: 11, color: 'var(--ink-soft)', padding: 8 }}>{p.comment}</figcaption>}
                    </figure>
                  ))}
                </div>
              </div>
            )
          })()}
        </section>
      </main>

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.86)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <button onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 16, right: 20, background: '#fff', border: 0, borderRadius: 999, width: 42, height: 42, fontSize: 28, cursor: 'pointer' }}>×</button>
          {lightbox.type === 'video'
            ? <video src={lightbox.url} controls autoPlay style={{ maxWidth: '96vw', maxHeight: '90vh', borderRadius: 10, background: '#000' }} onClick={e => e.stopPropagation()} />
            : <img src={lightbox.url} style={{ maxWidth: '96vw', maxHeight: '90vh', borderRadius: 10 }} onClick={e => e.stopPropagation()} />}
        </div>
      )}

      <div style={{ padding: '10px 24px', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, textAlign: 'center' }}>{L.confidential}</div>
    </div>
  )
}

const page: React.CSSProperties = { minHeight: '100vh', padding: 24, fontFamily: 'Arial, sans-serif', color: 'var(--ink)' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: '0 4px 14px rgba(31,58,95,.08)' }
const h2: React.CSSProperties = { margin: '0 0 12px', color: 'var(--navy)', fontSize: 18 }
const metaTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const gridTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const ruleK: React.CSSProperties = { padding: '9px 14px', fontWeight: 600, color: 'var(--ink-soft)', verticalAlign: 'top', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }
const ruleV: React.CSSProperties = { padding: '9px 14px', borderBottom: '1px solid var(--line)' }

function Td({ children, k }: { children: React.ReactNode; k?: boolean }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, color: k ? 'var(--ink-soft)' : 'var(--ink)', fontSize: k ? 12 : 13, fontWeight: k ? 400 : 700 }}>{children}</td>
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ background: 'var(--navy)', color: '#fff', textAlign: 'left', padding: 9, fontSize: 12 }}>{children}</th>
}
