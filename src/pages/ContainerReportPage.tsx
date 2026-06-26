import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

type Lang = 'en' | 'de' | 'zh'
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' }]

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Container Loading Report', subtitle: 'Live report · clickable photo & video evidence', viewed: 'Viewed',
    details: 'Shipping & Container Details', po: 'PO No.', container: 'Container No.', seal: 'Seal No.', bl: 'BL Number',
    loadingType: 'Loading Type', pallets: 'Pallets', dateLoaded: 'Date Loaded', etd: 'Est. Port Departure',
    eta: 'Est. Port Arrival', depPort: 'Departure Port', destPort: 'Destination Port', inspector: 'Inspector',
    approver: 'Approved By', contents: 'Loaded Contents', packing: 'Pallet Packing Inspection', pallet: 'Pallet',
    photos: 'Photo / Video Appendix', pass: 'Pass', fail: 'Fail', na: 'N/A',
    partNumber: 'Part Number', model: 'Model', size: 'Size', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Color', qty: 'Qty Loaded',
    statusLoaded: 'LOADED', statusInProgress: 'IN PROGRESS', statusHold: 'HOLD', statusUnset: 'IN PROGRESS', statusTag: 'CONTAINER STATUS',
    palletType: 'Palletised', nonPalletType: 'Non-palletised', noPhotos: 'No photos uploaded.', loading: 'Loading report…',
    txUnavailable: 'Automatic translation is unavailable — some fields are shown in the original language.',
  },
  de: {
    title: 'Containerverladebericht', subtitle: 'Live-Bericht · anklickbare Foto- & Videonachweise', viewed: 'Angesehen',
    details: 'Versand- & Containerdetails', po: 'Bestell-Nr.', container: 'Container-Nr.', seal: 'Siegel-Nr.', bl: 'BL-Nummer',
    loadingType: 'Verladeart', pallets: 'Paletten', dateLoaded: 'Verladedatum', etd: 'Vorauss. Hafenabfahrt',
    eta: 'Vorauss. Hafenankunft', depPort: 'Abfahrtshafen', destPort: 'Zielhafen', inspector: 'Prüfer',
    approver: 'Genehmigt von', contents: 'Geladener Inhalt', packing: 'Palettenverpackungsprüfung', pallet: 'Palette',
    photos: 'Foto- / Video-Anhang', pass: 'i.O.', fail: 'n.i.O.', na: 'k.A.',
    partNumber: 'Teilenummer', model: 'Modell', size: 'Größe', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Farbe', qty: 'Geladene Menge',
    statusLoaded: 'GELADEN', statusInProgress: 'IN BEARBEITUNG', statusHold: 'ZURÜCKGEHALTEN', statusTag: 'CONTAINERSTATUS',
    palletType: 'Palettiert', nonPalletType: 'Nicht palettiert', noPhotos: 'Keine Fotos hochgeladen.', loading: 'Bericht wird geladen…',
    txUnavailable: 'Automatische Übersetzung nicht verfügbar — einige Felder erscheinen in der Originalsprache.',
  },
  zh: {
    title: '集装箱装柜报告', subtitle: '实时报告 · 可点击照片与视频证据', viewed: '查看时间',
    details: '运输与集装箱信息', po: '订单号', container: '集装箱号', seal: '封条号', bl: '提单号',
    loadingType: '装柜方式', pallets: '托盘数', dateLoaded: '装柜日期', etd: '预计离港',
    eta: '预计到港', depPort: '起运港', destPort: '目的港', inspector: '检验员',
    approver: '批准人', contents: '装载内容', packing: '托盘包装检验', pallet: '托盘',
    photos: '照片 / 视频附录', pass: '合格', fail: '不合格', na: '不适用',
    partNumber: '产品编号', model: '型号', size: '尺寸', pcd: 'PCD', cb: 'CB', et: 'ET', color: '颜色', qty: '装载数量',
    statusLoaded: '已装柜', statusInProgress: '进行中', statusHold: '暂扣', statusTag: '集装箱状态',
    palletType: '托盘装', nonPalletType: '非托盘装', noPhotos: '暂无照片。', loading: '正在加载报告…',
    txUnavailable: '自动翻译不可用 — 部分内容以原文显示。',
  },
}

