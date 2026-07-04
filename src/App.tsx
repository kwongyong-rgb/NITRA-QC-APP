import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useI18n } from './lib/i18n'
import Login from './pages/Login'
import Home from './pages/Home'
import NewInspection from './pages/NewInspection'
import Inspection from './pages/Inspection'
import Approvals from './pages/Approvals'
import Settings from './pages/Settings'
import Skus from './pages/Skus'
import TeamPage from './pages/TeamPage'
import SetPassword from './pages/SetPassword'
import CustomerHome from './pages/CustomerHome'
import RefLibrary from './pages/RefLibrary'
import ReportPage from './pages/ReportPage'
import PoReportPage from './pages/PoReportPage'
import ContainerReportPage from './pages/ContainerReportPage'
import ContainerLoading from './pages/ContainerLoading'
import PoHub from './pages/PoHub'
import ErrorBoundary from './components/ErrorBoundary'

export interface Profile { id: string; full_name: string; role: 'inspector' | 'admin' | 'customer' }

// Captured synchronously at module load: an invite / password-reset link arrives
// with its one-time token in the URL hash (e.g. #...&type=invite). The Supabase
// client strips the hash asynchronously, so we read the type now, before that.
const initialLinkType = (() => {
  try { return new URLSearchParams((window.location.hash || '').replace(/^#/, '')).get('type') }
  catch { return null }
})()

export default function App() {
  const [recoverMode, setRecoverMode] = useState(initialLinkType === 'invite' || initialLinkType === 'recovery')
  const [mustReset, setMustReset] = useState(false)
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const { lang, setLang, t } = useI18n()
  const nav = useNavigate()
  const location = useLocation()
  // Recipients of an emailed report link are not logged-in NITRA staff, so this
  // one route must never go through the login wall below.
  const isPublicReport = location.pathname.startsWith('/report/') || location.pathname.startsWith('/po-report/') || location.pathname.startsWith('/container-report/')

  useEffect(() => {
    if (isPublicReport) return
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setProfile(null); setMustReset(false); return }
      // Accounts created by an admin with a temporary password must choose
      // their own password before using the app.
      setMustReset(session.user.user_metadata?.must_reset === true)
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(data as Profile)
    }
    load()
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) setProfile(null); else load()
    })
    return () => sub.subscription.unsubscribe()
  }, [isPublicReport])

  if (isPublicReport) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/report/:id" element={<ReportPage />} />
          <Route path="/po-report/:po" element={<PoReportPage />} />
          <Route path="/container-report/:id" element={<ContainerReportPage />} />
        </Routes>
      </ErrorBoundary>
    )
  }

  if (profile === undefined) return <div className="page">…</div>

  // An invited user (or password reset) must set a password before using the app.
  if (recoverMode) {
    return <SetPassword onDone={() => {
      try { history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
      setRecoverMode(false)
      nav('/')
    }} />
  }

  if (profile === null) return <Login />

  // Temp-password accounts must choose their own password before anything else.
  if (mustReset) {
    return <SetPassword forced onDone={() => { setMustReset(false); nav('/') }} />
  }

  // Customers get their own dashboard: assigned POs, status, and report links.
  // RLS (migration 19) scopes their data server-side; this is the whole UI.
  if (profile.role === 'customer') {
    return <CustomerHome profile={profile} />
  }

  return (
    <>
      <header className="topbar">
        <Link to="/"><img src="/logo-white.png" alt="NITRA" /></Link>
        <span className="title">{t('appTitle')}</span>
        <button className="topbar-burger" aria-label="Menu" onClick={() => setMenuOpen(o => !o)}>☰</button>
        <nav className={menuOpen ? 'topbar-nav open' : 'topbar-nav'} onClick={() => setMenuOpen(false)}>
          {profile.role === 'admin' && (
            <>
              <Link to="/approvals"><button>{t('approvals')}</button></Link>
              <Link to="/skus"><button>{t('skus')}</button></Link>
              <Link to="/users"><button>{t('users')}</button></Link>
              <Link to="/settings"><button>{t('settings')}</button></Link>
            </>
          )}
          <Link to="/reference"><button>{t('refLibrary')}</button></Link>
          <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{lang === 'en' ? '中文' : 'EN'}</button>
          <button onClick={async () => { await supabase.auth.signOut(); nav('/') }}>{t('signOut')}</button>
        </nav>
      </header>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home profile={profile} />} />
          <Route path="/po/:poNo" element={<PoHub profile={profile} />} />
          <Route path="/new" element={<NewInspection profile={profile} />} />
          <Route path="/inspection/:id" element={<Inspection profile={profile} />} />
          <Route path="/container/:id" element={<ContainerLoading profile={profile} />} />
          <Route path="/approvals" element={profile.role === 'admin' ? <Approvals /> : <Navigate to="/" />} />
          <Route path="/settings" element={profile.role === 'admin' ? <Settings /> : <Navigate to="/" />} />
          <Route path="/skus" element={profile.role === 'admin' ? <Skus /> : <Navigate to="/" />} />
          <Route path="/users" element={profile.role === 'admin' ? <TeamPage /> : <Navigate to="/" />} />
          <Route path="/team" element={<Navigate to="/users" />} />
          <Route path="/reference" element={<RefLibrary profile={profile} />} />
        </Routes>
      </ErrorBoundary>
    </>
  )
}
