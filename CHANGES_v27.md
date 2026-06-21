# NITRA QC App — v27 (Pallet/Container: camera + per-parameter undo)

1. Camera ＋ on every pallet cell and every container item, available regardless
   of P/F/NA (so e.g. "photo of each pallet" can be attached even on a pass).
2. Undo moved from one button at the bottom to a per-parameter ↶ Undo on each
   pallet-packing parameter and each container item — undoes the latest action
   for that parameter only. Shows a count where relevant.

Changed: pages/Inspection.tsx only. Vercel-only deploy.

## Verified
- tsc -b: 0 errors.
