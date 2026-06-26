# NITRA QC App — v51 (logo blends into header)

Removed the white plate behind the report logo so it sits directly on the navy header
and blends in (the AVO logo already has a navy background). Applied to the interactive
report page and the email header.

Changed: pages/ReportPage.tsx, supabase/functions/send-report.

## Deploy
1. Vercel: replace files, commit, push (report page).
2. supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw (email).
3. Hard-refresh / InPrivate to confirm.
