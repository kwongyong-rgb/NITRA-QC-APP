# NITRA QC App — v22 (Batch 1 tweaks)

Builds on v21. Two changes to the Inspection Report tab:

1. The "Corrective Action / Disposition" box now sits directly UNDER Inspection
   Findings (was near the bottom).
2. One-tap wording templates are now DYNAMIC — they pull in the names of the
   parameters that actually failed this inspection. Templates:
   - Rework failed param + load → "Factory to rework wheels with failed
     parameter(s): <failed params> (100% inspection conducted), and load after rework."
   - 100% inspect + rework + reinspect
   - Exclude failed pieces
   - Pending customer
   - Acceptable — load
   (If nothing failed, they read "the affected parameter(s)".)
   Each button appends its line so you can stack several, then edit freely.

Changed: pages/Inspection.tsx only. Edge functions UNCHANGED from v21.

## Deploy
- Vercel: replace files, commit, push, wait Ready.
- Supabase functions: only if you have NOT already deployed v21's versions
  (no function code changed between v21 and v22).

## Verified
- tsc -b: 0 errors.
