-- Migration 22: B6 Stage 2 — sync foundation, part A.
-- Server-authoritative updated_at on inspections + container_loadings.
--
-- WHY: today the app stamps updated_at from the CLIENT clock
-- (new Date().toISOString()). An offline device's clock cannot be trusted to
-- decide "which copy is newer" at sync time. This migration makes the DATABASE
-- stamp updated_at with ITS OWN clock on every insert/update, so updated_at
-- becomes a trustworthy "server last-touched" marker. That is the foundation
-- the later conflict screen uses to compare "server last online update" vs the
-- device's offline-edit time, and to flag (never silently overwrite).
--
-- SAFETY: CREATE-only (one function + two triggers). No RLS change, no table
-- creation, no data change, nothing dropped except its own trigger before
-- re-create. The function is plain (NOT security definer) — it only sets a
-- column on the row being written, so it needs no elevated privilege. Tables
-- are to_regclass-guarded so this is a no-op on any table not present live.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.inspections') is not null then
    execute 'drop trigger if exists set_updated_at_trg on public.inspections';
    execute 'create trigger set_updated_at_trg before insert or update on public.inspections for each row execute function public.set_updated_at()';
  end if;
  if to_regclass('public.container_loadings') is not null then
    execute 'drop trigger if exists set_updated_at_trg on public.container_loadings';
    execute 'create trigger set_updated_at_trg before insert or update on public.container_loadings for each row execute function public.set_updated_at()';
  end if;
end $$;
