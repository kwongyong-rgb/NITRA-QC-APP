# NITRA QC App — v16

## In-app Summary tab now matches the interactive report
- NEW src/lib/outcome.ts — shared per-parameter outcome calc (mirrors the
  interactive-report function), so the app Summary tab and the emailed report
  show identical results.
- src/pages/Inspection.tsx — Summary tab rebuilt:
  - Title "Inspection Report"
  - "Summary" section with the auto-generated outcome narrative
  - "Inspection Outcome" table: Inspected Parameter | Checked | Pass | Fail |
    Defect Pieces | Outcome  (colour-coded), replacing the old Defect Log + the
    defect/photo count cards.
  - Disposition selector, remarks, submit, and the PDF/Email buttons kept.

## Carried from v15 (still need deploying if not already live)
- interactive-report returns per-parameter `outcomes`; ReportPage renders the
  same "Inspection Report / Summary / Inspection Outcome" layout.
- send-report email link points to https://nitra-qc-app.vercel.app/report/<id>.

## Deploy
1. Vercel: replace files, commit, push, wait Ready.
2. Supabase — deploy BOTH functions (safe to re-run):
     supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
     supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
3. Send a NEW report email (old emails keep the old link) and open that one.

## Verified
- Front-end strict type check: 0 errors.
- Both edge functions transpile clean.
