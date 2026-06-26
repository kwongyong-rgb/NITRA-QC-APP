-- ============================================================
-- Migration 06 — run in Supabase SQL Editor
-- Fix: reassigning / copying a photo silently does nothing.
-- Cause: the photos table has no UPDATE policy, so RLS lets the
-- query "succeed" but it affects 0 rows (same class of bug that
-- migration 04 fixed for inspections).
-- Fix: add permissive insert / update / delete policies on photos
-- scoped to the owning inspection's inspector, or any approver.
-- Safe to re-run (drop ... if exists first); permissive policies
-- are OR'd with any existing ones, so this never tightens access.
-- "Success. No rows returned" = it worked.
-- ============================================================

alter table photos enable row level security;

drop policy if exists "photos_insert_owner" on photos;
create policy "photos_insert_owner" on photos for insert
  with check (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ));

drop policy if exists "photos_update_owner" on photos;
create policy "photos_update_owner" on photos for update
  using (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ))
  with check (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ));

drop policy if exists "photos_delete_owner" on photos;
create policy "photos_delete_owner" on photos for delete
  using (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ));
