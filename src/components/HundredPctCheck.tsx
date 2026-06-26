import { useState } from 'react'
import { DefectModal, PassPhotoModal } from './PhotoModal'
import type { PFNA } from '../lib/rules'

interface Props {
  inspectionId: string
  lotSize: number
  triggeredItems: { key: string; label: string }[]
  baseResults: Record<string, Record<string, PFNA>>
  results: Record<string, Record<string, PFNA>>
  onSave: (key: string, pieceNo: number, result: PFNA) => void
  editable: boolean
}

type ModalState =
  | { type: 'fail'; itemKey: string; itemLabel: string; pieceNo: number }
  | { type: 'pass'; itemKey: string; itemLabel: string; pieceNo: number }
  | null

export default function HundredPctCheck({ inspectionId, lotSize, triggeredItems, baseResults, results, onSave, editable }: Props) {
  const [activeItem, setActiveItem] = useState(triggeredItems[0]?.key || '')
  const [modal, setModal] = useState<ModalState>(null)

  const item = triggeredItems.find(i => i.key === activeItem) || triggeredItems[0]
  if (!item) return null
  const itemResults = results[item.key] || {}
  const baseItem = baseResults[item.key] || {}   // pieces already inspected on the Visual/Technical sample

  const pieces = Array.from({ length: lotSize }, (_, i) => i + 1)
  const verdictOf = (n: number): PFNA | undefined => baseItem[String(n)] ?? itemResults[String(n)]
  const checked = pieces.filter(n => verdictOf(n) === 'P' || verdictOf(n) === 'F').length
  const fails = pieces.filter(n => verdictOf(n) === 'F').length

  const rows: number[][] = []
  for (let i = 0; i < lotSize; i += 10)
    rows.push(Array.from({ length: Math.min(10, lotSize - i) }, (_, j) => i + j + 1))

  return (
    <div className="card">
      <h2 style={{ color:'var(--fail)' }}>⛔ 100% Inspection / 全检</h2>

      {triggeredItems.length > 1 && (
        <div className="tabs" style={{ position:'static', marginBottom:12 }}>
          {triggeredItems.map(it => (
            <button key={it.key} className={item.key === it.key ? 'on' : ''} onClick={() => setActiveItem(it.key)}>{it.label}</button>
          ))}
        </div>
      )}

      {/* Counters */}
      <div className="row" style={{ marginBottom:14 }}>
        {[['Checked / 已检', `${checked} / ${lotSize}`, 'var(--navy)'],
          ['Fails / 不合格', String(fails), fails > 0 ? 'var(--fail)' : 'var(--pass)'],
          ['Remaining / 待检', String(lotSize - checked), checked < lotSize ? 'var(--amber)' : 'var(--pass)']
        ].map(([label, val, color]) => (
          <div key={label} className="card" style={{ flex:1, marginBottom:0, textAlign:'center', padding:10 }}>
            <div className="muted" style={{ fontSize:12 }}>{label}</div>
            <div style={{ fontSize:28, fontFamily:'var(--display)', fontWeight:700, color: color as string }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="muted" style={{ marginBottom:10, fontSize:13 }}>
        Checking: <b>{item.label}</b> · Tap <b>P</b> or <b>F</b> to record instantly. Tap the piece number after to add optional photo/video.
        {Object.keys(baseItem).length > 0 && <> · 🔒 Pieces already inspected on the sample (Visual/Technical) are pre-filled with their result and locked — re-inspect only the remaining pieces.</>}
      </div>

      {rows.map((row, ri) => (
        <div key={ri} style={{ display:'flex', gap:4, marginBottom:4, flexWrap:'wrap' }}>
          {row.map(n => {
            const baseV = baseItem[String(n)]
            const locked = baseV === 'P' || baseV === 'F'   // already inspected on the sample → locked
            const val = locked ? baseV : itemResults[String(n)]
            return (
              <div key={n} style={{ width:52, border:'1.5px solid var(--line)', borderRadius:8,
                background: val === 'P' ? 'var(--pass-bg)' : val === 'F' ? 'var(--fail-bg)' : '#fff',
                borderColor: val === 'P' ? 'var(--pass)' : val === 'F' ? 'var(--fail)' : 'var(--line)',
                overflow:'hidden', opacity: locked ? 0.85 : 1 }}>
                {/* Piece number — tap to add optional photo (disabled for locked base fails) */}
                <button
                  style={{ width:'100%', textAlign:'center', fontSize:11, fontWeight:700, padding:'3px 0',
                    border:'none', borderBottom:'1px solid var(--line)', background:'rgba(0,0,0,.04)',
                    cursor: (!locked && val) ? 'pointer' : 'default', color: val ? 'var(--navy)' : 'inherit' }}
                  onClick={() => {
                    if (!editable || locked || !val) return
                    setModal({ type: val === 'F' ? 'fail' : 'pass', itemKey: item.key, itemLabel: item.label, pieceNo: n })
                  }}>
                  {locked ? `${n} 🔒` : `${n}${val ? ' 📷' : ''}`}
                </button>
                {/* P / F — instant save, no popup (locked base fails are read-only) */}
                <div style={{ display:'flex' }}>
                  <button disabled={!editable || locked}
                    style={{ flex:1, border:'none', borderRight:'1px solid var(--line)', minHeight:36,
                      background: val === 'P' ? 'var(--pass)' : 'transparent',
                      color: val === 'P' ? '#fff' : 'var(--pass)', fontWeight:700, fontSize:13, cursor: locked ? 'default' : 'pointer' }}
                    onClick={() => onSave(item.key, n, val === 'P' ? undefined : 'P')}>P</button>
                  <button disabled={!editable || locked}
                    style={{ flex:1, border:'none', minHeight:36,
                      background: val === 'F' ? 'var(--fail)' : 'transparent',
                      color: val === 'F' ? '#fff' : 'var(--fail)', fontWeight:700, fontSize:13, cursor: locked ? 'default' : 'pointer' }}
                    onClick={() => onSave(item.key, n, val === 'F' ? undefined : 'F')}>F</button>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {checked === lotSize && (
        <div className="banner ok" style={{ marginTop:14 }}>
          ✓ All {lotSize} pieces checked · {fails} fail{fails !== 1 ? 's' : ''}
        </div>
      )}

      {modal?.type === 'fail' && (
        <DefectModal inspectionId={inspectionId} itemKey={modal.itemKey}
          itemLabel={`${modal.itemLabel} (100% check)`} pieceNo={modal.pieceNo} tab="100pct"
          onDone={() => setModal(null)} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'pass' && (
        <PassPhotoModal inspectionId={inspectionId} itemKey={modal.itemKey}
          itemLabel={`${modal.itemLabel} (100% check)`} pieceNo={modal.pieceNo} tab="100pct"
          onDone={() => setModal(null)} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
