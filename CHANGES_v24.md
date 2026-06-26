# NITRA QC App — v24 (Photos tab refinements)

Builds on v23. Photos tab changes:

1. Removed the "Required Shots" section entirely (and its assign-to-slot flow).
2. The gallery now lists EVERY Visual & Technical parameter, grouped under its
   section header — even parameters with no photos (shown as "— no photos —").
   This makes empty parameters visible so you can fill them: tap ↻ Reassign or
   ⧉ Copy on a photo elsewhere and pick the empty parameter as the target.
3. Kept the All / Approved / Failed filter; each photo still shows its P/F badge
   and the ↻ Reassign / ⧉ Copy actions.

Note: photos taken on the Pallet tab are managed there (Pallet is being reworked
in Batch 3), so they don't appear in this Visual/Technical gallery.

Changed: pages/Inspection.tsx only. No edge-function, i18n, or schema changes.

## Deploy — Vercel ONLY
Replace files, commit, push, wait Ready.

## Verified
- tsc -b: 0 errors.
