# NITRA QC App — v15 (report content/formatting changes)

Changed: src/pages/ReportPage.tsx + supabase/functions/interactive-report/index.ts

1. "Inspection Summary" header  →  "Inspection Report"
2. "Remarks"  →  new "Summary" card containing an AUTO-GENERATED outcome
   narrative (e.g. "1 parameter required 100% inspection: Area D — Rim horn
   inside. All other inspected parameters passed."), with the inspector's
   typed remarks shown below it if present.
3. "Defect Log"  →  "Inspection Outcome", rebuilt as a per-parameter table:
   Inspected Parameter | Checked | Pass | Fail | Defect Pieces | Outcome
   - Checked = how many wheels were inspected for that parameter
   - Defect Pieces = the piece numbers that failed (e.g. #3, Extra 1)
   - Outcome = Pass / Additional Inspection — Pass / 100% Inspection
     (colour-coded green / amber / red)
   Computed from form_data (results, extra_results, meas_*, hundred_pct) via
   the rule engine — NOT from the raw defects table, so the duplicate
   "(100% check)" rows do not appear.

## Deploy
- Vercel: replace files, commit, push (ReportPage changed).
- Supabase: redeploy ONLY interactive-report (its data output changed):
    supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
  send-report did NOT change this round — no need to redeploy it.

## Verified
- Front-end strict type check: 0 errors.
- interactive-report transpiles clean.
