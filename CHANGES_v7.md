# NITRA QC App — v7 changes

## New: PDF Report (item 10)
- `src/lib/report.ts` — browser-generated bilingual PDF report (Option A).
  Opens a print window and triggers Save-as-PDF. Pulls live data: SKU, defects,
  photos (signed URLs), inspector/approver names, rule outcome, 100% results.
- Button **📄 PDF Report** added to:
  - Summary tab (`src/pages/Inspection.tsx`)
  - each row in Approvals (`src/pages/Approvals.tsx`)
- Report sections: header + disposition banner, meta, Inspection Outcome (plain
  language + failing piece #s), 100% Inspection Results (when triggered),
  Defect Log (one row per failed piece, stage-tagged), Remarks, Photo Appendix
  (Required Shots + per-parameter, pass before defect). A4, no sign-off block.
  Logo loads from /logo-white.png.

## Wheel weight + TPMS wiring (items 3 & 8) — from v6
- `src/pages/Skus.tsx` — Excel importer maps WHEEL_WEIGHT_LBS→kg and TPMS_SENSOR_MM;
  manual Add/Edit form gained Weight (kg) / tolerance / TPMS fields; table shows them.
- `src/lib/standard.ts` — TPMS item relabelled as a match-check; weight shown at 2 dp.
- Header weight display formatted to 2 dp (Inspection / NewInspection).

## Notes
- No new database migration needed (migration 05 already added the columns/seed data).
- Verified: `tsc` (strict, project config) passes with 0 errors.
