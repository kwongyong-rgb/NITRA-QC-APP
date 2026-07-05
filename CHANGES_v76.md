# v76 — B5: verdict-first reports + "Disposition" vocabulary unified

## Vocabulary: one term, one Chinese, everywhere
Canonical term is now **Disposition / 处置** across the whole app, matching the
QC Standard V2.0 (which already used it — so the standard doc needs no change).
Retired "Final Decision" / "最终决定" / "Final disposition" everywhere.

Chinese disposition VALUES aligned to the standard (they had drifted — the app
even disagreed with itself between the in-app and consolidated reports):

| Disposition | Canonical 中文 | was (app) |
|---|---|---|
| Approved for Loading | 批准装柜 | (already correct) |
| Hold for Rework & Reinspection | 暂扣返工并重检 | 暂停 — 返工与复检 |
| Conditional Loading — Failed Pieces Excluded | 有条件装柜 — 已剔除不合格件 | …剔除… (missing 已) |
| Conditional Loading — Rework Rejected & Load | 有条件装柜 — 返工不合格件后装柜 | 返工后装柜 (consolidated) |
| Pending Customer Approval | 待客户批准 | (already correct) |

Verified: all five now appear identically in `i18n.tsx`, `report.ts`, and
`ReportPage.tsx`.

## Report re-layout (verdict-first)
Both reports already lead with the verdict banner. Refinements:
- **Fixed a bug:** the print report (`report.ts`) titled two different sections
  "Inspection Outcome". The second (per-piece table) is now **Inspection Findings /
  检验发现**.
- **"Corrective Action / Disposition" → "Action Taken / 处置措施"** in both the
  print report and the interactive report.
- **Disposition banner repeated at the bottom** of both reports (top + tail).

Surfaces touched: `i18n.tsx`, `report.ts` (print/PDF path), `ReportPage.tsx`
(interactive + emailed/public `/report/:id` path), `CustomerHome.tsx` (customer
portal label, EN/DE/FR-CA).

## Scope correction — app-only, NO edge-function deploy
Earlier I expected B5 to need Pipeline B for three edge functions. Tracing
showed the `interactive-report` / `container-report` / `po-report` functions
return **JSON (disposition codes)**, not HTML — all report layout and text is
rendered client-side. So there is **nothing to deploy to the functions**; the
public/emailed report renders through `ReportPage`, which these edits cover.
**Deploy = Pipeline A only.**

## Not done (flagged)
The interactive viewer's body order is Findings → Criteria → Outcome; the
print/PDF report is Outcome → Findings → Action. Both are verdict-banner-first.
If you want the interactive viewer's sections reordered to exactly match the
print report (Outcome above Findings), that's a small follow-up — say the word.

## Build gate
- `tsc -b` clean; `vite build` OK; `rules-of-hooks`: 0 across src.
- Grep-verified: no stale "Final Decision" / old Chinese remains.
