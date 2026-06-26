-- ============================================================
-- Migration 11 — run in Supabase SQL Editor
-- Audit trail for approver amendments to inspection reports.
-- "Success. No rows returned" = done. Safe to re-run.
-- ============================================================

alter table inspections add column if not exists amended_at timestamptz;
alter table inspections add column if not exists amended_by uuid;
alter table inspections add column if not exists amend_log jsonb not null default '[]'::jsonb;
