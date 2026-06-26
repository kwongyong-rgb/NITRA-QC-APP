# NITRA QC App — v48 (new disposition + fix stray "REJECT")

## 1. New disposition option
Added "Conditional Loading — Rework Rejected Pieces & Load" (code: conditional_rework)
to the disposition dropdown, in EN/中文, and to all report outputs (in-app, emailed
report, public report page, PDF).

## 2. Why the email said "REJECT"
The disposition dropdown only offers Approved / Hold-Rework / Conditional / Pending —
there is no Reject option. This report had a leftover disposition value of "reject"
stored from an older build that DID have a Reject option. Because "reject" no longer
matches any dropdown option, the selector showed blank (looked unchosen) — but the
stored value was still "reject", and the email/report mapped it to a red REJECT.

Fix: the report now recognises ONLY the current dispositions. Anything else — empty,
or a legacy value like "reject"/"release"/"hold_100" — now displays a neutral
"PENDING DISPOSITION" (grey) instead of REJECT. So an undisposed/draft report no
longer claims REJECT. Applied to the emailed report, the public report page, and the
PDF (the PDF previously also showed raw codes for the current dispositions — now fixed).

To clear it on this report: just pick the correct disposition in the dropdown; it
overwrites the stale value.

Changed: pages/Inspection.tsx, lib/i18n.tsx, pages/ReportPage.tsx, lib/report.ts,
supabase/functions/send-report.

## Deploy
1. Vercel: replace files, commit, push (dropdown, report page, PDF).
2. Redeploy the email function:
   supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
   (interactive-report unchanged this round; no need to redeploy it.)
3. Hard-refresh / InPrivate to confirm.

## Verified
- tsc -b: 0 errors. send-report + interactive-report: esbuild clean.
