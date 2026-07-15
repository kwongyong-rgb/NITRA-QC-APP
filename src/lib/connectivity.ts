// ---------------------------------------------------------------------------
// B6 Stage 2 — connectivity awareness.
// A single source of truth for "is this device actually reachable to the
// server right now?" — the foundation the later write-queue / offline-creation
// batches hang off.
//
// Why not just navigator.onLine? On warehouse Wi-Fi a device can be "connected"
// (navigator.onLine === true) while having NO working route to the internet
// (captive portal, dead uplink). So we treat navigator.onLine only as a fast
// negative signal (false => definitely offline) and confirm the positive case
// with a lightweight reachability ping to Supabase.
//
// The ping uses mode:'no-cors' on purpose: we don't read the response body, we
// only care whether the network round-trip completes. That sidesteps CORS
// entirely — any completed request (even an opaque/401 one) means "server
// reachable"; only a network failure or timeout means "offline".
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
// GoTrue health endpoint — public, tiny, always present on a Supabase project.
const PING_URL = `${SUPABASE_URL}/auth/v1/health`
const RECHECK_MS = 30_000     // re-confirm periodically (catches silent drops)
const PING_TIMEOUT_MS = 5_000 // a hung request counts as offline

// Confirm the server is actually reachable. Never throws — resolves true/false.
export async function pingReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (!SUPABASE_URL) return true // misconfig: don't nag, assume online
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS)
  try {
    // cache-buster so a proxy can't answer an offline device from cache
    await fetch(`${PING_URL}?_=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// React hook: returns the current online/offline state, kept live via the
// browser's online/offline events, tab-visibility changes, and a periodic
// re-check. Safe against setState-after-unmount.
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    let alive = true
    const apply = (v: boolean) => { if (alive) setOnline(v) }
    const verify = () => { void pingReachable().then(apply) }

    const onOffline = () => apply(false)          // trust the negative immediately
    const onOnline = () => verify()               // confirm the positive
    const onVisible = () => { if (document.visibilityState === 'visible') verify() }

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    verify()                                      // initial confirmation
    const id = window.setInterval(verify, RECHECK_MS)

    return () => {
      alive = false
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(id)
    }
  }, [])

  return online
}
