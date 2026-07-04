// Supabase Edge Function: manage-users
// Approver-only account management for the NITRA QC app.
//
// SECURITY MODEL
// - Deployed WITH jwt verification (no --no-verify-jwt). Supabase's gateway first
//   proves the caller has *a* valid logged-in session.
// - This function then independently re-checks that the caller is an APPROVER by
//   resolving caller JWT -> user id -> profiles.role using the service role.
//   The role is NEVER trusted from the client body.
// - The service-role key lives only in this function's env, never in the browser.
//
// ACTIONS (POST body { action, ... })
//   list                         -> all users merged: id, email, full_name, role, active
//   invite { full_name, email, role }  -> create auth user + profile, email a branded
//                                         "set password" link via Resend
//   set_role { user_id, role }   -> update profiles.role
//   deactivate { user_id }       -> ban the user (reversible)
//   reactivate { user_id }       -> lift the ban
import { createClient } from 'jsr:@supabase/supabase-js@2'

type Role = 'inspector' | 'admin' | 'customer'
const BAN_FOREVER = '876000h' // ~100 years; reversible via reactivate

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1) Resolve and verify the caller from their JWT (server-side, not the body).
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ ok: false, error: 'Not signed in.' }, 401)

    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt)
    if (callerErr || !caller?.user) return json({ ok: false, error: 'Invalid session.' }, 401)
    const callerId = caller.user.id

    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', callerId).single()
    // Accept both 'admin' (current) and 'approver' (pre-rename) so this
    // function keeps working regardless of SQL/deploy ordering.
    if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'approver') {
      return json({ ok: false, error: 'Admin access required.' }, 403)
    }

    // 2) Dispatch the requested action.
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'list') {
      const users = await listAllAuthUsers(admin)
      const { data: profiles } = await admin.from('profiles').select('id, full_name, role')
      const pMap = new Map((profiles || []).map((p: any) => [p.id, p]))
      const rows = users.map((u) => {
        const p = pMap.get(u.id) as any
        const banned = u.banned_until ? new Date(u.banned_until).getTime() > Date.now() : false
        return {
          id: u.id,
          email: u.email || '',
          full_name: p?.full_name || '',
          role: (p?.role as Role) || 'inspector',
          active: !banned,
          is_self: u.id === callerId,
        }
      })
      // Stable, readable order: admins, then inspectors, then customers, then by name.
      const rank = (r: string) => r === 'admin' ? 0 : r === 'inspector' ? 1 : 2
      rows.sort((a, b) =>
        (rank(a.role) - rank(b.role)) ||
        (a.full_name || a.email).localeCompare(b.full_name || b.email))
      return json({ ok: true, users: rows })
    }

    if (action === 'invite') {
      const full_name = String(body.full_name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const role = body.role as Role
      if (!full_name) return json({ ok: false, error: 'Full name is required.' }, 400)
      if (!/.+@.+\..+/.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400)
      if (!['inspector', 'admin', 'customer'].includes(role)) return json({ ok: false, error: 'Role must be admin, inspector, or customer.' }, 400)

      // Reject duplicates up front (clear error beats a silent no-op).
      const existing = await findUserByEmail(admin, email)
      if (existing) return json({ ok: false, error: `A user with ${email} already exists.` }, 409)

      const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')

      // generateLink(type:'invite') creates the auth user AND returns the action
      // link WITHOUT sending Supabase's own email — so we can send a branded one.
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: { full_name }, redirectTo: appUrl },
      })
      if (linkErr || !linkData?.user || !linkData?.properties?.action_link) {
        return json({ ok: false, error: `Could not create invite: ${linkErr?.message || 'unknown error'}` }, 500)
      }
      const newUserId = linkData.user.id
      const actionLink = linkData.properties.action_link

      // Create the profile now, with the chosen name + role, so authority is
      // correct from the start instead of waiting for first sign-in.
      const { error: pErr } = await admin.from('profiles').upsert({ id: newUserId, full_name, role })
      if (pErr) {
        return json({ ok: false, error: `User created but profile failed: ${pErr.message}` }, 500)
      }

      // Branded invite email via Resend.
      const sent = await sendInviteEmail(email, full_name, role, actionLink)
      if (!sent.ok) {
        return json({ ok: true, warning: `User created, but the invite email failed to send: ${sent.error}. You can re-send by removing and re-inviting, or share the set-password link manually.`, user_id: newUserId }, 200)
      }
      return json({ ok: true, user_id: newUserId, email })
    }

    if (action === 'create_with_password') {
      // Admin creates the account directly with a temporary password. The
      // user is forced to choose their own password on first sign-in
      // (user_metadata.must_reset gates the app until they do).
      const full_name = String(body.full_name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const role = body.role as Role
      const password = String(body.password || '')
      if (!full_name) return json({ ok: false, error: 'Full name is required.' }, 400)
      if (!/.+@.+\..+/.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400)
      if (!['inspector', 'admin', 'customer'].includes(role)) return json({ ok: false, error: 'Role must be admin, inspector, or customer.' }, 400)
      if (password.length < 8) return json({ ok: false, error: 'Temporary password must be at least 8 characters.' }, 400)

      const existing = await findUserByEmail(admin, email)
      if (existing) return json({ ok: false, error: `A user with ${email} already exists.` }, 409)

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name, must_reset: true },
      })
      if (cErr || !created?.user) return json({ ok: false, error: `Could not create user: ${cErr?.message || 'unknown error'}` }, 500)

      const { error: pErr } = await admin.from('profiles').upsert({ id: created.user.id, full_name, role })
      if (pErr) return json({ ok: false, error: `User created but profile failed: ${pErr.message}` }, 500)
      return json({ ok: true, user_id: created.user.id, email })
    }

    if (action === 'set_role') {
      const user_id = String(body.user_id || '')
      const role = body.role as Role
      if (!['inspector', 'admin', 'customer'].includes(role)) return json({ ok: false, error: 'Role must be admin, inspector, or customer.' }, 400)
      if (!user_id) return json({ ok: false, error: 'Missing user_id.' }, 400)
      // Guard: an admin cannot demote themselves (prevents locking out all admins by accident).
      if (user_id === callerId && role !== 'admin') {
        return json({ ok: false, error: 'You cannot change your own role away from admin.' }, 400)
      }
      const { error } = await admin.from('profiles').update({ role }).eq('id', user_id)
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'deactivate' || action === 'reactivate') {
      const user_id = String(body.user_id || '')
      if (!user_id) return json({ ok: false, error: 'Missing user_id.' }, 400)
      if (action === 'deactivate' && user_id === callerId) {
        return json({ ok: false, error: 'You cannot deactivate your own account.' }, 400)
      }
      const { error } = await admin.auth.admin.updateUserById(user_id, {
        ban_duration: action === 'deactivate' ? BAN_FOREVER : 'none',
      })
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ ok: false, error: `Unknown action: ${action || '(none)'}` }, 400)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// --- helpers ---------------------------------------------------------------

