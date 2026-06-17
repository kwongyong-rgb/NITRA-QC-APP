import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function Login() {
  const { t, lang, setLang } = useI18n()
  const [email, setEmail] = useState(() => localStorage.getItem('saved_email') || '')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [stayIn, setStayIn] = useState(true)
  const [mode, setMode] = useState<'login'|'reset'>('login')
  const [resetEmail, setResetEmail] = useState('')
  const [resetMsg, setResetMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true); setErr('')
    if (stayIn) localStorage.setItem('saved_email', email)
    else localStorage.removeItem('saved_email')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr(error.message)
    setBusy(false)
  }

  const resetPassword = async () => {
    setBusy(true); setErr(''); setResetMsg('')
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else setResetMsg('Password reset email sent! Check your inbox.')
  }

  return (
    <div style={{ minHeight:'100%', display:'grid', placeItems:'center', background:'var(--navy)' }}>
      <div className="card" style={{ width:'min(420px, 92vw)', padding:28 }}>
        <img src="/logo-white.png" alt="NITRA" style={{ height:34, filter:'invert(1) brightness(0.2)' }} />
        <h2 style={{ margin:'14px 0' }}>{t('appTitle')}</h2>

        {mode === 'login' ? (
          <>
            <label className="fld"><span>{t('email')}</span>
              <input className="txt" type="email" value={email} onChange={e => setEmail(e.target.value)}
                autoComplete="username" />
            </label>
            <div style={{ height:10 }} />
            <label className="fld"><span>{t('password')}</span>
              <div style={{ position:'relative' }}>
                <input className="txt" type={showPw ? 'text' : 'password'} value={pw}
                  onChange={e => setPw(e.target.value)} autoComplete="current-password"
                  onKeyDown={e => e.key === 'Enter' && signIn()}
                  style={{ paddingRight:48 }} />
                <button onClick={() => setShowPw(!showPw)}
                  style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--ink-soft)' }}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:10, marginTop:12, cursor:'pointer' }}>
              <input type="checkbox" checked={stayIn} onChange={e => setStayIn(e.target.checked)}
                style={{ width:20, height:20, accentColor:'var(--navy)' }} />
              <span style={{ fontSize:14 }}>{t('staySignedIn')}</span>
            </label>
            {err && <p style={{ color:'var(--fail)', marginTop:10, fontSize:14 }}>{err}</p>}
            <button className="btn" style={{ width:'100%', marginTop:16 }}
              disabled={busy || !email || !pw} onClick={signIn}>
              {busy ? '…' : t('signIn')}
            </button>
            <button style={{ background:'none', border:'none', color:'var(--navy)', cursor:'pointer', marginTop:12, fontSize:14, textDecoration:'underline' }}
              onClick={() => { setMode('reset'); setResetEmail(email); setErr('') }}>
              Forgot password? / 忘记密码？
            </button>
          </>
        ) : (
          <>
            <p style={{ marginBottom:14, color:'var(--ink-soft)' }}>Enter your email and we'll send a password reset link.</p>
            <label className="fld"><span>{t('email')}</span>
              <input className="txt" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} />
            </label>
            {err && <p style={{ color:'var(--fail)', marginTop:10, fontSize:14 }}>{err}</p>}
            {resetMsg && <p style={{ color:'var(--pass)', marginTop:10, fontSize:14 }}>{resetMsg}</p>}
            <button className="btn" style={{ width:'100%', marginTop:16 }}
              disabled={busy || !resetEmail} onClick={resetPassword}>
              {busy ? '…' : 'Send reset email / 发送重置邮件'}
            </button>
            <button style={{ background:'none', border:'none', color:'var(--navy)', cursor:'pointer', marginTop:12, fontSize:14, textDecoration:'underline' }}
              onClick={() => { setMode('login'); setErr(''); setResetMsg('') }}>
              ← Back to sign in / 返回登录
            </button>
          </>
        )}

        <button className="btn ghost" style={{ width:'100%', marginTop:10 }}
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
          {lang === 'en' ? '中文' : 'English'}
        </button>
      </div>
    </div>
  )
}
