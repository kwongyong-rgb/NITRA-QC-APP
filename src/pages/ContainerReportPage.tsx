import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

type Lang = 'en' | 'de' | 'zh'
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' }]

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Container Loading Report', subtitle: 'Live report · clickable photo & video evidence',
    details: 'Shipping & Container Details', po: 'PO No.', container: 'Container No.', seal: 'Seal No.', bl: 'BL Number',
    loadingType: 'Loading type', pallets: 'Pallets', dateLoaded: 'Date Loaded', etd: 'Est. Port Departure',
    eta: 'Est. Port Arrival', depPort: 'Departure Port', destPort: 'Destination Port', inspector: 'Inspector',
    approver: 'Approved By', contents: 'Loaded Contents', packing: 'Pallet Packing Inspection', pallet: 'Pallet',
    photos: 'Photo / Video Evidence', pass: 'Pass', fail: 'Fail', na: 'N/A', viewed: 'Viewed',
    statusApproved: 'APPROVED', statusSubmitted: 'PENDING APPROVAL', statusDraft: 'DRAFT', statusRejected: 'RETURNED',
    palletType: 'Palletised', nonPalletType: 'Non-palletised', noPhotos: 'No photos uploaded.', loading: 'Loading report…',
  },
  de: {
    title: 'Containerverladebericht', subtitle: 'Live-Bericht · anklickbare Foto- & Videonachweise',
    details: 'Versand- & Containerdetails', po: 'Bestell-Nr.', container: 'Container-Nr.', seal: 'Siegel-Nr.', bl: 'BL-Nummer',
    loadingType: 'Verladeart', pallets: 'Paletten', dateLoaded: 'Verladedatum', etd: 'Vorauss. Hafenabfahrt',
    eta: 'Vorauss. Hafenankunft', depPort: 'Abfahrtshafen', destPort: 'Zielhafen', inspector: 'Prüfer',
    approver: 'Genehmigt von', contents: 'Geladener Inhalt', packing: 'Palettenverpackungsprüfung', pallet: 'Palette',
    photos: 'Foto- / Videonachweis', pass: 'i.O.', fail: 'n.i.O.', na: 'k.A.', viewed: 'Angesehen',
    statusApproved: 'GENEHMIGT', statusSubmitted: 'AUSSTEHENDE GENEHMIGUNG', statusDraft: 'ENTWURF', statusRejected: 'ZURÜCKGEGEBEN',
    palletType: 'Palettiert', nonPalletType: 'Nicht palettiert', noPhotos: 'Keine Fotos hochgeladen.', loading: 'Bericht wird geladen…',
  },
  zh: {
    title: '集装箱装柜报告', subtitle: '实时报告 · 可点击照片与视频证据',
    details: '运输与集装箱信息', po: '订单号', container: '集装箱号', seal: '封条号', bl: '提单号',
    loadingType: '装柜方式', pallets: '托盘数', dateLoaded: '装柜日期', etd: '预计离港',
    eta: '预计到港', depPort: '起运港', destPort: '目的港', inspector: '检验员',
    approver: '批准人', contents: '装载内容', packing: '托盘包装检验', pallet: '托盘',
    photos: '照片 / 视频证据', pass: '合格', fail: '不合格', na: '不适用', viewed: '查看时间',
    statusApproved: '已批准', statusSubmitted: '待批准', statusDraft: '草稿', statusRejected: '已退回',
    palletType: '托盘装', nonPalletType: '非托盘装', noPhotos: '暂无照片。', loading: '正在加载报告…',
  },
}

function statusInfo(s: string, L: Record<string, string>) {
  if (s === 'approved') return { text: L.statusApproved, color: '#1F8A4C', bg: '#E8F5EC' }
  if (s === 'submitted') return { text: L.statusSubmitted, color: '#B7791F', bg: '#FCF2DD' }
  if (s === 'rejected') return { text: L.statusRejected, color: '#C0392B', bg: '#FBE9E7' }
  return { text: L.statusDraft, color: '#5A6878', bg: '#EEF1F5' }
}
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString() : '—'

