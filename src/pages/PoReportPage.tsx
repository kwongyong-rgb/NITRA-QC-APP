import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

type Lang = 'en' | 'de' | 'zh'
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' }]

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Consolidated PO Report', subtitle: 'All wheel inspections & container loadings for this PO',
    overview: 'Overview', jumpTo: 'Jump to', wheelInsp: 'Wheel Inspections', containersH: 'Container Loadings',
    partNo: 'Part No. / SKU', modelSize: 'Model / Size', disposition: 'Disposition', status: 'Status',
    findings: 'Inspection Findings', corrective: 'Corrective Action / Disposition', outcome: 'Inspection Outcome',
    parameter: 'Parameter', checked: 'Checked', pass: 'Pass', fail: 'Fail', pieces: 'Failing pieces',
    outcomeCol: 'Outcome', photos: 'Photo / Video Evidence', loadingType: 'Loading type', pallets: 'Pallets',
    contents: 'Loaded contents', seal: 'Seal', container: 'Container', noSkus: 'No wheel inspections in this PO.',
    noConts: 'No container loadings in this PO.', viewed: 'Viewed', pendingDisp: 'PENDING DISPOSITION',
    expand: 'Tap to expand', collapse: 'Collapse', defects: 'Failing pieces', checksOk: 'Packing checks passed',
    checksFail: 'Packing checks failed', palletType: 'Palletised', nonPalletType: 'Non-palletised',
    outPass: 'Pass', out100: '100% Inspection', outAddPass: 'Additional Inspection — Pass', outAddReq: 'Additional Inspection Required',
    allPassed: 'All other inspected parameters passed.', loading: 'Loading consolidated report…',
  },
  de: {
    title: 'Konsolidierter Bestellbericht', subtitle: 'Alle Radprüfungen & Containerverladungen dieser Bestellung',
    overview: 'Übersicht', jumpTo: 'Springe zu', wheelInsp: 'Radprüfungen', containersH: 'Containerverladungen',
    partNo: 'Teile-Nr. / SKU', modelSize: 'Modell / Größe', disposition: 'Entscheidung', status: 'Status',
    findings: 'Prüfergebnisse', corrective: 'Korrekturmaßnahme / Entscheidung', outcome: 'Prüfergebnis',
    parameter: 'Parameter', checked: 'Geprüft', pass: 'i.O.', fail: 'n.i.O.', pieces: 'Fehlerhafte Teile',
    outcomeCol: 'Ergebnis', photos: 'Foto- / Videonachweis', loadingType: 'Verladeart', pallets: 'Paletten',
    contents: 'Geladener Inhalt', seal: 'Siegel', container: 'Container', noSkus: 'Keine Radprüfungen in dieser Bestellung.',
    noConts: 'Keine Containerverladungen in dieser Bestellung.', viewed: 'Angesehen', pendingDisp: 'AUSSTEHENDE ENTSCHEIDUNG',
    expand: 'Zum Aufklappen tippen', collapse: 'Einklappen', defects: 'Fehlerhafte Teile', checksOk: 'Verpackungsprüfungen bestanden',
    checksFail: 'Verpackungsprüfungen nicht bestanden', palletType: 'Palettiert', nonPalletType: 'Nicht palettiert',
    outPass: 'Bestanden', out100: '100%-Prüfung', outAddPass: 'Zusatzprüfung — Bestanden', outAddReq: 'Zusatzprüfung erforderlich',
    allPassed: 'Alle übrigen geprüften Parameter bestanden.', loading: 'Konsolidierter Bericht wird geladen…',
  },
  zh: {
    title: '订单综合报告', subtitle: '本订单的所有轮毂检验与集装箱装柜',
    overview: '概览', jumpTo: '跳转至', wheelInsp: '轮毂检验', containersH: '集装箱装柜',
    partNo: '产品编号 / SKU', modelSize: '型号 / 尺寸', disposition: '处置', status: '状态',
    findings: '检验结果', corrective: '纠正措施 / 处置', outcome: '检验结果',
    parameter: '项目', checked: '已检', pass: '合格', fail: '不合格', pieces: '不合格件号',
    outcomeCol: '结果', photos: '照片 / 视频证据', loadingType: '装柜方式', pallets: '托盘',
    contents: '装载内容', seal: '封条', container: '集装箱', noSkus: '本订单暂无轮毂检验。',
    noConts: '本订单暂无集装箱装柜。', viewed: '查看时间', pendingDisp: '待定处置',
    expand: '点击展开', collapse: '收起', defects: '不合格件号', checksOk: '包装检查合格',
    checksFail: '包装检查不合格', palletType: '托盘装', nonPalletType: '非托盘装',
    outPass: '合格', out100: '全检', outAddPass: '加检 — 合格', outAddReq: '需加检',
    allPassed: '其余已检项目均合格。', loading: '正在加载综合报告…',
  },
}

