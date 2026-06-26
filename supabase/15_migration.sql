-- Migration 15: the consolidated PO report caches its container translations under a
-- key like 'po:<PO number>' (not an inspection uuid). Widen the cache key column to
-- text so those rows are accepted and the public PO report isn't re-translated on every
-- view. Existing uuid values cast to text cleanly.

alter table report_translations alter column inspection_id type text;