export default function ContainerReportPage() {
  const { id } = useParams<{ id: string }>()
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const L = DICT[lang]

  useEffect(() => {
    setData(null); setErr('')
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    fetch(`${base}/functions/v1/container-report?id=${id}&lang=${lang}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error || 'Report unavailable') })
      .catch(e => setErr(String(e)))
  }, [id, lang])

  if (err) return <div style={page}><div style={{ ...card, borderColor: '#C0392B' }}><h2 style={{ color: '#C0392B' }}>Report unavailable</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: '#5A6878', padding: 20 }}>{L.loading}</p></div>

  const c = data.container
  const st = statusInfo(c.insp_status, L)
  const rows: [string, string][] = [
    [L.po, c.po_no || '—'], [L.container, c.container_no || '—'], [L.seal, c.seal_no || '—'], [L.bl, c.bl_no || '—'],
    [L.loadingType, c.loading_type === 'pallet' ? `${L.palletType} (${c.pallet_count})` : L.nonPalletType],
    [L.dateLoaded, fmtDate(c.date_loaded)], [L.etd, fmtDate(c.etd)], [L.eta, fmtDate(c.eta)],
    [L.depPort, c.dep_port || '—'], [L.destPort, c.dest_port || '—'],
    [L.inspector, c.inspectorName || '—'], [L.approver, c.reviewerName || '—'],
  ]

  return (
    <div style={page}>
      <header style={{ background: '#1F3A5F', color: '#fff' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl ? <img src={data.logoUrl} alt="logo" style={{ height: 42, maxWidth: 220, objectFit: 'contain' }} /> : <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>NITRA</span>}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>📦 {L.title}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{c.container_no || ''} · {L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.12)', borderRadius: 999, padding: 3 }}>
            {LANGS.map(o => (
              <button key={o.id} onClick={() => setLang(o.id)} style={{ border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? '#1F3A5F' : '#CFE0F5' }}>{o.label}</button>
            ))}
          </div>
        </div>
        <div style={{ background: st.bg, borderTop: `3px solid ${st.color}` }}>
          <div style={{ maxWidth: 1000, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: st.color }} />
            <span style={{ color: st.color, fontWeight: 800, fontSize: 15 }}>{st.text}</span>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
        <section style={card}>
          <h2 style={h2}>{L.details}</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}><tbody>
            {rows.map(([k, v], i) => (
              <tr key={i}><td style={{ padding: '8px 10px', color: '#5A6878', fontWeight: 600, width: '42%', borderBottom: '1px solid #EAEFF4' }}>{k}</td>
                <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #EAEFF4' }}>{v}</td></tr>
            ))}
          </tbody></table>
        </section>

        {data.contents?.length > 0 && (
          <section style={card}>
            <h2 style={h2}>{L.contents}</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{data.contents.map((x: string, i: number) => <li key={i} style={{ marginBottom: 3 }}>{x}</li>)}</ul>
          </section>
        )}

        {data.pallets?.length > 0 && (
          <section style={card}>
            <h2 style={h2}>{L.packing}</h2>
            {data.pallets.map((pl: any) => (
              <div key={pl.n} style={{ border: '1px solid #D5DBE4', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: '#1F3A5F', marginBottom: 6 }}>{L.pallet} {pl.n}{pl.failCount > 0 && <span style={{ color: '#C0392B', fontSize: 12, marginLeft: 8 }}>● {pl.failCount} {L.fail}</span>}</div>
                {pl.checks?.length ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}><tbody>
                    {pl.checks.map((ck: any, i: number) => (
                      <tr key={i}><td style={{ padding: '6px 8px', borderBottom: '1px solid #EAEFF4' }}>{ck.label}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #EAEFF4', textAlign: 'right', fontWeight: 700, color: ck.value === 'F' ? '#C0392B' : ck.value === 'P' ? '#1F8A4C' : '#5A6878' }}>
                          {ck.value === 'P' ? L.pass : ck.value === 'F' ? L.fail : L.na}</td></tr>
                    ))}
                  </tbody></table>
                ) : <span style={{ color: '#5A6878', fontSize: 13 }}>—</span>}
              </div>
            ))}
          </section>
        )}

        <section style={card}>
          <h2 style={h2}>{L.photos}</h2>
          {data.photoGroups?.length ? data.photoGroups.map((g: any) => (
            <div key={g.key} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: '#1F3A5F', fontSize: 14, marginBottom: 6 }}>{g.label}</div>
              <div style={grid}>
                {g.photos.map((p: any, i: number) => (
                  <figure key={i} style={fig}>
                    {p.url ? (p.mediaType === 'video' ? <video src={p.url} controls style={imgS} /> : <img src={p.url} style={imgS} />) : <div style={{ ...imgS, background: '#EEF1F5' }} />}
                    <figcaption style={cap}><b style={{ color: p.isPass ? '#1F8A4C' : '#C0392B' }}>{p.isPass ? L.pass : L.fail}</b>{p.pieceNo ? ` · #${p.pieceNo}` : ''}{p.comment ? ` · ${p.comment}` : ''}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )) : <p style={{ color: '#5A6878', fontSize: 13 }}>{L.noPhotos}</p>}
        </section>

        <div style={{ textAlign: 'center', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, padding: '14px 0' }}>CONFIDENTIAL — PROPERTY OF NITRA</div>
      </div>
    </div>
  )
}

const page: React.CSSProperties = { background: '#F4F7FA', minHeight: '100vh', color: '#18222E', fontFamily: 'system-ui, -apple-system, Arial, sans-serif' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #D5DBE4', borderRadius: 12, padding: 18, marginBottom: 14 }
const h2: React.CSSProperties = { margin: '0 0 10px', fontSize: 18, color: '#1F3A5F' }
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }
const fig: React.CSSProperties = { margin: 0, border: '1px solid #D5DBE4', borderRadius: 10, overflow: 'hidden', background: '#fff' }
const imgS: React.CSSProperties = { width: '100%', height: 110, objectFit: 'cover', display: 'block' }
const cap: React.CSSProperties = { fontSize: 11, color: '#5A6878', padding: 6 }