function statusInfo(s: string, L: Record<string, string>) {
  if (s === 'loaded') return { text: L.statusLoaded, color: 'var(--pass)', bg: '#E8F5EC' }
  if (s === 'hold') return { text: L.statusHold, color: 'var(--fail)', bg: '#FBE9E7' }
  return { text: L.statusInProgress, color: 'var(--amber)', bg: '#FCF2DD' }
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

  if (err) return <div style={page}><div style={{ ...card, borderColor: 'var(--fail)' }}><h2 style={{ color: 'var(--fail)' }}>Report unavailable</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: 'var(--ink-soft)', padding: 20 }}>{L.loading}</p></div>

  const c = data.container
  const st = statusInfo(c.status, L)

  return (
    <div style={page}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl ? <img src={data.logoUrl} alt="logo" style={{ height: 46, maxWidth: 240, objectFit: 'contain', display: 'block' }} /> : <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>NITRA</span>}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: .3 }}>{L.title}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{c.container_no || ''} · {L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.12)', borderRadius: 999, padding: 3 }}>
              {LANGS.map(o => (
                <button key={o.id} onClick={() => setLang(o.id)} style={{ border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? 'var(--navy)' : '#CFE0F5' }}>{o.label}</button>
              ))}
            </div>
            <div style={{ color: '#9FB6D4', fontSize: 11.5, whiteSpace: 'nowrap' }}>{L.viewed} {new Date().toLocaleString()}</div>
          </div>
        </div>
        <div style={{ background: st.bg, borderTop: `3px solid ${st.color}` }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: st.color, flexShrink: 0 }} />
              <span style={{ color: st.color, fontWeight: 800, fontSize: 15 }}>{st.text}</span>
            </div>
            <span style={{ color: st.color, opacity: .6, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>{L.statusTag}</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '22px auto', padding: '0 14px' }}>
        {data.translationNote && (
          <div style={{ background: '#FCF2DD', border: '1px solid var(--amber)', color: '#7A5200', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{L.txUnavailable}</div>
        )}

        <section style={card}>
          <h2 style={h2}>{L.details}</h2>
          <table style={metaTable}><tbody>
            <tr><Td k>{L.po}</Td><Td>{c.po_no || '—'}</Td><Td k>{L.container}</Td><Td>{c.container_no || '—'}</Td></tr>
            <tr><Td k>{L.seal}</Td><Td>{c.seal_no || '—'}</Td><Td k>{L.bl}</Td><Td>{c.bl_no || '—'}</Td></tr>
            <tr><Td k>{L.loadingType}</Td><Td>{c.loading_type === 'pallet' ? `${L.palletType} (${c.pallet_count})` : L.nonPalletType}</Td><Td k>{L.dateLoaded}</Td><Td>{fmtDate(c.date_loaded)}</Td></tr>
            <tr><Td k>{L.etd}</Td><Td>{fmtDate(c.etd)}</Td><Td k>{L.eta}</Td><Td>{fmtDate(c.eta)}</Td></tr>
            <tr><Td k>{L.depPort}</Td><Td>{c.dep_port || '—'}</Td><Td k>{L.destPort}</Td><Td>{c.dest_port || '—'}</Td></tr>
            <tr><Td k>{L.inspector}</Td><Td>{c.inspectorName || '—'}</Td><Td k>{L.approver}</Td><Td>{c.reviewerName || '—'}</Td></tr>
          </tbody></table>
        </section>

        {data.contents?.length > 0 && (
          <section style={card}>
            <h2 style={h2}>{L.contents}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={gridTable}>
                <thead><tr>{[L.partNumber, L.model, L.size, L.pcd, L.cb, L.et, L.color, L.qty].map(t => <Th key={t}>{t}</Th>)}</tr></thead>
                <tbody>
                  {data.contents.map((raw: any, i: number) => {
                    const r = typeof raw === 'string' ? { part_no: raw, model: '', size: '', pcd: '', cb: '', et: '', color: '', qty: '' } : raw
                    return (
                      <tr key={i}>
                        <Td>{r.part_no}</Td><Td2>{r.model || '—'}</Td2><Td2>{r.size || '—'}</Td2><Td2>{r.pcd || '—'}</Td2>
                        <Td2>{r.cb !== '' && r.cb != null ? r.cb : '—'}</Td2><Td2>{r.et || '—'}</Td2><Td2>{r.color || '—'}</Td2>
                        <Td2 b>{r.qty}</Td2>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data.pallets?.length > 0 && (
          <section style={card}>
            <h2 style={h2}>{L.packing}</h2>
            {data.pallets.map((pl: any) => (
              <div key={pl.n} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>{L.pallet} {pl.n}{pl.failCount > 0 && <span style={{ color: 'var(--fail)', fontSize: 12, marginLeft: 8 }}>● {pl.failCount} {L.fail}</span>}</div>
                {pl.checks?.length ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}><tbody>
                    {pl.checks.map((ck: any, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: '7px 8px', borderBottom: '1px solid #EEF1F5' }}>{ck.label}</td>
                        <td style={{ padding: '7px 8px', borderBottom: '1px solid #EEF1F5', textAlign: 'right', fontWeight: 700, color: ck.value === 'F' ? 'var(--fail)' : ck.value === 'P' ? 'var(--pass)' : 'var(--ink-soft)' }}>
                          {ck.value === 'P' ? L.pass : ck.value === 'F' ? L.fail : L.na}</td></tr>
                    ))}
                  </tbody></table>
                ) : <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>—</span>}
              </div>
            ))}
          </section>
        )}

        <section style={card}>
          <h2 style={h2}>{L.photos}</h2>
          {data.photoGroups?.length ? data.photoGroups.map((g: any) => (
            <div key={g.key} style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '4px 0', color: 'var(--navy)' }}>{g.label}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {g.photos.map((p: any, i: number) => (
                  <figure key={i} style={fig}>
                    <a href={p.url || '#'} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                      {p.url ? (p.mediaType === 'video' ? <div style={{ ...imgS, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#EEF1F5' }}><span style={{ fontSize: 32, color: 'var(--navy)' }}>▶</span></div> : <img src={p.url} style={imgS} />) : <div style={{ ...imgS, background: '#EEF1F5' }} />}
                    </a>
                    {p.comment ? <figcaption style={cap}>{p.comment}</figcaption> : null}
                  </figure>
                ))}
              </div>
            </div>
          )) : <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{L.noPhotos}</p>}
        </section>

        <div style={{ textAlign: 'center', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, padding: '14px 0' }}>CONFIDENTIAL — PROPERTY OF NITRA</div>
      </main>
    </div>
  )
}

const page: React.CSSProperties = { minHeight: '100vh', fontFamily: 'Arial, sans-serif', color: 'var(--ink)', background: '#F4F7FA' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: '0 4px 14px rgba(31,58,95,.08)' }
const h2: React.CSSProperties = { margin: '0 0 12px', color: 'var(--navy)', fontSize: 18 }
const metaTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const gridTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const fig: React.CSSProperties = { margin: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }
const imgS: React.CSSProperties = { width: '100%', height: 110, objectFit: 'cover', display: 'block' }
const cap: React.CSSProperties = { fontSize: 11, color: 'var(--ink-soft)', padding: 6 }

function Td({ children, k }: { children: React.ReactNode; k?: boolean }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, color: k ? 'var(--ink-soft)' : 'var(--ink)', fontSize: k ? 12 : 13, fontWeight: k ? 400 : 700, whiteSpace: k ? 'nowrap' : 'normal' }}>{children}</td>
}
function Td2({ children, b }: { children: React.ReactNode; b?: boolean }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, color: 'var(--ink)', fontSize: 13, fontWeight: b ? 700 : 400 }}>{children}</td>
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ background: 'var(--navy)', color: '#fff', textAlign: 'left', padding: 9, fontSize: 12, whiteSpace: 'nowrap' }}>{children}</th>
}
