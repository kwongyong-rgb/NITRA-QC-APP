import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'
import * as XLSX from 'xlsx'

// PO master info + ordered items for the PO detail page (Phase 1).
// - Info card: customer / date / destination, editable by admin.
// - Items card: part numbers with ordered vs loaded vs remaining quantities.
//   Loaded is computed from confirmed container-loading contents for this PO.
// - Excel upload (admin): flexible header matching -> review screen -> save.

interface PoRow { id: string; po_no: string; customer_name: string | null; po_date: string | null; destination: string | null }
interface Item { id?: string; part_no: string; qty_ordered: number }
interface ReviewRow { part_no: string; qty: string; ok: boolean; note: string }

const HDR_PART = ['part number', 'part no', 'part no.', 'partnumber', 'part', 'sku', 'part_no', 'item', 'item no', 'part#', 'p/n']
const HDR_QTY = ['qty', 'quantity', 'qty ordered', 'ordered qty', 'order qty', 'pcs', 'amount', 'qty_ordered']

export default function PoInfo({ po, profile, refreshKey }: { po: string; profile: Profile; refreshKey?: number }) {
  const [row, setRow] = useState<PoRow | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loadedQty, setLoadedQty] = useState<Record<string, number>>({})
  const [editInfo, setEditInfo] = useState<{ customer_name: string; po_date: string; destination: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [review, setReview] = useState<ReviewRow[] | null>(null)
  const [addItem, setAddItem] = useState<{ part_no: string; qty: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const isApprover = profile.role === 'admin'

  const load = useCallback(async () => {
    setErr('')
    // PO master row — create lazily if missing (covers POs typed before Phase 1).
    let { data: p } = await supabase.from('pos').select('*').eq('po_no', po).maybeSingle()
    if (!p && isApprover && po.trim() !== '') {
      const ins = await supabase.from('pos').insert({ po_no: po }).select('*').single()
      if (!ins.error) p = ins.data
    }
    setRow((p as PoRow) || null)
    if (p) {
      const { data: it } = await supabase.from('po_items').select('id,part_no,qty_ordered').eq('po_id', (p as PoRow).id).order('part_no')
      setItems((it as Item[]) || [])
    } else setItems([])
    // Loaded quantities: sum confirmed container-loading contents for this PO.
    const { data: conts } = await supabase.from('container_loadings').select('data').eq('po_no', po)
    const sums: Record<string, number> = {}
    for (const c of (conts as { data: any }[]) || []) {
      const d = c.data || {}
      if ((d.loading_type || 'pallet') === 'pallet') {
        for (const pd of Object.values(d.pallets || {})) {
          for (const ct of ((pd as any).contents || [])) {
            if (ct.part_no) sums[ct.part_no] = (sums[ct.part_no] || 0) + (Number(ct.qty) || 0)
          }
        }
      } else {
        for (const ct of (d.non_pallet_contents || [])) {
          if (ct.part_no) sums[ct.part_no] = (sums[ct.part_no] || 0) + (Number(ct.qty) || 0)
        }
      }
    }
    setLoadedQty(sums)
  }, [po, isApprover])
  useEffect(() => { load() }, [load, refreshKey])

  const saveInfo = async () => {
    if (!row || !editInfo) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('pos').update({
      customer_name: editInfo.customer_name.trim() || null,
      po_date: editInfo.po_date || null,
      destination: editInfo.destination.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setEditInfo(null); load()
  }

  const saveNewItem = async () => {
    if (!row || !addItem) return
    const part = addItem.part_no.trim()
    const qty = parseInt(addItem.qty, 10)
    if (!part) { setErr('Part number is required.'); return }
    if (!Number.isFinite(qty) || qty < 0) { setErr('Quantity must be a number.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('po_items').upsert({ po_id: row.id, part_no: part, qty_ordered: qty }, { onConflict: 'po_id,part_no' })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setAddItem(null); load()
  }

  const updateQty = async (it: Item, v: string) => {
    const qty = parseInt(v, 10)
    if (!Number.isFinite(qty) || qty < 0 || !it.id) return
    const { error } = await supabase.from('po_items').update({ qty_ordered: qty }).eq('id', it.id)
    if (error) setErr(error.message); else load()
  }

  const removeItem = async (it: Item) => {
    if (!it.id) return
    if (!confirm(`Remove ${it.part_no} from this PO's order list?\n\n(Existing inspections and reports are NOT affected.)`)) return
    const { error } = await supabase.from('po_items').delete().eq('id', it.id)
    if (error) setErr(error.message); else load()
  }

  // ---- Excel upload: flexible header match -> review -> confirm ----
  const onFile = async (f: File) => {
    setErr('')
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      if (!rows.length) { setErr('The file appears to be empty.'); return }
      // Find the header row: first row containing a part-ish and a qty-ish header.
      const norm = (s: any) => String(s || '').trim().toLowerCase()
      let hdrIdx = -1, partCol = -1, qtyCol = -1
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const cells = rows[r].map(norm)
        const pc = cells.findIndex(c => HDR_PART.includes(c))
        const qc = cells.findIndex(c => HDR_QTY.includes(c))
        if (pc >= 0 && qc >= 0) { hdrIdx = r; partCol = pc; qtyCol = qc; break }
      }
      const out: ReviewRow[] = []
      if (hdrIdx >= 0) {
        for (let r = hdrIdx + 1; r < rows.length; r++) {
          const part = String(rows[r][partCol] || '').trim()
          const qty = String(rows[r][qtyCol] || '').trim()
          if (!part && !qty) continue
          const qn = parseInt(qty.replace(/[, ]/g, ''), 10)
          out.push({ part_no: part, qty: Number.isFinite(qn) ? String(qn) : qty, ok: !!part && Number.isFinite(qn), note: !part ? 'Missing part number' : (!Number.isFinite(qn) ? 'Quantity is not a number' : '') })
        }
      } else {
        // No recognisable header: assume col A = part, col B = qty, let the
        // review screen sort it out. Nothing is saved until confirmed.
        for (const r of rows) {
          const part = String(r[0] || '').trim()
          const qty = String(r[1] || '').trim()
          if (!part && !qty) continue
          const qn = parseInt(qty.replace(/[, ]/g, ''), 10)
          out.push({ part_no: part, qty: Number.isFinite(qn) ? String(qn) : qty, ok: !!part && Number.isFinite(qn), note: 'No header row detected — please verify' })
        }
      }
      if (!out.length) { setErr('No item rows found in the file.'); return }
      setReview(out)
    } catch (e) {
      setErr('Could not read the file: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const confirmReview = async () => {
    if (!row || !review) return
    const good = review.filter(r => r.part_no.trim() && Number.isFinite(parseInt(r.qty, 10)))
    if (!good.length) { setErr('No valid rows to save. Fix the highlighted rows first.'); return }
    setBusy(true); setErr('')
    const payload = good.map(r => ({ po_id: row.id, part_no: r.part_no.trim(), qty_ordered: parseInt(r.qty, 10) }))
    const { error } = await supabase.from('po_items').upsert(payload, { onConflict: 'po_id,part_no' })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setReview(null); load()
  }

  const fmtDate = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString() : '—'
  const totOrdered = items.reduce((a, b) => a + (b.qty_ordered || 0), 0)
  const totLoaded = items.reduce((a, b) => a + (loadedQty[b.part_no] || 0), 0)

  return (
    <>
      {/* ---- PO information ---- */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>PO information</h2>
          {isApprover && row && !editInfo && (
            <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}
              onClick={() => setEditInfo({ customer_name: row.customer_name || '', po_date: row.po_date || '', destination: row.destination || '' })}>✎ Edit</button>
          )}
        </div>
        {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginTop: 8 }}>{err}</div>}
        {!editInfo && (
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.9 }}>
            <div><span className="muted">Customer:</span> <b>{row?.customer_name || '—'}</b></div>
            <div><span className="muted">PO date:</span> <b>{fmtDate(row?.po_date || null)}</b></div>
            <div><span className="muted">Destination:</span> <b>{row?.destination || '—'}</b></div>
          </div>
        )}
        {editInfo && (
          <div style={{ marginTop: 10 }}>
            <label className="fld"><span>Customer name</span>
              <input className="txt" value={editInfo.customer_name} onChange={e => setEditInfo({ ...editInfo, customer_name: e.target.value })} /></label>
            <label className="fld"><span>PO date</span>
              <input className="txt" type="date" value={editInfo.po_date} onChange={e => setEditInfo({ ...editInfo, po_date: e.target.value })} /></label>
            <label className="fld"><span>Destination</span>
              <input className="txt" value={editInfo.destination} onChange={e => setEditInfo({ ...editInfo, destination: e.target.value })} /></label>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={saveInfo}>{busy ? 'Saving…' : 'Save'}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setEditInfo(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Ordered items ---- */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Ordered items</h2>
          {isApprover && row && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => { setErr(''); setAddItem({ part_no: '', qty: '' }) }}>＋ Add item</button>
              <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => fileRef.current?.click()}>⬆ Upload Excel</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
            </div>
          )}
        </div>
        {items.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No ordered items recorded yet.{isApprover ? ' Add items or upload the PO item list (Excel).' : ''}</p>}
        {items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ marginTop: 8, minWidth: 420 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Part number</th><th>Ordered</th><th>Loaded</th><th>Remaining</th>{isApprover && <th />}</tr></thead>
              <tbody>
                {items.map(it => {
                  const loaded = loadedQty[it.part_no] || 0
                  const rem = (it.qty_ordered || 0) - loaded
                  return (
                    <tr key={it.part_no}>
                      <td style={{ fontWeight: 700 }}>{it.part_no}</td>
                      <td style={{ textAlign: 'center' }}>
                        {isApprover
                          ? <input className="txt" style={{ width: 84, minHeight: 34, textAlign: 'center' }} defaultValue={it.qty_ordered} inputMode="numeric"
                              onBlur={e => { if (e.target.value !== String(it.qty_ordered)) updateQty(it, e.target.value) }} />
                          : it.qty_ordered}
                      </td>
                      <td style={{ textAlign: 'center' }}>{loaded}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: rem < 0 ? 'var(--fail, #C0392B)' : rem === 0 ? 'var(--pass, #1F8A4C)' : 'inherit' }}>
                        {rem}{rem < 0 ? ' ⚠' : ''}
                      </td>
                      {isApprover && <td><button className="btn danger" style={{ minHeight: 34, padding: '2px 10px', fontSize: 13 }} onClick={() => removeItem(it)}>🗑</button></td>}
                    </tr>
                  )
                })}
                <tr>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{totOrdered}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{totLoaded}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{totOrdered - totLoaded}</td>
                  {isApprover && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Loaded = confirmed container-loading contents recorded for this PO.</p>
      </div>

      {/* ---- Add item modal ---- */}
      {addItem && (
        <div className="modal-overlay" onClick={() => setAddItem(null)}>
          <div className="modal" style={{ width: 'min(420px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Add ordered item</h2>
            <label className="fld"><span>Part number</span>
              <input className="txt" value={addItem.part_no} autoFocus onChange={e => setAddItem({ ...addItem, part_no: e.target.value })} /></label>
            <label className="fld"><span>Quantity ordered</span>
              <input className="txt" inputMode="numeric" value={addItem.qty} onChange={e => setAddItem({ ...addItem, qty: e.target.value })} /></label>
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={saveNewItem}>{busy ? 'Saving…' : 'Save item'}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setAddItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Excel review modal ---- */}
      {review && (
        <div className="modal-overlay" onClick={() => setReview(null)}>
          <div className="modal" style={{ width: 'min(560px, 96vw)', maxHeight: '86vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Review extracted items</h2>
            <p className="muted" style={{ fontSize: 13 }}>Nothing is saved yet. Fix any highlighted rows, then confirm. Existing items with the same part number will have their ordered quantity updated.</p>
            <table className="tbl">
              <thead><tr><th style={{ textAlign: 'left' }}>Part number</th><th>Qty</th><th /></tr></thead>
              <tbody>
                {review.map((r, i) => {
                  const bad = !r.part_no.trim() || !Number.isFinite(parseInt(r.qty, 10))
                  return (
                    <tr key={i} style={bad ? { background: '#FBE9E7' } : undefined}>
                      <td><input className="txt" style={{ minHeight: 34 }} value={r.part_no}
                        onChange={e => setReview(review.map((x, j) => j === i ? { ...x, part_no: e.target.value } : x))} /></td>
                      <td style={{ width: 110 }}><input className="txt" style={{ minHeight: 34, textAlign: 'center' }} inputMode="numeric" value={r.qty}
                        onChange={e => setReview(review.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></td>
                      <td style={{ width: 44 }}><button className="btn danger" style={{ minHeight: 32, padding: '2px 8px', fontSize: 13 }}
                        onClick={() => setReview(review.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {review.some(r => r.note) && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{[...new Set(review.map(r => r.note).filter(Boolean))].join(' · ')}</p>}
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginTop: 6 }}>{err}</div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={confirmReview}>{busy ? 'Saving…' : `Confirm & save ${review.length} item(s)`}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
