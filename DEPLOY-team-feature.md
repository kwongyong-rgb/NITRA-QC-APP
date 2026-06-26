# NITRA QC — Team page + manage-users: deploy steps

This adds an approver-only **Team** page (invite users, set Inspector/Approver,
deactivate/reactivate) and the **manage-users** edge function behind it.

Unzip this into your repo so the files drop into place (files at repo ROOT):
- `src/App.tsx`            (replaces — adds Team link, /team route, invite flow)
- `src/lib/i18n.tsx`       (replaces — adds the "Team" label EN/中文)
- `src/pages/TeamPage.tsx` (NEW)
- `src/pages/SetPassword.tsx` (NEW)
- `supabase/functions/manage-users/index.ts` (NEW)

There are NO SQL migrations to run. Nothing to paste into the SQL Editor.

---

## PIPELINE 1 — App/UI (src/) → GitHub → Vercel

1. Unzip into `C:\Users\Razer\Documents\GitHub\NITRA-QC-APP` (let it overwrite
   App.tsx and i18n.tsx; the two new pages just appear).
2. GitHub Desktop → commit ("Add approver Team page + manage-users") → Push.
3. Wait for Vercel to go green.
4. On the iPad: delete the PWA, clear Safari cache, reinstall.

## PIPELINE 2 — Edge function (deploy SEPARATELY, in PowerShell in the repo)

Deploy WITH jwt verification (this is staff-only — do NOT add --no-verify-jwt):

    supabase functions deploy manage-users --project-ref nzzktgstpifevaqyapyw

"WARNING: Docker is not running" is harmless. Make sure you unzipped the file
into the repo BEFORE deploying, or it ships old/empty code.

No new secrets needed — it uses SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the
Resend key, which are already set.

---

## ONE Supabase dashboard setting to check (or invites won't land)

The invite email contains a link that sends the user back to the app. Supabase
only allows redirects to URLs on its allow-list.

Supabase Dashboard → Authentication → URL Configuration:
- **Site URL** should be `https://nitra-qc-app.vercel.app`
- Under **Redirect URLs**, make sure `https://nitra-qc-app.vercel.app/**` is listed.

If that's already how reports/login work, you're fine — nothing to change.

(Optional) The invite email "from" defaults to `NITRA QC <kyong@nitrawheels.com>`.
To change it, set an `INVITE_FROM_EMAIL` secret in Supabase (any verified
address on nitrawheels.com).

---

## How to test (5 minutes)

1. Open the live app signed in as kyong@ (approver). You should see **Team** in
   the top menu. Inspectors should NOT see it.
2. Team → **Invite user** → enter a name, an email you can check, role =
   Inspector → Send invite.
3. Check that inbox → click "Set my password" → you land on the set-password
   screen → choose a password → you're signed in as that user.
4. Back as kyong@, change that user's role to Approver via the dropdown, then
   **Deactivate** and **Reactivate** them.

## Notes / guardrails built in
- The function re-checks server-side that the CALLER is an approver before doing
  anything — it never trusts a role sent from the browser, and the service-role
  key never touches the browser.
- You can't demote or deactivate your OWN account (prevents locking yourself
  and every other approver out by accident).
- Emails come from `auth.users` via the admin API inside the function — the
  `profiles` table is never queried for an email (that's the column-that-doesn't-
  exist bug from the handoff).
- "Remove" is **Deactivate** (reversible), not a hard delete, by design.
