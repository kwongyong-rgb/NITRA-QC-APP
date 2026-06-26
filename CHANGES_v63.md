# NITRA QC App — v63 (report polish, email fixes, SKU fallback, back buttons)

## SKU info on container report
- Loaded Contents now falls back to the BASE MODEL when a specific finish variant isn't
  registered: e.g. "MCF1-8519 MB ET45 MLG" now borrows Size/PCD/CB/ET from the registered
  MCF1-8519 model (Color stays blank until that exact SKU is added).
- Part numbers whose base model is NOT in the SKU master at all (e.g. the whole MCF1-9020
  family) still need to be added to the SKUs page — there's nothing to borrow from.

## Container interactive report
- Removed the container icon next to the status (e.g. "LOADED").

## Container Loading PDF — readability overhaul
- Section headers are now solid navy bars; table headers are navy and now actually print
  (added print-color-adjust). Loaded Contents has aligned columns, zebra striping and a
  right-aligned Qty. Photo appendix groups are boxed and clearly separated. Icon removed.

## Container Loading email — Image 5
- Removed Loaded Contents, Non-Pallet Loading and Container Loading Inspection Photos.
- Now shows a clean "Shipping & Container Details" block (PO, Container, Seal, BL, Loading
  Type, Date Loaded, ETD, ETA, Departure/Destination Port, Inspector, Approved By).

## Consolidated PO report
- PUBLIC page Email now works — send-po-report is deployed so the report page can call it
  (and it reports exactly who it was sent to / any error).
- PDF: header sits next to the AVO logo (like the interactive report); section + table
  headers are navy and print correctly; zebra rows. Layout matches the interactive report.

## Container Loading Inspection page
- "Container Loading" card renamed to "Container Details".
- Back button now returns to the PREVIOUS page (labelled "← Back"), not Home.
- Submitting now records the submitting user as the Inspector, so the inspector/approver
  names appear on the report (approver name appears once approved).

## In-app PO page
- "Consolidated PO report" description spacing fixed and text updated (no more jump-to).

## Wheel Inspection page
- Added a "← Back" button.

## Files
- supabase/functions/container-report (model fallback), send-container-report (email),
  src/pages/ContainerReportPage, ContainerLoading, Inspection, PoHub, PoReportPage,
  src/lib/report.ts (both PDFs)

## DEPLOY
1. Vercel: replace files, commit, push, wait green.
2. Edge functions (PowerShell in repo):
   supabase functions deploy container-report      --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy send-container-report --project-ref nzzktgstpifevaqyapyw
   supabase functions deploy send-po-report        --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   (send-po-report changes to --no-verify-jwt so the public report's Email button works.)
3. Hard-refresh / reinstall the PWA. (No migration.)

## Verified
- tsc -b: 0 errors. All 4 edge functions: esbuild clean.
