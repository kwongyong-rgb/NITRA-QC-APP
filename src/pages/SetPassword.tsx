import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Shown when a user arrives via an invite (or password-reset) link, OR — in
// `forced` mode — when an admin-created account with a temporary password
// signs in for the first time and must choose their own password.
export default function SetPassword({ onDone, forced = false }: { onDone: () => void; forced?: boolean }) {
  const [ready, setReady] = useState(forced)   // forced: session already exists
  const [linkError, setLinkError] = useState(false) // link invalid/expired
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  // The token in the URL is exchanged for a session asynchronously by the client.
  // Wait for it (with a timeout) before showing the form.
  useEffect(() => {
    if (forced) return // session already exists (temp-password sign-in)
    let cancelled = false
    const sub = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled && session) setReady(true)
    })
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (!cancelled && data.session) { setReady(true); return true }
      return false
    }
    ;(async () => {
      for (let i = 0; i < 20; i++) { // ~5s of polling
        if (await check()) return
        await new Promise(r => setTimeout(r, 250))
      }
      if (!cancelled) setLinkError(true)
    })()
    return () => { cancelled = true; sub.data.subscription.unsubscribe() }
  }, [forced])

  const submit = async () => {
    setErr('')
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pw !== pw2) { setErr('The two passwords do not match.'); return }
    setBusy(true)
    // In forced mode also clear the must_reset flag so the gate lifts.
    const { error } = await supabase.auth.updateUser(
      forced ? { password: pw, data: { must_reset: false } } : { password: pw })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(true)
  }

  return (
    <div className="page" style={{ maxWidth: 420, margin: '0 auto' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Set your password</h2>

        {linkError && !ready && (
          <>
            <p className="muted">This invite link is invalid or has expired. Ask your admin to send a new invite.</p>
            <button className="btn" onClick={onDone}>Go to sign in</button>
          </>
        )}

        {!ready && !linkError && <p className="muted">Verifying your invite…</p>}

        {ready && !done && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Choose a password to finish setting up your account.</p>
            <label className="fld"><span>New password</span>
              <input className="txt" type="password" value={pw} autoFocus
                onChange={e => setPw(e.target.value)} /></label>
            <label className="fld"><span>Confirm password</span>
              <input className="txt" type="password" value={pw2}
                onChange={e => setPw2(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit() }} /></label>
            {err && <div className="muted" style={{ color: 'var(--red, #C0392B)' }}>{err}</div>}
            <button className="btn" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : 'Save password & continue'}
            </button>
          </>
        )}

        {done && (
          <>
            <p style={{ color: 'var(--green, #1F8A4C)', fontWeight: 600 }}>Password set. You’re all set.</p>
            <button className="btn" onClick={onDone}>Continue to the app</button>
          </>
        )}
      </div>
    </div>
  )
}
