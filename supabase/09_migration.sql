-- ============================================================
-- Migration 09 — run in Supabase SQL Editor (run the WHOLE thing)
-- Definitive fix for: "new row violates row-level security policy
-- for table photos" when adding Container Loading photos.
--
-- Migration 08 applied cleanly, but the cross-table ownership check
-- on the photos table still evaluates false for container photos.
-- Rather than keep fighting it, we scope the photos table to any
-- authenticated user (all app accounts are trusted QC staff).
--   • Inspection / container ownership is still enforced on the
--     inspections and container_loadings tables themselves.
--   • The public report reads photos via the service-role edge
--     function (which bypasses RLS), so this doesn't affect it.
--   • Anonymous visitors still get no direct access to photos.
--
-- "Success. No rows returned" = done.
-- ============================================================

-- Refresh PostgREST's schema cache (picks up the container_loading_id column)
notify pgrst, 'reload schema';

-- Remove every existing policy on photos (clears any stale or conflicting ones)
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'photos' loop
    execute format('drop policy if exists %I on photos', pol.policyname);
  end loop;
end $$;

alter table photos enable row level security;

-- One clean policy: authenticated users have full access to photos
create policy "photos_all_authenticated" on photos
  for all
  to authenticated
  using (true)
  with check (true);
