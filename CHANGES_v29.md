# NITRA QC App — v29 (Container Loading form rework)

Builds on v28 (Batch 4.1). Addresses all feedback on the +Container form.

## Header
- Container number and Seal number each get a 📷 camera to photograph the actual
  number / sealed seal. (Photos can be deleted.)
- New "Loading type": Pallet vs Non-pallet. Pallet → Pallet Packing section shows.
  Non-pallet → only Container Loading Inspection Photos show.
- Loaded contents now listed per pallet: "Pallet 1: SKU-A × 100, SKU-B × 50", so
  you can see which pallet holds which SKUs and how many.

## Pallet Packing
- Each pallet's packing checks now have All P / All F / All NA / ↶ Undo.
- Pallet label photo, contents rows, and per-check photos all show thumbnails with
  a 🗑 delete.

## Container Loading Inspection Photos (renamed from "Container Loading checks")
- No Pass/Fail — each item just needs a photo. Submission is blocked until every
  item (and, for pallet loads, every pallet label) has a photo.
- Items + instructions:
  • Container Condition: Exterior — all 4 sides incl. damage, before loading
  • Container Condition: Interior — interior incl. damage, before loading
  • Container Loading: Empty / Half Full / Full
  • Wheels loaded by size & part number
  • Box labels & hand-holes facing container door
  • Spare boxes & caps at front
  • Protective net after loading

## Fixes
- Photo capture now reports errors instead of failing silently (the "camera does
  nothing" issue — almost always because migration 07 hasn't been run yet).
- Every photo can be deleted (🗑) on every parameter.

Changed: lib/standard.ts, pages/ContainerLoading.tsx. No new migration.

## Deploy
1. If you haven't already: Supabase SQL Editor → run 07_migration.sql (REQUIRED —
   without it, container photos can't save).
2. Vercel: replace files, commit, push.

## Verified
- tsc -b: 0 errors.
