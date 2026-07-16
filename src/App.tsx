import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useI18n } from './lib/i18n'
import { useOnline } from './lib/connectivity'
import { warmRefCache } from './lib/refCache'
import { syncPendingInspections } from './lib/offlineSync'
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
import MyWork from './pages/MyWork'
import AdminDashboard from './pages/AdminDashboard'
import RefLibrary from './pages/RefLibrary'
import ReportPage from './pages/ReportPage'
import PoReportPage from './pages/PoReportPage'
import ContainerReportPage from './pages/ContainerReportPage'
import ContainerLoading from './pages/ContainerLoading'
import PoHub from './pages/PoHub'
import ErrorBoundary from './components/ErrorBoundary'

export interface Profile { id: string; full_name: string; role: 'inspector' | 'admin' | 'customer' }

// Cache the signed-in profile so an offline blip (profile fetch fails with no
// network) doesn't get misread as "no user" and bounce a logged-in inspector to
// the Login screen. Only a real sign-out clears it.
const PROFILE_KEY = 'nitra_profile'
function cacheProfile(p: Profile) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch { /* ignore */ } }
function readCachedProfile(): Profile | null {
  try { const s = localStorage.getItem(PROFILE_KEY); return s ? (JSON.parse(s) as Profile) : null } catch { return null }
}
function clearCachedProfile() { try { localStorage.removeItem(PROFILE_KEY) } catch { /* ignore */ } }
function looksOffline(msg?: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return /load failed|failed to fetch|network/i.test(msg || '')
}

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
  const [wide, setWide] = useState(window.innerWidth >= 900)
  const [pendingCount, setPendingCount] = useState(0)
  const { lang, setLang, t } = useI18n()
  const online = useOnline()
  const nav = useNavigate()
  const location = useLocation()
  // Recipients of an emailed report link are not logged-in NITRA staff, so this
  // one route must never go through the login wall below.
  const isPublicReport = location.pathname.startsWith('/report/') || location.pathname.startsWith('/po-report/') || location.pathname.startsWith('/container-report/')

  useEffect(() => {
    if (isPublicReport) return
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        // No readable session. If we're offline but have a cached profile, keep
        // the user in rather than forcing a login they can't complete offline.
        const cached = readCachedProfile()
        if (cached && looksOffline()) { setProfile(cached); setMustReset(false); return }
        setProfile(null); setMustReset(false); return
      }
      // Accounts created by an admin with a temporary password must choose
      // their own password before using the app.
      setMustReset(session.user.user_metadata?.must_reset === true)
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (data && !error) { setProfile(data as Profile); cacheProfile(data as Profile); return }
      // Fetch failed. Offline/network → keep the cached profile (don't log out).
      const cached = readCachedProfile()
      if (cached && looksOffline(error?.message)) { setProfile(cached); return }
      setProfile((data as Profile) ?? null)
    }
    load()
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Only a genuine sign-out logs the user out. Transient null sessions (e.g. a
      // failed token refresh while offline) must NOT drop a logged-in inspector.
      if (event === 'SIGNED_OUT') { setProfile(null); clearCachedProfile() }
      else if (s) load()
    })
    return () => sub.subscription.unsubscribe()
  }, [isPublicReport])

  useEffect(() => {
    const onR = () => setWide(window.innerWidth >= 900)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])

  // Warm the offline reference cache (SKU list + sampling settings) whenever we're
  // logged in and online — so offline screens have the data no matter which screen
  // was opened first.
  useEffect(() => { if (online && profile) void warmRefCache() }, [online, profile])

  // Push any offline-created inspections to the server whenever we're logged in and
  // online (on load and the moment connectivity returns). Scoped to this user; the
  // currently-open inspection syncs itself from its own screen.
  useEffect(() => { if (online && profile) void syncPendingInspections(profile.id) }, [online, profile])

  // Sidebar badge: how many items await approval (admins, refreshed per navigation)
  useEffect(() => {
    if (profile?.role !== 'admin') return
    ;(async () => {
      const [a, b] = await Promise.all([
        supabase.from('inspections').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('container_loadings').select('id', { count: 'exact', head: true }).eq('insp_status', 'submitted'),
      ])
      setPendingCount((a.count ?? 0) + (b.count ?? 0))
    })()
  }, [profile?.role, location.pathname])

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

  const isWorkScreen = location.pathname.startsWith('/inspection/') || location.pathname.startsWith('/container/')
  const showBottomNav = profile.role === 'inspector' && !isWorkScreen
  const showSidebar = profile.role === 'admin' && wide
  const SIDEBAR_ITEMS = [
    { to: '/dashboard', label: t('dashboard'), icon: '🏠' },
    { to: '/', label: t('pos'), icon: '📋' },
    { to: '/approvals', label: t('approvals'), icon: '✅', badge: pendingCount },
    { to: '/users', label: t('users'), icon: '👥' },
    { to: '/skus', label: t('skus'), icon: '🛞' },
    { to: '/reference', label: t('reference'), icon: '🖼' },
    { to: '/settings', label: t('settings'), icon: '⚙️' },
  ]

  return (
    <>
      <header className="topbar">
        <Link to="/"><img src="/logo-white.png" alt="NITRA" /></Link>
        <span className="title" style={{ flex: '0 0 auto' }}>{t('appTitle')}</span>
        <span
          className={online ? 'netpill on' : 'netpill off'}
          title={online ? t('online') : t('offline')}
          aria-live="polite"
        >
          <span className="dot" />{online ? t('online') : t('offline')}
        </span>
        <span style={{ flex: 1 }} />
        <button className="topbar-burger" aria-label="Menu" onClick={() => setMenuOpen(o => !o)}>☰</button>
        <nav className={menuOpen ? 'topbar-nav open' : 'topbar-nav'} onClick={() => setMenuOpen(false)}>
          {profile.role === 'admin' && !showSidebar && (
            <>
              <Link to="/approvals"><button>{t('approvals')}</button></Link>
              <Link to="/skus"><button>{t('skus')}</button></Link>
              <Link to="/users"><button>{t('users')}</button></Link>
              <Link to="/settings"><button>{t('settings')}</button></Link>
            </>
          )}
          {!showSidebar && <Link to="/reference"><button>{t('refLibrary')}</button></Link>}
          <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{lang === 'en' ? '中文' : 'EN'}</button>
          <button onClick={async () => { await supabase.auth.signOut(); nav('/') }}>{t('signOut')}</button>
        </nav>
      </header>
      <div style={showSidebar ? { display: 'flex', alignItems: 'flex-start' } : undefined}>
      {showSidebar && (
        <aside style={{ width: 216, flexShrink: 0, position: 'sticky', top: 0,
          height: 'calc(100vh - 56px)', background: '#fff', borderRight: '1.5px solid var(--line)',
          padding: '14px 10px' }}>
          {SIDEBAR_ITEMS.map(it => {
            const active = it.to === '/' ? (location.pathname === '/' || location.pathname.startsWith('/po/')) : location.pathname.startsWith(it.to)
            return (
              <Link key={it.to} to={it.to} style={{ textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px',
                  borderRadius: 10, marginBottom: 4, fontWeight: 700, fontSize: 14,
                  background: active ? 'var(--navy)' : 'transparent',
                  color: active ? '#fff' : 'var(--navy)' }}>
                  <span>{it.icon}</span>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {!!it.badge && <span style={{ background: active ? '#fff' : 'var(--amber, #B7791F)', color: active ? 'var(--navy)' : '#fff',
                    borderRadius: 12, fontSize: 12, fontWeight: 800, padding: '1px 8px' }}>{it.badge}</span>}
                </div>
              </Link>
            )
          })}
        </aside>
      )}
      <div style={showSidebar ? { flex: 1, minWidth: 0 } : undefined}>
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
          <Route path="/mywork" element={<MyWork profile={profile} />} />
          <Route path="/dashboard" element={profile.role === 'admin' ? <AdminDashboard /> : <Navigate to="/" />} />
        </Routes>
      </ErrorBoundary>
      </div>
      </div>
      {showBottomNav && (
        <>
          <div style={{ height: 64 }} />
          <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 25,
            background: 'var(--navy)', display: 'flex',
            paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {[
              { to: '/', label: t('pos'), icon: '📋', active: location.pathname === '/' || location.pathname.startsWith('/po/') },
              { to: '/mywork', label: t('myWork'), icon: '🛠', active: location.pathname === '/mywork' },
              { to: '/reference', label: t('reference'), icon: '🖼', active: location.pathname === '/reference' },
            ].map(t => (
              <Link key={t.to} to={t.to} style={{ flex: 1, textDecoration: 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  padding: '8px 0 10px', color: '#fff', opacity: t.active ? 1 : 0.6,
                  borderTop: t.active ? '3px solid #fff' : '3px solid transparent', fontWeight: 700, fontSize: 12 }}>
                  <span style={{ fontSize: 20 }}>{t.icon}</span>{t.label}
                </div>
              </Link>
            ))}
          </nav>
        </>
      )}
    </>
  )
}
