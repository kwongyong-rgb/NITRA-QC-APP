import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function Login() {
  const { t, lang, setLang } = useI18n()
  const [email, setEmail] = useState(() => localStorage.getItem('saved_email') || '')
  const [pw, setPw] = useState('')
  const [stayIn, setStayIn] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true); setErr('')
    if (stayIn) localStorage.setItem('saved_email', email)
    else localStorage.removeItem('saved_email')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', background: 'var(--navy)' }}>
      <div className="card" style={{ width: 'min(420px, 92vw)', padding: 28 }}>
        <img src="/logo-white.png" alt="NITRA" style={{ height: 34, filter: 'invert(1) brightness(0.2)' }} />
        <h2 style={{ margin: '14px 0' }}>{t('appTitle')}</h2>
        <label className="fld"><span>{t('email')}</span>
          <input className="txt" type="email" value={email}
            onChange={e => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <div style={{ height: 10 }} />
        <label className="fld"><span>{t('password')}</span>
          <input className="txt" type="password" value={pw}
            onChange={e => setPw(e.target.value)} autoComplete="current-password"
            onKeyDown={e => e.key === 'Enter' && go()} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={stayIn} onChange={e => setStayIn(e.target.checked)}
            style={{ width: 20, height: 20, accentColor: 'var(--navy)' }} />
          <span style={{ fontSize: 14 }}>{t('staySignedIn')}</span>
        </label>
        {err && <p style={{ color: 'var(--fail)', marginTop: 10, fontSize: 14 }}>{err}</p>}
        <button className="btn" style={{ width: '100%', marginTop: 16 }}
          disabled={busy || !email || !pw} onClick={go}>
          {busy ? '…' : t('signIn')}
        </button>
        <button className="btn ghost" style={{ width: '100%', marginTop: 10 }}
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
          {lang === 'en' ? '中文' : 'English'}
        </button>
      </div>
    </div>
  )
}
