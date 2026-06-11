import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, Link } from 'react-router-dom'
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

export interface Profile { id: string; full_name: string; role: 'inspector' | 'approver' }

export default function App() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const { lang, setLang, t } = useI18n()
  const nav = useNavigate()

  useEffect(() => {
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
  }, [])

  if (profile === undefined) return <div className="page">…</div>
  if (profile === null) return <Login />

  return (
    <>
      <header className="topbar">
        <Link to="/"><img src="/logo-white.png" alt="NITRA" /></Link>
        <span className="title">{t('appTitle')}</span>
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
      </header>
      <Routes>
        <Route path="/" element={<Home profile={profile} />} />
        <Route path="/new" element={<NewInspection profile={profile} />} />
        <Route path="/inspection/:id" element={<Inspection profile={profile} />} />
        <Route path="/approvals" element={profile.role === 'approver' ? <Approvals /> : <Navigate to="/" />} />
        <Route path="/settings" element={profile.role === 'approver' ? <Settings /> : <Navigate to="/" />} />
        <Route path="/skus" element={profile.role === 'approver' ? <Skus /> : <Navigate to="/" />} />
        <Route path="/reference" element={<RefLibrary profile={profile} />} />
      </Routes>
    </>
  )
}
