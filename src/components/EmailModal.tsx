import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Replaces window.prompt() for report emailing (QW-1).
// - One-tap chips: the saved distribution list (Settings) + recently used
//   addresses on this device.
// - Free typing still works (Enter / comma / blur adds the address).
// - Sending with nothing selected preserves the old "leave blank to use the
//   saved distribution list" behaviour where the caller supports it.

const RECENT_KEY = 'nitra_recent_recipients'
const getRecents = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
export const rememberRecipients = (emails: string[]) => {
  try {
    const cur = getRecents()
    const merged = [...emails, ...cur.filter(e => !emails.includes(e))].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(merged))
  } catch { /* ignore */ }
}

export default function EmailModal({ title, allowBlank, sending, onSend, onClose }: {
  title: string
  allowBlank?: boolean          // true = empty selection means "use saved list"
  sending?: boolean
  onSend: (emails: string[]) => void
  onClose: () => void
}) {
  const [dist, setDist] = useState<string[]>([])
  const [recents, setRecents] = useState<string[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setRecents(getRecents())
    supabase.from('settings').select('value').eq('key', 'distribution').maybeSingle()
      .then(({ data }) => {
        const emails: string[] = data?.value?.emails || []
        setDist(emails)
        setSel(new Set(emails)) // saved list pre-selected — one tap to deselect
      })
  }, [])

  const toggle = (e: string) => { const n = new Set(sel); if (n.has(e)) n.delete(e); else n.add(e); setSel(n) }
  const addTyped = () => {
    const parts = typed.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    const bad = parts.find(p => !/.+@.+\..+/.test(p))
    if (bad) { setErr(`"${bad}" doesn't look like an email address.`); return }
    setErr('')
    const n = new Set(sel); for (const p of parts) n.add(p)
    setSel(n); setTyped('')
  }
  const send = () => {
    const emails = [...sel]
    if (!emails.length && !allowBlank) { setErr('Select or type at least one recipient.'); return }
    if (typed.trim()) { setErr('Press Enter to add the typed address first, or clear it.'); return }
    if (emails.length) rememberRecipients(emails)
    onSend(emails)
  }
  const chip = (e: string) => (
    <button key={e} onClick={() => toggle(e)}
      style={{ minHeight: 40, padding: '6px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
        border: `1.5px solid ${sel.has(e) ? 'var(--navy)' : 'var(--line)'}`,
        background: sel.has(e) ? 'var(--navy)' : '#fff', color: sel.has(e) ? '#fff' : 'var(--ink, #18222E)' }}>
      {sel.has(e) ? '✓ ' : ''}{e}
    </button>
  )
  const others = recents.filter(r => !dist.includes(r))

  return (
    <div className="modal-overlay" onClick={() => !sending && onClose()}>
      <div className="modal" style={{ width: 'min(500px, 94vw)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {dist.length > 0 && (<>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Saved distribution list</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>{dist.map(chip)}</div>
        </>)}
        {others.length > 0 && (<>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Recent</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>{others.map(chip)}</div>
        </>)}
        <label className="fld"><span>Add address</span>
          <input className="txt" type="email" placeholder="name@company.com" value={typed}
            onChange={e => { setTyped(e.target.value); setErr('') }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTyped() } }}
            onBlur={addTyped} /></label>
        {allowBlank && sel.size === 0 && <p className="muted" style={{ fontSize: 12 }}>No recipients selected — the saved distribution list will be used.</p>}
        {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)' }}>{err}</div>}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn" disabled={sending} onClick={send}>{sending ? 'Sending…' : `Send${sel.size ? ` (${sel.size})` : ''}`}</button>
          <button className="btn ghost" disabled={sending} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
