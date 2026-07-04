# v67 — Phase 2: Users & roles

## Renames (atomic with migration 18)
- Role value **approver → admin** everywhere: database (migration), all app
  role checks, manage-users edge function. User-facing wording updated
  ("awaiting admin sign-off", "Amend details (admin)", etc.). Report labels
  like "Approved By / 批准人" are unchanged (they describe the approval, not
  the role).
- **Team → Users**: nav label (EN "Users" / 中文 "用户管理"), route `/users`
  (old `/team` redirects), page copy updated.

## New
- **Customer role** (third role). Customers who sign in see a holding page
  only — the real dashboard is Phase 3. IMPORTANT: do not onboard real
  customers until Phase 3 ships the RLS lockdown.
- **Temporary-password user creation**: in Add a user, choose "invite email"
  (unchanged) or "temporary password" — admin sets/generates a password, no
  email is sent, and the account is forced to choose a new password on first
  sign-in (user_metadata.must_reset gate + SetPassword forced mode).
- **PO assignment for customers**: per-customer "POs" button on the Users page
  opens a checkbox list of all POs; stored in the new `po_access` table
  (admin-managed; customers can read only their own rows — used by Phase 3).
- manage-users edge function v2: `create_with_password` action, three-role
  validation, admin-first sort, transition-safe caller check (accepts
  'approver' or 'admin').

## Deploy (ORDER MATTERS)
1. SQL: run migration 18 (role rename + po_access).
2. PowerShell: `supabase functions deploy manage-users --project-ref nzzktgstpifevaqyapyw`
   (keep jwt — no --no-verify-jwt).
3. App: push to GitHub -> Vercel green -> reinstall PWA.
Between steps 1 and 3 the OLD deployed app checks role==='approver', so admin
menus vanish for a few minutes until Vercel finishes. Inspector flows are
unaffected. manage-users keeps working throughout (accepts both).
