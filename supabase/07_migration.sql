-- ============================================================
-- Migration 07 — run in Supabase SQL Editor
-- Batch 4.1: Container Loading records (PO-scoped, separate from
-- per-SKU wheel inspections). Pallet packing + container loading
-- live here, tied to PO + Container No + Seal No.
-- "Success. No rows returned" = it worked. Safe to re-run.
-- ============================================================

create table if not exists container_loadings (
  id uuid primary key default gen_random_uuid(),
  po_no text not null default '',
  container_no text not null default '',
  seal_no text not null default '',
  status text not null default 'in_progress',     -- in_progress / loaded / hold
  data jsonb not null default '{}'::jsonb,         -- { pallet_count, pallets:{n:{contents:[{part_no,qty}], checks:{}}}, container_checks:{} }
  summary jsonb not null default '{}'::jsonb,      -- { disposition, corrective_action }
  inspector_id uuid not null default auth.uid(),
  reviewed_by uuid,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_note text not null default '',
  insp_status text not null default 'draft',       -- draft / submitted / approved / rejected
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- Photos may attach to a container loading instead of an inspection
alter table photos add column if not exists container_loading_id uuid references container_loadings(id) on delete cascade;
alter table photos alter column inspection_id drop not null;

-- Extend photo RLS to cover container-loading photos (inspection OR container owner / approver)
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
