# NITRA QC App — v62 (SKU-match fix + consolidated report rework / part 3)

## Loaded Contents — missing SKU info
- The SKU lookup now matches the master case-insensitively and ignoring stray spaces,
  so near-miss part numbers fill in.
- Any row still showing "—" for Model/Size/PCD/CB/ET/Color is a part number that is NOT
  in the SKU master at all (e.g. MCF1-8519 MB ET45 MLG, the MCF1-9020 series). Add those
  to the SKUs page and they'll populate everywhere. Part no. + Qty always show regardless.

## Consolidated PO report — reworked (part 3/3)
- Container Loadings now come FIRST, then Wheel Inspections.
- Container table columns: Container No. (click → container interactive report) · BL Number
  · Est. Port Departure · Est. Port Arrival · Destination Port.
- Wheel table columns: Part Number (click → that SKU's interactive report) · Size · PCD ·
  CB · ET · Color · Disposition. (Failing Pieces removed; Size is its own column.)
- Removed the tap-to-expand sections (you open each report by clicking its row) and the
  Jump-to navigation.
- Header now has EN/DE/中文 + PDF + Email buttons. PDF prints a clean two-table overview;
  Email sends the report link via send-po-report.

## Files
- supabase/functions/container-report/index.ts (normalized SKU match)
- supabase/functions/po-report/index.ts (container shipping fields)
- src/pages/PoReportPage.tsx (rework), src/lib/report.ts (openPoReport)

## DEPLOY
1. Vercel: replace files, commit, push, wait green.
2. Edge functions (PowerShell in repo):
   supabase functions deploy container-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy po-report        --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. Hard-refresh / reinstall the PWA.
(No migration. send-po-report unchanged — already deployed.)

## Verified
- tsc -b: 0 errors. po-report + container-report: esbuild clean.
