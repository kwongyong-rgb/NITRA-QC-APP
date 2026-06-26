-- ============================================================
-- Migration 10 — run in Supabase SQL Editor
-- Adds Brand Name and Factory to the SKU record.
-- "Success. No rows returned" = done. Safe to re-run.
-- ============================================================

alter table skus add column if not exists brand_name text not null default '';
alter table skus add column if not exists factory text not null default '';
