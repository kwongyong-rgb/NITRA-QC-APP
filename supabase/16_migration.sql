-- Migration 16: per-container report logo (same idea as inspections.report_logo_path).
-- Used by the container loading interactive report and PDF.
alter table container_loadings add column if not exists report_logo_path text;
