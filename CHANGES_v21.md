# NITRA QC App — v21 (Cleanup Batch 1 of 5)

1. New Inspection: the part-number dropdown now closes immediately when you pick
   one (touch-safe).
2. Defect capture (camera ＋ on a Fail) simplified:
   - Appearance areas A–D: defect type = Paint Inclusions / Casting Failure ·
     Porosity / Scratches · Hair Lint. No severity.
   - Area E: defect type = Burrs on TPMS Hole. No severity.
   - TPMS parameter: renamed to "TPMS Dimension"; no defect type (a fail means it
     didn't match).
   - All other Visual + all Dimension parameters: no defect type, no severity —
     just an optional photo/video. Severity removed everywhere.
   - Technical fails keep the OPTIONAL "measured value" field.
3. Inspection Report tab: "Summary" renamed to "Inspection Findings".
4. New "Corrective Action / Disposition" free-text box with one-tap wording
   templates (100% inspection + rework / exclude failed pieces / customer
   approval / acceptable — load) the inspector can insert and edit. Replaces the
   old free-text remarks; shows in the report and email.
5. Final Disposition replaced with the 4 options: Approved for Loading / Hold for
   Rework & Reinspection / Conditional Loading — Failed Pieces Excluded / Pending
   Customer Approval. Email + interactive report updated to match.

Changed: NewInspection.tsx, components/PhotoModal.tsx, lib/standard.ts,
lib/i18n.tsx, pages/Inspection.tsx, pages/ReportPage.tsx,
supabase/functions/interactive-report + send-report.

## Deploy
1. Vercel: replace files, commit, push, wait Ready.
2. Supabase — redeploy BOTH (labels + corrective action changed):
     supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
     supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw

## Verified
- tsc -b (exact Vercel build gate): 0 errors. Edge functions transpile clean.

## Next batches
2: Photos tab (reassign + copy) · 3: Pallet Packing per-pallet ·
4: PO hub + Container Loading + consolidated report · 5: amend + version history.
