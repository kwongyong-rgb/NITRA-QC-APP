import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'

// Customer dashboard (Phase 3). RLS scopes every query server-side: a customer
// can only read their assigned POs, and only APPROVED inspections/loadings of
// those POs — so this page simply queries and renders. Report links go to the
// public consolidated report page (no login required there).
// Languages: English / German / Canadian French.

type CLang = 'en' | 'de' | 'fr'
const DICT: Record<CLang, Record<string, string>> = {
  en: {
    myPos: 'My Purchase Orders', greeting: 'Welcome', signOut: 'Sign out',
    po: 'PO Number', date: 'PO Date', dest: 'Destination', skus: 'SKUs',
    status: 'Inspection Status', disp: 'Final Decision', report: 'Report',
    open: 'Open report', copy: 'Copy link', copied: 'Link copied', none: 'No purchase orders have been assigned to your account yet. Please contact your NITRA representative.',
    pending: 'Pending Inspection', inprog: 'Inspection In Progress', approved: 'Approved',
    loading: 'Loading…',
  },
  de: {
    myPos: 'Meine Bestellungen', greeting: 'Willkommen', signOut: 'Abmelden',
    po: 'Bestellnummer', date: 'Bestelldatum', dest: 'Zielort', skus: 'SKUs',
    status: 'Prüfstatus', disp: 'Endgültige Entscheidung', report: 'Bericht',
    open: 'Bericht öffnen', copy: 'Link kopieren', copied: 'Link kopiert', none: 'Ihrem Konto wurden noch keine Bestellungen zugewiesen. Bitte kontaktieren Sie Ihren NITRA-Ansprechpartner.',
    pending: 'Prüfung ausstehend', inprog: 'Prüfung läuft', approved: 'Freigegeben',
    loading: 'Wird geladen…',
  },
  fr: {
    myPos: 'Mes bons de commande', greeting: 'Bienvenue', signOut: 'Se déconnecter',
    po: 'Nº de commande', date: 'Date de commande', dest: 'Destination', skus: 'SKU',
    status: 'État de l’inspection', disp: 'Décision finale', report: 'Rapport',
    open: 'Ouvrir le rapport', copy: 'Copier le lien', copied: 'Lien copié', none: 'Aucun bon de commande n’a encore été attribué à votre compte. Veuillez contacter votre représentant NITRA.',
    pending: 'Inspection à venir', inprog: 'Inspection en cours', approved: 'Approuvé',
    loading: 'Chargement…',
  },
}

