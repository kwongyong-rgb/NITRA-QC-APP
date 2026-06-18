# CHANGES v15 — Interactive Report Formatting

Updated the interactive report formatting:

- Renamed the main report header from "Inspection Summary" to "Inspection Report".
- Renamed the remarks area to "Summary".
- Added automatic inspection summary wording based on report outcomes:
  - lists parameters requiring 100% inspection
  - lists parameters requiring pending additional inspection
  - lists parameters where additional inspection passed
  - states no additional/100% inspection was required when clean
- Replaced the old interactive Defect Log table with an "Inspection Outcome" table.
- Added outcome columns:
  - Inspected Parameter
  - Checked (wheels inspected)
  - Pass
  - Fail
  - Defect Pieces
  - Outcome
  - Photo / Video
- Defect pieces now display as #1, #2 instead of Piece 1, Piece 2.
- Supabase interactive-report function now returns outcomes and summaryText for the Vercel report page.
- Updated browser print/PDF report wording to use "Summary" and clarified the Checked header.

Build verified with npm run build.
