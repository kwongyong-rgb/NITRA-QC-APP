# NITRA QC App — v39 (Technical tab: Lug seat type check + import aliases)

## Technical tab — Lug seat type
- New "Lug seat type" parameter in the Wheel Machining section, right under Seat
  thickness. Instead of a numeric nominal/tolerance, it shows "Required: <type>" —
  the lug seat type from that SKU's record — and the inspector marks P/F/NA per
  piece on whether the wheel matches. Flows into the report like any other check.

## SKU import — extra columns recognised
Now also recognises Lug Seat Type (Lug Seat / Seat Type), Seat Thickness mm,
Lug Hole mm, and Counter Bore mm, so the upload template round-trips fully.

Changed: lib/standard.ts, pages/Inspection.tsx, pages/Skus.tsx,
supabase/functions/interactive-report (added the lug_seat_type label).

## Deploy
1. Vercel: replace files, commit, push.
2. Redeploy the report function (PUBLIC, JWT off):
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. No migration. Reinstall the PWA.

## Verified
- tsc -b: 0 errors. interactive-report: esbuild clean.

## Note
Existing SKUs have a blank Lug seat type until you fill it (SKU editor or re-import
with the Lug Seat Type column) — until then the check shows "Required: —".
