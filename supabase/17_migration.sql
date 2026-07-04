-- Migration 17: PO master data (Phase 1 of the PO-centered rebuild).
-- Creates the `pos` (purchase orders) and `po_items` (ordered part numbers +
-- quantities) tables, and BACKFILLS a pos row for every PO number that already
-- exists on inspections or container loadings.
--
-- SAFETY: this migration only CREATES tables and INSERTS rows. It does not
-- modify or delete anything in inspections, container_loadings, photos, or any
-- other existing table. All existing reports and inspection data are untouched.

create table if not exists pos (
  id            uuid primary key default gen_random_uuid(),
  po_no         text not null,
  customer_name text,
  po_date       date,
  destination   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists pos_po_no_uniq on pos (po_no);

create table if not exists po_items (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references pos(id) on delete cascade,
  part_no      text not null,
  qty_ordered  integer not null default 0,
  created_at   timestamptz not null default now()
);

create unique index if not exists po_items_po_part_uniq on po_items (po_id, part_no);

alter table pos enable row level security;
alter table po_items enable row level security;

-- Everyone signed in can read PO master data (inspectors need it for
-- validation and autofill). Only the approver/admin role can write it.
-- The role check accepts BOTH 'approver' and 'admin' so the Phase 2 role
-- rename will not break these policies.

drop policy if exists pos_read on pos;
create policy pos_read on pos
  for select to authenticated using (true);

drop policy if exists pos_write on pos;
create policy pos_write on pos
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists pos_update on pos;
create policy pos_update on pos
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists pos_delete on pos;
create policy pos_delete on pos
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists po_items_read on po_items;
create policy po_items_read on po_items
  for select to authenticated using (true);

drop policy if exists po_items_write on po_items;
create policy po_items_write on po_items
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists po_items_update on po_items;
create policy po_items_update on po_items
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists po_items_delete on po_items;
create policy po_items_delete on po_items
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

-- ---- BACKFILL: one pos row per existing PO number (inserts only) ----
insert into pos (po_no)
select distinct po_no from inspections
where po_no is not null and btrim(po_no) <> ''
on conflict (po_no) do nothing;

insert into pos (po_no)
select distinct po_no from container_loadings
where po_no is not null and btrim(po_no) <> ''
on conflict (po_no) do nothing;
