import { useState } from 'react'
import { DefectModal, PassPhotoModal } from './PhotoModal'
import type { PFNA } from '../lib/rules'

interface Props {
  inspectionId: string
  lotSize: number
  triggeredItems: { key: string; label: string }[]
  results: Record<string, Record<string, PFNA>>   // itemKey → { pieceNo → P/F }
  onSave: (key: string, pieceNo: number, result: PFNA) => void
  editable: boolean
}

type ModalState =
  | { type: 'fail'; itemKey: string; itemLabel: string; pieceNo: number }
  | { type: 'pass'; itemKey: string; itemLabel: string; pieceNo: number }
  | null

export default function HundredPctCheck({ inspectionId, lotSize, triggeredItems, results, onSave, editable }: Props) {
  const [activeItem, setActiveItem] = useState(triggeredItems[0]?.key || '')
  const [modal, setModal] = useState<ModalState>(null)

  const item = triggeredItems.find(i => i.key === activeItem) || triggeredItems[0]
  if (!item) return null
  const itemResults = results[item.key] || {}

  const pieces = Array.from({ length: lotSize }, (_, i) => i + 1)
  const checked = pieces.filter(n => itemResults[String(n)] === 'P' || itemResults[String(n)] === 'F').length
  const fails = pieces.filter(n => itemResults[String(n)] === 'F').length

  // Group pieces into rows of 10
  const rows: number[][] = []
  for (let i = 0; i < lotSize; i += 10) {
    rows.push(Array.from({ length: Math.min(10, lotSize - i) }, (_, j) => i + j + 1))
  }

  return (
    <div className="card">
      <h2 style={{ color: 'var(--fail)' }}>⛔ 100% Inspection / 全检</h2>

      {triggeredItems.length > 1 && (
        <div className="tabs" style={{ position: 'static', marginBottom: 12 }}>
          {triggeredItems.map(it => (
            <button key={it.key} className={item.key === it.key ? 'on' : ''} onClick={() => setActiveItem(it.key)}>
              {it.label}
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card" style={{ flex: 1, marginBottom: 0, textAlign: 'center', padding: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>Checked / 已检</div>
          <div style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--navy)' }}>
            {checked} / {lotSize}
          </div>
        </div>
        <div className="card" style={{ flex: 1, marginBottom: 0, textAlign: 'center', padding: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>Fails / 不合格</div>
          <div style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 700, color: fails > 0 ? 'var(--fail)' : 'var(--pass)' }}>
            {fails}
          </div>
        </div>
        <div className="card" style={{ flex: 1, marginBottom: 0, textAlign: 'center', padding: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>Remaining / 待检</div>
          <div style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 700, color: checked < lotSize ? 'var(--amber)' : 'var(--pass)' }}>
            {lotSize - checked}
          </div>
        </div>
      </div>

      <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
        Checking for: <b>{item.label}</b> · Tap P or F on each piece — instant save.
        Photos/comments are optional: F opens a detail screen (can save empty);
        tap a green piece's number to add an optional pass photo.
      </div>

      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
          {row.map(n => {
            const val = itemResults[String(n)]
            return (
              <div key={n} style={{
                width: 52, border: '1.5px solid var(--line)', borderRadius: 8,
                background: val === 'P' ? 'var(--pass-bg)' : val === 'F' ? 'var(--fail-bg)' : '#fff',
                borderColor: val === 'P' ? 'var(--pass)' : val === 'F' ? 'var(--fail)' : 'var(--line)',
                overflow: 'hidden'
              }}>
                <button
                  style={{ width: '100%', textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '3px 0', border: 'none', borderBottom: '1px solid var(--line)', background: 'rgba(0,0,0,.04)', cursor: val ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (!editable || !val) return
                    setModal({ type: val === 'F' ? 'fail' : 'pass', itemKey: item.key, itemLabel: item.label, pieceNo: n })
                  }}>
                  {n}{(val) ? ' 📷' : ''}
                </button>
                <div style={{ display: 'flex' }}>
                  <button disabled={!editable}
                    style={{ flex: 1, border: 'none', borderRight: '1px solid var(--line)', minHeight: 36,
                      background: val === 'P' ? 'var(--pass)' : 'transparent',
                      color: val === 'P' ? '#fff' : 'var(--pass)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                    onClick={() => onSave(item.key, n, val === 'P' ? undefined : 'P')}>P</button>
                  <button disabled={!editable}
                    style={{ flex: 1, border: 'none', minHeight: 36,
                      background: val === 'F' ? 'var(--fail)' : 'transparent',
                      color: val === 'F' ? '#fff' : 'var(--fail)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                    onClick={() => {
                      const newVal = val === 'F' ? undefined : 'F'
                      onSave(item.key, n, newVal)
                      if (newVal === 'F') setModal({ type: 'fail', itemKey: item.key, itemLabel: item.label, pieceNo: n })
                    }}>F</button>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {checked === lotSize && (
        <div className="banner ok" style={{ marginTop: 14 }}>
          ✓ All {lotSize} pieces checked · {fails} fail{fails !== 1 ? 's' : ''} recorded
        </div>
      )}

      {modal?.type === 'fail' && (
        <DefectModal
          inspectionId={inspectionId}
          itemKey={modal.itemKey} itemLabel={`${modal.itemLabel} (100% check)`}
          pieceNo={modal.pieceNo} tab="100pct"
          onDone={() => setModal(null)} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'pass' && (
        <PassPhotoModal
          inspectionId={inspectionId}
          itemKey={modal.itemKey} itemLabel={`${modal.itemLabel} (100% check)`}
          pieceNo={modal.pieceNo} tab="100pct"
          onDone={() => setModal(null)} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
