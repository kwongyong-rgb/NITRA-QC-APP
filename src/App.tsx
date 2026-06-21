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
import RefLibrary from './pages/RefLibrary'
import ReportPage from './pages/ReportPage'
import ContainerLoading from './pages/ContainerLoading'
import PoHub from './pages/PoHub'
import ErrorBoundary from './components/ErrorBoundary'

export interface Profile { id: string; full_name: string; role: 'inspector' | 'approver' }

export default function App() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const { lang, setLang, t } = useI18n()
  const nav = useNavigate()
  const location = useLocation()
  // Recipients of an emailed report link are not logged-in NITRA staff, so this
  // one route must never go through the login wall below.
  const isPublicReport = location.pathname.startsWith('/report/')

  useEffect(() => {
    if (isPublicReport) return
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setProfile(null); return }
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
        </Routes>
      </ErrorBoundary>
    )
  }

  if (profile === undefined) return <div className="page">…</div>
  if (profile === null) return <Login />

  return (
    <>
      <header className="topbar">
        <Link to="/"><img src="/logo-white.png" alt="NITRA" /></Link>
        <span className="title">{t('appTitle')}</span>
        <button className="topbar-burger" aria-label="Menu" onClick={() => setMenuOpen(o => !o)}>☰</button>
        <nav className={menuOpen ? 'topbar-nav open' : 'topbar-nav'} onClick={() => setMenuOpen(false)}>
          {profile.role === 'approver' && (
            <>
              <Link to="/approvals"><button>{t('approvals')}</button></Link>
              <Link to="/skus"><button>{t('skus')}</button></Link>
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
          <Route path="/" element={<Home />} />
          <Route path="/po/:poNo" element={<PoHub profile={profile} />} />
          <Route path="/new" element={<NewInspection profile={profile} />} />
          <Route path="/inspection/:id" element={<Inspection profile={profile} />} />
          <Route path="/container/:id" element={<ContainerLoading profile={profile} />} />
          <Route path="/approvals" element={profile.role === 'approver' ? <Approvals /> : <Navigate to="/" />} />
          <Route path="/settings" element={profile.role === 'approver' ? <Settings /> : <Navigate to="/" />} />
          <Route path="/skus" element={profile.role === 'approver' ? <Skus /> : <Navigate to="/" />} />
          <Route path="/reference" element={<RefLibrary profile={profile} />} />
        </Routes>
      </ErrorBoundary>
    </>
  )
}