const DISP: Record<string, Record<Lang, string>> = {
  approved_loading: { en: 'APPROVED FOR LOADING', de: 'FÜR VERLADUNG FREIGEGEBEN', zh: '批准装柜' },
  hold_rework: { en: 'HOLD FOR REWORK & REINSPECTION', de: 'ZURÜCKHALTEN FÜR NACHARBEIT & NACHPRÜFUNG', zh: '暂扣返工并重检' },
  conditional_loading: { en: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE AUSGESCHLOSSEN', zh: '有条件装柜 — 已剔除不合格件' },
  conditional_rework: { en: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE NACHARBEITEN & VERLADEN', zh: '有条件装柜 — 返工不合格件后装柜' },
  pending_customer: { en: 'PENDING CUSTOMER APPROVAL', de: 'AUSSTEHENDE KUNDENFREIGABE', zh: '待客户批准' },
}
const DISP_CLS: Record<string, string> = {
  approved_loading: 'pass', hold_rework: 'hold', conditional_loading: 'hold', conditional_rework: 'hold', pending_customer: 'hold',
}
const clsColor = (c: string) => c === 'pass' ? '#1F8A4C' : c === 'hold' ? '#B7791F' : c === 'reject' ? '#C0392B' : '#5A6878'
const clsBg = (c: string) => c === 'pass' ? '#E8F5EC' : c === 'hold' ? '#FCF2DD' : c === 'reject' ? '#FBE9E7' : '#EEF1F5'

function dispOf(insp: any, lang: Lang, L: Record<string, string>) {
  const code = insp?.disposition || ''
  if (code === 'custom') return { text: insp?.disposition_custom || L.pendingDisp, cls: insp?.disposition_cls || 'pending' }
  if (code && DISP[code]) return { text: DISP[code][lang], cls: DISP_CLS[code] || 'pending' }
  return { text: L.pendingDisp, cls: 'pending' }
}

const OUT_MAP: Record<string, string> = {
  'Pass': 'outPass', '100% Inspection': 'out100',
  'Additional Inspection — Pass': 'outAddPass', 'Additional Inspection Required': 'outAddReq',
}
const outLabel = (o: string, L: Record<string, string>) => L[OUT_MAP[o]] || o
const outColor = (o: string) => o === '100% Inspection' ? '#C0392B' : o.startsWith('Additional Inspection Required') ? '#B7791F' : o.startsWith('Additional') ? '#B7791F' : '#1F8A4C'

function buildFindings(outcomes: any[], L: Record<string, string>): string[] {
  if (!outcomes?.length) return []
  const notes: string[] = []
  let anyPass = false
  for (const o of outcomes) {
    if (o.outcome === 'Pass') { anyPass = true; continue }
    notes.push(`${o.parameter} — ${outLabel(o.outcome, L)}`)
  }
  if (anyPass) notes.push(L.allPassed)
  return notes
}

function sanitizeHtml(input: string): string {
  if (!input) return ''
  const html = /<(\/?)(b|i|u|p|ul|ol|li|br|strong|em|span|div)\b/i.test(input)
    ? input
    : input.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)).replace(/\n/g, '<br>')
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'UL', 'OL', 'LI', 'BR', 'SPAN', 'DIV'])
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstChild as HTMLElement
  const walk = (node: Element) => {
    Array.from(node.children).forEach(child => {
      if (!allowed.has(child.tagName)) { child.replaceWith(doc.createTextNode(child.textContent || '')); return }
      Array.from(child.attributes).forEach(a => child.removeAttribute(a.name))
      walk(child)
    })
  }
  walk(root)
  return root.innerHTML
}

