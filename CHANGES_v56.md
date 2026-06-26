# NITRA QC App — v56 (Batch 4.4: Consolidated PO report)

This build INCLUDES everything from v55 (rich-text corrective action + custom
dispositions) PLUS the consolidated PO report. If you deploy v56 you do not also
need to deploy v55 — but you must run BOTH migration 14 and 15.

## Consolidated PO report
A single shareable, public report at /po-report/{PO} containing:
- OVERVIEW — PO header + roll-up tables: every wheel SKU (part no · model · disposition
  · failing-piece count) and every container (no. · seal · disposition · status).
- STICKY JUMP-TO NAV — Overview · each SKU · each container.
- A COLLAPSIBLE full section per SKU (findings, corrective action, outcome table, photo
  evidence — same content as its own report) and per container (seal, loading type,
  packing-check pass/fail, loaded contents, corrective action, photos).
- EN / DE / 中文 language toggle (reuses the same Claude translation + cache).

How it's built (kept the existing single report untouched):
- New edge function `po-report` aggregates the PO: it calls `interactive-report` once per
  inspection (so each SKU's data + translation is identical to its own report) and builds
  each container's summary inline, translating the container's dynamic text.
- New page `src/pages/PoReportPage.tsx` (public route, no login).
- New edge function `send-po-report` emails a link + overview to recipients.
- PO hub: the "coming soon" button is replaced by "Open consolidated report" +
  "✉ Email consolidated report".

## Files
NEW: supabase/functions/po-report/, supabase/functions/send-po-report/,
     src/pages/PoReportPage.tsx, supabase/15_migration.sql
EDIT: src/App.tsx (public route), src/pages/PoHub.tsx (buttons)
(plus all v55 files: RichText, Inspection, ReportPage, lib/report, interactive-report,
 send-report, 14_migration.sql)

## DEPLOY — full set
1. SQL Editor → run 14_migration.sql, then 15_migration.sql.
   (15 widens the translation-cache key so the PO report caches its translations.)
2. Vercel: replace files, commit, push, wait green.
3. Edge functions (PowerShell in repo):
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy po-report          --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy send-report         --project-ref nzzktgstpifevaqyapyw
   supabase functions deploy send-po-report      --project-ref nzzktgstpifevaqyapyw
   (po-report MUST be --no-verify-jwt — it feeds a public page. send-* keep JWT.)
4. Reinstall the PWA / hard-refresh.

## Verified
- tsc -b: 0 errors. po-report, send-po-report, interactive-report, send-report: esbuild clean.

## Notes / first-version scope
- Each SKU/container section is collapsed by default; tap to expand.
- Container section shows packing-check pass/fail counts + which checks failed (not每
  per-pallet line) — can expand to per-pallet later if wanted.
- A PO with many SKUs makes the page fetch each SKU's report; first open may take a few
  seconds (then translations are cached).
