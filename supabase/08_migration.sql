-- ============================================================
-- Migration 08 — run in Supabase SQL Editor
-- Fix: "new row violates row-level security policy for table photos"
-- when adding a Container Loading photo. Migration 07 added the column
-- but its policy section didn't apply. This re-applies ONLY the RLS
-- policies, cleanly and idempotently. Run the WHOLE thing.
-- "Success. No rows returned" = done.
-- ============================================================

-- Make sure the linkage column exists and inspection_id is optional
alter table photos add column if not exists container_loading_id uuid references container_loadings(id) on delete cascade;
alter table photos alter column inspection_id drop not null;

-- container_loadings policies (in case 07 didn't finish them)
alter table container_loadings enable row level security;

drop policy if exists "cl_select" on container_loadings;
create policy "cl_select" on container_loadings for select
  using (inspector_id = auth.uid() or is_approver());

drop policy if exists "cl_insert" on container_loadings;
create policy "cl_insert" on container_loadings for insert
  with check (inspector_id = auth.uid() or is_approver());

drop policy if exists "cl_update_inspector" on container_loadings;
create policy "cl_update_inspector" on container_loadings for update
  using (inspector_id = auth.uid()) with check (inspector_id = auth.uid());

drop policy if exists "cl_update_approver" on container_loadings;
create policy "cl_update_approver" on container_loadings for update
  using (is_approver()) with check (is_approver());

drop policy if exists "cl_delete" on container_loadings;
create policy "cl_delete" on container_loadings for delete
  using ((inspector_id = auth.uid() and insp_status in ('draft','rejected')) or is_approver());

-- photos policies — allow insert/update/delete when the photo belongs to an
-- inspection OR a container loading the user owns (or the user is an approver)
drop policy if exists "photos_insert_owner" on photos;
create policy "photos_insert_owner" on photos for insert
  with check (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

drop policy if exists "photos_update_owner" on photos;
create policy "photos_update_owner" on photos for update
  using (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  )
  with check (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

drop policy if exists "photos_delete_owner" on photos;
create policy "photos_delete_owner" on photos for delete
  using (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );
