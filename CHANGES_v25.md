# NITRA QC App — v25 (Fix: photo reassign silently failing)

## Cause
The photos table had no UPDATE policy, so reassigning a photo passed RLS but
updated 0 rows — exactly the class of silent failure migration 04 fixed for
inspections. Copy (insert) is also covered by the same migration.

## The fix (REQUIRED) — run SQL
Run `supabase/06_migration.sql` in the Supabase SQL Editor (Dashboard → SQL
Editor → paste → Run). "Success. No rows returned" = done. It adds permissive
insert/update/delete policies on photos for the inspection's inspector or any
approver. Safe to re-run.

## App change (optional but recommended)
Reassign now surfaces errors instead of failing silently: if the DB blocks it
you'll see a clear message telling you to run migration 06.

Changed: components/PhotoModal.tsx; new supabase/06_migration.sql.

## Deploy
1. Supabase SQL Editor: run 06_migration.sql   ← this fixes reassign/copy
2. Vercel (optional, for the clearer error message): replace files, commit, push.

## Verified
- tsc -b: 0 errors.