// Disposition display (matches the app's canonical dispositions)
const DISP: Record<string, Record<CLang, string>> = {
  approved_loading: { en: 'APPROVED FOR LOADING', de: 'FÜR VERLADUNG FREIGEGEBEN', fr: 'APPROUVÉ POUR LE CHARGEMENT' },
  hold_rework: { en: 'HOLD FOR REWORK & REINSPECTION', de: 'ZURÜCKHALTEN FÜR NACHARBEIT & NACHPRÜFUNG', fr: 'EN ATTENTE — REPRISE ET RÉINSPECTION' },
  conditional_loading: { en: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE AUSGESCHLOSSEN', fr: 'CHARGEMENT CONDITIONNEL — PIÈCES NON CONFORMES EXCLUES' },
  conditional_rework: { en: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', de: 'BEDINGTE VERLADUNG — TEILE NACHARBEITEN & VERLADEN', fr: 'CHARGEMENT CONDITIONNEL — REPRISE DES PIÈCES PUIS CHARGEMENT' },
  pending_customer: { en: 'PENDING CUSTOMER APPROVAL', de: 'AUSSTEHENDE KUNDENFREIGABE', fr: 'EN ATTENTE D’APPROBATION DU CLIENT' },
}

interface PoRow { id: string; po_no: string; po_date: string | null; destination: string | null }
interface Row extends PoRow { totalSkus: number; approvedInsp: number; disposition: string | null; dispositionCustom: string | null }

export default function CustomerHome({ profile }: { profile: Profile }) {
  const [lang, setLang] = useState<CLang>(() => (localStorage.getItem('nitra_cust_lang') as CLang) || 'en')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [narrow, setNarrow] = useState(window.innerWidth < 720)
  const [copiedPo, setCopiedPo] = useState('')
  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth < 720)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  const copyLink = async (poNo: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/po-report/${encodeURIComponent(poNo)}`)
      setCopiedPo(poNo); setTimeout(() => setCopiedPo(''), 2000)
    } catch { /* ignore */ }
  }
  const L = DICT[lang]

  const pick = (l: CLang) => { setLang(l); localStorage.setItem('nitra_cust_lang', l) }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      // RLS already scopes all three queries to this customer's assigned POs
      // (and to approved rows only, for inspections/loadings).
      const [{ data: pos }, { data: items }, { data: insp }, { data: conts }] = await Promise.all([
        supabase.from('pos').select('id,po_no,po_date,destination').order('po_date', { ascending: false }),
        supabase.from('po_items').select('po_id'),
        supabase.from('inspections').select('po_no,status,updated_at'),
        supabase.from('container_loadings').select('po_no,insp_status,summary,updated_at'),
      ])
      const itemCount = new Map<string, number>()
      for (const it of (items as { po_id: string }[]) || []) itemCount.set(it.po_id, (itemCount.get(it.po_id) || 0) + 1)
      const inspByPo = new Map<string, number>()
      for (const r of (insp as { po_no: string }[]) || []) inspByPo.set(r.po_no, (inspByPo.get(r.po_no) || 0) + 1)
      // Latest approved container disposition per PO (the loading decision is
      // the customer-facing final outcome).
      const dispByPo = new Map<string, { code: string | null; custom: string | null; at: string }>()
      for (const c of (conts as { po_no: string; summary: any; updated_at: string }[]) || []) {
        const cur = dispByPo.get(c.po_no)
        if (!cur || c.updated_at > cur.at) {
          dispByPo.set(c.po_no, { code: c.summary?.disposition || null, custom: c.summary?.disposition_custom || null, at: c.updated_at })
        }
      }
      const out: Row[] = ((pos as PoRow[]) || []).map(p => ({
        ...p,
        totalSkus: itemCount.get(p.id) || 0,
        approvedInsp: inspByPo.get(p.po_no) || 0,
        disposition: dispByPo.get(p.po_no)?.code || null,
        dispositionCustom: dispByPo.get(p.po_no)?.custom || null,
      }))
      setRows(out)
      setLoading(false)
    }
    load()
  }, [])

  const statusOf = (r: Row) => {
    if (r.disposition || r.dispositionCustom) return L.approved
    if (r.approvedInsp > 0) return `${L.inprog} (${r.approvedInsp}${r.totalSkus ? '/' + r.totalSkus : ''})`
    return L.pending
  }
  const dispOf = (r: Row) => r.dispositionCustom || (r.disposition && DISP[r.disposition] ? DISP[r.disposition][lang] : '—')
  const fmtDate = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-CA' : lang === 'de' ? 'de-DE' : 'fr-CA') : '—'

  return (
    <>
      <header className="topbar">
        <img src="/logo-white.png" alt="NITRA" />
        <span className="title">QC Inspection</span>
        <nav className="topbar-nav open" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {(['en', 'de', 'fr'] as CLang[]).map(l => (
            <button key={l} style={lang === l ? { fontWeight: 800, textDecoration: 'underline' } : undefined}
              onClick={() => pick(l)}>{l.toUpperCase()}</button>
          ))}
          <button onClick={async () => { await supabase.auth.signOut(); location.href = '/' }}>{L.signOut}</button>
        </nav>
      </header>
      <div className="page">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{L.greeting}, {profile.full_name}</h2>
          <h3 style={{ marginBottom: 8 }}>{L.myPos}</h3>
          {loading && <p className="muted">{L.loading}</p>}
          {!loading && rows.length === 0 && <p className="muted">{L.none}</p>}
          {!loading && rows.length > 0 && narrow && (
            <div>
              {rows.map(r => (
                <div key={r.id} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{r.po_no}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{fmtDate(r.po_date)}{r.destination ? ` · ${r.destination}` : ''}{r.totalSkus ? ` · ${r.totalSkus} ${L.skus}` : ''}</div>
                  <div style={{ marginTop: 6, fontSize: 14 }}><b>{L.status}:</b> {statusOf(r)}</div>
                  <div style={{ marginTop: 2, fontSize: 14 }}><b>{L.disp}:</b> {dispOf(r)}</div>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <a href={`/po-report/${encodeURIComponent(r.po_no)}`} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                      <button className="btn" style={{ width: '100%', minHeight: 44 }}>{L.open}</button>
                    </a>
                    <button className="btn ghost" style={{ minHeight: 44 }} onClick={() => copyLink(r.po_no)}>{copiedPo === r.po_no ? '✓ ' + L.copied : L.copy}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && rows.length > 0 && !narrow && (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>{L.po}</th><th>{L.date}</th><th>{L.dest}</th>
                  <th>{L.skus}</th><th>{L.status}</th><th style={{ textAlign: 'left' }}>{L.disp}</th><th>{L.report}</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700 }}>{r.po_no}</td>
                      <td style={{ textAlign: 'center' }}>{fmtDate(r.po_date)}</td>
                      <td style={{ textAlign: 'center' }}>{r.destination || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{r.totalSkus || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{statusOf(r)}</td>
                      <td>{dispOf(r)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                          <a href={`/po-report/${encodeURIComponent(r.po_no)}`} target="_blank" rel="noreferrer">
                            <button className="btn ghost" style={{ minHeight: 34, padding: '4px 10px', fontSize: 13 }}>{L.open}</button>
                          </a>
                          <button className="btn ghost" style={{ minHeight: 34, padding: '4px 10px', fontSize: 13 }} onClick={() => copyLink(r.po_no)}>{copiedPo === r.po_no ? '✓' : L.copy}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
