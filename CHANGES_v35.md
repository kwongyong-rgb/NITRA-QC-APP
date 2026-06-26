# NITRA QC App — v35 (SKU import: one header-aware reader for any known format)

Replaces the master-OR-simple branch with a single resolver that:
- Normalises every column header (lowercase, strips spaces/dots/underscores).
- Matches each SKU field against known names + common variants, and reads from
  whichever column is present.
- Handles size/PCD as a single string (19X8.5 / 5X112) or as separate
  diameter/width/lug-hole/bolt-circle columns.
- Load: uses Load Rating Lbs as lbs, or Wheel Load converting kg→lb only when the
  value says "kg".
- Wheel weight: Wheel Weight Lbs (→kg) or Wheel Weight Kg.
- Clear message if no part-number column is found.

Recognised aliases include: part no / part number / new_part_number; model /
style name; size / wheel diameter+width; pcd / lug holes+bolt circle mm; et /
offset mm; cb / production cb mm; color / colour / factory finish name; wheel load
/ load rating lbs; tpms sensor mm; upc / fitment / lug seat.

Adding a new alias for an unseen header is a one-line change.

Changed: pages/Skus.tsx only.

## Deploy
Vercel only: replace files, commit, push.

## Verified
- tsc -b: 0 errors.
- Dry-run on feifei_motec_order: 6 SKUs, identical to v34 (no regression).
