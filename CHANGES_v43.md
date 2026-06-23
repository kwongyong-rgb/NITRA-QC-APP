# NITRA QC App — v43 (custom report logo per report)

The approver can set a custom logo on a wheel inspection report (e.g. the client's
logo) before sending it out; otherwise the default NITRA logo is used.

## What's added
- On any report, the approver sees "🖼 Set report logo" (and "Reset logo"). Upload
  an image; a preview shows it on the navy header background.
- The custom logo appears on BOTH the emailed report header and the public
  interactive report page (linked in the email). No custom logo = NITRA as before.
- Setting/resetting the logo is recorded in the amendment history.

Changed: pages/Inspection.tsx, pages/ReportPage.tsx,
supabase/functions/send-report (email header logo),
supabase/functions/interactive-report (logoUrl in output); new
supabase/12_migration.sql.

## Deploy
1. Supabase SQL Editor: run 12_migration.sql
2. Vercel: replace files, commit, push.
3. Redeploy both report functions (PowerShell in repo folder):
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
4. Reinstall the PWA.

## Verified
- tsc -b: 0 errors. Both edge functions: esbuild clean.

## Note
The logo is per-report (set it before sending each one). If you'd rather set a
client logo once and reuse it across all that client's reports (per-PO or a small
logo library), I can do that as a follow-up.
