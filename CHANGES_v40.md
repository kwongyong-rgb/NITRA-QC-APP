# NITRA QC App — v40 (template split columns + Bolt Circle alias)

- Importer now also accepts a plain "Bolt Circle" header (in addition to
  "Bolt Circle mm"). Separate Wheel Diameter / Wheel Width and Lug Holes /
  Bolt Circle columns are combined into Size and PCD on upload, exactly as a
  single Size / PCD column would be.
- Upload template updated: Size is split into Wheel Diameter + Wheel Width, and
  PCD into Lug Holes + Bolt Circle.

Changed: pages/Skus.tsx (includes all v39 changes).

## Deploy
1. Vercel: replace files, commit, push.
2. If not already done from v39, redeploy the report function:
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. No migration. Reinstall the PWA.

## Verified
- tsc -b: 0 errors.
- Template round-trip: 19 + 8.5 -> 19x8.5, 5 + 112 -> 5x112.