async function listAllAuthUsers(admin: ReturnType<typeof createClient>) {
  const all: any[] = []
  let page = 1
  // Page through in case the team ever grows past one page.
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    all.push(...data.users)
    if (data.users.length < 200) break
    page++
    if (page > 25) break // hard safety stop
  }
  return all
}

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  const users = await listAllAuthUsers(admin)
  return users.find((u) => (u.email || '').toLowerCase() === email) || null
}

async function sendInviteEmail(email: string, fullName: string, role: Role, actionLink: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }
  const roleLabel = role === 'admin' ? 'Admin' : role === 'customer' ? 'Customer' : 'Inspector'
  const html = inviteHtml(fullName, roleLabel, actionLink)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('INVITE_FROM_EMAIL') || 'NITRA QC <kyong@nitrawheels.com>',
        to: [email],
        subject: 'You\u2019ve been invited to the NITRA QC app',
        html,
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status} ${t}`.trim() }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

function inviteHtml(fullName: string, roleLabel: string, actionLink: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:560px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">QC Inspection App</div>
</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px;border-radius:0 0 10px 10px">
  <p style="margin-top:0">Hi ${esc(fullName)},</p>
  <p>You\u2019ve been added to the NITRA QC inspection app as <b>${esc(roleLabel)}</b>. Click below to set your password and sign in.</p>
  <p style="text-align:center;margin:26px 0"><a href="${esc(actionLink)}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;display:inline-block">Set my password</a></p>
  <p style="font-size:12px;color:#5A6878">If the button does not work, copy and paste this link into your browser:<br><a href="${esc(actionLink)}">${esc(actionLink)}</a></p>
  <p style="font-size:12px;color:#5A6878">This link can only be used once and expires for security. If you didn\u2019t expect this invite, you can ignore this email.</p>
</div></body></html>`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}
