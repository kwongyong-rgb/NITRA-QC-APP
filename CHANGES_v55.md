# NITRA QC App — v55 (rich-text corrective action + custom dispositions)

## 1. Formatting in the Corrective Action / Disposition box
The plain box is now a small rich-text editor: Bold, Italic, Underline, bullet list,
and numbered list. Saved as HTML. Old plain-text notes still load fine. The formatting
shows on the interactive report (sanitised), the emailed report, and the printable PDF
(the PDF previously didn't show the corrective action at all — now it does). The DE/中文
translation keeps the formatting tags and only translates the text inside them.

## 2. Custom final disposition (+ save for future use)
The disposition dropdown now has: Standard options, a "Saved custom" group, and
"➕ Add custom disposition…". Adding one opens a panel:
  - a text field for the wording,
  - a banner-colour picker (Approved=green / Caution=amber / Reject=red / Neutral=grey),
  - a "Save this disposition for future use" checkbox → "Save to library".
Saved dispositions appear in the dropdown on every future report. The interactive
report, the email, and the PDF all render the custom wording with the chosen colour
(new red "Reject" banner state added).

## Files changed
- src/components/RichText.tsx (new editor)
- src/pages/Inspection.tsx (editor + custom-disposition UI/state)
- src/pages/ReportPage.tsx (HTML render + sanitiser + custom disposition + red state)
- src/lib/report.ts (PDF: corrective action + custom disposition)
- supabase/functions/interactive-report/index.ts (translate custom text; preserve HTML)
- supabase/functions/send-report/index.ts (custom disposition banner)
- supabase/14_migration.sql (custom_dispositions library table)

## DEPLOY — all three pipelines this time
1. SQL Editor: run 14_migration.sql  ("Success. No rows returned").
2. Vercel: replace files, commit, push, wait green. (app + report page)
3. Edge functions (PowerShell in repo):
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
4. Reinstall the PWA / hard-refresh the report link.

## Verified
- tsc -b: 0 errors. interactive-report + send-report: esbuild clean.

## Note
The custom-disposition colour picker only sets the banner colour; it doesn't change
any pass/fail counting. Background HTML is allow-listed (b/i/u/p/ul/ol/li/span) on the
public report, so pasted styles/scripts are stripped.
