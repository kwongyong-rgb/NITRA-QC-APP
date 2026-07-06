# v79 — Bugfix: findings summary contradicted the outcome table

## The bug
The "Inspection Findings" summary said *"All inspected parameters passed on the
initial sample"* even when the Outcome table showed a failure (e.g. Area A:
Fail = 1, "Additional Inspection Required").

Cause: the findings builder bucketed outcomes into only two groups — "100%
Inspection" and "Additional Inspection — Pass" — and printed "all passed" when
both were empty. The **"Additional Inspection Required"** outcome (a base-sample
failure that hasn't had additional sampling yet) matched neither bucket, so a
real failure fell through and was silently reported as a pass.

## The fix
Findings now also surface "Additional Inspection Required" parameters, e.g.
*"Area A — Front / design — failed the initial sample; additional inspection
required"*, and "all passed" only prints when there are genuinely no issues.

Fixed in both places that build this summary:
- `src/lib/outcome.ts` (`summaryItems`) — the in-app Inspection Report tab.
- `src/pages/ReportPage.tsx` (`buildFindings`) — the interactive / emailed
  report, with a new bilingual+trilingual label (EN / DE / FR? — DE + ZH added).

The print/PDF report was not affected (it lists actual defect rows, not this
auto-summary). The outcome table itself was always correct.

## Scope / deploy
- **No migrations, no edge-function deploys. App-only (Pipeline A).**
- Files: `src/lib/outcome.ts`, `src/pages/ReportPage.tsx`.

## Build gate
- `tsc -b` clean; `vite build` OK; `rules-of-hooks`: 0.
