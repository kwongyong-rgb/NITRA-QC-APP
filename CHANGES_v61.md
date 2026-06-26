# NITRA QC App — v61 (container report polish + photo reassign/copy)

## Container Loading Inspection PAGE
- The report card ("Container Loading Inspection", renamed from "Container Loading
  Report") now sits at the TOP of the page, formatted like the wheel QC inspection
  header card.
- Button order: PDF Report · View Interactive Report · Email Interactive Report
  (View now next to Email).
- Uploading a report logo (Change report logo / Logo cut-out) now shows a live preview
  of the logo on navy, exactly like the wheel report page.
- Container Loading Inspection Photos can now be REASSIGNED (↻) or COPIED (⧉) to other
  inspection parameters — same as the wheel inspection photos.

## Container Loading INTERACTIVE REPORT
- Status header now reflects the loading STATUS with QC-report colours:
  Loaded = green, In Progress = amber, Hold = red (replaces the draft/insp wording).
- "Photo / Video Evidence" renamed to "Photo / Video Appendix".
- Removed the "Pass" label under each loading photo (these are loading photos, not P/F).
- Loaded Contents now populates the full SKU table once the container-report function is
  redeployed (see deploy) — the blank table was the old function still returning the
  previous format.

## Wheel QC Inspection Report — Inspection Report tab
- Added "View Interactive Report" next to "Email Interactive Report".

## Files
- src/pages/ContainerLoading.tsx, src/pages/ContainerReportPage.tsx,
  src/pages/Inspection.tsx, src/components/PhotoModal.tsx (CopyModal container support)

## DEPLOY
1. Vercel: replace files, commit, push, wait green.
2. Edge function — REQUIRED to fix the blank Loaded Contents:
   supabase functions deploy container-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. Hard-refresh / reinstall the PWA.
(No migration.)

## Verified
- tsc -b: 0 errors. container-report: esbuild clean.
