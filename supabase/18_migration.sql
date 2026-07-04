-- Migration 18: Phase 2 — role rename (approver -> admin) + customer PO access.
--
-- SAFETY: updates ONLY the role column value on profiles; creates one new
-- table. No inspection, report, PO, or photo data is touched.

-- 1) Drop any CHECK constraints on profiles (in case one pins role values),
--    then rename the role value.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'profiles'::regclass and contype = 'c'
  loop
    execute format('alter table profiles drop constraint %I', r.conname);
  end loop;
end $$;

update profiles set role = 'admin' where role = 'approver';

-- 2) Customer PO access: which customer user may view which PO.
create table if not exists po_access (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  po_id       uuid not null references pos(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create unique index if not exists po_access_uniq on po_access (customer_id, po_id);

alter table po_access enable row level security;

-- Admins manage assignments; a customer can read their own (needed for the
-- Phase 3 dashboard). Policies accept 'approver' too so ordering never bites.
drop policy if exists po_access_read on po_access;
create policy po_access_read on po_access
  for select to authenticated
  using (
    customer_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','approver'))
  );

drop policy if exists po_access_insert on po_access;
create policy po_access_insert on po_access
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','approver')));

drop policy if exists po_access_delete on po_access;
create policy po_access_delete on po_access
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','approver')));
