import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { openPoReport } from '../lib/report'

type Lang = 'en' | 'de' | 'zh'
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' }]

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Consolidated PO Report', subtitle: 'All container loadings & wheel inspections for this PO', viewed: 'Viewed',
    containersH: 'Container Loadings', wheelInsp: 'Wheel Inspections',
    container: 'Container No.', bl: 'BL Number', etd: 'Est. Port Departure', eta: 'Est. Port Arrival', destPort: 'Destination Port',
    partNo: 'Part Number', size: 'Size', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Color', disposition: 'Disposition',
    noSkus: 'No wheel inspections in this PO.', noConts: 'No container loadings in this PO.',
    pendingDisp: 'PENDING DISPOSITION', email: 'Email', pdf: 'PDF', loading: 'Loading consolidated report…',
  },
  de: {
    title: 'Konsolidierter Bestellbericht', subtitle: 'Alle Containerverladungen & Radprüfungen dieser Bestellung', viewed: 'Angesehen',
    containersH: 'Containerverladungen', wheelInsp: 'Radprüfungen',
    container: 'Container-Nr.', bl: 'BL-Nummer', etd: 'Vorauss. Hafenabfahrt', eta: 'Vorauss. Hafenankunft', destPort: 'Zielhafen',
    partNo: 'Teilenummer', size: 'Größe', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Farbe', disposition: 'Entscheidung',
    noSkus: 'Keine Radprüfungen in dieser Bestellung.', noConts: 'Keine Containerverladungen in dieser Bestellung.',
    pendingDisp: 'AUSSTEHENDE ENTSCHEIDUNG', email: 'E-Mail', pdf: 'PDF', loading: 'Konsolidierter Bericht wird geladen…',
  },
  zh: {
    title: '订单综合报告', subtitle: '本订单的所有集装箱装柜与轮毂检验', viewed: '查看时间',
    containersH: '集装箱装柜', wheelInsp: '轮毂检验',
    container: '集装箱号', bl: '提单号', etd: '预计离港', eta: '预计到港', destPort: '目的港',
    partNo: '产品编号', size: '尺寸', pcd: 'PCD', cb: 'CB', et: 'ET', color: '颜色', disposition: '处置',
    noSkus: '本订单暂无轮毂检验。', noConts: '本订单暂无集装箱装柜。',
    pendingDisp: '待定处置', email: '邮件', pdf: 'PDF', loading: '正在加载综合报告…',
  },
}

