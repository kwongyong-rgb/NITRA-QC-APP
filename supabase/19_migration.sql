-- Migration 19: Phase 3 — customer data lockdown.
--
-- Strategy: two helper functions + RESTRICTIVE policies. Restrictive policies
-- are AND-ed with existing permissive ones, so they scope/block customers
-- without touching (or needing to know the names of) policies created in
-- earlier sessions. Staff behaviour is unchanged: every restrictive policy
-- passes automatically for staff.
--
-- SAFETY: creates functions and policies only; adds one permissive SELECT
-- policy each on inspections/container_loadings for customers (approved rows
-- of assigned POs). No data is modified or deleted.

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'approver', 'inspector')
  );
$$;

create or replace function public.is_customer()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'customer'
  );
$$;

-- Which POs is this customer assigned to?
create or replace function public.customer_can_see_po(p_po_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from po_access
    where customer_id = auth.uid() and po_id = p_po_id
  );
$$;

create or replace function public.customer_can_see_po_no(p_po_no text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from po_access a join pos p on p.id = a.po_id
    where a.customer_id = auth.uid() and p.po_no = p_po_no
  );
$$;

-- ---- Scope PO master data: staff see all, customers see assigned only ----
drop policy if exists pos_customer_scope on pos;
create policy pos_customer_scope on pos
  as restrictive for select to authenticated
  using ( is_staff() or customer_can_see_po(id) );

drop policy if exists po_items_customer_scope on po_items;
create policy po_items_customer_scope on po_items
  as restrictive for select to authenticated
  using ( is_staff() or customer_can_see_po(po_id) );

-- ---- Customers may read APPROVED inspection rows of assigned POs only ----
-- (permissive: extends the existing inspector/approver visibility)
drop policy if exists insp_customer_read on inspections;
create policy insp_customer_read on inspections
  for select to authenticated
  using ( is_customer() and status = 'approved' and customer_can_see_po_no(po_no) );

drop policy if exists cl_customer_read on container_loadings;
create policy cl_customer_read on container_loadings
  for select to authenticated
  using ( is_customer() and insp_status = 'approved' and customer_can_see_po_no(po_no) );

-- ---- Hard-block customers from internal tables ----
-- (their reports render through the public report pages, which use the
-- service role — customers never need direct reads on these)
drop policy if exists skus_no_customer on skus;
create policy skus_no_customer on skus
  as restrictive for select to authenticated using ( not is_customer() );

drop policy if exists settings_no_customer on settings;
create policy settings_no_customer on settings
  as restrictive for select to authenticated using ( not is_customer() );

drop policy if exists defects_no_customer on defects;
create policy defects_no_customer on defects
  as restrictive for select to authenticated using ( not is_customer() );

drop policy if exists photos_no_customer on photos;
create policy photos_no_customer on photos
  as restrictive for select to authenticated using ( not is_customer() );

drop policy if exists custom_disp_no_customer on custom_dispositions;
create policy custom_disp_no_customer on custom_dispositions
  as restrictive for select to authenticated using ( not is_customer() );

drop policy if exists report_tr_no_customer on report_translations;
create policy report_tr_no_customer on report_translations
  as restrictive for select to authenticated using ( not is_customer() );

-- ---- Storage: customers cannot read the qc-photos bucket directly ----
drop policy if exists qc_photos_no_customer on storage.objects;
create policy qc_photos_no_customer on storage.objects
  as restrictive for select to authenticated
  using ( bucket_id <> 'qc-photos' or not is_customer() );

-- ---- Belt-and-braces: customers cannot write to core tables ----
-- (per-command, NOT "for all": a restrictive ALL policy would also AND into
-- the customer SELECT policies above and cancel them)
drop policy if exists insp_no_customer_write on inspections;
drop policy if exists insp_no_cust_ins on inspections;
create policy insp_no_cust_ins on inspections
  as restrictive for insert to authenticated with check ( not is_customer() );
drop policy if exists insp_no_cust_upd on inspections;
create policy insp_no_cust_upd on inspections
  as restrictive for update to authenticated using ( not is_customer() );
drop policy if exists insp_no_cust_del on inspections;
create policy insp_no_cust_del on inspections
  as restrictive for delete to authenticated using ( not is_customer() );

drop policy if exists cl_no_customer_write on container_loadings;
drop policy if exists cl_no_cust_ins on container_loadings;
create policy cl_no_cust_ins on container_loadings
  as restrictive for insert to authenticated with check ( not is_customer() );
drop policy if exists cl_no_cust_upd on container_loadings;
create policy cl_no_cust_upd on container_loadings
  as restrictive for update to authenticated using ( not is_customer() );
drop policy if exists cl_no_cust_del on container_loadings;
create policy cl_no_cust_del on container_loadings
  as restrictive for delete to authenticated using ( not is_customer() );
