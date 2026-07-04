import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Role = 'inspector' | 'admin' | 'customer'
interface TeamUser {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
  is_self: boolean
}
interface InviteDraft { full_name: string; email: string; role: Role; mode: 'invite' | 'password'; password: string }
const EMPTY_INVITE: InviteDraft = { full_name: '', email: '', role: 'inspector', mode: 'invite', password: '' }
const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', inspector: 'Inspector', customer: 'Customer' }
const genPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  const rnd = new Uint32Array(12); crypto.getRandomValues(rnd)
  for (const n of rnd) out += chars[n % chars.length]
  return out
}

interface ManageResult {
  ok: boolean
  error?: string
  warning?: string
  users?: TeamUser[]
  user_id?: string
  email?: string
}

// All privileged work happens server-side in the manage-users edge function,
// which re-verifies that the caller is an admin. The browser only ever holds
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
  // PO assignment for customer users
  const [assignFor, setAssignFor] = useState<TeamUser | null>(null)
  const [allPos, setAllPos] = useState<{ id: string; po_no: string; customer_name: string | null }[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [assignBusy, setAssignBusy] = useState(false)

  const openAssign = async (u: TeamUser) => {
    setErr(''); setAssignBusy(true); setAssignFor(u)
    const [{ data: pos }, { data: acc }] = await Promise.all([
      supabase.from('pos').select('id,po_no,customer_name').order('po_no'),
      supabase.from('po_access').select('po_id').eq('customer_id', u.id),
    ])
    setAllPos((pos as { id: string; po_no: string; customer_name: string | null }[]) || [])
    setChecked(new Set(((acc as { po_id: string }[]) || []).map(a => a.po_id)))
    setAssignBusy(false)
  }

  const saveAssign = async () => {
    if (!assignFor) return
    setAssignBusy(true); setErr('')
    const del = await supabase.from('po_access').delete().eq('customer_id', assignFor.id)
    if (del.error) { setErr(del.error.message); setAssignBusy(false); return }
    if (checked.size) {
      const ins = await supabase.from('po_access').insert([...checked].map(po_id => ({ customer_id: assignFor.id, po_id })))
      if (ins.error) { setErr(ins.error.message); setAssignBusy(false); return }
    }
    setAssignBusy(false)
    flash(`${assignFor.full_name || assignFor.email}: ${checked.size} PO(s) assigned.`)
    setAssignFor(null)
  }

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
    if (invite.mode === 'password' && invite.password.length < 8) { setErr('Temporary password must be at least 8 characters.'); return }
    setInviting(true); setErr('')
    const res = await callManageUsers(invite.mode === 'invite'
      ? { action: 'invite', full_name: invite.full_name.trim(), email: invite.email.trim(), role: invite.role }
      : { action: 'create_with_password', full_name: invite.full_name.trim(), email: invite.email.trim(), role: invite.role, password: invite.password })
    setInviting(false)
    if (res?.ok) {
      const created = invite
      setInvite(null)
      if (created.mode === 'password') {
        flash(`User created. Give them the temporary password — they'll be asked to change it on first sign-in.`)
        alert(`User created for ${created.email.trim()}\n\nTemporary password:\n${created.password}\n\nShare this with them securely. They must change it on first sign-in.`)
      } else {
        flash(res.warning ? res.warning : `Invite sent to ${created.email.trim()}.`)
      }
      load()
    } else {
      setErr(res?.error || 'Could not create the user.')
    }
  }

  const changeRole = async (u: TeamUser, role: Role) => {
    if (role === u.role) return
    setBusyId(u.id); setErr('')
    const res = await callManageUsers({ action: 'set_role', user_id: u.id, role })
    setBusyId(null)
    if (res?.ok) { flash(`${u.full_name || u.email} is now ${ROLE_LABEL[role]}.`); load() }
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
          <h2 style={{ margin: 0 }}>Users {rows.length ? `(${rows.length})` : ''}</h2>
          <button className="btn" onClick={() => { setErr(''); setInvite({ ...EMPTY_INVITE }) }}>+ Add user</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Add users and set their access level. Admins have full control; Inspectors record inspections; Customers can only view reports for POs assigned to them (customer dashboard arrives in the next update).
        </p>

        {err && <div className="muted" style={{ color: 'var(--red, #C0392B)', marginBottom: 10 }}>{err}</div>}
        {msg && <div className="muted" style={{ color: 'var(--green, #1F8A4C)', marginBottom: 10 }}>{msg}</div>}

        {loading ? <p className="muted">Loading…</p> : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                  <td>{u.full_name || '—'}{u.is_self && <span className="muted" style={{ fontSize: 12 }}> (you)</span>}</td>
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
                      <option value="admin">Admin</option>
                      <option value="inspector">Inspector</option>
                      <option value="customer">Customer</option>
                    </select>
                  </td>
                  <td style={{ color: u.active ? 'var(--green, #1F8A4C)' : 'var(--red, #C0392B)', fontWeight: 600 }}>
                    {u.active ? 'Active' : 'Deactivated'}
                  </td>
                  <td>
                    {u.role === 'customer' && (
                      <button className="btn ghost" style={{ minHeight: 36, padding: '4px 10px', marginRight: 6 }}
                        disabled={busyId === u.id} onClick={() => openAssign(u)}>POs</button>
                    )}
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
              <h2 style={{ margin: 0 }}>Add a user</h2>
              <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => setInvite(null)}>✕</button>
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
                  <option value="admin">Admin</option>
                  <option value="inspector">Inspector</option>
                  <option value="customer">Customer</option>
                </select></label>
            </div>
            <label className="fld"><span>How should they get access?</span>
              <select className="txt" value={invite.mode}
                onChange={e => setInvite({ ...invite, mode: e.target.value as 'invite' | 'password', password: e.target.value === 'password' && !invite.password ? genPassword() : invite.password })}>
                <option value="invite">Send invite email (they set their own password)</option>
                <option value="password">I’ll give them a temporary password</option>
              </select></label>
            {invite.mode === 'password' && (
              <label className="fld"><span>Temporary password</span>
                <div className="row" style={{ gap: 8 }}>
                  <input className="txt" style={{ flex: 1 }} value={invite.password}
                    onChange={e => setInvite({ ...invite, password: e.target.value })} />
                  <button className="btn ghost" style={{ minHeight: 40, padding: '4px 12px' }} onClick={() => setInvite({ ...invite, password: genPassword() })}>↻ New</button>
                </div>
              </label>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              {invite.mode === 'invite'
                ? 'They’ll get a branded email from kyong@nitrawheels.com with a link to set their own password.'
                : 'No email is sent. Share the temporary password with them securely — they’ll be required to change it the first time they sign in.'}
            </p>
            {err && <div className="muted" style={{ color: 'var(--red, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={sendInvite} disabled={inviting}>{inviting ? 'Working…' : (invite.mode === 'invite' ? 'Send invite' : 'Create user')}</button>
              <button className="btn ghost" onClick={() => setInvite(null)} disabled={inviting}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {assignFor && (
        <div className="modal-overlay" onClick={() => setAssignFor(null)}>
          <div className="modal" style={{ width: 'min(480px, 94vw)', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Assign POs — {assignFor.full_name || assignFor.email}</h2>
            <p className="muted" style={{ fontSize: 13 }}>This customer will only be able to view reports for the ticked POs. (The customer dashboard itself arrives in the next update.)</p>
            {assignBusy && !allPos.length ? <p className="muted">Loading…</p> : (
              allPos.length === 0 ? <p className="muted">No POs exist yet.</p> :
              allPos.map(p => (
                <label key={p.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 20, height: 20 }} checked={checked.has(p.id)}
                    onChange={e => { const n = new Set(checked); if (e.target.checked) n.add(p.id); else n.delete(p.id); setChecked(n) }} />
                  <span style={{ fontWeight: 700 }}>{p.po_no}</span>
                  {p.customer_name && <span className="muted" style={{ fontSize: 13 }}>{p.customer_name}</span>}
                </label>
              ))
            )}
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginTop: 8 }}>{err}</div>}
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" disabled={assignBusy} onClick={saveAssign}>{assignBusy ? 'Saving…' : 'Save assignments'}</button>
              <button className="btn ghost" disabled={assignBusy} onClick={() => setAssignFor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
