# NITRA QC App — v18

## Summary now shows one bullet per parameter (easier to read)
Both the in-app Summary tab and the emailed interactive report list each
parameter/issue on its own line instead of one combined sentence, e.g.:
  • Area D — Rim horn inside — required 100% inspection
  • Rear centre bore + mounting face paint-free — required 100% inspection
  • All other inspected parameters passed.

Changed (front-end only):
- src/lib/outcome.ts — summaryText() replaced with summaryItems() returning a
  list of bullet strings.
- src/pages/Inspection.tsx and src/pages/ReportPage.tsx — render the Summary as
  a bulleted list; ReportPage's duplicate builder removed (now shared).

## Deploy — Vercel ONLY this time
The Edge Functions did NOT change, so no Supabase redeploy is needed.
1. Replace files with v18, commit, push, wait for Ready.
That's it.

## Verified
- `tsc -b` (exact Vercel build gate): 0 errors.

## Note on "Defect Pieces" wording
#3 = piece 3 of the original sample failed.
Extra 1 = the 1st additional (extra-sample) piece failed.
A bare number = that piece in a 100% inspection failed.
(Tell me if you'd prefer "Additional 1" instead of "Extra 1".)