const DISP: Record<string, Record<Lang, string>> = {
  approved_loading: { en: 'APPROVED FOR LOADING', de: 'FÜR VERLADUNG FREIGEGEBEN', zh: '批准装柜' },
  hold_rework: { en: 'HOLD FOR REWORK & REINSPECTION', de: 'ZURÜCKHALTEN FÜR NACHARBEIT & NACHPRÜFUNG', zh: '暂扣返工并重检' },
  conditional_loading: { en: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE AUSGESCHLOSSEN', zh: '有条件装柜 — 已剔除不合格件' },
  conditional_rework: { en: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE NACHARBEITEN & VERLADEN', zh: '有条件装柜 — 返工不合格件后装柜' },
  pending_customer: { en: 'PENDING CUSTOMER APPROVAL', de: 'AUSSTEHENDE KUNDENFREIGABE', zh: '待客户批准' },
}
const DISP_CLS: Record<string, string> = { approved_loading: 'pass', hold_rework: 'hold', conditional_loading: 'hold', conditional_rework: 'hold', pending_customer: 'hold' }
const clsColor = (c: string) => c === 'pass' ? 'var(--pass)' : c === 'hold' ? 'var(--amber)' : c === 'reject' ? 'var(--fail)' : '#5A6878'
const clsBg = (c: string) => c === 'pass' ? '#E8F5EC' : c === 'hold' ? '#FCF2DD' : c === 'reject' ? '#FBE9E7' : '#EEF1F5'

function dispOf(insp: any, lang: Lang, L: Record<string, string>) {
  const code = insp?.disposition || ''
  if (code === 'custom') return { text: insp?.disposition_custom || L.pendingDisp, cls: insp?.disposition_cls || 'pending' }
  if (code && DISP[code]) return { text: DISP[code][lang], cls: DISP_CLS[code] || 'pending' }
  return { text: L.pendingDisp, cls: 'pending' }
}
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString() : '—'

export default function PoReportPage() {
  const { po: poParam } = useParams<{ po: string }>()
  const po = decodeURIComponent(poParam || '')
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [emailing, setEmailing] = useState(false)
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

  const emailReport = async () => {
    const raw = window.prompt('Email this consolidated PO report to (comma-separated):', 'kyong@nitrawheels.com')
    if (raw === null) return
    const emails = raw.split(',').map(s => s.trim()).filter(Boolean)
    if (!emails.length) { alert('No recipients entered.'); return }
    setEmailing(true)
    const { error } = await supabase.functions.invoke('send-po-report', { body: { po, emails } })
    setEmailing(false)
    if (error) { alert('Email failed: ' + error.message); return }
    alert('Consolidated PO report link sent.')
  }

  if (err) return <div style={page}><div style={{ ...card, borderColor: 'var(--fail)' }}><h2 style={{ color: 'var(--fail)' }}>Report unavailable</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: 'var(--ink-soft)', padding: 20 }}>{L.loading}</p></div>

  return (
    <div style={page}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl ? <img src={data.logoUrl} alt="logo" style={{ height: 46, maxWidth: 240, objectFit: 'contain', display: 'block' }} /> : <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>NITRA</span>}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: .3 }}>{L.title} · {po}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.12)', borderRadius: 999, padding: 3 }}>
              {LANGS.map(o => (
                <button key={o.id} onClick={() => setLang(o.id)} style={{ border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? 'var(--navy)' : '#CFE0F5' }}>{o.label}</button>
              ))}
            </div>
            <button onClick={() => openPoReport(po, lang)} style={hdrBtn}>{L.pdf}</button>
            <button onClick={emailReport} disabled={emailing} style={{ ...hdrBtn, opacity: emailing ? .6 : 1 }}>{L.email}</button>
          </div>
        </div>
        <div style={{ height: 4, background: 'var(--amber)' }} />
      </header>

      <main style={{ maxWidth: 1100, margin: '22px auto', padding: '0 14px' }}>
        <section style={card}>
          <h2 style={h2}>{L.containersH}</h2>
          {containers.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}>
                <thead><tr>{[L.container, L.bl, L.etd, L.eta, L.destPort].map(t => <Th key={t}>{t}</Th>)}</tr></thead>
                <tbody>
                  {containers.map((c, i) => (
                    <tr key={i}>
                      <Td><a href={`/container-report/${c.id}`} target="_blank" rel="noreferrer" style={link}>{c.container_no || `#${i + 1}`}</a></Td>
                      <Td2>{c.bl_no || '—'}</Td2><Td2>{fmtDate(c.etd)}</Td2><Td2>{fmtDate(c.eta)}</Td2><Td2>{c.dest_port || '—'}</Td2>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p style={muted}>{L.noConts}</p>}
        </section>

        <section style={card}>
          <h2 style={h2}>{L.wheelInsp}</h2>
          {skus.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}>
                <thead><tr>{[L.partNo, L.size, L.pcd, L.cb, L.et, L.color, L.disposition].map(t => <Th key={t}>{t}</Th>)}</tr></thead>
                <tbody>
                  {skus.map((s, i) => {
                    const d = dispOf(s.insp, lang, L)
                    return (
                      <tr key={i}>
                        <Td><a href={`/report/${s.id}`} target="_blank" rel="noreferrer" style={link}>{s.insp?.part_no || `SKU ${i + 1}`}</a></Td>
                        <Td2>{s.sku?.size || '—'}</Td2><Td2>{s.sku?.pcd || '—'}</Td2><Td2>{s.sku?.cb_mm ?? '—'}</Td2>
                        <Td2>{s.sku?.offset_txt || '—'}</Td2><Td2>{s.sku?.finish || '—'}</Td2>
                        <Td2><span style={{ ...pill, background: clsBg(d.cls), color: clsColor(d.cls) }}>{d.text}</span></Td2>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p style={muted}>{L.noSkus}</p>}
        </section>

        <div style={{ textAlign: 'center', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, padding: '14px 0' }}>CONFIDENTIAL — PROPERTY OF NITRA</div>
      </main>
    </div>
  )
}

const page: React.CSSProperties = { minHeight: '100vh', fontFamily: 'Arial, sans-serif', color: 'var(--ink)', background: '#F4F7FA' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: '0 4px 14px rgba(31,58,95,.08)' }
const h2: React.CSSProperties = { margin: '0 0 12px', color: 'var(--navy)', fontSize: 18 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const muted: React.CSSProperties = { color: 'var(--ink-soft)', fontSize: 13 }
const pill: React.CSSProperties = { display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }
const link: React.CSSProperties = { color: 'var(--navy)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }
const hdrBtn: React.CSSProperties = { border: '1px solid rgba(255,255,255,.3)', background: 'rgba(255,255,255,.12)', color: '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 9, fontSize: 13, fontWeight: 700 }}>{children}</td>
}
function Td2({ children }: { children: React.ReactNode }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 9, fontSize: 13 }}>{children}</td>
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ background: 'var(--navy)', color: '#fff', textAlign: 'left', padding: 9, fontSize: 12, whiteSpace: 'nowrap' }}>{children}</th>
}
