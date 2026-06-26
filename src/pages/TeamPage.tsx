import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Role = 'inspector' | 'approver'
interface TeamUser {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
  is_self: boolean
}
interface InviteDraft { full_name: string; email: string; role: Role }
const EMPTY_INVITE: InviteDraft = { full_name: '', email: '', role: 'inspector' }

interface ManageResult {
  ok: boolean
  error?: string
  warning?: string
  users?: TeamUser[]
  user_id?: string
  email?: string
}

// All privileged work happens server-side in the manage-users edge function,
// which re-verifies that the caller is an approver. The browser only ever holds
// the anon key + the logged-in session (auto-attached by functions.invoke).
async function callManageUsers(body: Record<string, unknown>): Promise<ManageResult> {
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  if (error) {
    // Edge function returned non-2xx; try to surface its JSON error message.
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    }
    return { ok: false, error: msg }
  }
  return data as ManageResult
}

export default function TeamPage() {
  const [rows, setRows] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [invite, setInvite] = useState<InviteDraft | null>(null)
  const [inviting, setInviting] = useState(false)

  const load = async () => {
    setLoading(true); setErr('')
    const res = await callManageUsers({ action: 'list' })
    if (res?.ok) setRows(res.users as TeamUser[])
    else setErr(res?.error || 'Could not load users.')
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const sendInvite = async () => {
    if (!invite) return
    if (!invite.full_name.trim()) { setErr('Full name is required.'); return }
    if (!/.+@.+\..+/.test(invite.email.trim())) { setErr('Enter a valid email.'); return }
    setInviting(true); setErr('')
    const res = await callManageUsers({
      action: 'invite',
      full_name: invite.full_name.trim(),
      email: invite.email.trim(),
      role: invite.role,
    })
    setInviting(false)
    if (res?.ok) {
      setInvite(null)
      flash(res.warning ? res.warning : `Invite sent to ${invite.email.trim()}.`)
      load()
    } else {
      setErr(res?.error || 'Invite failed.')
    }
  }

  const changeRole = async (u: TeamUser, role: Role) => {
    if (role === u.role) return
    setBusyId(u.id); setErr('')
    const res = await callManageUsers({ action: 'set_role', user_id: u.id, role })
    setBusyId(null)
    if (res?.ok) { flash(`${u.full_name || u.email} is now ${role === 'approver' ? 'Approver' : 'Inspector'}.`); load() }
    else { setErr(res?.error || 'Could not change role.'); load() }
  }

  const toggleActive = async (u: TeamUser) => {
    const deactivating = u.active
    const verb = deactivating ? 'Deactivate' : 'Reactivate'
    if (!confirm(`${verb} ${u.full_name || u.email}?\n\n${deactivating
      ? 'They will be blocked from signing in. You can reactivate them at any time.'
      : 'They will be able to sign in again.'}`)) return
    setBusyId(u.id); setErr('')
    const res = await callManageUsers({ action: deactivating ? 'deactivate' : 'reactivate', user_id: u.id })
    setBusyId(null)
    if (res?.ok) { flash(`${u.full_name || u.email} ${deactivating ? 'deactivated' : 'reactivated'}.`); load() }
    else { setErr(res?.error || `Could not ${verb.toLowerCase()}.`); load() }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Team {rows.length ? `(${rows.length})` : ''}</h2>
          <button className="btn" onClick={() => { setErr(''); setInvite({ ...EMPTY_INVITE }) }}>+ Invite user</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Invite people, set whether they\u2019re an Inspector or Approver, and deactivate anyone who should no longer have access.
          Approvers can manage SKUs, settings, approvals and this page; inspectors cannot.
        </p>

        {err && <div className="muted" style={{ color: 'var(--red, #C0392B)', marginBottom: 10 }}>{err}</div>}
        {msg && <div className="muted" style={{ color: 'var(--green, #1F8A4C)', marginBottom: 10 }}>{msg}</div>}

        {loading ? <p className="muted">Loading\u2026</p> : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                  <td>{u.full_name || '\u2014'}{u.is_self && <span className="muted" style={{ fontSize: 12 }}> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className="txt"
                      style={{ minHeight: 36, padding: '4px 8px' }}
                      value={u.role}
                      disabled={busyId === u.id || (u.is_self)}
                      title={u.is_self ? 'You cannot change your own role' : ''}
                      onChange={e => changeRole(u, e.target.value as Role)}
                    >
                      <option value="inspector">Inspector</option>
                      <option value="approver">Approver</option>
                    </select>
                  </td>
                  <td style={{ color: u.active ? 'var(--green, #1F8A4C)' : 'var(--red, #C0392B)', fontWeight: 600 }}>
                    {u.active ? 'Active' : 'Deactivated'}
                  </td>
                  <td>
                    {!u.is_self && (
                      <button
                        className="btn ghost"
                        style={{ minHeight: 36, padding: '4px 10px', borderColor: u.active ? 'var(--amber, #B7791F)' : 'var(--green, #1F8A4C)', color: u.active ? 'var(--amber, #B7791F)' : 'var(--green, #1F8A4C)' }}
                        disabled={busyId === u.id}
                        onClick={() => toggleActive(u)}
                      >{u.active ? 'Deactivate' : 'Reactivate'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invite && (
        <div className="modal-overlay" onClick={() => setInvite(null)}>
          <div className="modal" style={{ width: 'min(460px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Invite a user</h2>
              <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => setInvite(null)}>\u2715</button>
            </div>
            <div className="grid2">
              <label className="fld"><span>Full name</span>
                <input className="txt" value={invite.full_name} autoFocus
                  onChange={e => setInvite({ ...invite, full_name: e.target.value })} /></label>
              <label className="fld"><span>Email</span>
                <input className="txt" type="email" value={invite.email}
                  onChange={e => setInvite({ ...invite, email: e.target.value })} /></label>
              <label className="fld"><span>Role</span>
                <select className="txt" value={invite.role}
                  onChange={e => setInvite({ ...invite, role: e.target.value as Role })}>
                  <option value="inspector">Inspector</option>
                  <option value="approver">Approver</option>
                </select></label>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              They\u2019ll get a branded email from kyong@nitrawheels.com with a link to set their own password.
            </p>
            {err && <div className="muted" style={{ color: 'var(--red, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={sendInvite} disabled={inviting}>{inviting ? 'Sending\u2026' : 'Send invite'}</button>
              <button className="btn ghost" onClick={() => setInvite(null)} disabled={inviting}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
