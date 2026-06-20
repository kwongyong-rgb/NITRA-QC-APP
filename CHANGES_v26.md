# NITRA QC App — v26 (Report appendix + Photos rename/delete + Batch 3: Pallet Packing)

## Photos & report
1. Tab renamed "Photos" → "Photos & Videos".
2. Delete: each photo/video now has a 🗑 delete action (with confirm).
3. Photo / Video Appendix in the Inspection Report (both the in-app Summary view
   AND the emailed web report) now uses the same layout as the Photos tab:
   split into "Approved Inspection Photos" and "Failed Inspection Photos", each
   grouped by section header → inspection parameter.

## Batch 3 — Pallet tab → "Pallet Packing"
- Now per-pallet, like the wheel grid. Enter the "Number of pallets" (1–22); each
  pallet-packing parameter then shows a grid of pallets 1..N with P / F / NA,
  All P / All F / All NA, camera ＋ on a pallet (tap the pallet number), and Undo.
  No defect type / severity on a fail (just an optional photo).
- The container-level checks (container condition/empty, box labels face doors,
  no loose wheels, spares at front, net/rope) are split off into a clearly-marked
  "Container Loading" section for now — these move to the PO level in Batch 4.

Changed: lib/standard.ts, lib/i18n.tsx, pages/Inspection.tsx, pages/ReportPage.tsx,
supabase/functions/interactive-report (adds parameter key to photo groups).

## Deploy
1. Vercel: replace files, commit, push, wait Ready.
2. Supabase — redeploy interactive-report (needed for the report appendix to group
   by section):
     supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   (send-report unchanged; no new DB migration — migration 06 from v25 still applies.)

## Verified
- tsc -b: 0 errors. interactive-report transpiles clean.

## Note
Old inspections used a flat pallet checklist; their pallet data won't appear in the
new per-pallet grid (new inspections use per-pallet). Container items still use the
flat keys, so those carry over.
