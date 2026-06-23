import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { summaryItems } from '../lib/outcome'
import { SECTIONS, MEAS_SECTIONS } from '../lib/standard'

const APPENDIX_SECTION_DEFS: { title: string; keys: string[] }[] = [
  ...SECTIONS.map(s => ({ title: s.title.en, keys: s.items.map(i => i.key) })),
  ...MEAS_SECTIONS.map(ms => ({ title: ms.title.en, keys: ms.cols.map(c => c.key) })),
]
const SECTION_OF: Record<string, string> = {}
for (const s of APPENDIX_SECTION_DEFS) for (const k of s.keys) SECTION_OF[k] = s.title
const APPENDIX_TITLES = [...APPENDIX_SECTION_DEFS.map(s => s.title), 'Other']

interface DefectRow {
  parameter: string
  pieceLabel: string
  mediaUrl: string | null
  mediaType: string | null
}
interface PhotoItem {
  isPass: boolean
  pieceLabel: string
  mediaUrl: string | null
  mediaType: string
  comment: string
}
interface PhotoGroup { key: string; label: string; photos: PhotoItem[] }
interface OutcomeRow {
  parameter: string
  checked: number
  pass: number
  fail: number
  defectPieces: string
  outcome: string
}
interface ReportData {
  ok: boolean
  error?: string
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

const DISPOSITION: Record<string, { text: string; cls: string }> = {
  approved_loading: { text: 'APPROVED FOR LOADING', cls: 'pass' },
  hold_rework: { text: 'HOLD FOR REWORK & REINSPECTION', cls: 'fail' },
  conditional_loading: { text: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', cls: 'hold' },
  conditional_rework: { text: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', cls: 'hold' },
  pending_customer: { text: 'PENDING CUSTOMER APPROVAL', cls: 'hold' },
}
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')
const outcomeColor = (o: string) => (o === '100% Inspection' ? 'var(--fail)' : o.startsWith('Additional') ? 'var(--amber)' : 'var(--pass)')

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReportData | null>(null)
  const [err, setErr] = useState('')
  const [lightbox, setLightbox] = useState<{ url: string; type: string } | null>(null)

  useEffect(() => {
    if (!id) return
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    fetch(`${base}/functions/v1/interactive-report?id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then((d: ReportData) => { if (d.ok) setData(d); else setErr(d.error || 'Report unavailable') })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [id])

  if (err) return <div style={page}><div style={{ ...card, borderColor: 'var(--fail)' }}><h2 style={{ color: 'var(--fail)' }}>Report unavailable</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: 'var(--ink-soft)' }}>Loading report…</p></div>

  const disp = (data.insp.disposition && DISPOSITION[data.insp.disposition]) || { text: 'PENDING DISPOSITION', cls: 'pending' }
  const bannerColor = disp.cls === 'pass' ? '#1F8A4C' : disp.cls === 'fail' ? '#C0392B' : disp.cls === 'pending' ? '#5A6878' : '#B97A14'
  const bannerBg = disp.cls === 'pass' ? '#E3F3EA' : disp.cls === 'fail' ? '#FBE9E7' : disp.cls === 'pending' ? '#EEF1F5' : '#FCF2DD'

  return (
    <div style={{ background: '#F4F7FA', minHeight: '100vh' }}>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {data.logoUrl
          ? <img src={data.logoUrl} alt="logo" style={{ maxHeight: 40, maxWidth: 220 }} />
          : <img src="/logo-white.png" alt="NITRA" style={{ height: 30 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>QC Interactive Report</div>
          <div style={{ color: '#9FB6D4', fontSize: 12 }}>Live report with clickable media evidence</div>
        </div>
      </div>
      <div style={{ background: bannerBg, color: bannerColor, padding: '12px 24px', fontWeight: 800, display: 'flex', justifyContent: 'space-between' }}>
        <span>{disp.text}</span>
        <small style={{ fontWeight: 600 }}>Viewed {new Date().toLocaleString()}</small>
      </div>

      <main style={{ maxWidth: 1100, margin: '22px auto', padding: '0 14px' }}>
        <section style={card}>
          <h2 style={h2}>Inspection Report</h2>
          <table style={metaTable}>
            <tbody>
              <tr><Td k>Part No. / SKU</Td><Td>{data.insp.part_no}</Td><Td k>Finish</Td><Td>{data.sku?.finish || '—'}</Td></tr>
              <tr><Td k>Model / Size</Td><Td>{data.sku?.model || '—'} {data.sku?.size || ''}</Td><Td k>PCD · ET · CB</Td><Td>{data.sku?.pcd || '—'} · {data.sku?.offset_txt || ''} · {data.sku?.cb_mm ?? ''}</Td></tr>
              <tr><Td k>PO No.</Td><Td>{data.insp.po_no || '—'}</Td><Td k>Batch</Td><Td>{data.insp.batch || '—'}</Td></tr>
              <tr><Td k>Lot Size</Td><Td>{data.insp.lot_size} pcs</Td><Td k>Samples</Td><Td>Visual {data.insp.app_sample} / Technical {data.insp.fun_sample}</Td></tr>
              <tr><Td k>Inspector</Td><Td>{data.inspectorName}</Td><Td k>Submitted</Td><Td>{fmt(data.insp.submitted_at)}</Td></tr>
              <tr><Td k>Approved By</Td><Td>{data.reviewerName}</Td><Td k>Approved On</Td><Td>{fmt(data.insp.reviewed_at)}</Td></tr>
            </tbody>
          </table>
        </section>

        <section style={card}>
          <h2 style={h2}>Inspection Findings</h2>
          <ul style={{ marginTop: 0, paddingLeft: 20 }}>
            {summaryItems(data.outcomes).map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
          {data.insp.corrective_action && (
            <div style={{ marginTop: 14 }}>
              <h2 style={h2}>Corrective Action / Disposition</h2>
              <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{data.insp.corrective_action}</p>
            </div>
          )}
        </section>

        <section style={card}>
          <h2 style={h2}>Inspection Evaluation Criteria</h2>
          <p><b>Visual:</b> ≤100 pcs inspect 8; each additional 100 pcs inspect +4. If 1 piece fails for a specific defect, inspect +4 for that defect; if the same defect fails again, conduct 100% inspection. If 2+ pieces fail in the initial sample, conduct 100% inspection immediately.</p>
          <p><b>Technical:</b> ≤100 pcs inspect 4; each additional 100 pcs inspect +2. If 1 piece fails for a specific defect, inspect +2 for that defect; if the same defect fails again, conduct 100% inspection. If 2+ pieces fail in the initial sample, conduct 100% inspection immediately.</p>
          <p style={{ marginBottom: 0 }}>100% inspection applies only to the specific defect/parameter that triggered the rule.</p>
        </section>

        <section style={card}>
          <h2 style={h2}>Inspection Outcome</h2>
          {data.outcomes.length ? (
            <table style={gridTable}>
              <thead><tr><Th>Inspected Parameter</Th><Th>Checked</Th><Th>Pass</Th><Th>Fail</Th><Th>Defect Pieces</Th><Th>Outcome</Th></tr></thead>
              <tbody>
                {data.outcomes.map((o, i) => (
                  <tr key={i}>
                    <Td>{o.parameter}</Td>
                    <Td>{o.checked}</Td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: 'var(--pass)' }}>{o.pass}</td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: o.fail > 0 ? 'var(--fail)' : 'var(--ink-soft)' }}>{o.fail}</td>
                    <Td>{o.defectPieces}</Td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: outcomeColor(o.outcome) }}>{o.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--ink-soft)' }}>No parameters inspected.</p>}
        </section>

        <section style={card}>
          <h2 style={h2}>Photo / Video Appendix</h2>
          {(['pass', 'fail'] as const).map(kind => {
            const pass = kind === 'pass'
            const secs = APPENDIX_TITLES.map(title => {
              const params = data.photoGroups
                .map(g => ({ key: g.key, label: g.label, photos: g.photos.filter(p => p.isPass === pass) }))
                .filter(g => g.photos.length && (SECTION_OF[g.key] || 'Other') === title)
              return { title, params }
            }).filter(s => s.params.length)
            return (
              <div key={kind} style={{ marginBottom: 16 }}>
                <div style={{ background: pass ? 'var(--pass)' : 'var(--fail)', color: '#fff', borderRadius: 8, padding: '7px 13px', fontWeight: 700 }}>
                  {pass ? 'Approved Inspection Photos' : 'Failed Inspection Photos'}
                </div>
                {secs.length ? secs.map(sec => (
                  <div key={sec.title} style={{ marginTop: 10 }}>
                    <h4 style={{ margin: '4px 0', color: 'var(--navy)' }}>{sec.title}</h4>
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
                              ) : <div style={{ width: '100%', height: 110, background: '#EEF1F5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>No media</div>}
                              <figcaption style={{ fontSize: 11, color: 'var(--ink-soft)', padding: 8 }}>
                                <b style={{ color: pass ? 'var(--pass)' : 'var(--fail)' }}>{pass ? 'PASS' : 'FAIL'}</b> · {p.pieceLabel}
                                {p.comment && <><br />{p.comment}</>}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )) : <p style={{ color: 'var(--ink-soft)', marginTop: 8 }}>{pass ? 'No approved photos.' : 'No failed photos.'}</p>}
              </div>
            )
          })}
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

      <div style={{ padding: '10px 24px', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, textAlign: 'center' }}>CONFIDENTIAL — PROPERTY OF NITRA</div>
    </div>
  )
}

const page: React.CSSProperties = { minHeight: '100vh', padding: 24, fontFamily: 'Arial, sans-serif', color: 'var(--ink)' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: '0 4px 14px rgba(31,58,95,.08)' }
const h2: React.CSSProperties = { margin: '0 0 12px', color: 'var(--navy)', fontSize: 18 }
const metaTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const gridTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }

function Td({ children, k }: { children: React.ReactNode; k?: boolean }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, color: k ? 'var(--ink-soft)' : 'var(--ink)', fontSize: k ? 12 : 13, fontWeight: k ? 400 : 700 }}>{children}</td>
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ background: 'var(--navy)', color: '#fff', textAlign: 'left', padding: 9, fontSize: 12 }}>{children}</th>
}
