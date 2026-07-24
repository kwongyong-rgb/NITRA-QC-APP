import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { DefectModal, PassPhotoModal } from './PhotoModal'
import type { PFNA } from '../lib/rules'

interface Props {
  inspectionId: string
  itemKey: string
  itemLabel: string
  result: 'P' | 'F'
  existingExtras: PFNA[]
  onSave: (result: 'P' | 'F') => void
  onUndo: () => void
  onClose: () => void
  extrasRequired: number
  baseSample: number      // extras are the pieces after this (extra #1 = baseSample+1)
}

export default function ExtraPieceScreen({
  inspectionId, itemKey, itemLabel, result,
  existingExtras, onSave, onUndo, onClose, extrasRequired, baseSample
}: Props) {
  const { bi: _bi } = useI18n(); void _bi
  const [photoModal, setPhotoModal] = useState(false)
  const done = existingExtras.filter(r => r === 'P' || r === 'F').length
  // The REAL lot piece number of the extra being recorded — extras are sequential
  // after the base sample, so with a base of 8 this is piece 9, then 10…
  const lotPieceNo = baseSample + done + 1

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <h2 style={{ color: result === 'F' ? 'var(--fail)' : 'var(--pass)', marginBottom: 14 }}>
          {result === 'F' ? '✗ Extra Piece — Fail' : '✓ Extra Piece — Pass'}
        </h2>

        {/* Item info */}
        <div className="card" style={{ background: result === 'F' ? 'var(--fail-bg)' : 'var(--pass-bg)', marginBottom: 14, padding: 10 }}>
          <div><b>Item / 检验项目:</b> {itemLabel}</div>
          <div><b>Additional piece {done + 1} of {extrasRequired}</b> — lot piece #{lotPieceNo}</div>
        </div>

        {/* Previous extras dots */}
        {existingExtras.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="muted" style={{ marginBottom: 6 }}>Recorded so far / 已记录:</div>
            <div className="extra-recorder">
              {existingExtras.map((r, i) => (
                <div key={i} className={`extra-dot ${r === 'P' ? 'p' : 'f'}`}>{r}</div>
              ))}
            </div>
          </div>
        )}

        {/* Photo button */}
        <div style={{ marginBottom: 16 }}>
          <button
            className={`btn ${result === 'F' ? 'danger' : 'ok'} ghost`}
            style={{ width: '100%' }}
            onClick={() => setPhotoModal(true)}>
            📷+ {result === 'F' ? 'Log defect + photo' : 'Take photo (optional)'}
          </button>
        </div>

        {/* Action buttons */}
        <div className="row">
          <button
            className={`btn ${result === 'F' ? 'danger' : 'ok'}`}
            style={{ flex: 1 }}
            onClick={() => { onSave(result); onClose() }}>
            Save {result === 'F' ? 'Fail' : 'Pass'} / 保存{result === 'F' ? '不合格' : '合格'}
          </button>
          {existingExtras.length > 0 && (
            <button className="btn ghost" onClick={() => { onUndo(); onClose() }}>
              ↩ Undo last
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>

      {/* Photo modals — rendered outside the inner modal so they stack on top */}
      {photoModal && result === 'F' && (
        <DefectModal
          inspectionId={inspectionId}
          itemKey={itemKey}
          itemLabel={`${itemLabel} (extra piece ${done + 1})`}
          pieceNo={-(done + 1)}   // negative = extra piece marker
          tab="extra"
          onDone={() => { setPhotoModal(false); onSave(result); onClose() }}
          onClose={() => setPhotoModal(false)}
        />
      )}
      {photoModal && result === 'P' && (
        <PassPhotoModal
          inspectionId={inspectionId}
          itemKey={itemKey}
          itemLabel={`${itemLabel} (extra piece ${done + 1})`}
          pieceNo={-(done + 1)}
          tab="extra"
          onDone={() => { setPhotoModal(false); onSave(result); onClose() }}
          onClose={() => setPhotoModal(false)}
        />
      )}
    </div>
  )
}
