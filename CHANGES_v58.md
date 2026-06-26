# NITRA QC App — v58 (batch part 2/3: Container Loading interactive report)

## Photos now optional (with a submit warning)
- The Container Loading Inspection Photos are no longer hard-required. The "photo
  required" markers are now neutral "no photo yet" hints.
- On "Submit for approval", if any inspection item (container photos or a pallet label)
  has no photo, a popup lists exactly which items are missing and asks whether to submit
  anyway without those pictures. Container number is still required.

## Container Loading interactive report (like the wheel report)
- NEW public page /container-report/{id} with an EN / DE / 中文 toggle: status banner,
  shipping & container details (PO, container, seal, BL, loading type, pallets, date
  loaded, ETD, ETA, departure/destination port, inspector, approver), loaded contents,
  per-pallet packing checks, and clickable photo/video evidence.
- NEW edge function `container-report` feeds that page (signs photos, resolves labels,
  translates dynamic text + caches per container).
- On the Container Loading page, a "Report" section (approver, or once approved) with:
  🔗 View interactive report · 📄 PDF report · 📧 Email interactive report ·
  🖼 Set/Change report logo · 🪄 Logo cut-out background · Reset logo.
- 📄 PDF report = printable A4 PDF (new openContainerReport in lib/report.ts).
- The emailed container report now leads with an "Open Interactive Report" button.

## Files
NEW: supabase/functions/container-report/, src/pages/ContainerReportPage.tsx,
     supabase/16_migration.sql
EDIT: src/pages/ContainerLoading.tsx (photos optional + logo/report buttons),
      src/lib/report.ts (openContainerReport), src/App.tsx (route),
      supabase/functions/send-container-report/index.ts (report link)

## DEPLOY
1. SQL Editor → run 16_migration.sql (adds container_loadings.report_logo_path).
2. Vercel: replace files, commit, push, wait green.
3. Edge functions (PowerShell in repo):
   supabase functions deploy container-report      --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy send-container-report --project-ref nzzktgstpifevaqyapyw
   (container-report MUST be --no-verify-jwt — public page. send-* keep JWT.)
4. Reinstall the PWA / hard-refresh.

## Verified
- tsc -b: 0 errors. All 6 edge functions: esbuild clean.

## Next — part 3/3
Consolidated report rework: containers first (Container # · BL · ETD · ETA · Destination,
linking to this new container report), wheel table (drop Failing Pieces, Size as its own
column, add PCD · CB · ET · Color, link each SKU to its report), remove tap-to-expand
sections and the Jump-to nav, add Email + PDF on the consolidated report.
