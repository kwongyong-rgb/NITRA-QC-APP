# NITRA QC App — v30 (Container form: photo RLS fix + non-pallet + pallet nav)

## Photo save fix (migration 08)
The "new row violates row-level security policy for table photos" error: migration
07 added the column but its policy section didn't apply (Supabase auto-commits each
statement, so a mid-script error left the photo policies un-updated). Migration 08
re-applies ONLY the policies, cleanly and idempotently. Run it and photos save.

## Non-Pallet Loading
Choosing "Non-pallet" now shows a Non-Pallet Loading section where you add each
part number loaded and its quantity (the Pallet Packing section is hidden; only the
Container Loading Inspection Photos remain).

## Pallet navigation
Instead of scrolling through every pallet, there's now a pallet-number strip (1…N)
— tap a number to jump to that pallet's card (like the piece navigation on the
Visual/Technical tabs). Numbers with data are tinted so you can see progress.

Changed: pages/ContainerLoading.tsx; new supabase/08_migration.sql.

## Deploy
1. Supabase SQL Editor: run 08_migration.sql   ← fixes container photo saving
2. Vercel: replace files, commit, push.

## Verified
- tsc -b: 0 errors.
