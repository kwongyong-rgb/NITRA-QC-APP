-- Migration 13: cache for machine-translated report text (DE / ZH).
-- The interactive-report edge function writes here with the service role, so no
-- public RLS policies are needed (RLS on, no policy = service-role only). It stores
-- one row per (inspection, language) and re-translates only when content_hash changes.

create table if not exists report_translations (
  inspection_id uuid not null,
  lang          text not null,
  content_hash  text not null,
  payload       jsonb not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (inspection_id, lang)
);

-- Safety for any earlier partial version of this table.
alter table report_translations add column if not exists content_hash text;
alter table report_translations add column if not exists payload jsonb not null default '{}';
alter table report_translations add column if not exists updated_at timestamptz not null default now();

alter table report_translations enable row level security;
