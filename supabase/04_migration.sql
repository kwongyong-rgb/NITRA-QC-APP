-- ============================================================
-- Migration 04 — run in Supabase SQL Editor
-- Fixes: delete bug, submit bug; adds reference photo fields
-- ============================================================

-- SUBMIT BUG FIX: the old update policy blocked status changing
-- to 'submitted' (its USING clause was applied to the NEW row).
drop policy if exists "insp_update" on inspections;

create policy "insp_update_inspector" on inspections for update
  using (inspector_id = auth.uid() and status in ('draft','rejected'))
  with check (inspector_id = auth.uid() and status in ('draft','submitted','rejected'));

create policy "insp_update_approver" on inspections for update
  using (is_approver()) with check (is_approver());

-- DELETE BUG FIX: there was no delete policy at all, so deletes
-- silently affected 0 rows.
drop policy if exists "insp_delete_inspector" on inspections;
drop policy if exists "insp_delete_approver" on inspections;

create policy "insp_delete_inspector" on inspections for delete
  using (inspector_id = auth.uid() and status = 'draft');

create policy "insp_delete_approver" on inspections for delete
  using (is_approver());

-- Reference photo library: acceptable/defect verdict
alter table photos add column if not exists ref_verdict text not null default '';

-- Custom reference categories live in settings
insert into settings (key, value) values
  ('ref_categories', '{"extra":[]}')
on conflict (key) do nothing;
