-- Migration 21: auto-link every inspection to its PO via the junction.
--
-- Reads now go through inspection_pos, so an inspection with no junction row
-- would be invisible. This trigger guarantees the primary (inspection, po_no)
-- link exists no matter how the inspection is created — the app today, offline
-- sync later (Stage 2), or direct SQL. Also re-runs the backfill (idempotent)
-- to catch any inspection created between migration 20 and now.
--
-- SAFETY: create function + trigger + idempotent backfill only. No RLS change,
-- no destructive ops. The function is security definer so it can write the
-- junction row regardless of the caller's RLS, but it only ever inserts the
-- row for the inspection's OWN po_no — no privilege escalation.

create or replace function public.inspection_autolink_po()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.po_no is not null and btrim(new.po_no) <> '' then
    insert into public.inspection_pos (inspection_id, po_no, created_by)
    values (new.id, new.po_no, new.inspector_id)
    on conflict (inspection_id, po_no) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists inspection_autolink_po_trg on public.inspections;
create trigger inspection_autolink_po_trg
  after insert on public.inspections
  for each row execute function public.inspection_autolink_po();

-- Catch any inspection created since migration 20 that has no junction row yet.
insert into public.inspection_pos (inspection_id, po_no)
select id, po_no from public.inspections
where po_no is not null and btrim(po_no) <> ''
on conflict (inspection_id, po_no) do nothing;
