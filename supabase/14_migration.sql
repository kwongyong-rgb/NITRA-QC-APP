-- Migration 14: a small shared library of custom (user-added) final dispositions.
-- The approver can type a one-off disposition on a report and optionally tick
-- "save for future use", which inserts a row here so it appears in the dropdown
-- for every future report. cls is the colour/severity bucket: pass | hold | reject | pending.

create table if not exists custom_dispositions (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  cls         text not null default 'hold',
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- avoid duplicate labels (case-insensitive)
create unique index if not exists custom_dispositions_label_uniq
  on custom_dispositions (lower(label));

alter table custom_dispositions enable row level security;

-- Any authenticated user may read the library and add to it; the approver curates it.
drop policy if exists custom_disp_read on custom_dispositions;
create policy custom_disp_read on custom_dispositions
  for select to authenticated using (true);

drop policy if exists custom_disp_insert on custom_dispositions;
create policy custom_disp_insert on custom_dispositions
  for insert to authenticated with check (true);

drop policy if exists custom_disp_delete on custom_dispositions;
create policy custom_disp_delete on custom_dispositions
  for delete to authenticated using (true);
