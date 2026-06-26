# NITRA QC App — v34 (SKU Excel import accepts the simple order-file format)

## Why your upload added nothing
The importer was built for the master wheel-data file and kept only rows with a
NEW_PART_NUMBER column. Your order file uses Part No. / Model / Size / PCD / ET /
CB / Color / Wheel Load, so every row was filtered out and it imported 0 — silently.

## Fix
The importer now auto-detects the file type:
- Master file (has NEW_PART_NUMBER) → unchanged behaviour.
- Simple order file (Part No., Model, Size, PCD, ET, CB, Color, Wheel Load) →
  mapped to SKU fields. Size "19X8.5" → 19x8.5 + diameter 19; PCD "5X112" →
  5x112 + bolt circle 112; ET → offset; CB → cb_mm; Color → finish; Wheel Load
  "600kg" → max load in lb (kg→lb). Lug-seat detail, wheel weight and TPMS are
  left blank (not in the order file) and can be filled in the SKU editor.
- If no rows are recognised, it now says so clearly instead of "Imported 0".

Changed: pages/Skus.tsx only.

## Deploy
Vercel only: replace files, commit, push. (No migration, no function.)

## Verified
- tsc -b: 0 errors.
- Dry-run of the mapping on feifei_motec_order: 6 SKUs map correctly.

## Open question
Part numbers import with the spaces from the file (e.g. "MCF1-8519 MB ET45 BLACK").
If your existing SKUs use dashes, say so and I'll normalise spaces→dashes.