export default function PoReportPage() {
  const { po: poParam } = useParams<{ po: string }>()
  const po = decodeURIComponent(poParam || '')
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const L = DICT[lang]

  useEffect(() => {
    setData(null); setErr('')
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    fetch(`${base}/functions/v1/po-report?po=${encodeURIComponent(po)}&lang=${lang}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error || 'Report unavailable') })
      .catch(e => setErr(String(e)))
  }, [po, lang])

  const skus: any[] = data?.skus || []
  const containers: any[] = data?.containers || []
  const toggle = (id: string) => setOpen(o => ({ ...o, [id]: !o[id] }))

  const navItems = useMemo(() => ([
    { id: 'overview', label: L.overview },
    ...skus.map((s, i) => ({ id: `sku-${i}`, label: s.insp?.part_no || `SKU ${i + 1}` })),
    ...containers.map((c, i) => ({ id: `cont-${i}`, label: c.container_no || `${L.container} ${i + 1}` })),
  ]), [skus, containers, L])

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (err) return <div style={page}><div style={{ ...card, borderColor: '#C0392B' }}><h2 style={{ color: '#C0392B' }}>Report unavailable</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: '#5A6878', padding: 20 }}>{L.loading}</p></div>

  return (
    <div style={page}>
      <style>{`.rich-body p{margin:0 0 8px}.rich-body ul,.rich-body ol{margin:0 0 8px;padding-left:22px}.rich-body li{margin:2px 0}.rich-body u{text-decoration:underline}`}</style>

      <header style={{ background: '#1F3A5F', color: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl
              ? <img src={data.logoUrl} alt="logo" style={{ height: 42, maxWidth: 220, objectFit: 'contain' }} />
              : <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>NITRA</span>}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{L.title} · {po}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.12)', borderRadius: 999, padding: 3 }}>
            {LANGS.map(o => (
              <button key={o.id} onClick={() => setLang(o.id)}
                style={{ border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                  background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? '#1F3A5F' : '#CFE0F5' }}>{o.label}</button>
            ))}
          </div>
        </div>
        {/* sticky jump nav */}
        <div style={{ background: '#16314F', borderTop: '1px solid rgba(255,255,255,.1)' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 16px', display: 'flex', gap: 8, overflowX: 'auto' }}>
            <span style={{ color: '#9FB6D4', fontSize: 12, alignSelf: 'center', whiteSpace: 'nowrap' }}>{L.jumpTo}:</span>
            {navItems.map(n => (
              <button key={n.id} onClick={() => jump(n.id)}
                style={{ border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: '#CFE0F5', borderRadius: 999,
                  padding: '4px 11px', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>{n.label}</button>
            ))}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
        {/* OVERVIEW */}
        <section id="overview" style={card}>
          <h2 style={h2}>{L.overview}</h2>
          <p style={{ color: '#5A6878', marginTop: 0, fontSize: 13 }}>{skus.length} {L.wheelInsp.toLowerCase()} · {containers.length} {L.containersH.toLowerCase()}</p>

          <h3 style={h3}>{L.wheelInsp}</h3>
          {skus.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}><thead><tr>{[L.partNo, L.modelSize, L.disposition, L.defects].map(t => <th key={t} style={th}>{t}</th>)}</tr></thead>
                <tbody>
                  {skus.map((s, i) => {
                    const d = dispOf(s.insp, lang, L)
                    return (
                      <tr key={i}>
                        <td style={td}><a onClick={() => jump(`sku-${i}`)} style={link}>{s.insp?.part_no || '—'}</a></td>
                        <td style={td}>{s.sku ? `${s.sku.model || '—'} · ${s.sku.size || ''}` : '—'}</td>
                        <td style={td}><span style={{ ...pill, background: clsBg(d.cls), color: clsColor(d.cls) }}>{d.text}</span></td>
                        <td style={{ ...td, color: (s.defectCount || 0) > 0 ? '#C0392B' : '#1F8A4C', fontWeight: 700 }}>{s.defectCount ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p style={muted}>{L.noSkus}</p>}

          <h3 style={h3}>{L.containersH}</h3>
          {containers.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}><thead><tr>{[L.container, L.seal, L.disposition, L.status].map(t => <th key={t} style={th}>{t}</th>)}</tr></thead>
                <tbody>
                  {containers.map((c, i) => {
                    const d = dispOf(c, lang, L)
                    return (
                      <tr key={i}>
                        <td style={td}><a onClick={() => jump(`cont-${i}`)} style={link}>{c.container_no || `${L.container} ${i + 1}`}</a></td>
                        <td style={td}>{c.seal_no || '—'}</td>
                        <td style={td}><span style={{ ...pill, background: clsBg(d.cls), color: clsColor(d.cls) }}>{d.text}</span></td>
                        <td style={td}>{c.insp_status || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p style={muted}>{L.noConts}</p>}
        </section>

        {/* SKU SECTIONS */}
        {skus.map((s, i) => {
          const d = dispOf(s.insp, lang, L)
          const id = `sku-${i}`; const isOpen = !!open[id]
          const findings = buildFindings(s.outcomes || [], L)
          return (
            <section id={id} key={id} style={card}>
              <button onClick={() => toggle(id)} style={secHead}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: '#5A6878' }}>▶</span>
                  <span style={{ fontWeight: 800, fontSize: 16 }}>{s.insp?.part_no || `SKU ${i + 1}`}</span>
                  <span style={{ ...pill, background: clsBg(d.cls), color: clsColor(d.cls) }}>{d.text}</span>
                </span>
                <span style={{ color: '#5A6878', fontSize: 12, whiteSpace: 'nowrap' }}>{isOpen ? L.collapse : L.expand}</span>
              </button>

              {isOpen && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ color: '#5A6878', fontSize: 13, marginTop: 0 }}>
                    {s.sku ? `${s.sku.model || '—'} · ${s.sku.size || ''} · ${s.sku.finish || ''}` : ''}
                  </p>
                  {findings.length > 0 && <>
                    <h3 style={h3}>{L.findings}</h3>
                    <ul style={{ marginTop: 0, paddingLeft: 20 }}>{findings.map((f, k) => <li key={k} style={{ marginBottom: 4 }}>{f}</li>)}</ul>
                  </>}
                  {s.insp?.corrective_action && <>
                    <h3 style={h3}>{L.corrective}</h3>
                    <div className="rich-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.insp.corrective_action) }} />
                  </>}
                  {(s.outcomes?.length > 0) && <>
                    <h3 style={h3}>{L.outcome}</h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={tbl}><thead><tr>{[L.parameter, L.checked, L.pass, L.fail, L.pieces, L.outcomeCol].map(t => <th key={t} style={th}>{t}</th>)}</tr></thead>
                        <tbody>
                          {s.outcomes.map((o: any, k: number) => (
                            <tr key={k}>
                              <td style={td}>{o.parameter}</td>
                              <td style={tdC}>{o.checked}</td>
                              <td style={{ ...tdC, color: '#1F8A4C', fontWeight: 700 }}>{o.pass}</td>
                              <td style={{ ...tdC, color: o.fail > 0 ? '#C0392B' : '#5A6878', fontWeight: 700 }}>{o.fail}</td>
                              <td style={tdC}>{o.defectPieces}</td>
                              <td style={{ ...td, color: outColor(o.outcome), fontWeight: 700 }}>{outLabel(o.outcome, L)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>}
                  <PhotoBlock groups={s.photoGroups || []} title={L.photos} pass={L.pass} fail={L.fail} />
                </div>
              )}
            </section>
          )
        })}

        {/* CONTAINER SECTIONS */}
        {containers.map((c, i) => {
          const d = dispOf(c, lang, L)
          const id = `cont-${i}`; const isOpen = !!open[id]
          return (
            <section id={id} key={id} style={card}>
              <button onClick={() => toggle(id)} style={secHead}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: '#5A6878' }}>▶</span>
                  <span style={{ fontWeight: 800, fontSize: 16 }}>📦 {c.container_no || `${L.container} ${i + 1}`}</span>
                  <span style={{ ...pill, background: clsBg(d.cls), color: clsColor(d.cls) }}>{d.text}</span>
                </span>
                <span style={{ color: '#5A6878', fontSize: 12, whiteSpace: 'nowrap' }}>{isOpen ? L.collapse : L.expand}</span>
              </button>
              {isOpen && (
                <div style={{ marginTop: 14 }}>
                  <table style={{ ...tbl, marginBottom: 12 }}><tbody>
                    <tr><td style={tdK}>{L.seal}</td><td style={td}>{c.seal_no || '—'}</td></tr>
                    <tr><td style={tdK}>{L.loadingType}</td><td style={td}>{c.loading_type === 'pallet' ? `${L.palletType} (${c.pallet_count} ${L.pallets})` : L.nonPalletType}</td></tr>
                    <tr><td style={tdK}>{L.checksOk} / {L.checksFail}</td><td style={td}><b style={{ color: '#1F8A4C' }}>{c.checkPass}</b> / <b style={{ color: c.checkFail > 0 ? '#C0392B' : '#5A6878' }}>{c.checkFail}</b>{c.failedChecks?.length ? ` — ${c.failedChecks.join(', ')}` : ''}</td></tr>
                  </tbody></table>
                  {c.contents?.length > 0 && <>
                    <h3 style={h3}>{L.contents}</h3>
                    <ul style={{ marginTop: 0, paddingLeft: 20 }}>{c.contents.map((x: string, k: number) => <li key={k} style={{ marginBottom: 2 }}>{x}</li>)}</ul>
                  </>}
                  {c.corrective_action && <>
                    <h3 style={h3}>{L.corrective}</h3>
                    <div className="rich-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(c.corrective_action) }} />
                  </>}
                  {c.photos?.length > 0 && <>
                    <h3 style={h3}>{L.photos}</h3>
                    <div style={grid}>
                      {c.photos.map((p: any, k: number) => (
                        <figure key={k} style={fig}>
                          {p.url ? (p.mediaType === 'video'
                            ? <video src={p.url} controls style={imgS} />
                            : <img src={p.url} style={imgS} />) : <div style={{ ...imgS, background: '#EEF1F5' }} />}
                          <figcaption style={cap}><b style={{ color: p.isPass ? '#1F8A4C' : '#C0392B' }}>{p.isPass ? L.pass : L.fail}</b>{p.comment ? ` · ${p.comment}` : ''}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </>}
                </div>
              )}
            </section>
          )
        })}

        <div style={{ textAlign: 'center', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, padding: '14px 0' }}>CONFIDENTIAL — PROPERTY OF NITRA</div>
      </div>
    </div>
  )
}

function PhotoBlock({ groups, title, pass, fail }: { groups: any[]; title: string; pass: string; fail: string }) {
  const all = groups.flatMap(g => (g.photos || []).map((p: any) => ({ ...p, group: g.label })))
  if (!all.length) return null
  return (
    <>
      <h3 style={h3}>{title}</h3>
      <div style={grid}>
        {all.map((p: any, k: number) => (
          <figure key={k} style={fig}>
            {p.mediaUrl ? (p.mediaType === 'video'
              ? <video src={p.mediaUrl} controls style={imgS} />
              : <img src={p.mediaUrl} style={imgS} />) : <div style={{ ...imgS, background: '#EEF1F5' }} />}
            <figcaption style={cap}><b style={{ color: p.isPass ? '#1F8A4C' : '#C0392B' }}>{p.isPass ? pass : fail}</b>{p.pieceLabel ? ` · ${p.pieceLabel}` : ''}{p.comment ? ` · ${p.comment}` : ''}</figcaption>
          </figure>
        ))}
      </div>
    </>
  )
}

const page: React.CSSProperties = { background: '#F4F7FA', minHeight: '100vh', color: '#18222E', fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #D5DBE4', borderRadius: 12, padding: 18, marginBottom: 14 }
const h2: React.CSSProperties = { margin: '0 0 10px', fontSize: 18, color: '#1F3A5F' }
const h3: React.CSSProperties = { margin: '16px 0 6px', fontSize: 14, color: '#1F3A5F' }
const secHead: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'transparent', border: 0, cursor: 'pointer', padding: 0, textAlign: 'left' }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', background: '#F1F5FA', color: '#5A6878', fontWeight: 700, borderBottom: '1px solid #D5DBE4', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #EAEFF4', verticalAlign: 'top' }
const tdC: React.CSSProperties = { ...td, textAlign: 'center' }
const tdK: React.CSSProperties = { ...td, color: '#5A6878', fontWeight: 600, whiteSpace: 'nowrap', width: '36%' }
const muted: React.CSSProperties = { color: '#5A6878', fontSize: 13 }
const pill: React.CSSProperties = { display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }
const link: React.CSSProperties = { color: '#1F3A5F', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }
const fig: React.CSSProperties = { margin: 0, border: '1px solid #D5DBE4', borderRadius: 10, overflow: 'hidden', background: '#fff' }
const imgS: React.CSSProperties = { width: '100%', height: 100, objectFit: 'cover', display: 'block' }
const cap: React.CSSProperties = { fontSize: 11, color: '#5A6878', padding: 6 }
