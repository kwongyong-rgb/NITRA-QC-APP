-- ============================================================
-- Migration 12 — run in Supabase SQL Editor
-- Optional custom logo per inspection report (else default NITRA).
-- "Success. No rows returned" = done. Safe to re-run.
-- ============================================================

alter table inspections add column if not exists report_logo_path text;
