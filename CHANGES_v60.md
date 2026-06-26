# NITRA QC App — v60 (Container report: QC-report look + SKU contents table)

## Container Loading interactive report restyled to match the QC report
- Same visual language as the wheel "QC Interactive Report": navy header bar with logo,
  title, "Live report" subtitle, EN/DE/中文 toggle and a "Viewed" timestamp, then a
  full-width status strip (coloured dot + status + tag) — exactly like the verdict strip.
- White cards with the same border, radius, soft shadow and navy headings; navy table
  headers and the same two-column key/value details table as the QC report.

## Loaded Contents → SKU table
- Instead of "Pallet 1: PART × 10" lines, Loaded Contents is now a table with columns:
  Part Number · Model · Size · PCD · CB · ET · Color · Qty Loaded.
- Quantities are totalled per part number across all pallets; Model/Size/PCD/CB/ET/Color
  are pulled from the SKU master for each part number.
- The PDF report shows the same table.

## Files
- src/pages/ContainerReportPage.tsx (restyle + contents table)
- src/lib/report.ts (container PDF contents table)
- supabase/functions/container-report/index.ts (enrich contents with SKU details)

## Deploy
1. Vercel: replace files, commit, push, wait green.
2. Edge function (PowerShell in repo):
   supabase functions deploy container-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. Hard-refresh / reinstall the PWA.
(No migration. send-container-report unchanged.)

## Verified
- tsc -b: 0 errors. container-report: esbuild clean.

## Note
Model/Size/PCD/CB/ET/Color come from the SKU master, so a loaded part number that
isn't in the SKU list will show "—" for those columns (part no. + qty still show).
