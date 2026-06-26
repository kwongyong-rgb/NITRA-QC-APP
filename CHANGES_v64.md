# v64 — Approver-managed Team page + manage-users edge function

## New
- **Team page** (approver-only): top-bar "Team" link + `/team` route, guarded the
  same way as Settings/SKUs. Lists all users (name / email / role / status),
  invite new users, change Inspector⇄Approver, deactivate/reactivate.
  - `src/pages/TeamPage.tsx`
- **Set-password screen** for invited users: `src/pages/SetPassword.tsx`.
  App.tsx detects an invite / password-reset link and routes to it before the
  normal login/profile gate.
- **`manage-users` edge function** (`supabase/functions/manage-users/index.ts`),
  service-role / Admin API. Actions: list, invite (branded Resend email with a
  set-password link), set_role, deactivate, reactivate.

## Security / behaviour
- The function resolves the caller's JWT → user id → `profiles.role` on the
  server and refuses anything that isn't an approver. Role is never trusted from
  the client; the service-role key never reaches the browser.
- Self-protection: you can't demote or deactivate your own account.
- Emails come from `auth.users` via the Admin API (the `profiles` table has no
  email column).
- Profiles are created at invite time with the chosen role, so authority is
  correct from first sign-in.

## Touched
- `src/App.tsx` (Team link, /team route, invite/recovery interception)
- `src/lib/i18n.tsx` (team label EN/中文)

## Deploy
- App: push to GitHub → Vercel.
- Edge function (separate): `supabase functions deploy manage-users --project-ref nzzktgstpifevaqyapyw` (KEEP jwt — no --no-verify-jwt).
- Check Supabase Auth → URL Configuration allows redirect to the app URL.
- No SQL migrations.
