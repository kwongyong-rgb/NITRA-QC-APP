# NITRA QC Inspection App — Technical Handoff (CLAUDE.md)

> **Read this whole file before doing anything.** It is intentionally exhaustive, not a summary. It is written so a fresh Claude Code session can continue development without the previous chat's context. Section 9 contains the **complete, verbatim source of every file** — do not assume anything about a file you have not read there.
>
> **To whoever continues this: do NOT compress, summarize, or "clean up" this document when updating it.** Add to it. The prior team's hard-won details (RLS gotchas, root-cause fixes, sync race conditions) are the point.

---

## 0. How the human (Kwong) works — READ FIRST

Kwong is the Admin at NITRA Wheels and is **non-technical**. You (the AI) write **all** code, SQL, and shell commands. Concretely:

- **One verifiable batch at a time:** propose → he approves → you build → you run the build gate and show him it passes → he commits/pushes and tests, before the next batch. Do not stack multiple risky changes.
- **You edit the repo files directly.** The development environment is Claude Code, working in the local repo at `C:\Users\Razer\Documents\GitHub\NITRA-QC-APP`. Kwong commits and pushes himself with GitHub Desktop. **Never ship partial patches** — a batch must leave the repo in a working, build-gate-passing state.
- **Still bump the version and add a `CHANGES_vNN.md` every batch.** The version history (§7) and the whole handoff narrative depend on it. Only the zip is gone, not the versioning.
- **All SQL and PowerShell must be inline in chat, copy-paste ready.** Pre-chunk long SQL as "Part 1 of N" — the Supabase SQL Editor silently truncates very long scripts. Kwong pastes these by hand; do not assume you can run them.
- **Build gate — YOU run it, before handing the batch over (all three must pass):**
  - `npx tsc -b` clean
  - `npx vite build` OK
  - `npx eslint src | grep -c rules-of-hooks` must be `0`
  Show him the passing output before he commits.
  (There are some *pre-existing* non-rules-of-hooks lint errors — `set-state-in-effect`, `no-explicit-any` — that are tolerated. Only `rules-of-hooks = 0` is the hard gate.)
- **Bilingual:** staff UI is EN / 简体中文 (`zh`); customer-facing report output is EN / DE / FR-CA.
- **Flag uncertainty and open questions honestly.** Never silently resolve an ambiguous decision.
- **Security review + verification queries for any migration touching RLS/RPCs**, in **plain English**, presented for him to read BEFORE he runs it. He is non-technical — explain what the SQL does and what could go wrong, not just what it says.
- **Always remind him to delete and reinstall the PWA** on the iPad/phone after every app deploy. See Pipeline A.

### Deploy pipelines
- **Pipeline A (app):** you edit the repo files directly → you run the build gate → GitHub Desktop commit + push → Vercel auto-builds → **CONFIRM THE DEPLOYED COMMIT HASH MATCHES THE PUSH** (see the trap below) → **on the iPad/phone, DELETE the PWA from the home screen and REINSTALL it.**
  - **⚠️ TRAP THAT COST TWO TEST CYCLES (v87/v88):** "Vercel finished building" is NOT "the new code is live". A FAILED build leaves the previous deployment serving, so the app looks fine and the device silently runs OLD code — every offline test result is then meaningless. On the Vercel Overview, check that *Production Deployment* shows the commit you just pushed, not an older one. If it shows `Error`, open that deployment's build log.
  - **Root cause of those failures:** the repo had NO `.gitignore`, so committing via GitHub Desktop swept in 14,825 `node_modules` files including WINDOWS-only native binaries (`@rolldown/binding-win32-x64-msvc`, `@rollup/rollup-win32-x64-*`). Vercel builds on LINUX and could not build, while the identical build passed on Kwong's Windows machine. Fixed in v88 by adding `.gitignore` + `git rm -r --cached node_modules dist`. **Never commit `node_modules/` or `dist/`.** If a Vercel build fails but the local build passes, suspect a platform/environment difference like this one first. Clearing cache is NOT enough — a stale service worker will keep serving old JS. This is the #1 "my fix didn't work" cause.
- **Pipeline B (edge functions):** PowerShell, e.g.
  `supabase functions deploy <name> --project-ref nzzktgstpifevaqyapyw --no-verify-jwt`
  (`--no-verify-jwt` is used for the public report functions: `interactive-report`, `po-report`, `container-report`, `send-*`).
- **Migrations:** pasted into the Supabase SQL Editor by hand. On the "Potential issue detected — creates a table without RLS" popup, click **"Run without RLS"** (NOT "Run and enable RLS", which enables RLS with no policies and locks staff out); a following migration part enables RLS + policies.

### Workflow history
Through **v86**, development ran in a chat tool with no repo access: every batch shipped as a full-codebase zip (`nitra-qc-app-vNN-FULL.zip`) that Kwong extracted into the repo by hand, and the build gate was run on his machine. From **v87 onward** development moved to **Claude Code**, which edits the repo directly and runs the build gate itself. The zip step is retired. Everything else about how Kwong works is unchanged — one batch at a time, inline copy-paste SQL with a plain-English security review, and he still owns the commit, the push, and the testing.

---

## 1. App overview

**NITRA QC App** is a Progressive Web App (PWA) used on iPads/phones by the QC team at **NITRA Wheels** (an aftermarket alloy-wheel brand) to run **quality-control inspections** of alloy wheels before they are loaded into shipping containers and sent to customers.

**Core purpose:** replace paper QC forms with a structured, bilingual, photo-backed, auditable digital inspection that produces a shareable **interactive report** and **PDF** per inspection, per PO, and per container.

**Users / roles** (the `role` column on `profiles`):
- `inspector` — does wheel inspections and container-loading inspections on the floor (often offsite, flaky signal).
- `admin` — (formerly called `approver`; renamed in migration 18, but code and RLS still accept both strings in places) approves/rejects submitted inspections, manages POs, SKUs, users, settings, and the reference library. Sees the admin dashboard + sidebar.
- `approver` — legacy alias of admin; RLS helper `is_approver()` and several policies still reference it. Treat admin and approver as the same privilege tier.
- `customer` — external; logs into a locked-down dashboard that shows only APPROVED inspections/containers for POs explicitly assigned to them (via `po_access`). Customer data isolation is enforced by RESTRICTIVE RLS (migration 19).

**The domain model in one paragraph:** A **PO** (purchase order) has ordered **po_items** (part_no + qty). Wheels are identified by **SKU** (`skus.part_no`). An **inspection** is a QC verdict on a lot of one SKU; it may be **shared across multiple POs** via the **`inspection_pos`** junction (many-to-many; association only — per-PO quantities live in `po_items`, not on the link). A **container_loading** records pallet packing + container loading for a PO. Inspections and container loadings each accrue **defects** and **photos**. Reports render per inspection, per PO, and per container, and are cached/translated server-side.

**Key inspection logic (see `src/lib/rules.ts` and `src/lib/standard.ts`):**
- Two parameter groups: **Appearance/Visual** (base sample = `app_sample`) and **Technical/Measure** (base sample = `fun_sample`).
- Sampling plan: if 1 base failure → inspect extra pieces (4 for visual, 2 for measure). Any failure in the extra sample → **100% inspection** for that parameter.
- Results are stored in `inspections.form_data` (jsonb): `results` (`"item_key:piece_no" → P/F/NA`), `meas_results`, `extra_results` (`"item_key" → PFNA[]`), `meas_extra_results`, `pallet`, plus `na_overrides` and `hundred_pct`.

---

## 2. Tech stack (exact, from `package.json`)

**Runtime/build:** React `^19.2.6`, React-DOM `^19.2.6`, TypeScript `~6.0.2`, Vite `^8.0.16`, `@vitejs/plugin-react` `^6.0.1`, `vite-plugin-pwa` `^1.3.0`.

**Routing:** `react-router-dom` `^7.17.0` (BrowserRouter; SPA rewrites via `vercel.json`).

**Backend SDK:** `@supabase/supabase-js` `^2.108.1`.

**Other libs:** `xlsx` `^0.18.5` (PO ordered-item Excel import + SKU import), `@fontsource/barlow` + `@fontsource/barlow-semi-condensed` (fonts).

**Lint/tooling:** ESLint `^10.3.0` (flat config), `typescript-eslint` `^8.59.2`, `eslint-plugin-react-hooks` `^7.1.1`, `eslint-plugin-react-refresh` `^0.5.2`.

**Important build notes:**
- `tsconfig.app.json` sets `noUnusedLocals` + `noUnusedParameters` — **unused imports/vars fail `tsc -b`.** Keep imports tidy.
- `verbatimModuleSyntax: true` — use `import type { ... }` for type-only imports.
- PWA uses `registerType: 'autoUpdate'` + Workbox `navigateFallback: 'index.html'`. The autoUpdate service worker is exactly why a home-screen reinstall is needed after deploy.
- Node types available (`@types/node`) but this is a browser app; `Date.now()`, `crypto.randomUUID()`, `Math.random()`, `indexedDB`, `navigator.onLine` are all used in app runtime code and are fine.

**Infrastructure identifiers (exact):**
- Supabase project ref: `nzzktgstpifevaqyapyw` (PRO plan). Storage bucket: `qc-photos`.
- Repo: `github.com/kwongyong-rgb/NITRA-QC-APP`; local `C:\Users\Razer\Documents\GitHub\NITRA-QC-APP`.
- Live: `https://nitra-qc-app.vercel.app` (installed as a PWA on the iPad/phone).
- Email delivery: **Resend** (used by the `send-*` edge functions).
- Migrations applied to live DB: **up to 22** (see §3). **Migrations 20 and 21 status:** 20 (junction + RLS) applied live; 21 (autolink trigger) applied; 22 (server-authoritative `updated_at`) applied.

---

## 3. Supabase schema — tables, columns, relationships, RLS

> **CRITICAL CAVEAT ON COMPLETENESS:** The migration files in this repo start at **`04_migration.sql`**. Migrations **01–03** (which originally created `profiles`, `skus`, `settings`, `inspections`, `defects`, `photos`) and **`20_migration.sql`** (which created the `inspection_pos` junction) are **NOT in the repo** — they were run in the live DB in an earlier chat whose container was wiped. The tables exist and work in the live DB. Below, DDL taken from an actual migration file is marked **[from migration NN]**; DDL that is **[reconstructed]** was rebuilt from `information_schema` dumps, `pg_policies` dumps, and code usage, and may differ in incidental details (constraint names, exact defaults) from the true original. **If you need the authoritative live schema, query `information_schema.columns` and `pg_policies` directly.** A good early task for a continuing session is to regenerate `01_migration.sql`–`03_migration.sql` and `20_migration.sql` from the live DB so the repo history is complete.

### 3.1 Helper functions (SECURITY DEFINER)
These exist live. `is_approver()` predates the repo (migrations 01–03) and is referenced everywhere; `is_staff()`, `is_customer()`, `customer_can_see_po()`, `customer_can_see_po_no()` are **[from migration 19]** (full source in §9). They are `SECURITY DEFINER` so they can read `profiles`/`po_access`/`pos` without tripping those tables' own RLS (this is the sanctioned pattern in this app for RLS checks that traverse other RLS-protected tables — it avoids recursion).

```sql
-- is_approver(): reconstructed — returns true for admin/approver role.
-- (Original DDL in missing migration 01–03. Behaviour, per usage:)
--   select exists (select 1 from profiles where id = auth.uid() and role in ('admin','approver'));
```

### 3.2 `profiles` — [reconstructed; original in missing 01–03]
User records, 1:1 with `auth.users`.
```sql
create table profiles (
  id         uuid primary key,          -- = auth.users.id
  full_name  text,
  role       text not null              -- 'inspector' | 'admin' | 'customer' (legacy 'approver' == admin)
  -- NOTE: there is NO email column on profiles. Selecting `email` silently returns blank. (Learned the hard way.)
);
alter table profiles enable row level security;
-- Migration 18 dropped any CHECK constraint on role and did: update profiles set role='admin' where role='approver';
```
Relationships: `inspections.inspector_id`, `container_loadings.inspector_id`, `po_access.customer_id`, `custom_dispositions.created_by`, `inspections.amended_by/reviewed_by` all reference `profiles.id` (= `auth.uid()`).

### 3.3 `skus` — [reconstructed; created in missing 01–03, extended by 04/05/10]
The wheel master catalogue. `part_no` is the natural key used throughout the app.
```sql
create table skus (
  part_no             text primary key,
  model               text,
  size                text,
  diameter_in         numeric,
  pcd                 text,          -- e.g. '5x139.7'
  bolt_circle_mm      numeric,
  offset_txt          text,          -- e.g. '+20'
  offset_mm           numeric,
  cb_mm               numeric,       -- centre bore
  lug_hole_mm         numeric,
  counter_bore_mm     numeric,
  seat_thickness_mm   numeric,
  lug_seat_type       text,
  finish              text,          -- e.g. 'SATIN BLACK', 'SATIN GUNMETAL'
  max_load_lbs        integer,
  upc_code            text,
  fitment             text,
  active              boolean not null default true,   -- queries filter .eq('active', true)
  -- added by migration 05:
  wheel_weight_kg     numeric,
  wheel_weight_tol_kg numeric not null default 0.4,
  tpms_sensor_mm      text not null default '',
  na_defaults         jsonb not null default '{}',     -- auto-NA item keys per SKU
  -- added by migration 10:
  brand_name          text not null default '',
  factory             text not null default ''
);
alter table skus enable row level security;
-- Migration 19 added RESTRICTIVE policy skus_no_customer (customers cannot read skus).
-- Staff read/write policies predate the repo (missing 01–03).
```
See `src/lib/standard.ts` `Sku` interface for the exact fields the app reads. Seed data (68 SKUs, TITAN + PURSUIT lines) is in `05_migration.sql` (§9).

### 3.4 `settings` — [reconstructed; created in missing 01–03]
Key/value config store.
```sql
create table settings (
  key   text primary key,
  value jsonb not null default '{}'
);
alter table settings enable row level security;
-- Known keys: 'sampling' (SamplingSettings — see rules.ts), 'ref_categories' (reference library custom categories).
-- Migration 19 added RESTRICTIVE settings_no_customer.
```
`'sampling'` drives `sampleSizes(lot, settings)` in `rules.ts` (used by New Inspection to compute `app_sample`/`fun_sample`). The offline cache (§5) stores this under key `'sampling'`.

### 3.5 `inspections` — [columns authoritative from information_schema dump; created in missing 01–03, extended by 04/11/12]
The central wheel-inspection record.
```sql
create table inspections (
  id               uuid primary key default gen_random_uuid(),  -- client-minted ids ARE allowed on insert (see §5)
  part_no          text not null,               -- FK-by-value to skus.part_no
  po_no            text not null default '',
  batch            text not null default '',
  lot_size         integer not null default 0,
  app_sample       integer not null default 0,  -- appearance/visual sample size
  fun_sample       integer not null default 0,  -- functional/measure sample size
  inspector_id     uuid not null,               -- NO default; app must set it = profile.id
  status           text not null default 'draft',   -- draft | submitted | approved | rejected
  language         text not null default 'en',
  form_data        jsonb not null default '{}',  -- results/meas_results/extra_results/meas_extra_results/pallet/na_overrides/hundred_pct
  measurements     jsonb not null default '{}',
  pallet_data      jsonb not null default '{}',
  summary          jsonb not null default '{}',  -- { disposition, disposition_custom, disposition_cls, remarks, corrective_action }
  review_note      text not null default '',
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  reviewed_by      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),  -- server-authoritative since migration 22 (trigger)
  amended_at       timestamptz,                 -- migration 11
  amended_by       uuid,                        -- migration 11
  amend_log        jsonb not null default '[]', -- migration 11 (audit trail of approver edits)
  report_logo_path text                         -- migration 12
);
```
**Live RLS policies on `inspections`** (from `pg_policies` dump; DDL in migrations 04 & 19):
- `insp_select` (SELECT, public): `inspector_id = auth.uid() OR is_approver()`
- `insp_customer_read` (SELECT, authenticated): `is_customer() AND status='approved' AND customer_can_see_po_no(po_no)`
- `insp_insert` (INSERT, public): WITH CHECK `inspector_id = auth.uid()` — **no constraint on `id`, so client-minted UUIDs insert cleanly.**
- `insp_no_cust_ins` (INSERT, authenticated, RESTRICTIVE): `not is_customer()`
- `insp_update_inspector` (UPDATE, public): USING `inspector_id=auth.uid() AND status in ('draft','rejected')`; WITH CHECK `inspector_id=auth.uid() AND status in ('draft','submitted','rejected')`
- `insp_update_approver` (UPDATE, public): `is_approver()`
- `insp_no_cust_upd` (UPDATE, authenticated, RESTRICTIVE): `not is_customer()`
- `insp_delete_inspector` (DELETE): `inspector_id=auth.uid() AND status='draft'`
- `insp_delete_approver` (DELETE): `is_approver()`
- `insp_no_cust_del` (DELETE, authenticated, RESTRICTIVE): `not is_customer()`

### 3.6 `container_loadings` — [from migration 07; columns confirmed by dump; extended by 16]
Pallet packing + container loading for a PO (separate from per-SKU wheel inspections). Full DDL + RLS in `07_migration.sql`/`08` (§9). Columns: `id uuid pk`, `po_no`, `container_no`, `seal_no`, `status` (in_progress/loaded/hold), `data jsonb` (pallets/checks), `summary jsonb`, `inspector_id uuid default auth.uid()`, `reviewed_by`, `submitted_at`, `reviewed_at`, `review_note`, `insp_status` (draft/submitted/approved/rejected), `created_at`, `updated_at` (server-authoritative since migration 22), `report_logo_path` (migration 16). Live RLS: `cl_select`, `cl_insert`, `cl_update_inspector`, `cl_update_approver`, `cl_delete`, `cl_customer_read`, and RESTRICTIVE `cl_no_cust_ins/upd/del`.

### 3.7 `defects` — [reconstructed; created in missing 01–03]
One row per logged failure, tied to an inspection.
```sql
create table defects (
  id                uuid primary key default gen_random_uuid(),
  inspection_id     uuid not null,          -- references inspections(id) on delete cascade
  piece_no          integer not null,       -- base pieces positive; extra pieces negative (-1, -2, ...)
  tab               text not null,          -- 'form' | 'measure' | 'extra'
  section           text,                   -- uppercased tab
  item_key          text not null,          -- matches SECTIONS/MEAS_COLS keys
  item_label        text,
  defect_type       text default 'unspecified',
  severity          text default 'minor',   -- critical | major | minor
  measurement_value numeric,
  measurement_unit  text default 'mm',
  comment           text default '',
  created_at        timestamptz not null default now()
);
alter table defects enable row level security;
```
**Live RLS** (from dump): `def_write` (ALL, public): USING/CHECK `exists(select 1 from inspections i where i.id=defects.inspection_id and ((i.inspector_id=auth.uid() and i.status in ('draft','rejected')) or is_approver()))`; `def_select` (SELECT, public): `exists(... i.inspector_id=auth.uid() or is_approver())`; `defects_no_customer` (SELECT, authenticated, RESTRICTIVE): `not is_customer()`.
**Sync note:** offline, `ensureDefect` inserts fail; `offlineSync.rebuildDefects()` recreates minimal defect rows from `form_data` Fails on sync (base + extra pieces).

### 3.8 `photos` — [reconstructed; created in missing 01–03, extended by 04/05/07]
Photos/videos attached to an inspection OR a container loading.
```sql
create table photos (
  id                    uuid primary key default gen_random_uuid(),
  inspection_id         uuid,                 -- nullable since migration 07 (may belong to container instead)
  container_loading_id  uuid references container_loadings(id) on delete cascade,  -- migration 07
  item_key              text,
  piece_no              integer,
  defect_id             uuid,                 -- links a photo to a defect; null = pass photo / appendix
  is_pass_photo         boolean default false,
  comment               text default '',
  storage_path          text,                 -- object path in the qc-photos bucket
  media_type            text not null default 'photo',   -- migration 05: 'photo' | 'video'
  reassigned_from       jsonb,                -- migration 05
  ref_verdict           text not null default '',        -- migration 04: reference-library acceptable/defect
  created_at            timestamptz not null default now()
);
alter table photos enable row level security;
```
**Live RLS** (migration 09 simplified it): `photos_all_authenticated` (ALL, authenticated): USING `true` / CHECK `true` — **any authenticated staff can fully access photos**; ownership is enforced on the parent inspection/container tables instead. Public reports read photos via service-role edge functions (bypass RLS). `photos_no_customer` (SELECT, authenticated, RESTRICTIVE, migration 19): `not is_customer()`. (Migrations 06/07/08 tried per-owner cross-table policies and kept failing for container photos — 09 is the definitive fix; see §7.)

### 3.9 `pos` and `po_items` — [from migration 17]
PO master + ordered items. Full DDL + RLS in `17_migration.sql` (§9). `pos`: `id`, `po_no` (unique), `customer_name`, `po_date`, `destination`, timestamps. `po_items`: `id`, `po_id → pos(id) on delete cascade`, `part_no`, `qty_ordered`, unique `(po_id, part_no)`. RLS: everyone authenticated reads; only admin/approver writes. Migration 19 adds RESTRICTIVE customer-scope SELECT (`is_staff() OR customer_can_see_po(...)`).

### 3.10 `po_access` — [from migration 18]
Which customer may view which PO. `id`, `customer_id`, `po_id → pos(id)`, unique `(customer_id, po_id)`. RLS: admin manages; customer reads own. Drives customer data isolation in migration 19.

### 3.11 `inspection_pos` (junction) — [reconstructed; created in missing migration 20]
Many-to-many link between inspections and POs (shared-SKU inspections, v80).
```sql
create table inspection_pos (
  inspection_id uuid not null,     -- references inspections(id) on delete cascade
  po_no         text not null,
  off_po        boolean not null default false,  -- true = SKU not on that PO (override, shows a ⚠ NOT ON PO badge)
  created_by    uuid,
  created_at    timestamptz not null default now(),
  primary key (inspection_id, po_no)
);
alter table inspection_pos enable row level security;
```
**Live RLS** (from dump): `ip_staff_all` (ALL, authenticated): `is_staff()`; `ip_customer_read` (SELECT, authenticated): `is_customer() AND customer_can_see_po_no(po_no)` — the **privacy wall** so a customer only sees link rows for their own PO. **Association only** — per-PO quantities live in `po_items`, never on the link.
**Migration 21** adds trigger `inspection_autolink_po_trg` (`AFTER INSERT ON inspections`, SECURITY DEFINER function `inspection_autolink_po()`) that inserts the inspection's own `(id, po_no)` junction row on insert (skips blank po_no), plus an idempotent re-backfill. This is what makes reads-through-junction work for app-created AND offline-synced inspections. Full source in `21_migration.sql` (§9).

### 3.12 `report_translations` — [from migration 13, widened by 15]
Server-side cache of machine-translated report text (DE/ZH/FR-CA). PK `(inspection_id, lang)` where `inspection_id` is TEXT (migration 15, so PO reports can key as `'po:<PO>'`). Written only by service-role edge functions (RLS on, no policy = service-role only). Migration 19 conditionally adds RESTRICTIVE `report_tr_no_customer`. **NOTE: this table is in the repo migrations but was reported NOT present in the live DB in an earlier session — verify before relying on it. Migration 19 `to_regclass`-guards it for exactly this reason.**

### 3.13 `custom_dispositions` — [from migration 14]
Small shared library of approver-added final dispositions. `id`, `label` (unique, case-insensitive), `cls` (pass/hold/reject/pending), `created_by`, `created_at`. Any authenticated user reads/inserts/deletes. **Same caveat as report_translations: in repo but possibly NOT in live DB — `to_regclass`-guarded in migration 19.**

### 3.14 `storage.objects` (bucket `qc-photos`)
Migration 19 adds RESTRICTIVE `qc_photos_no_customer` so customers cannot read the bucket directly. Photos reach customers only through service-role report edge functions.

### 3.15 Migration 22 (latest) — server-authoritative `updated_at`
```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at := now(); return new; end; $$;
-- triggers set_updated_at_trg BEFORE INSERT OR UPDATE on inspections + container_loadings.
```
Rationale in §5/§7. Full source in `22_migration.sql` (§9).

### RLS lessons that WILL bite you (do not relearn these the hard way)
1. **RLS is the #1 failure point in this app.** A query can "succeed" and affect **0 rows** when a policy is missing (no error thrown) — this caused the original delete/submit/photo-reassign bugs (migrations 04, 06). Always ensure the matching INSERT/UPDATE/DELETE policy exists.
2. Migrations should be **CREATE/INSERT only** where possible; always `drop policy if exists` before `create policy`; `to_regclass`-guard tables that may not exist live (`custom_dispositions`, `report_translations`).
3. **SECURITY DEFINER helper functions are the CORRECT pattern here** for RLS checks that traverse other RLS-protected tables (`po_access`, `pos`, the junction) — they bypass those tables' RLS and avoid recursion. The "prefer inline `exists(...)`" advice applies only to *simple* single-table role checks, not multi-table traversals.
4. **RESTRICTIVE policies are AND-ed** with permissive ones. Migration 19 uses per-command restrictive policies (NOT `for all`) on purpose: a restrictive `ALL` policy would also AND into the customer SELECT policies and cancel them.
5. The "creates a table without RLS" SQL-Editor popup → **"Run without RLS"**, then a follow-up part enables RLS + policies.
6. `profiles` has **no `email` column**.
7. **Client-minted UUIDs insert cleanly** (`id uuid default gen_random_uuid()` + `insp_insert` checks only `inspector_id`), which is the whole basis for offline creation (§5).

---

## 4. Vercel setup

- **Framework preset:** Vite. **Build command:** `tsc -b && vite build` (the `build` script). **Output dir:** `dist`. **Install:** `npm install`.
- **SPA routing:** `vercel.json` rewrites everything to `/index.html` (React Router client-side routing). Without this, deep links like `/inspection/:id` 404 on refresh.
- **Environment variables (names only — set in Vercel Project Settings → Environment Variables):**
  - `VITE_SUPABASE_URL` — the Supabase project URL (`https://nzzktgstpifevaqyapyw.supabase.co`).
  - `VITE_SUPABASE_ANON_KEY` — the Supabase anon/public key.
  (Both are read in `src/lib/supabase.ts`. `VITE_`-prefixed vars are embedded in the client bundle at build time — do NOT put the service-role key here.)
- **Deployment notes:** auto-deploy on push to the repo default branch. After each deploy, the PWA must be **deleted from the home screen and reinstalled** on the device (autoUpdate service worker). Edge functions are deployed separately via the Supabase CLI (Pipeline B), NOT via Vercel.
- **Edge function secrets** (set in Supabase, not Vercel): the `send-*` functions need a Resend API key; `ocr-label` and `interactive-report` translation need whatever provider keys they reference. Check each function's `Deno.env.get(...)` calls (§9) for the exact secret names before deploying.

---

## 5. Offline / online sync approach (B6 — the big in-progress feature)

This is the most actively-developed area. It is being built in **staged, independently-deployable batches**. The design and current state:

### Scope
**Only the inspection flow is going offline** — wheel inspections + container-loading inspections + their photos (the offsite, flaky-signal work). PO setup, ordered items, SKU management, user management, and consolidated reports stay **online-only** (done at the office).

### Locked design decisions
- **Offline creation uses client-minted UUIDs** (`crypto.randomUUID()`). RLS allows inserting an explicit `id` (see §3.5), so an offline device mints the id and it inserts cleanly on sync — no reconciliation.
- **`updated_at` is server-authoritative** (migration 22 trigger). The client clock cannot be trusted to decide "which copy is newer" at sync time, so the DB stamps `updated_at` with its own clock on every write. This is the foundation for future conflict detection.
- **Conflict handling rule (NOT yet built): queue the local copy, FLAG for review, never silently overwrite.** The refined requirement from the user is a *merge* view ("keep both") because photos/defects are separate rows (additive, no collision) and `form_data` is keyed per-wheel (different wheels merge cleanly); only the same field on the same wheel edited on both sides is a true conflict needing a manual pick.

### The four client-side modules (all in `src/lib/`, all fail-safe: any error → null/no-op, never breaks the live flow)
1. **`connectivity.ts`** — `useOnline()` hook + `pingReachable()`. Treats `navigator.onLine === false` as an immediate offline signal, but confirms the *positive* case with a lightweight `mode:'no-cors'` reachability ping to `${VITE_SUPABASE_URL}/auth/v1/health` (5s timeout, cache-buster) so "connected but no internet" warehouse Wi-Fi reads correctly. Re-checks every 30s, on the browser online/offline events, and on tab-visibility. Drives the **Online/在线 · Offline/离线 header pill** in `App.tsx`.
2. **`localDraft.ts`** (B6 Stage 1, v77) — IndexedDB (`nitra-qc` DB, `drafts` store) snapshot of the currently-open wheel/container inspection (`form_data`/`summary`/`pallet_data`), written on every change alongside the normal Supabase write. Pure insurance; restores on reopen if the local snapshot differs from the server (the "Unsaved changes found on this device" prompt). This is the base other stages build on.
3. **`refCache.ts`** (v83/v85, extended v87) — IndexedDB (`nitra-qc-cache` DB, `ref` store) read-through cache for reference data. `cacheGet`/`cacheSet`/`cacheGetWithMeta` (v87: also returns the stored `savedAt`, so screens can show how old cached data is instead of passing it off as live), plus **`warmRefCache()`** which proactively downloads + stores the full active SKU master (`skus`), the 4-col subset (`skus_lite`), and the sampling settings (`sampling`) whenever logged-in-and-online. Called from `App.tsx` on an `[online, profile]` effect. This is why the New Inspection form + PartPicker work offline. (v83 cached lazily per-screen and that was insufficient — v85 added proactive warming; do not regress to lazy-only.)
   - **v87 added `warmPoCache(userId)`** in the same module + the same `[online, profile]` trigger: five bulk queries (`pos`, `inspections`, `container_loadings`, `po_items`, `inspection_pos`) fanned out to populate the PO list cache AND every PO's detail cache in one pass. Bulk, not per-PO, deliberately — warming only the list would repeat the exact v85 trap (an inspector who warmed the list at the office still finds an empty PO *detail* page onsite).
   - **PO cache keys are namespaced by user id** (`po_list:<uid>`, `po_hub:<uid>:<po>`, `po_info:<uid>:<po>`, `po_stages:<uid>:<po>`) — see the privacy note in §7. Do NOT remove the namespacing.
5. **`offlineMedia.ts`** (v91, Stage 3) — offline **photos & videos**. Own IndexedDB DB (`nitra-qc-media`) with two stores: `blobs` (the captured file, keyed by its FUTURE storage path) and `rows` (the queued `photos` table row). Same trick as v86: the storage path is client-minted BEFORE upload, so an offline capture is stored under the exact path it will occupy in the bucket and sync just uploads to it — nothing to reconcile. Key exports: `saveLocalMedia`, `savePendingPhotoRow`, `mediaUrlFor` (local blob first, else signed URL), `getPendingPhotosFor`, `pendingMediaStats`, `syncPendingMedia`, `currentUserId` (reads the persisted session — works offline, avoids threading a prop through every photo modal).
   - **Sync ORDER matters:** `App.tsx` runs `syncPendingInspections()` and only THEN `syncPendingMedia()` — a photo row whose parent inspection isn't on the server yet cannot insert. A failed row stays queued and retries; it is never dropped.
   - **Fail photos taken offline have no `defect_id`** (the defect row doesn't exist until `rebuildDefects` runs at sync). `syncPendingMedia` links them afterwards by matching `item_key` + `piece_no`, the same pair the online flow keys on.
   - **Originals are kept, never downscaled** — a deliberate call: the appearance standard judges paint spots at ≤0.8 mm, so compressing offline photos would make them measurably worse than online ones (inconsistent evidence inside one report). The mitigation is the ⏳ tally chip in the header, not compression. **Offline video prompts with its file size** so the inspector can decide whether it's worth the space.
   - Local blob capture is only ever a **FALLBACK after a real network failure** — the online path is byte-for-byte unchanged.
   - **iOS EMPTY-BLOB TRAP (v96/v97) — cost several cycles, do NOT reintroduce:** a photo/video from `<input capture>` is a File that REFERENCES a temp file on disk, not the bytes. Two things had to be fixed together:
     1. **Capture timing (v97, the real cause):** `MediaCapture`'s inputs must `await upload(...)` BEFORE clearing `input.value`. The old code (`upload(f); e.currentTarget.value=''`, not awaited) cleared the input synchronously, which on iOS releases the camera temp file BEFORE `saveLocalMedia`'s `arrayBuffer()` read it — so it read empty. `saveLocalMedia` still materializes the bytes into an in-memory Blob via `await file.arrayBuffer()` at capture time. **Do not un-await those onChange handlers, and do not regress `saveLocalMedia` to storing the raw File.**
     2. **Self-heal (v97):** a stale iOS File reference reports a NON-ZERO `.size` while its content is gone, so a size check misses it. `syncPendingMedia` drops a queued photo when the UPLOAD fails with "No content provided" / empty-body (bytes unrecoverable); other upload errors stay queued to retry. The symptom was `upload: No content provided` with the ⏳ counter stuck forever.
   - **TWO TRAPS FOUND IN DEVICE TESTING — do not reintroduce:**
     1. **`Inspection.load()` has THREE early returns on the offline paths** (pending inspection already loaded; network failure after a prior successful load; SKU resolve failure). The v91 first cut merged queued photos at the END of `load()`, so offline they never appeared — on the very screen they were taken. Server photos and queued photos are now separate state merged via `useMemo`, with the queue read by its OWN effect (`[id, mediaTick, online]`). **Anything that must work offline cannot live at the tail of `load()` — check those early returns first.**
     2. **The batch inspection sync SKIPS the currently-open inspection** (by design — its screen syncs it, avoiding a two-writer race). So on reconnect, media sync ran while the parent inspection row was still absent, every photo insert failed, and nothing retried — the ⏳ chip stuck forever. Fixed by retrying media sync in the 15s tally poll AND kicking one immediately after `syncOnePending` succeeds. **Any future queue that depends on a parent row must have a retry, not just a one-shot on reconnect.**
4. **`offlineSync.ts`** (v86) — offline inspection **creation + sync** (the write side). IndexedDB (`nitra-qc-pending` DB, `inspections` store) of pending offline-created inspections (full rows). Key exports:
   - `savePendingInspection` / `getPendingInspection` / `getAllPendingInspections` / `updatePendingInspection` (self-guards: no-op if id isn't pending) / `pendingCount`.
   - `setOpenInspection(id|null)` — the Inspection screen registers the open inspection so the batch sync skips it (no two-writer race).
   - `syncPendingInspections(userId?)` — batch sync on reconnect: for each pending inspection **belonging to `userId`** and **not currently open**, `upsert` (onConflict `id`) the row, `rebuildDefects` from `form_data` Fails (base + extra pieces, check-then-insert so no dupes), then remove from the pending store. Module-level `syncing` guard + `navigator.onLine` guard.
   - `syncOnePending(insp, userId?)` — the open screen syncs ITS inspection, capturing latest edits first (`updatePendingInspection`), so in-flight edits aren't lost.

### End-to-end offline flow (as built through v86)
1. **Start Inspection offline** (`NewInspection.start`): mints a UUID, tries the online insert; on network failure saves a `PendingInspection` locally and navigates to `/inspection/<id>`. (Start is disabled until sampling settings are cached, to avoid 0-sample inspections.)
2. **Inspection screen** (`Inspection.load`): if the server has no row, loads from the pending store; resolves the SKU from `refCache('skus')`; shows a **⏳ Not synced yet** banner. A `loadedOnceRef` guard prevents the trailing `load()` after each edit from reverting optimistic state with the lagging pending copy.
   - **v92 — offline restore of SERVER inspections.** On every successful ONLINE load, `load()` caches the full inspection row + defects to IndexedDB (`insp_full:<uid>:<id>`, via `cacheSet`). On an offline REMOUNT (navigate away and back, or a flaky-wifi inspection that synced then dropped signal — at which point it's a server row with NO pending copy), `load()` restores from that cache instead of dead-ending on the red "Could not load / TypeError: Load failed" card. This is a **real** scenario, not just a test artifact: the flaky-warehouse cycle (create offline → wifi blips on → syncs → removed from pending store → wifi drops → navigate back → crash) is exactly what this app's "connected but no uplink" premise produces. No-cache-yet + offline shows a calm bilingual message (`offlineCantOpen`), never the red crash. **The `loadedOnceRef` guard only survives within ONE mount; a remount resets it — that is why the cache, not the guard, is what makes offline remount work.** BUT the offline-restore branch ALSO needs the `loadedOnceRef` early-return guard (like the pending path) so a trailing `load()` — after marking a result or taking a photo — doesn't re-restore the cached row and clobber the live optimistic edit (this bit in v92 testing: a Fail reverted to NA after a photo). On the first offline remount, `localDraft` edits are applied SILENTLY (offline the device copy is authoritative, no server to conflict with) rather than via the restore prompt. Deleting an offline (queued, not-yet-uploaded) photo must go through `deleteQueuedPhoto()` (local blob+row), NOT a server delete — the latter hits 0 rows and looks like a failure.
3. **Editing offline:** optimistic `setInsp` + `localDraft` snapshot + (if pending) `updatePendingInspection`. While `isPending`, `saveFd` **skips** the doomed server update (avoids a 0-row-update masking race); the mirror + self-sync own the write. `v82` hardened all this so offline edits never crash the screen (calm "offline" banner instead of the raw "TypeError: Load failed", and a failed reload keeps the working screen instead of a dead-end error page).
4. **Reconnect:** `App.tsx` runs `syncPendingInspections(profile.id)`; the open screen runs `syncOnePending(insp, profile.id)` and clears `isPending`. Inspection becomes a normal live row (with junction via migration 21 trigger, and defects rebuilt).

### Sync correctness notes (from an adversarial review — DO NOT regress)
- Sync is **scoped to the logged-in inspector** (`inspector_id === userId`) so a device shared between users never mis-uploads / RLS-rejects another user's pending inspection.
- The open inspection is **skipped by the batch sync** and synced by its own screen; combined with `saveFd` skipping server writes while `isPending`, this closes the two-writer race. A **narrow residual race** remains (an edit made during the single push round-trip): it is self-healing because the edit survives in React state + `localDraft`, and the next successful save pushes the whole `form_data`. Accept but be aware.
- `rebuildDefects` covers base pieces (`results`/`meas_results`, positive `piece_no`, tab `form`/`measure`) AND extra pieces (`extra_results`/`meas_extra_results`, negative `piece_no = -(i+1)`, tab `extra`, label `" (extra)"`) — matching how `Inspection.addExtra`/`ensureDefect` write them online.

---

## 6. File / component structure

### Root / config
- `index.html`, `src/main.tsx` — entry; `BrowserRouter` → `I18nProvider` → `App`.
- `vite.config.ts` — Vite + React + PWA (autoUpdate, manifest, Workbox).
- `vercel.json` — SPA rewrite. `tsconfig*.json`, `eslint.config.js`, `.env.example`.

### `src/lib/` (logic; no JSX except i18n)
- `supabase.ts` — the Supabase client (persistSession + autoRefreshToken). Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- `i18n.tsx` — `I18nProvider`, `useI18n()`, the `STR` map of `{en, zh}` strings, `t()` and `bi()`. Staff UI language persisted in `localStorage('lang')`.
- `standard.ts` — the QC standard: `SECTIONS` (appearance/finish/marking items, each `{key, group, label:{en,zh}, standard, glossBlackOnly?, blackOnly?}`), `MEAS_SECTIONS`/`MEAS_COLS` (technical measurements), `PALLET_ITEMS`, `PHOTO_SLOTS`, the `Sku` interface, and helpers `isGlossBlack`/`isBlack`.
- `rules.ts` — `FormData` type, `PFNA` type, `emptyFormData()`, `sampleSizes(lot, settings)`, `evaluateAll(...)` (the sampling/extra/100% rule engine), `ItemVerdict`.
- `outcome.ts` — `computeOutcomes`, `summaryItems`, `outcomeColor` (turns form_data into the report's per-parameter outcome table). **Bug-fix history:** the "Additional Inspection Required" bucket was missing here and in ReportPage (v-history) — a findings-vs-outcome contradiction.
- `report.ts` — `openInspectionReport(...)` and report-building helpers (the big client-side report generator).
- `poStatus.ts` — PO status-strip math (`sumLoadedByPart`, ordered vs loaded vs remaining).
- `refmap.ts` — maps item keys → reference library images.
- `inspectionPos.ts` — junction helpers: `linkedInspectionIds(po)`, `deletePoLinksAndOrphans`, attach/detach.
- `localDraft.ts`, `connectivity.ts`, `refCache.ts`, `offlineSync.ts` — offline stack (§5).

### `src/components/`
- `PartPicker.tsx` — mobile-first searchable SKU picker (filters `skus` master by part/model/size/finish; PO-aware badging; `allowFreeText` prop lets you type a part not in the master, used by the Add Ordered Item form). Caches to `refCache('skus_lite')`.
- `PhotoModal.tsx` — the photo/defect capture modals (`DefectModal`, `PassPhotoModal`, `ReassignModal`, `CopyModal`, `MediaThumb`, `MediaCapture`). Photos go to the `qc-photos` bucket.
- `RichText.tsx` — rich-text box for report remarks. **Bug-fix:** focus is tracked in a `useRef`, not React state, so focusing doesn't re-render and drop the caret (previously needed double/triple-click to type).
- `ExtraPieceScreen.tsx`, `HundredPctCheck.tsx` — the extra-sample and 100%-inspection sub-flows.
- `SharedPosCard.tsx` — "Shared with POs" card on the inspection page (v80 shared-SKU).
- `AttachInspectionModal.tsx` — "🔗 Attach inspection" on the PO page (v80).
- `PoStatusStrip.tsx` — Ordered ▸ Inspection ▸ Loading ▸ Shipped status strip with per-stage counts (v74/75).
- `EmailModal.tsx`, `CustomerAccessCard.tsx`, `Camera.tsx`, `ErrorBoundary.tsx`.

### `src/pages/`
- `App.tsx` — root: auth/session load with **offline-resilient profile caching** (cached profile survives an offline profile-fetch failure; only a real `SIGNED_OUT` logs out), routing, the top bar + **connectivity pill**, admin sidebar, inspector bottom nav, the `warmRefCache` and `syncPendingInspections` effects, and the public-report route bypass.
- `Login.tsx`, `SetPassword.tsx` — auth. `Home.tsx` — PO list / resume banner. `MyWork.tsx` — inspector's own drafts.
- `NewInspection.tsx` — start a wheel inspection (SKU picker, lot size, sample-size calc; **offline creation** path).
- `Inspection.tsx` — **the big one (~1400 lines):** the full wheel-inspection UI (tabs: Visual, Technical, Photos, Pallet, 100% Check, Report), defect logging, extra pieces, disposition, submit, amend, report open, and all the **offline load/edit/sync** wiring.
- `ContainerLoading.tsx` — the container-loading inspection UI (pallets, container checks, photos).
- `PoHub.tsx` — the PO page (mobile): wheel inspections list, container loadings list, Add SKU (→ `/new?po=`), Attach inspection, PO report link. Renders `PoInfo`.
- `PoInfo.tsx` — PO master info + ordered-items table + Add Ordered Item modal (uses `PartPicker`) + Excel import.
- `Approvals.tsx`, `AdminDashboard.tsx`, `Skus.tsx`, `TeamPage.tsx`, `Settings.tsx`, `RefLibrary.tsx` — admin screens.
- `CustomerHome.tsx` — the locked-down customer dashboard.
- `ReportPage.tsx`, `PoReportPage.tsx`, `ContainerReportPage.tsx` — the public interactive report pages (reached via emailed links; bypass the login wall in `App.tsx`).

### `supabase/functions/` (Deno edge functions; deploy via Pipeline B)
- `interactive-report`, `po-report`, `container-report` — render/serve the public interactive reports (service-role; `--no-verify-jwt`). `interactive-report` takes a `po` param so a shared inspection renders under the *viewing* PO (privacy wall).
- `send-report`, `send-po-report`, `send-container-report` — email report links via Resend.
- `manage-users` — admin user CRUD (create with temp password, etc.).
- `ocr-label` — OCR for label photos.

### `public/`
- PWA icons, `logo-white.png`, `favicon.svg`, and `ref/*.jpg` (reference-library images).

---

## 7. Decisions & reasoning (so you don't redo this thinking)

**Already-fixed bugs — ROOT CAUSES known, do NOT re-investigate:**
1. **QC SOP doc images render as slivers / cover logo half-missing (docx→PDF).** ROOT CAUSE: the QC Standard `.docx`'s default paragraph style set `<w:spacing w:line="252"/>` with **no `lineRule`**, treated as an EXACT ~12.6pt line height that clips every image-bearing paragraph to a ~12px strip. FIX: remove that spacing default from `word/styles.xml` docDefaults (`<w:pPr><w:spacing w:line="252"/></w:pPr>` → `<w:pPr/>`). It is NOT a transparency/alpha, image-extraction, or LibreOffice bug. **Verify numerically** (rasterize with `pdftoppm`, measure per-page non-white block heights: pre-fix image pages max ~113px, post-fix 200–518px). Removing it shifts pagination, so recompute the Contents page numbers from the rendered PDF. (This concerns the QC Standard document, not the app.)
2. **RichText needed double/triple-click to type.** Focus was in React state → re-render dropped the caret. FIX: track focus in a `useRef`.
3. **Pass/fail photo comments didn't show.** Saved but never rendered. FIX: render under the photo thumbnail.
4. **Orange Peel only offered on gloss black.** Was gated `glossBlackOnly`. FIX: new `blackOnly` flag + `isBlack()` so it applies to any black finish; `hat_marks` stays gloss-black-only.
5. **Findings summary said "all passed" while the Outcome table showed a Fail.** `summaryItems`/`buildFindings` missed the "Additional Inspection Required" bucket. FIX: add that bucket in `outcome.ts` and `ReportPage`.
6. **Missing Chinese** in `PoHub`/`PoInfo` and the QC doc appearance-table area designations + Area E sentence. FIX: wired `t()` / added the Chinese.

**Architecture/UX choices:**
- **Photos table scoped to any authenticated user** (migration 09) instead of per-owner cross-table checks — because the cross-table `exists(...)` check kept evaluating false for container-loading photos and blocked inserts. All app accounts are trusted staff; ownership is enforced on the parent tables; public reports use service-role. Pragmatic over pure.
- **"Disposition / 处置" vocabulary unified** everywhere (v76); report layout is **verdict-first**.
- **Shared-SKU inspections (v80):** many-to-many via `inspection_pos`, association-only. Privacy wall: the junction's RLS lets a customer read only their own PO's link rows; reports render each inspection under the **viewing** PO (`interactive-report` `po` param) so a shared inspection never leaks another customer's PO.
- **Offline: client-minted UUIDs + server-authoritative `updated_at`** (see §5) — chosen because RLS already allows explicit ids and because device clocks can't be trusted for conflict ordering.
- **Connectivity: reachability ping, not just `navigator.onLine`** — warehouse Wi-Fi is often "connected" with no working uplink.
- **Offline caching is proactive (`warmRefCache`), not lazy** — lazy per-screen caching (v83) failed because users never opened the New Inspection screen online first (v85 fix).
- **`saveFd` skips server writes while `isPending`** and the open screen owns its own sync — to close the reconnect two-writer race.
- **PO offline cache is namespaced per user (v87) — this is a PRIVACY control, not a nicety.** The SKU/settings cache needs no namespacing (identical for everyone), but PO data is scoped per user by RLS: an inspector only sees their OWN inspections/container loadings. IndexedDB survives sign-out, so on a shared iPad an un-namespaced cache would show user A's POs to user B. Namespacing makes a different user get a cache MISS rather than someone else's data — it fails closed. Do not "simplify" these keys.
- **`isOffline()` (v87, `connectivity.ts`) is for BLOCKING WRITES ONLY — never for deciding what to render.** It uses `navigator.onLine === false`, which is unreliable for the positive case (the whole reason `pingReachable()` exists) but trustworthy as a negative, so as a block-a-write guard it cannot produce a false negative. For anything the USER SEES, use the ping-confirmed **`useOnline()`** hook — the same source as the header pill. v87 broke this rule in the PO-list empty state and v89 fixed it; `isOffline()` now survives in ONE place only: the lazy PO-create guard in `poStatus.getOrCreatePoId()` / `PoInfo.load`, which is non-component code with no hook available (a false "online" there is harmless — the insert just fails with a network error and creates nothing).
  - **CORRECTION — do not repeat this misdiagnosis.** During v88 it was written here as fact that iOS standalone PWAs report `navigator.onLine === true` in airplane mode, "proven on a real device". **That was wrong.** On-device testing (iPhone, v89) showed `ping: OFFLINE · navigator.onLine: false` — they AGREED. The symptom that prompted the theory (the PO list showing the ONLINE empty-state message) was fully explained by the device running OLD code, because the Vercel deploy had silently failed (see §0 Pipeline A trap). The `useOnline()` rule above is still correct on its own merits — it catches "connected to Wi-Fi with a dead uplink", which `navigator.onLine` cannot — but it is NOT backed by an observed iOS bug. Treat any unverified platform-quirk claim in this document with the same suspicion.
- **There are TWO lazy PO-create paths, and both are guarded (v87).** `PoInfo.load`'s inline insert is the well-known one; the second is `getOrCreatePoId()` in `poStatus.ts`, called by `PoStatusStrip` (which renders on EVERY admin PO-page view) and `CustomerAccessCard`. Offline, the "does this PO exist?" read returns nothing — not because the PO is missing, but because there's no network — so without the guard, merely OPENING a PO page offline would insert a phantom `pos` row. If you add a third caller of `getOrCreatePoId`, it inherits the guard; if you write a new inline `pos` insert, guard it yourself.

**Version history (all built, verified, deployed unless noted):** v74–75 PO status strip; v76 disposition vocabulary + verdict-first report; v77 B6 Stage 1 offline safety net (`localDraft`); v78 four live-use bug fixes + PO/sidebar translation; v79 findings-vs-outcome fix; v80 shared-SKU inspections (`inspection_pos`); **v81** connectivity pill; **v82** offline edit hardening (no crash on offline All Pass/Fail) + Add-Ordered-Item searchable dropdown; **v83** offline read foundation pt1 (false-logout fix + SKU/settings cache); **v84** fix Add-Ordered-Item dropdown clipped inside modal; **v85** proactive `warmRefCache`; **v86** offline inspection creation + auto-sync; **v87** PO-page offline caching — read-through + `warmPoCache`, per-user cache namespacing, both lazy-PO-create paths guarded (the first batch built in Claude Code rather than shipped as a zip); **v88** moved user-facing connectivity checks to the `useOnline()` hook + added a temporary on-device cache diagnostic + **fixed the broken Vercel deploy** (added `.gitignore`; `node_modules` with Windows binaries had been committed, so v87 AND v88 never reached production and all "v87" device testing was actually testing old code); **v89** removed the diagnostic scaffolding and **corrected v88's wrong iOS `navigator.onLine` root cause** — see the CORRECTION bullet above. **v87's offline PO caching is CONFIRMED WORKING on an iPhone** as of v89: PO list + detail survive a force-close offline, and Add SKU → Start Inspection works offline. **v90** surfaced offline-created (pending) inspections in `Home`/`MyWork`/`PoHub` with a ⏳ NOT SYNCED badge, closing the last hole in the offline read side (device-verified); **v91** B6 **Stage 3 — offline photos & videos** for wheel inspections (`offlineMedia.ts`: local blobs keyed by their future storage path, queued `photos` rows, sync-after-inspections ordering, defect re-linking, ⏳ upload tally in the header); **v92** offline restore of SERVER inspections — caches the full row+defects on successful online load so an offline remount (incl. the flaky-wifi synced-then-dropped cycle) restores instead of crashing on the red "Could not load" card; **v93** fixed the spurious "Unsaved changes found on this device" prompt (root cause: Postgres JSONB reorders form_data keys, so the order-sensitive `JSON.stringify` compare falsely flagged identical all-online inspections — now compared canonically via `stableStringify`) and made the prompt informative (shows the device copy's save time + a "what's different" list, buttons relabeled "Restore device copy"/"Keep server copy"); **v94** online-created inspections stay visible on their PO page offline (`cachePoHubInsp` folds an inspection into its PO-page cache on online load, closing the "created online → continue offline → SKU missing from PO page" dead-end) (this is the newest).

---

## 8. What's NOT done yet (gaps, half-built, next steps)

**Repo/schema hygiene:**
- **Missing migration files `01`–`03` and `20`.** Tables exist live but the DDL isn't in the repo. Recommended early task: regenerate them from the live DB (`information_schema` + `pg_policies`) so history is complete. Reconstructed DDL in §3 is best-effort.
- `report_translations` and `custom_dispositions` are in repo migrations but **may not exist in the live DB** — verify (they're `to_regclass`-guarded in migration 19 for this reason).
- Pre-existing lint errors remain (non-blocking): `react-refresh/only-export-components` on `i18n.tsx`; `set-state-in-effect` on several effects; `no-explicit-any` in `PoInfo.tsx`. Only `rules-of-hooks = 0` is enforced.

**Offline (B6) — the staged plan and where it stands:**
- **Stage 1 — DONE (v77):** local IndexedDB safety net (`localDraft`).
- **Stage 2 — IN PROGRESS:** connectivity awareness (v81 ✓), reference-data caching (v83/v85 ✓), offline creation of inspections + write-queue/sync (v86 ✓ for **wheel inspections**), PO-page offline caching (v87 ✓ — this closed the offline READ side; it's also what makes the v86 flow *reachable* onsite, since a blank PO list meant no door into Add SKU → Start Inspection). **Still to do in Stage 2:**
  - **Offline container-loading creation** (quick follow-up): v86 only did wheel inspections. `ContainerLoading.tsx` + `PoHub.addContainer` need the same client-UUID + pending-store + sync treatment. (v87 made `addContainer` block cleanly offline instead of erroring — that's a stopgap, not the fix.)
  - ~~Offline-created inspections aren't listed anywhere until they sync~~ — **DONE in v90.** Pending inspections are merged into `Home`, `MyWork` and `PoHub` at display time (never into the cache, which holds server truth), scoped to the signed-in inspector and deduped by id against server rows so a just-synced inspection can't appear twice. Helper: `getPendingForUser(userId)` in `offlineSync.ts`. v90 also blocks two footguns: deleting a pending inspection (a server delete would affect 0 rows, look successful, and the item would reappear from IndexedDB) and deleting a PO that still has un-uploaded work (would wipe the server side while the device copy survives and re-syncs).
  - **Submit-for-approval requires connectivity** — reconnect + let the pending banner clear first. Possibly queue submits later.
- **Stage 3 — DONE for wheel inspections (v91):** offline **photos/videos** — local blobs in IndexedDB uploaded to `qc-photos` on reconnect (`offlineMedia.ts`, §5). Still online-only: the reference library (`Camera.tsx`), report-logo uploads, `CopyModal`, **container-loading photos**, and the `ocr-label` scan.
- **Stage 4 — NOT STARTED:** **sync conflicts.** Rule: queue the local copy, FLAG for review, never silently overwrite. Refined requirement is a **merge/"keep both"** view (photos/defects are additive separate rows; `form_data` is per-wheel so different wheels merge cleanly; only same-field-same-wheel is a true conflict needing a manual pick). Migration 22's server-authoritative `updated_at` + `localDraft`'s stored `serverUpdatedAt` are the foundation for detecting "the server changed while you were offline". The concrete scenario the user cares about most: two users on the same shared SKU — one online marks All Pass, one offline marks All Fail — must flag, not overwrite.
- **Narrow known residual race** in v86 sync (edit during the reconnect push window) — self-healing via state + `localDraft` + next save; documented in §5. A fuller fix would gate all savers (not just `saveFd`) on `isPending`, or re-push after `isPending` clears.

**Suggested next batch (as of v91):** the offline read side AND wheel-inspection photos are done. Remaining, in order:
1. **Offline container-loading creation + its photos.** v86/v91 covered wheel inspections only. `ContainerLoading.tsx` + `PoHub.addContainer` need the same client-UUID + pending-store + sync treatment, and it can now reuse `offlineMedia.ts` wholesale (queued rows already carry a `container_loading_id` field for exactly this). **Sequencing note — this was deliberately put AFTER Stage 3:** a container-loading inspection is ~9 mandatory container photos plus a label photo per pallet, so offline creation without offline photos would have shipped something unusable in the field (the container is sealed and gone before the inspector is back in signal). The `ocr-label` AI scan stays online-only.
2. **Stage 4 — conflict/merge.** Kwong has repeatedly flagged the two-user shared-SKU clash (one online marks All Pass, one offline marks All Fail) as the scenario he most wants handled.

**Repo hygiene worth doing before Stage 4:** regenerate migrations `01`–`03` and `20` from the live DB. Conflict work will lean on the junction table's exact schema and RLS, and right now that DDL exists nowhere in the repo.

---

## 9. All current code (verbatim)

Every source, config, migration, and edge-function file follows, in full. This section is auto-generated by concatenation, so it is byte-exact. **Do not trust a mental model of any file — read it here.** (The large SKU seed `INSERT` in `05_migration.sql` is included in full.)


---

## 9a. Root config + app shell

### `package.json`

```json
{
  "name": "web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@fontsource/barlow": "^5.2.8",
    "@fontsource/barlow-semi-condensed": "^5.2.7",
    "@supabase/supabase-js": "^2.108.1",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-router-dom": "^7.17.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^24.13.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^10.3.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.6.0",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.59.2",
    "vite": "^8.0.16",
    "vite-plugin-pwa": "^1.3.0"
  }
}

```

### `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo-white.png'],
      manifest: {
        name: 'NITRA QC Inspection',
        short_name: 'NITRA QC',
        description: 'Alloy wheel QC inspection toolkit',
        theme_color: '#1F3A5F',
        background_color: '#EEF1F5',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})

```

### `vercel.json`

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}

```

### `.env.example`

```text
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_public_key

```

### `tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}

```

### `tsconfig.app.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}

```

### `tsconfig.node.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}

```

### `eslint.config.js`

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])

```

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```

### `src/main.tsx`

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { I18nProvider } from './lib/i18n'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

```

### `src/index.css`

```css
@import '@fontsource/barlow-semi-condensed/600.css';
@import '@fontsource/barlow-semi-condensed/700.css';
@import '@fontsource/barlow/400.css';
@import '@fontsource/barlow/500.css';
@import '@fontsource/barlow/600.css';

:root {
  --navy: #1F3A5F;
  --navy-deep: #142A45;
  --steel: #EEF1F5;
  --line: #D5DBE4;
  --ink: #18222E;
  --ink-soft: #5A6878;
  --pass: #1F8A4C;
  --pass-bg: #E3F3EA;
  --fail: #C0392B;
  --fail-bg: #FBE9E7;
  --amber: #B97A14;
  --amber-bg: #FCF2DD;
  --input: #FFF7DF;
  --radius: 10px;
  --display: 'Barlow Semi Condensed', 'Noto Sans SC', sans-serif;
  --body: 'Barlow', 'Noto Sans SC', -apple-system, sans-serif;
}
* { box-sizing: border-box; margin: 0; }
html, body, #root { height: 100%; }
body {
  font-family: var(--body);
  background: var(--steel);
  color: var(--ink);
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
h1,h2,h3 { font-family: var(--display); letter-spacing: .01em; }
button { font-family: inherit; cursor: pointer; }
input, select, textarea { font-family: inherit; font-size: 16px; }

/* App shell */
.topbar {
  background: var(--navy); color: #fff;
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; position: sticky; top: 0; z-index: 50;
}
.topbar img { height: 26px; }
.topbar .title { font-family: var(--display); font-weight: 700; font-size: 18px; flex: 1; }
/* B6 Stage 2 — connectivity pill in the header */
.netpill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 11px; border-radius: 999px;
  font-size: 12.5px; font-weight: 700; line-height: 1; white-space: nowrap;
}
.netpill .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.netpill.on  { background: #10633A; color: #D7F6E5; }
.netpill.on  .dot { background: #34E08A; box-shadow: 0 0 0 3px rgba(52,224,138,.22); }
.netpill.off { background: #3A4658; color: #CDD6E3; }
.netpill.off .dot { background: #98A6B8; }
.topbar button {
  background: rgba(255,255,255,.12); color: #fff; border: 1px solid rgba(255,255,255,.25);
  border-radius: 8px; padding: 8px 14px; font-weight: 600; font-size: 14px;
}
.page { max-width: 1100px; margin: 0 auto; padding: 16px; padding-bottom: 90px; }

/* Cards & layout */
.card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; margin-bottom: 14px; }
.card h2 { font-size: 20px; color: var(--navy); margin-bottom: 12px; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }

/* Form elements — big touch targets */
label.fld { display: block; }
label.fld span { display: block; font-size: 13px; font-weight: 600; color: var(--ink-soft); margin-bottom: 5px; text-transform: uppercase; letter-spacing: .04em; }
input.txt, select.sel, textarea.txt {
  width: 100%; padding: 13px 14px; border: 1.5px solid var(--line);
  border-radius: 8px; background: var(--input); min-height: 50px;
}
input.txt:focus, select.sel:focus, textarea.txt:focus { outline: 3px solid #9FB6D4; border-color: var(--navy); }
input.auto { background: var(--pass-bg); }

.btn {
  background: var(--navy); color: #fff; border: none; border-radius: 10px;
  padding: 14px 22px; font-weight: 700; font-size: 16px; min-height: 52px;
  font-family: var(--display); letter-spacing: .02em;
}
.btn:disabled { opacity: .45; }
.btn.ghost { background: #fff; color: var(--navy); border: 1.5px solid var(--navy); }
.btn.danger { background: var(--fail); }
.btn.ok { background: var(--pass); }

/* P / F / NA segment */
.pfna { display: flex; gap: 6px; }
.pfna button {
  flex: 1; min-width: 52px; min-height: 48px; border-radius: 8px;
  border: 1.5px solid var(--line); background: #fff; font-weight: 700; font-size: 15px;
}
.pfna button.p.on { background: var(--pass); border-color: var(--pass); color: #fff; }
.pfna button.f.on { background: var(--fail); border-color: var(--fail); color: #fff; }
.pfna button.n.on { background: var(--ink-soft); border-color: var(--ink-soft); color: #fff; }

/* status banner — the live rule engine readout */
.banner { border-radius: var(--radius); padding: 12px 16px; margin-bottom: 14px; font-weight: 600; border: 1.5px solid; }
.banner.ok { background: var(--pass-bg); border-color: var(--pass); color: var(--pass); }
.banner.warn { background: var(--amber-bg); border-color: var(--amber); color: var(--amber); }
.banner.bad { background: var(--fail-bg); border-color: var(--fail); color: var(--fail); }

/* tables */
table.tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.tbl th { background: var(--navy); color: #fff; padding: 9px 8px; text-align: left; font-family: var(--display); font-weight: 600; letter-spacing: .03em; }
.tbl td { padding: 8px; border-bottom: 1px solid var(--line); }
.tbl tr:nth-child(even) td { background: #F7F9FB; }
.tbl input { width: 76px; padding: 9px 6px; border: 1.5px solid var(--line); border-radius: 6px; background: var(--input); text-align: center; }
.tbl input.bad { background: var(--fail-bg); border-color: var(--fail); }
.tbl input.good { background: var(--pass-bg); }

/* tabs */
.tabs { display: flex; gap: 4px; overflow-x: auto; margin-bottom: 14px; position: sticky; top: 54px; z-index: 40; background: var(--steel); padding: 6px 0; }
.tabs button {
  border: 1.5px solid var(--line); background: #fff; border-radius: 999px;
  padding: 10px 16px; font-weight: 600; white-space: nowrap; font-size: 14px;
}
.tabs button.on { background: var(--navy); color: #fff; border-color: var(--navy); }

.pill { display: inline-block; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 700; }
.pill.draft { background: var(--line); color: var(--ink-soft); }
.pill.submitted { background: var(--amber-bg); color: var(--amber); }
.pill.approved { background: var(--pass-bg); color: var(--pass); }
.pill.rejected { background: var(--fail-bg); color: var(--fail); }

.camera-thumb { width: 84px; height: 84px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
.muted { color: var(--ink-soft); font-size: 13px; }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.55);
  display: grid; place-items: center; z-index: 200; padding: 12px;
  overflow-y: auto;
}
.modal {
  background: #fff; border-radius: var(--radius); padding: 20px;
  width: min(520px, 100%); max-height: 92vh; overflow-y: auto;
}

/* Inline + photo button */
.plus-btn {
  background: transparent; border: 1.5px dashed var(--line);
  border-radius: 8px; padding: 6px 10px; font-size: 18px; min-height: 44px; min-width: 44px;
  color: var(--ink-soft);
}
.plus-btn.has-photo { border-color: var(--pass); color: var(--pass); }
.plus-btn.has-fail-photo { border-color: var(--fail); color: var(--fail); }

/* Extra pieces inline recorder */
.extra-recorder { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
.extra-dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; border: 2px solid var(--line); }
.extra-dot.p { background: var(--pass-bg); border-color: var(--pass); color: var(--pass); }
.extra-dot.f { background: var(--fail-bg); border-color: var(--fail); color: var(--fail); }

/* ===== Mobile / phone responsive ===== */
.topbar-burger {
  display: none; background: rgba(255,255,255,.12); color: #fff;
  border: 1px solid rgba(255,255,255,.25); border-radius: 8px;
  width: 44px; height: 44px; font-size: 20px; align-items: center; justify-content: center;
}
.topbar-nav { display: flex; align-items: center; gap: 14px; }

/* 100% Check tab accent (moved off inline style so mobile can restyle it) */
.tabs button.crit { background: var(--fail); color: #fff; border-color: var(--fail); }

@media (max-width: 820px) {
  .topbar .title { font-size: 16px; }
  .topbar-burger { display: inline-flex; }
  .topbar-nav { display: none; }
  .topbar-nav.open {
    display: flex; flex-direction: column; align-items: stretch; gap: 8px;
    position: absolute; top: 100%; left: 0; right: 0;
    background: var(--navy-deep); padding: 12px 16px;
    border-top: 1px solid rgba(255,255,255,.15);
  }
  .topbar-nav.open a { display: block; }
  .topbar-nav.open button { width: 100%; text-align: left; min-height: 48px; }
}

/* Inspection tabs become a bottom nav bar on phones */
.tabs button .tab-ico { display: none; }
@media (max-width: 768px) {
  .tabs {
    position: fixed; top: auto; bottom: 0; left: 0; right: 0;
    margin: 0; gap: 0; padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    background: #fff; border-top: 1px solid var(--line); overflow-x: visible;
    box-shadow: 0 -2px 10px rgba(0,0,0,.07);
  }
  .tabs button {
    flex: 1; min-width: 0; border: none; border-radius: 8px; background: transparent;
    padding: 4px 2px; display: flex; flex-direction: column; align-items: center; gap: 2px;
    color: var(--ink-soft); white-space: normal; line-height: 1.05;
  }
  .tabs button.on { background: transparent; color: var(--navy); border: none; }
  .tabs button.crit { background: transparent; color: var(--fail); border: none; }
  .tabs button .tab-ico { display: block; font-size: 19px; line-height: 1; }
  .tabs button .tab-txt { font-size: 10px; }
  .page { padding-left: 12px; padding-right: 12px; }
}

/* PO command-center status strip (B4) */
.pstrip { display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; }
.pstrip .pseg {
  flex: 1 1 150px; min-width: 130px;
  border: 1.5px solid var(--line); border-radius: 10px;
  background: #fff; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 3px;
}
.pstrip .pseg-name { font-family: var(--display); font-weight: 700; font-size: 14px; line-height: 1.15; letter-spacing: .02em; color: var(--ink); }
.pstrip .pseg-state { font-size: 12px; line-height: 1.3; color: var(--ink-soft); }
.pstrip .pseg.done { background: var(--pass-bg); border-color: var(--pass); }
.pstrip .pseg.done .pseg-state { color: var(--pass); font-weight: 700; }
.pstrip .pseg.active { background: var(--amber-bg); border-color: var(--amber); }
.pstrip .pseg.active .pseg-state { color: var(--amber); font-weight: 700; }
.pstrip .pseg.todo .pseg-name { color: var(--ink-soft); }
.pstrip .pseg.ext { flex: 0 1 120px; border-style: dashed; background: transparent; opacity: .7; }
.pstrip .pseg.ext .pseg-name { color: var(--ink-soft); font-weight: 600; }

```

### `src/App.tsx`

```tsx
import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useI18n } from './lib/i18n'
import { useOnline } from './lib/connectivity'
import { warmRefCache } from './lib/refCache'
import { syncPendingInspections } from './lib/offlineSync'
import Login from './pages/Login'
import Home from './pages/Home'
import NewInspection from './pages/NewInspection'
import Inspection from './pages/Inspection'
import Approvals from './pages/Approvals'
import Settings from './pages/Settings'
import Skus from './pages/Skus'
import TeamPage from './pages/TeamPage'
import SetPassword from './pages/SetPassword'
import CustomerHome from './pages/CustomerHome'
import MyWork from './pages/MyWork'
import AdminDashboard from './pages/AdminDashboard'
import RefLibrary from './pages/RefLibrary'
import ReportPage from './pages/ReportPage'
import PoReportPage from './pages/PoReportPage'
import ContainerReportPage from './pages/ContainerReportPage'
import ContainerLoading from './pages/ContainerLoading'
import PoHub from './pages/PoHub'
import ErrorBoundary from './components/ErrorBoundary'

export interface Profile { id: string; full_name: string; role: 'inspector' | 'admin' | 'customer' }

// Cache the signed-in profile so an offline blip (profile fetch fails with no
// network) doesn't get misread as "no user" and bounce a logged-in inspector to
// the Login screen. Only a real sign-out clears it.
const PROFILE_KEY = 'nitra_profile'
function cacheProfile(p: Profile) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch { /* ignore */ } }
function readCachedProfile(): Profile | null {
  try { const s = localStorage.getItem(PROFILE_KEY); return s ? (JSON.parse(s) as Profile) : null } catch { return null }
}
function clearCachedProfile() { try { localStorage.removeItem(PROFILE_KEY) } catch { /* ignore */ } }
function looksOffline(msg?: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return /load failed|failed to fetch|network/i.test(msg || '')
}

// Captured synchronously at module load: an invite / password-reset link arrives
// with its one-time token in the URL hash (e.g. #...&type=invite). The Supabase
// client strips the hash asynchronously, so we read the type now, before that.
const initialLinkType = (() => {
  try { return new URLSearchParams((window.location.hash || '').replace(/^#/, '')).get('type') }
  catch { return null }
})()

export default function App() {
  const [recoverMode, setRecoverMode] = useState(initialLinkType === 'invite' || initialLinkType === 'recovery')
  const [mustReset, setMustReset] = useState(false)
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [wide, setWide] = useState(window.innerWidth >= 900)
  const [pendingCount, setPendingCount] = useState(0)
  const { lang, setLang, t } = useI18n()
  const online = useOnline()
  const nav = useNavigate()
  const location = useLocation()
  // Recipients of an emailed report link are not logged-in NITRA staff, so this
  // one route must never go through the login wall below.
  const isPublicReport = location.pathname.startsWith('/report/') || location.pathname.startsWith('/po-report/') || location.pathname.startsWith('/container-report/')

  useEffect(() => {
    if (isPublicReport) return
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        // No readable session. If we're offline but have a cached profile, keep
        // the user in rather than forcing a login they can't complete offline.
        const cached = readCachedProfile()
        if (cached && looksOffline()) { setProfile(cached); setMustReset(false); return }
        setProfile(null); setMustReset(false); return
      }
      // Accounts created by an admin with a temporary password must choose
      // their own password before using the app.
      setMustReset(session.user.user_metadata?.must_reset === true)
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (data && !error) { setProfile(data as Profile); cacheProfile(data as Profile); return }
      // Fetch failed. Offline/network → keep the cached profile (don't log out).
      const cached = readCachedProfile()
      if (cached && looksOffline(error?.message)) { setProfile(cached); return }
      setProfile((data as Profile) ?? null)
    }
    load()
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Only a genuine sign-out logs the user out. Transient null sessions (e.g. a
      // failed token refresh while offline) must NOT drop a logged-in inspector.
      if (event === 'SIGNED_OUT') { setProfile(null); clearCachedProfile() }
      else if (s) load()
    })
    return () => sub.subscription.unsubscribe()
  }, [isPublicReport])

  useEffect(() => {
    const onR = () => setWide(window.innerWidth >= 900)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])

  // Warm the offline reference cache (SKU list + sampling settings) whenever we're
  // logged in and online — so offline screens have the data no matter which screen
  // was opened first.
  useEffect(() => { if (online && profile) void warmRefCache() }, [online, profile])

  // Push any offline-created inspections to the server whenever we're logged in and
  // online (on load and the moment connectivity returns). Scoped to this user; the
  // currently-open inspection syncs itself from its own screen.
  useEffect(() => { if (online && profile) void syncPendingInspections(profile.id) }, [online, profile])

  // Sidebar badge: how many items await approval (admins, refreshed per navigation)
  useEffect(() => {
    if (profile?.role !== 'admin') return
    ;(async () => {
      const [a, b] = await Promise.all([
        supabase.from('inspections').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('container_loadings').select('id', { count: 'exact', head: true }).eq('insp_status', 'submitted'),
      ])
      setPendingCount((a.count ?? 0) + (b.count ?? 0))
    })()
  }, [profile?.role, location.pathname])

  if (isPublicReport) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/report/:id" element={<ReportPage />} />
          <Route path="/po-report/:po" element={<PoReportPage />} />
          <Route path="/container-report/:id" element={<ContainerReportPage />} />
        </Routes>
      </ErrorBoundary>
    )
  }

  if (profile === undefined) return <div className="page">…</div>

  // An invited user (or password reset) must set a password before using the app.
  if (recoverMode) {
    return <SetPassword onDone={() => {
      try { history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
      setRecoverMode(false)
      nav('/')
    }} />
  }

  if (profile === null) return <Login />

  // Temp-password accounts must choose their own password before anything else.
  if (mustReset) {
    return <SetPassword forced onDone={() => { setMustReset(false); nav('/') }} />
  }

  // Customers get their own dashboard: assigned POs, status, and report links.
  // RLS (migration 19) scopes their data server-side; this is the whole UI.
  if (profile.role === 'customer') {
    return <CustomerHome profile={profile} />
  }

  const isWorkScreen = location.pathname.startsWith('/inspection/') || location.pathname.startsWith('/container/')
  const showBottomNav = profile.role === 'inspector' && !isWorkScreen
  const showSidebar = profile.role === 'admin' && wide
  const SIDEBAR_ITEMS = [
    { to: '/dashboard', label: t('dashboard'), icon: '🏠' },
    { to: '/', label: t('pos'), icon: '📋' },
    { to: '/approvals', label: t('approvals'), icon: '✅', badge: pendingCount },
    { to: '/users', label: t('users'), icon: '👥' },
    { to: '/skus', label: t('skus'), icon: '🛞' },
    { to: '/reference', label: t('reference'), icon: '🖼' },
    { to: '/settings', label: t('settings'), icon: '⚙️' },
  ]

  return (
    <>
      <header className="topbar">
        <Link to="/"><img src="/logo-white.png" alt="NITRA" /></Link>
        <span className="title" style={{ flex: '0 0 auto' }}>{t('appTitle')}</span>
        <span
          className={online ? 'netpill on' : 'netpill off'}
          title={online ? t('online') : t('offline')}
          aria-live="polite"
        >
          <span className="dot" />{online ? t('online') : t('offline')}
        </span>
        <span style={{ flex: 1 }} />
        <button className="topbar-burger" aria-label="Menu" onClick={() => setMenuOpen(o => !o)}>☰</button>
        <nav className={menuOpen ? 'topbar-nav open' : 'topbar-nav'} onClick={() => setMenuOpen(false)}>
          {profile.role === 'admin' && !showSidebar && (
            <>
              <Link to="/approvals"><button>{t('approvals')}</button></Link>
              <Link to="/skus"><button>{t('skus')}</button></Link>
              <Link to="/users"><button>{t('users')}</button></Link>
              <Link to="/settings"><button>{t('settings')}</button></Link>
            </>
          )}
          {!showSidebar && <Link to="/reference"><button>{t('refLibrary')}</button></Link>}
          <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{lang === 'en' ? '中文' : 'EN'}</button>
          <button onClick={async () => { await supabase.auth.signOut(); nav('/') }}>{t('signOut')}</button>
        </nav>
      </header>
      <div style={showSidebar ? { display: 'flex', alignItems: 'flex-start' } : undefined}>
      {showSidebar && (
        <aside style={{ width: 216, flexShrink: 0, position: 'sticky', top: 0,
          height: 'calc(100vh - 56px)', background: '#fff', borderRight: '1.5px solid var(--line)',
          padding: '14px 10px' }}>
          {SIDEBAR_ITEMS.map(it => {
            const active = it.to === '/' ? (location.pathname === '/' || location.pathname.startsWith('/po/')) : location.pathname.startsWith(it.to)
            return (
              <Link key={it.to} to={it.to} style={{ textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px',
                  borderRadius: 10, marginBottom: 4, fontWeight: 700, fontSize: 14,
                  background: active ? 'var(--navy)' : 'transparent',
                  color: active ? '#fff' : 'var(--navy)' }}>
                  <span>{it.icon}</span>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {!!it.badge && <span style={{ background: active ? '#fff' : 'var(--amber, #B7791F)', color: active ? 'var(--navy)' : '#fff',
                    borderRadius: 12, fontSize: 12, fontWeight: 800, padding: '1px 8px' }}>{it.badge}</span>}
                </div>
              </Link>
            )
          })}
        </aside>
      )}
      <div style={showSidebar ? { flex: 1, minWidth: 0 } : undefined}>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home profile={profile} />} />
          <Route path="/po/:poNo" element={<PoHub profile={profile} />} />
          <Route path="/new" element={<NewInspection profile={profile} />} />
          <Route path="/inspection/:id" element={<Inspection profile={profile} />} />
          <Route path="/container/:id" element={<ContainerLoading profile={profile} />} />
          <Route path="/approvals" element={profile.role === 'admin' ? <Approvals /> : <Navigate to="/" />} />
          <Route path="/settings" element={profile.role === 'admin' ? <Settings /> : <Navigate to="/" />} />
          <Route path="/skus" element={profile.role === 'admin' ? <Skus /> : <Navigate to="/" />} />
          <Route path="/users" element={profile.role === 'admin' ? <TeamPage /> : <Navigate to="/" />} />
          <Route path="/team" element={<Navigate to="/users" />} />
          <Route path="/reference" element={<RefLibrary profile={profile} />} />
          <Route path="/mywork" element={<MyWork profile={profile} />} />
          <Route path="/dashboard" element={profile.role === 'admin' ? <AdminDashboard /> : <Navigate to="/" />} />
        </Routes>
      </ErrorBoundary>
      </div>
      </div>
      {showBottomNav && (
        <>
          <div style={{ height: 64 }} />
          <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 25,
            background: 'var(--navy)', display: 'flex',
            paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {[
              { to: '/', label: t('pos'), icon: '📋', active: location.pathname === '/' || location.pathname.startsWith('/po/') },
              { to: '/mywork', label: t('myWork'), icon: '🛠', active: location.pathname === '/mywork' },
              { to: '/reference', label: t('reference'), icon: '🖼', active: location.pathname === '/reference' },
            ].map(t => (
              <Link key={t.to} to={t.to} style={{ flex: 1, textDecoration: 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  padding: '8px 0 10px', color: '#fff', opacity: t.active ? 1 : 0.6,
                  borderTop: t.active ? '3px solid #fff' : '3px solid transparent', fontWeight: 700, fontSize: 12 }}>
                  <span style={{ fontSize: 20 }}>{t.icon}</span>{t.label}
                </div>
              </Link>
            ))}
          </nav>
        </>
      )}
    </>
  )
}

```


---

## 9b. src/lib

### `src/lib/connectivity.ts`

```ts
// ---------------------------------------------------------------------------
// B6 Stage 2 — connectivity awareness.
// A single source of truth for "is this device actually reachable to the
// server right now?" — the foundation the later write-queue / offline-creation
// batches hang off.
//
// Why not just navigator.onLine? On warehouse Wi-Fi a device can be "connected"
// (navigator.onLine === true) while having NO working route to the internet
// (captive portal, dead uplink). So we treat navigator.onLine only as a fast
// negative signal (false => definitely offline) and confirm the positive case
// with a lightweight reachability ping to Supabase.
//
// The ping uses mode:'no-cors' on purpose: we don't read the response body, we
// only care whether the network round-trip completes. That sidesteps CORS
// entirely — any completed request (even an opaque/401 one) means "server
// reachable"; only a network failure or timeout means "offline".
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
// GoTrue health endpoint — public, tiny, always present on a Supabase project.
const PING_URL = `${SUPABASE_URL}/auth/v1/health`
const RECHECK_MS = 30_000     // re-confirm periodically (catches silent drops)
const PING_TIMEOUT_MS = 5_000 // a hung request counts as offline

// Confirm the server is actually reachable. Never throws — resolves true/false.
export async function pingReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (!SUPABASE_URL) return true // misconfig: don't nag, assume online
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS)
  try {
    // cache-buster so a proxy can't answer an offline device from cache
    await fetch(`${PING_URL}?_=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// React hook: returns the current online/offline state, kept live via the
// browser's online/offline events, tab-visibility changes, and a periodic
// re-check. Safe against setState-after-unmount.
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    let alive = true
    const apply = (v: boolean) => { if (alive) setOnline(v) }
    const verify = () => { void pingReachable().then(apply) }

    const onOffline = () => apply(false)          // trust the negative immediately
    const onOnline = () => verify()               // confirm the positive
    const onVisible = () => { if (document.visibilityState === 'visible') verify() }

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    verify()                                      // initial confirmation
    const id = window.setInterval(verify, RECHECK_MS)

    return () => {
      alive = false
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(id)
    }
  }, [])

  return online
}

```

### `src/lib/i18n.tsx`

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'zh'
export type Bi = { en: string; zh: string }

const STR = {
  appTitle:       { en: 'QC Inspection',              zh: '质检系统' },
  signIn:         { en: 'Sign in',                    zh: '登录' },
  signOut:        { en: 'Sign out',                   zh: '退出' },
  email:          { en: 'Email',                      zh: '邮箱' },
  password:       { en: 'Password',                   zh: '密码' },
  staySignedIn:   { en: 'Stay signed in on this device', zh: '在此设备保持登录' },
  newInspection:  { en: 'New Inspection',             zh: '新建检验' },
  myInspections:  { en: 'My Inspections',             zh: '我的检验' },
  allInspections: { en: 'All Inspections',            zh: '全部检验' },
  partNo:         { en: 'Part No. / SKU',             zh: '产品编号' },
  poNo:           { en: 'PO No.',                     zh: '订单号' },
  batch:          { en: 'Batch / date stamp',         zh: '批次/日期' },
  lotSize:        { en: 'Lot size (pcs)',             zh: '批量（件）' },
  appSample:      { en: 'Appearance sample',          zh: '外观抽样' },
  funSample:      { en: 'Functional sample',          zh: '功能抽样' },
  start:          { en: 'Start Inspection',           zh: '开始检验' },
  tabVisual:      { en: 'Visual',                     zh: '外观' },
  tabTechnical:   { en: 'Technical',                  zh: '技术' },
  tabPhotos:      { en: 'Photos & Videos',            zh: '照片与视频' },
  tabPallet:      { en: 'Pallet Packing',             zh: '托盘包装' },
  palletCount:    { en: 'Number of pallets',          zh: '托盘数量' },
  tabSummary:     { en: 'Inspection Report',           zh: '检验报告' },
  tab100pct:      { en: '⛔ 100% Check',              zh: '⛔ 全检' },
  piece:          { en: 'Piece',                      zh: '件号' },
  addDefect:      { en: 'Log Defect',                 zh: '记录缺陷' },
  defectType:     { en: 'Defect type',                zh: '缺陷类型' },
  sizeMm:         { en: 'Size (mm)',                  zh: '尺寸(mm)' },
  severity:       { en: 'Severity',                   zh: '严重度' },
  critical:       { en: 'Critical',                   zh: '严重' },
  major:          { en: 'Major',                      zh: '主要' },
  minor:          { en: 'Minor',                      zh: '轻微' },
  takePhoto:      { en: 'Take photo',                 zh: '拍照' },
  save:           { en: 'Save',                       zh: '保存' },
  submit:         { en: 'Submit for Approval',        zh: '提交审批' },
  approve:        { en: 'Approve',                    zh: '批准' },
  reject:         { en: 'Reject',                     zh: '退回' },
  approvals:      { en: 'Approvals',                  zh: '审批' },
  settings:       { en: 'Settings',                   zh: '设置' },
  skus:           { en: 'SKUs',                       zh: 'SKU管理' },
  users:          { en: 'Users',                      zh: '用户管理' },
  refLibrary:     { en: 'Reference Library',          zh: '参考资料库' },
  nominal:        { en: 'Nominal',                    zh: '标称' },
  tolerance:      { en: 'Tolerance',                  zh: '公差' },
  result:         { en: 'Result',                     zh: '判定' },
  status:         { en: 'Status',                     zh: '状态' },
  remarks:        { en: 'Remarks',                    zh: '备注' },
  disposition:    { en: 'Disposition',                zh: '处置' },
  restoreTitle:   { en: 'Unsaved changes found on this device', zh: '本设备上发现未保存的更改' },
  restoreBody:    { en: 'This inspection has changes saved on this device that aren’t on the server — a save may have failed while offline. Restore them?', zh: '此检验在本设备上保存了尚未同步到服务器的更改——可能是离线时保存失败。是否恢复？' },
  restoreBtn:     { en: 'Restore', zh: '恢复' },
  restoreDiscard: { en: 'Discard', zh: '放弃' },
  dashboard:      { en: 'Dashboard', zh: '仪表板' },
  pos:            { en: 'POs', zh: '采购订单' },
  reference:      { en: 'Reference', zh: '参考资料' },
  allPos:         { en: 'All POs', zh: '所有采购订单' },
  noPo:           { en: '(No PO)', zh: '(无采购订单)' },
  wheelInspections:  { en: 'Wheel inspections', zh: '轮毂检验' },
  containerLoadings: { en: 'Container loadings', zh: '装柜检验' },
  deleteEntirePo: { en: 'Delete entire PO', zh: '删除整个订单' },
  addSku:         { en: 'Add SKU', zh: '添加SKU' },
  addContainer:   { en: 'Add container', zh: '添加集装箱' },
  noWheelInspections:  { en: 'No wheel inspections yet.', zh: '暂无轮毂检验。' },
  noContainerLoadings: { en: 'No container loadings yet.', zh: '暂无装柜检验。' },
  noContainerNo:  { en: '(no container no.)', zh: '(无集装箱号)' },
  seal:           { en: 'Seal', zh: '封条' },
  delWheelConfirm:   { en: 'Delete this wheel inspection? This cannot be undone.', zh: '删除此轮毂检验？此操作无法撤销。' },
  delContConfirm:    { en: 'Delete this container loading? This cannot be undone.', zh: '删除此装柜检验？此操作无法撤销。' },
  poInformation:  { en: 'PO information', zh: '订单信息' },
  customer:       { en: 'Customer', zh: '客户' },
  poDate:         { en: 'PO date', zh: '订单日期' },
  destination:    { en: 'Destination', zh: '目的地' },
  orderedItems:   { en: 'Ordered items', zh: '订购项目' },
  addItem:        { en: 'Add item', zh: '添加项目' },
  uploadExcel:    { en: 'Upload Excel', zh: '上传Excel' },
  noOrderedItems: { en: 'No ordered items recorded yet.', zh: '暂无订购项目记录。' },
  addUploadHint:  { en: ' Add items or upload the PO item list (Excel).', zh: ' 可添加项目或上传采购订单明细（Excel）。' },
  partNumber:     { en: 'Part number', zh: '零件号' },
  ordered:        { en: 'Ordered', zh: '订购' },
  loaded:         { en: 'Loaded', zh: '已装' },
  remainingQty:   { en: 'Remaining', zh: '剩余' },
  qty:            { en: 'Qty', zh: '数量' },
  edit:           { en: 'Edit', zh: '编辑' },
  partRequired:   { en: 'Part number is required.', zh: '请填写零件号。' },
  myWork:         { en: 'My Work', zh: '我的工作' },
  customerName:   { en: 'Customer name', zh: '客户名称' },
  saving:         { en: 'Saving…', zh: '保存中…' },
  addOrderedItem: { en: 'Add ordered item', zh: '添加订购项目' },
  qtyOrdered:     { en: 'Quantity ordered', zh: '订购数量' },
  saveItem:       { en: 'Save item', zh: '保存项目' },
  reviewExtracted:{ en: 'Review extracted items', zh: '核对提取的项目' },
  reviewHint:     { en: 'Nothing is saved yet. Fix any highlighted rows, then confirm. Existing items with the same part number will have their ordered quantity updated.', zh: '尚未保存。请修正高亮行后确认。相同零件号的现有项目将更新其订购数量。' },
  attachInspection: { en: 'Attach inspection', zh: '关联检验' },
  attachHint:       { en: 'Attach an existing approved inspection of a SKU this PO ordered — no need to re-inspect a shared lot.', zh: '关联此订单已订购SKU的现有已批准检验——共享批次无需重复检验。' },
  showOffPo:        { en: 'Show inspections for SKUs not on this PO', zh: '显示不在此订单上的SKU检验' },
  noAttachCandidates: { en: 'No approved inspections available to attach.', zh: '暂无可关联的已批准检验。' },
  attach:           { en: 'Attach', zh: '关联' },
  offPo:            { en: 'NOT ON PO', zh: '不在订单' },
  sharedWithPos:    { en: 'Shared with POs', zh: '共享至订单' },
  sharedHint:       { en: 'POs this SKU inspection covers. The inspection is a verdict on the lot; per-PO quantities live in each PO’s ordered items.', zh: '此SKU检验所覆盖的订单。检验为对该批次的判定；各订单数量见其订购项目。' },
  addToPo:          { en: 'Add to PO', zh: '添加到订单' },
  remove:           { en: 'Remove', zh: '移除' },
  noPosLinked:      { en: 'Not linked to any PO yet.', zh: '尚未关联任何订单。' },
  dispApprovedLoading: { en: 'Approved for Loading',                     zh: '批准装柜' },
  dispHoldRework:      { en: 'Hold for Rework & Reinspection',          zh: '暂扣返工并重检' },
  dispConditional:     { en: 'Conditional Loading — Failed Pieces Excluded', zh: '有条件装柜 — 已剔除不合格件' },
  dispConditionalRework: { en: 'Conditional Loading — Rework Rejected Pieces & Load', zh: '有条件装柜 — 返工不合格件后装柜' },
  dispPendingCustomer: { en: 'Pending Customer Approval',               zh: '待客户批准' },
  inspectionFindings:  { en: 'Inspection Findings',                     zh: '检验结果' },
  correctiveAction:    { en: 'Corrective Action / Disposition',         zh: '纠正措施 / 处置' },
  insertTemplate:      { en: 'Insert wording',                          zh: '插入用语' },
  allClean:       { en: 'No defects flagged — on track', zh: '暂无缺陷——正常' },
  extraNeeded:    { en: 'Inspect extra pieces for',   zh: '需加检：' },
  fullInsp:       { en: '100% INSPECTION required',  zh: '需全检' },
  monitor:        { en: 'Below trigger — record & monitor', zh: '低于阈值——记录监控' },
  updated:        { en: 'Updated',                    zh: '更新' },
  submitted:      { en: 'Submitted',                  zh: '提交' },
  po:             { en: 'PO',                         zh: '订单' },
  lot:            { en: 'Lot',                        zh: '批量' },
  defectsLogged:  { en: 'Defects logged',             zh: '已记录缺陷' },
  photosTaken:    { en: 'Photos taken',               zh: '已拍照片' },
  release:        { en: 'RELEASE',                    zh: '放行' },
  releaseRecord:  { en: 'RELEASE WITH RECORD',        zh: '记录放行' },
  hold100:        { en: 'HOLD — 100% INSPECTION',     zh: '全检待定' },
  rejectDisp:     { en: 'REJECT',                     zh: '拒收' },
  requiredShots:  { en: 'Required Shots',             zh: '必拍照片' },
  allPhotos:      { en: 'All Photos',                 zh: '所有照片' },
  take:           { en: 'Take',                       zh: '拍摄' },
  assign:         { en: 'Assign',                     zh: '指定' },
  notTaken:       { en: 'Not taken',                  zh: '未拍' },
  passPhoto:      { en: 'Pass — Take Photo',          zh: '合格拍照' },
  failDefect:     { en: 'Fail — Log Defect',          zh: '不合格记录' },
  saveDefect:     { en: 'Save Defect',                zh: '保存缺陷' },
  cancel:         { en: 'Cancel',                     zh: '取消' },
  comment:        { en: 'Comment (optional)',         zh: '备注（可选）' },
  measurement:    { en: 'Measurement',                zh: '测量值' },
  inspParam:      { en: 'Inspected Parameter',        zh: '检验项目' },
  allPass:        { en: 'All P',                      zh: '全部合格' },
  allFail:        { en: 'All F',                      zh: '全部不合格' },
  allNA:          { en: 'All NA',                     zh: '全部不适用' },
  undo:           { en: '↩ Undo',                     zh: '↩ 撤销' },
  refStandard:    { en: 'View standard reference',    zh: '查看标准参考' },
  close:          { en: 'Close',                      zh: '关闭' },
  submitConfirm:  { en: 'Submit this inspection for approval?', zh: '确认提交此检验单审批？' },
  submitWarning:  { en: 'Once submitted, you cannot make changes unless an admin returns it.', zh: '提交后，除非管理员退回，否则无法修改。' },
  noPhotoYet:     { en: 'No photos yet',              zh: '暂无照片' },
  noDefectsYet:   { en: 'No defects logged.',         zh: '暂无缺陷记录。' },
  extraPiece:     { en: 'Extra piece',                zh: '加检件' },
  of:             { en: 'of',                         zh: '/' },
  checked:        { en: 'Checked',                    zh: '已检' },
  fails:          { en: 'Fails',                      zh: '不合格' },
  remaining:      { en: 'Remaining',                  zh: '待检' },
  checkingFor:    { en: 'Checking for',               zh: '检查项目' },
  pdfReport:      { en: '📄 PDF Report',               zh: '📄 PDF报告' },
  online:         { en: 'Online',                     zh: '在线' },
  offline:        { en: 'Offline',                    zh: '离线' },
  offlineSaved:   { en: 'You’re offline — changes are saved on this device and will sync when the connection is back.', zh: '您已离线——更改已保存在本设备，恢复联网后将自动同步。' },
  offlineCantSubmit: { en: 'You’re offline. Your work is saved on this device — reconnect to submit for approval.', zh: '您已离线。工作已保存在本设备——请恢复联网后再提交审批。' },
  notSyncedYet:   { en: 'Not synced yet — this inspection was created offline and is saved on this device. It will upload automatically when you’re back online.', zh: '尚未同步——此检验为离线创建，已保存在本设备。恢复联网后将自动上传。' },
  sampleSettingsMissing: { en: 'Sample-size settings aren’t available yet — connect once so they load, then you can start inspections offline.', zh: '抽样设置尚未加载——请先联网一次以加载，之后即可离线开始检验。' },
} satisfies Record<string, Bi>

type Key = keyof typeof STR
const Ctx = createContext<{
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: Key) => string
  bi: (b: Bi) => string
}>(null!)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>((localStorage.getItem('lang') as Lang) || 'en')
  const set = (l: Lang) => { localStorage.setItem('lang', l); setLang(l) }
  const t = (k: Key) => STR[k][lang]
  const bi = (b: Bi) => b[lang]
  return <Ctx.Provider value={{ lang, setLang: set, t, bi }}>{children}</Ctx.Provider>
}
export const useI18n = () => useContext(Ctx)

```

### `src/lib/inspectionPos.ts`

```ts
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Shared SKU inspections — helpers over the inspection_pos junction table.
// One wheel inspection (a verdict on a production lot) can be linked to many
// POs. The link is association-only: per-PO quantities live in the ordered-items
// table, not here. off_po marks a link where the SKU is not on that PO's order.
// ---------------------------------------------------------------------------

export interface PoLink { po_no: string; off_po: boolean }

// Inspection ids linked to a PO, with each link's off_po flag.
export async function linkedInspectionIds(po: string): Promise<{ ids: string[]; offPo: Record<string, boolean> }> {
  const { data } = await supabase.from('inspection_pos').select('inspection_id, off_po').eq('po_no', po)
  const rows = (data as { inspection_id: string; off_po: boolean }[]) || []
  const offPo: Record<string, boolean> = {}
  for (const r of rows) offPo[r.inspection_id] = r.off_po
  return { ids: rows.map(r => r.inspection_id), offPo }
}

// POs an inspection is linked to.
export async function posForInspection(inspId: string): Promise<PoLink[]> {
  const { data } = await supabase.from('inspection_pos').select('po_no, off_po').eq('inspection_id', inspId).order('po_no')
  return (data as PoLink[]) || []
}

// PO numbers that ordered a given part number (eligible to attach), minus any to exclude.
export async function posOrderingPart(partNo: string, exclude: string[] = []): Promise<string[]> {
  const { data } = await supabase.from('po_items').select('pos!inner(po_no)').eq('part_no', partNo)
  const rows = (data as { pos: { po_no: string } | { po_no: string }[] | null }[]) || []
  const ex = new Set(exclude)
  const out = new Set<string>()
  for (const r of rows) {
    const p = r.pos
    if (!p) continue
    for (const x of (Array.isArray(p) ? p : [p])) {
      if (x?.po_no && !ex.has(x.po_no)) out.add(x.po_no)
    }
  }
  return [...out].sort()
}

// Every PO number (for the off-PO override), minus any to exclude.
export async function allPoNos(exclude: string[] = []): Promise<string[]> {
  const { data } = await supabase.from('pos').select('po_no').order('po_no')
  const ex = new Set(exclude)
  return ((data as { po_no: string }[]) || []).map(r => r.po_no).filter(p => !ex.has(p))
}

export async function attachToPo(inspId: string, po: string, offPo: boolean, createdBy?: string) {
  return supabase.from('inspection_pos').insert({ inspection_id: inspId, po_no: po, off_po: offPo, created_by: createdBy ?? null })
}

export async function detachFromPo(inspId: string, po: string) {
  return supabase.from('inspection_pos').delete().eq('inspection_id', inspId).eq('po_no', po)
}

// Delete a PO's links, then delete only the inspections that are now orphaned
// (no remaining PO). Shared inspections still linked elsewhere are preserved.
export async function deletePoLinksAndOrphans(po: string): Promise<void> {
  const { ids } = await linkedInspectionIds(po)
  await supabase.from('inspection_pos').delete().eq('po_no', po)
  if (!ids.length) return
  const { data: still } = await supabase.from('inspection_pos').select('inspection_id').in('inspection_id', ids)
  const stillSet = new Set(((still as { inspection_id: string }[]) || []).map(s => s.inspection_id))
  const orphans = ids.filter(id => !stillSet.has(id))
  if (orphans.length) await supabase.from('inspections').delete().in('id', orphans)
}

```

### `src/lib/localDraft.ts`

```ts
// ---------------------------------------------------------------------------
// B6 Stage 1 — offline safety net.
// Snapshots the currently-open wheel / container inspection to IndexedDB
// alongside the normal Supabase writes. This is PURE INSURANCE: every op is
// wrapped so any failure here resolves to null / no-op and NEVER disrupts the
// live inspection. If IndexedDB is unavailable, the whole layer quietly does
// nothing and the app behaves exactly as before.
// (Later stages build the write queue + offline photo blobs on this same store.)
// ---------------------------------------------------------------------------

const DB_NAME = 'nitra-qc'
const STORE = 'drafts'
const VERSION = 1

export type DraftKind = 'inspection' | 'container'

export interface LocalDraft {
  key: string                     // `${kind}:${id}`
  kind: DraftKind
  id: string
  updatedAt: string               // ISO — when this local snapshot was taken
  serverUpdatedAt: string | null  // server updated_at last seen (informational)
  data: unknown                   // snapshot payload (form_data / summary / pallet_data)
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode)
        const req = make(tx.objectStore(STORE))
        req.onsuccess = () => resolve((req.result as T) ?? null)
        req.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch { resolve(null) }
    })
  }).catch(() => null)
}

const keyOf = (kind: DraftKind, id: string) => `${kind}:${id}`

export async function saveLocalDraft(kind: DraftKind, id: string, data: unknown, serverUpdatedAt: string | null): Promise<void> {
  if (!id) return
  const draft: LocalDraft = {
    key: keyOf(kind, id), kind, id,
    updatedAt: new Date().toISOString(),
    serverUpdatedAt,
    data,
  }
  await run('readwrite', (s) => s.put(draft))
}

export async function getLocalDraft(kind: DraftKind, id: string): Promise<LocalDraft | null> {
  if (!id) return null
  return run<LocalDraft>('readonly', (s) => s.get(keyOf(kind, id)))
}

export async function clearLocalDraft(kind: DraftKind, id: string): Promise<void> {
  if (!id) return
  await run('readwrite', (s) => s.delete(keyOf(kind, id)))
}

```

### `src/lib/offlineSync.ts`

```ts
// ---------------------------------------------------------------------------
// B6 Stage 2 — offline inspection creation + sync (write side).
//
// When offline, a wheel inspection is created on the device with a client-minted
// UUID and stored here (a "pending" inspection). The Inspection screen loads it
// from this store, and edits are mirrored back in. When connectivity returns,
// syncPendingInspections() upserts each pending inspection to Supabase (the id is
// client-minted, so this inserts cleanly — verified against the live INSERT RLS)
// and rebuilds its defect rows from the recorded Pass/Fail results, then removes
// it from the pending store.
//
// Idempotent by design: the upsert keys on the client id (a double-flush can't
// duplicate the row), and defect rebuild checks-then-inserts (no duplicate
// defects). NOT covered here (later stages): offline photos, and the two-user
// shared-SKU conflict wall.
//
// Every op is fail-safe: failures leave the inspection pending to retry later and
// never throw into the UI.
// ---------------------------------------------------------------------------

import { supabase } from './supabase'
import { SECTIONS, MEAS_COLS } from './standard'

const DB_NAME = 'nitra-qc-pending'
const STORE = 'inspections'
const VERSION = 1

export interface PendingInspection {
  id: string
  part_no: string
  po_no: string
  batch: string
  lot_size: number
  app_sample: number
  fun_sample: number
  inspector_id: string
  status: string
  form_data: unknown
  summary: unknown
  pallet_data: unknown
  created_at: string
  updated_at: string
  pendingSince: string
}

let dbPromise: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}
function run<T>(mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode)
        const req = make(tx.objectStore(STORE))
        req.onsuccess = () => resolve((req.result as T) ?? null)
        req.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch { resolve(null) }
    })
  }).catch(() => null)
}

export async function savePendingInspection(row: PendingInspection): Promise<void> {
  await run('readwrite', (s) => s.put(row))
}
export async function getPendingInspection(id: string): Promise<PendingInspection | null> {
  return run<PendingInspection>('readonly', (s) => s.get(id))
}
export async function getAllPendingInspections(): Promise<PendingInspection[]> {
  return (await run<PendingInspection[]>('readonly', (s) => s.getAll())) || []
}
export async function pendingCount(): Promise<number> {
  return (await getAllPendingInspections()).length
}
async function removePendingInspection(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}

// Keep a pending inspection's editable content current (called as the user edits
// offline). Self-guards: no-op if this id isn't a pending inspection.
export async function updatePendingInspection(insp: {
  id: string; form_data?: unknown; summary?: unknown; pallet_data?: unknown; status?: string
}): Promise<void> {
  const existing = await getPendingInspection(insp.id)
  if (!existing) return
  await savePendingInspection({
    ...existing,
    form_data: insp.form_data ?? existing.form_data,
    summary: insp.summary ?? existing.summary,
    pallet_data: insp.pallet_data ?? existing.pallet_data,
    status: insp.status ?? existing.status,
    updated_at: new Date().toISOString(),
  })
}

// The inspection currently open on the Inspection screen. The App-level batch sync
// skips it, because that screen syncs its own inspection (capturing in-flight edits)
// — avoiding a two-writer race on reconnect.
let openId: string | null = null
export function setOpenInspection(id: string | null): void { openId = id }

// item_key -> label(en) for rebuilding defect rows from Pass/Fail results.
const ITEM_LABEL: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const sec of SECTIONS) for (const it of sec.items) m[it.key] = it.label.en
  for (const c of MEAS_COLS) m[c.key] = c.label.en
  return m
})()

async function ensureDefectRow(id: string, item_key: string, piece: number, tab: string, labelSuffix = ''): Promise<void> {
  const { data: exists } = await supabase.from('defects').select('id')
    .eq('inspection_id', id).eq('item_key', item_key).eq('piece_no', piece).eq('tab', tab)
    .limit(1).maybeSingle()
  if (exists) return
  await supabase.from('defects').insert({
    inspection_id: id, piece_no: piece, tab,
    section: tab.toUpperCase(), item_key,
    item_label: (ITEM_LABEL[item_key] || item_key) + labelSuffix,
    defect_type: 'unspecified', severity: 'minor', measurement_value: null, measurement_unit: 'mm', comment: '',
  })
}

// After a pending inspection's row is live, recreate the defect rows for every
// recorded Fail — mirroring what tapping "Fail" does online (a minimal defect the
// inspector can flesh out later). Covers base pieces AND extra pieces. Each is
// check-then-insert so a retry can't duplicate.
async function rebuildDefects(id: string, formData: unknown): Promise<void> {
  const fd = (formData || {}) as {
    results?: Record<string, string>; meas_results?: Record<string, string>
    extra_results?: Record<string, string[]>; meas_extra_results?: Record<string, string[]>
  }
  for (const [rkey, val] of Object.entries(fd.results || {})) {
    if (val === 'F') { const [k, p] = rkey.split(':'); await ensureDefectRow(id, k, Number(p), 'form') }
  }
  for (const [rkey, val] of Object.entries(fd.meas_results || {})) {
    if (val === 'F') { const [k, p] = rkey.split(':'); await ensureDefectRow(id, k, Number(p), 'measure') }
  }
  // Extra pieces: online these are logged via ensureDefect(key, -idx, 'extra').
  for (const [k, arr] of Object.entries(fd.extra_results || {})) {
    for (let i = 0; i < (arr || []).length; i++) if (arr[i] === 'F') await ensureDefectRow(id, k, -(i + 1), 'extra', ' (extra)')
  }
  for (const [k, arr] of Object.entries(fd.meas_extra_results || {})) {
    for (let i = 0; i < (arr || []).length; i++) if (arr[i] === 'F') await ensureDefectRow(id, k, -(i + 1), 'extra', ' (extra)')
  }
}

async function pushRow(p: PendingInspection): Promise<boolean> {
  const { error } = await supabase.from('inspections').upsert({
    id: p.id, part_no: p.part_no, po_no: p.po_no, batch: p.batch,
    lot_size: p.lot_size, app_sample: p.app_sample, fun_sample: p.fun_sample,
    inspector_id: p.inspector_id, status: p.status,
    form_data: p.form_data, summary: p.summary, pallet_data: p.pallet_data,
    created_at: p.created_at,
  }, { onConflict: 'id' })
  if (error) return false               // leave pending, retry next time
  await rebuildDefects(p.id, p.form_data)
  await removePendingInspection(p.id)
  return true
}

// Push all pending inspections belonging to this user to the server. Returns how
// many synced. Skips the currently-open inspection (that screen syncs itself) and
// any inspection created by a different user (would fail the insert RLS).
let syncing = false
export async function syncPendingInspections(userId?: string): Promise<number> {
  if (syncing) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  syncing = true
  let synced = 0
  try {
    for (const p of await getAllPendingInspections()) {
      if (openId && p.id === openId) continue
      if (userId && p.inspector_id !== userId) continue
      if (await pushRow(p)) synced++
    }
  } catch { /* ignore — anything unsynced stays pending */ } finally { syncing = false }
  return synced
}

// Sync the one inspection open on screen, capturing its latest edits first. Called
// by the Inspection screen when connectivity returns. Returns true if it reached
// the server (so the screen can drop its "pending" state).
export async function syncOnePending(insp: {
  id: string; inspector_id: string; form_data?: unknown; summary?: unknown; pallet_data?: unknown; status?: string
}, userId?: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (userId && insp.inspector_id !== userId) return false
  await updatePendingInspection(insp)   // capture the latest edits before pushing
  const p = await getPendingInspection(insp.id)
  if (!p) return true                   // already synced/removed — nothing to do
  return pushRow(p)
}

```

### `src/lib/outcome.ts`

```ts
// Per-parameter inspection outcome — shared by the in-app Summary tab.
// Mirrors the logic in supabase/functions/interactive-report so the in-app
// Summary and the emailed interactive report show identical results.

export interface OutcomeRow {
  key: string
  parameter: string
  checked: number
  pass: number
  fail: number
  defectPieces: string
  outcome: string
}

type AnyFd = {
  results?: Record<string, string>
  meas_results?: Record<string, string>
  extra_results?: Record<string, string[]>
  meas_extra_results?: Record<string, string[]>
  hundred_pct?: Record<string, Record<string, string>>
} | null | undefined

export function computeOutcomes(fdInput: unknown, labelOf: (k: string) => string): OutcomeRow[] {
  const fd = (fdInput || {}) as AnyFd
  const baseV = fd?.results || {}
  const baseT = fd?.meas_results || {}
  const extraV = fd?.extra_results || {}
  const extraT = fd?.meas_extra_results || {}
  const hundred = fd?.hundred_pct || {}

  const scanBase = (map: Record<string, string>, key: string) => {
    let checked = 0; const fails: number[] = []
    for (const [k, v] of Object.entries(map)) {
      if (k.split(':')[0] !== key) continue
      if (v === 'P' || v === 'F') { checked++; if (v === 'F') fails.push(Number(k.split(':')[1])) }
    }
    return { checked, fails }
  }
  const scanArr = (arr: string[] | undefined) => {
    let checked = 0; const failIdx: number[] = []
    ;(arr || []).forEach((v, i) => { if (v === 'P' || v === 'F') { checked++; if (v === 'F') failIdx.push(i + 1) } })
    return { checked, failIdx }
  }

  const keySet = new Set<string>()
  for (const k of Object.keys(baseV)) keySet.add(k.split(':')[0])
  for (const k of Object.keys(baseT)) keySet.add(k.split(':')[0])
  for (const k of Object.keys(extraV)) keySet.add(k)
  for (const k of Object.keys(extraT)) keySet.add(k)
  for (const k of Object.keys(hundred)) keySet.add(k)

  const rank = (o: string) => (o === '100% Inspection' ? 0 : o.startsWith('Additional') ? 1 : 2)
  return [...keySet].map((key) => {
    const bV = scanBase(baseV, key), bT = scanBase(baseT, key)
    const baseFails = [...bV.fails, ...bT.fails]
    const ex = scanArr(extraV[key] || extraT[key])
    // Mirror the rule engine: base sample is the gate. 0 base fails = clean
    // (extras AND any old 100% data are ignored). 100% only when the base has
    // >=2 fails, or exactly 1 base fail plus a failed extra-sample piece.
    const triggers100 = baseFails.length >= 2 || (baseFails.length >= 1 && ex.failIdx.length >= 1)
    // Per piece: 100% fills pieces in first (only if triggered), then the base
    // verdict OVERRIDES — base is the first authority and is never overturned.
    const mergedV: Record<number, string> = {}
    if (triggers100) { for (const [pc, v] of Object.entries(hundred[key] || {})) { if (v === 'P' || v === 'F') mergedV[Number(pc)] = v } }
    for (const [k, v] of Object.entries(baseV)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
    for (const [k, v] of Object.entries(baseT)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
    const failPieces = Object.entries(mergedV).filter(([, v]) => v === 'F').map(([pc]) => Number(pc)).sort((a, b) => a - b)
    const checked = Object.keys(mergedV).length
    const fail = failPieces.length
    const dedup = failPieces.map((n) => `#${n}`)
    let outcome: string
    if (baseFails.length === 0) outcome = 'Pass'
    else if (triggers100) outcome = '100% Inspection'
    else if (ex.checked > 0) outcome = 'Additional Inspection — Pass'
    else outcome = 'Additional Inspection Required'
    return { key, parameter: labelOf(key), checked, pass: checked - fail, fail, defectPieces: dedup.length ? dedup.join(', ') : '—', outcome }
  }).filter((o) => o.checked > 0)
    .sort((a, b) => rank(a.outcome) - rank(b.outcome) || a.parameter.localeCompare(b.parameter))
}

export function summaryItems(rows: Array<{ parameter: string; outcome: string }>): string[] {
  const hundred = rows.filter((x) => x.outcome === '100% Inspection')
  const addRequired = rows.filter((x) => x.outcome === 'Additional Inspection Required')
  const addPass = rows.filter((x) => x.outcome.startsWith('Additional Inspection — Pass'))
  const items: string[] = []
  for (const r of hundred) items.push(`${r.parameter} — required 100% inspection`)
  for (const r of addRequired) items.push(`${r.parameter} — failed the initial sample; additional inspection required`)
  for (const r of addPass) items.push(`${r.parameter} — passed after additional sampling`)
  if (!hundred.length && !addRequired.length && !addPass.length) items.push('All inspected parameters passed on the initial sample.')
  else items.push('All other inspected parameters passed.')
  return items
}

export const outcomeColor = (o: string) =>
  o === '100% Inspection' ? 'var(--fail)' : o.startsWith('Additional') ? 'var(--amber)' : 'var(--pass)'

```

### `src/lib/poStatus.ts`

```ts
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Shared PO status logic — used by the PO command-center strip (PoStatusStrip)
// AND by PoInfo's Ordered / Loaded / Remaining table. The loaded-quantity
// summation lives here once (sumLoadedByPart) so both agree on the maths.
// ---------------------------------------------------------------------------

export type StageState = 'todo' | 'active' | 'done'
export type StageUnit = 'sku' | 'pcs' | 'none'

// One stage's progress: state + a done/total count in a unit.
// total = 0 means "no baseline to measure against" (e.g. no order list yet) —
// the strip then shows just the done figure without a denominator.
export interface StageResult {
  state: StageState
  done: number
  total: number
  unit: StageUnit
}

export interface PoStageInput {
  items: { part_no: string; qty_ordered: number }[]
  insps: { status: string; part_no: string | null }[]
  conts: { insp_status: string; data: unknown }[]
}

// Three QC lifecycle stages (a 4th "Loaded" was folded into Loading: an
// approved container-loading inspection already means those pieces are loaded).
export interface PoStages {
  items: StageResult
  inspection: StageResult
  loading: StageResult
}

// Sum loaded quantity per part number across the container loadings passed in.
// Mirrors the two container shapes: pallet loadings (data.pallets[*].contents)
// and non-pallet loadings (data.non_pallet_contents). It sums whatever
// containers the caller gives it — the caller decides which to include: the
// strip's Loading stage passes APPROVED loadings only, while PoInfo's running
// Ordered/Loaded/Remaining table passes all recorded loadings.
export function sumLoadedByPart(conts: { data: unknown }[]): Record<string, number> {
  const sums: Record<string, number> = {}
  const add = (ct: unknown) => {
    const c = ct as { part_no?: string; qty?: unknown }
    if (c && c.part_no) sums[c.part_no] = (sums[c.part_no] || 0) + (Number(c.qty) || 0)
  }
  for (const cont of conts || []) {
    const d = (cont?.data || {}) as {
      loading_type?: string
      pallets?: Record<string, { contents?: unknown[] }>
      non_pallet_contents?: unknown[]
    }
    if ((d.loading_type || 'pallet') === 'pallet') {
      for (const pd of Object.values(d.pallets || {})) {
        for (const ct of (pd?.contents || [])) add(ct)
      }
    } else {
      for (const ct of (d.non_pallet_contents || [])) add(ct)
    }
  }
  return sums
}

// Read the pos.id for a PO number, lazily creating the master row when an admin
// opens a PO that predates the pos table (mirrors PoInfo). Conflict-safe: if a
// concurrent create wins the unique index, we simply re-read.
export async function getOrCreatePoId(po: string, canCreate: boolean): Promise<string | null> {
  if (!po || !po.trim()) return null
  const { data } = await supabase.from('pos').select('id').eq('po_no', po).maybeSingle()
  if (data) return (data as { id: string }).id
  if (!canCreate) return null
  const ins = await supabase.from('pos').insert({ po_no: po }).select('id').single()
  if (!ins.error && ins.data) return (ins.data as { id: string }).id
  const re = await supabase.from('pos').select('id').eq('po_no', po).maybeSingle()
  return re.data ? (re.data as { id: string }).id : null
}

// Compute the three QC lifecycle stages, each with a done/total count.
// - PO Ordered Items: order list entered            -> count = ordered SKUs
// - Inspection:       ordered SKUs with an APPROVED inspection / ordered SKUs
// - Loading:          APPROVED-loaded pieces / ordered pieces
//   (approved container-loading inspection = those pieces are loaded)
// A stage is 'active' while under way but incomplete, 'todo' before it starts.
export function computeStages(input: PoStageInput): PoStages {
  const { items, insps, conts } = input

  const orderedSkus = items.length
  const orderedPcs = items.reduce((a, b) => a + (b.qty_ordered || 0), 0)
  const orderedParts = new Set(items.map(i => i.part_no))

  // ---- PO Ordered Items ----
  const itemsStage: StageResult = {
    state: orderedSkus > 0 ? 'done' : 'todo',
    done: orderedSkus,
    total: orderedSkus,
    unit: 'sku',
  }

  // ---- Inspection: ordered SKUs that have an approved inspection ----
  const approvedInspParts = new Set(
    insps.filter(i => i.status === 'approved' && i.part_no).map(i => i.part_no as string),
  )
  let inspDone: number
  let inspTotal: number
  if (orderedSkus > 0) {
    inspTotal = orderedSkus
    inspDone = [...orderedParts].filter(p => approvedInspParts.has(p)).length
  } else {
    // No order list — fall back to the distinct SKUs actually inspected.
    const anyParts = new Set(insps.filter(i => i.part_no).map(i => i.part_no as string))
    inspTotal = anyParts.size
    inspDone = approvedInspParts.size
  }
  const inspState: StageState =
    insps.length === 0 ? 'todo' : (inspTotal > 0 && inspDone >= inspTotal ? 'done' : 'active')

  // ---- Loading: approved-loaded pieces vs ordered pieces ----
  const approvedConts = conts.filter(c => c.insp_status === 'approved')
  const loadedPcs = Object.values(sumLoadedByPart(approvedConts)).reduce((a, b) => a + b, 0)
  let loadState: StageState
  if (conts.length === 0) {
    loadState = 'todo'
  } else if (orderedPcs > 0) {
    loadState = loadedPcs >= orderedPcs ? 'done' : 'active'
  } else {
    // No order baseline — done only if every recorded loading is approved.
    loadState = conts.every(c => c.insp_status === 'approved') ? 'done' : 'active'
  }

  return {
    items: itemsStage,
    inspection: { state: inspState, done: inspDone, total: inspTotal, unit: 'sku' },
    loading: { state: loadState, done: loadedPcs, total: orderedPcs, unit: 'pcs' },
  }
}

```

### `src/lib/refCache.ts`

```ts
// ---------------------------------------------------------------------------
// B6 Stage 2 — reference-data cache (read side of offline).
// A tiny, fail-safe key/value cache in IndexedDB so read-only reference data
// (the SKU master, sampling settings, and later the opened PO's items) survives
// going offline. Kept in a SEPARATE database from the Stage 1 draft store so the
// two never fight over schema versions.
//
// Every op is wrapped so any failure resolves to null / no-op and NEVER disrupts
// the app. If IndexedDB is unavailable, the whole layer quietly does nothing and
// online behaviour is exactly as before.
//
// Usage pattern (read-through): try the live Supabase fetch; on success refresh
// the cache; on offline/empty, fall back to the cached copy.
// ---------------------------------------------------------------------------

import { supabase } from './supabase'

const DB_NAME = 'nitra-qc-cache'
const STORE = 'ref'
const VERSION = 1

interface CacheRec { key: string; value: unknown; savedAt: string }

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode)
        const req = make(tx.objectStore(STORE))
        req.onsuccess = () => resolve((req.result as T) ?? null)
        req.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch { resolve(null) }
    })
  }).catch(() => null)
}

// Store (or refresh) a cached value. Fire-and-forget safe.
export async function cacheSet(key: string, value: unknown): Promise<void> {
  const rec: CacheRec = { key, value, savedAt: new Date().toISOString() }
  await run('readwrite', (s) => s.put(rec))
}

// Read a cached value, or null if absent/unavailable.
export async function cacheGet<T>(key: string): Promise<T | null> {
  const rec = await run<CacheRec>('readonly', (s) => s.get(key))
  return rec ? (rec.value as T) : null
}

// Proactively download + store the reference data the offline screens need, so
// it's available no matter which screen the user opens first. Called on login and
// whenever connectivity returns. Fully fail-safe — never throws, no-ops offline.
// This is what makes the New Inspection SKU list work offline WITHOUT having had
// to open the New Inspection screen while online beforehand.
export async function warmRefCache(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const skus = await supabase.from('skus').select('*').eq('active', true).order('part_no')
    if (skus.data && !skus.error) {
      await cacheSet('skus', skus.data)  // full rows — New Inspection form
      await cacheSet('skus_lite', (skus.data as Array<Record<string, unknown>>).map((s) => ({
        part_no: s.part_no, model: s.model, size: s.size, finish: s.finish,
      })))                                // 4-col subset — PartPicker
    }
    const settings = await supabase.from('settings').select('value').eq('key', 'sampling').single()
    if (settings.data && !settings.error) await cacheSet('sampling', (settings.data as { value: unknown }).value)
  } catch { /* ignore — warming is best-effort */ }
}

```

### `src/lib/refmap.ts`

```ts
// Maps inspection item keys to reference image paths from QC Standard V18
export const REF_MAP: Record<string, string> = {
  // Appearance areas — front wheel
  area_a:           '/ref/appearance_front.jpg',
  area_b:           '/ref/appearance_front.jpg',
  area_c:           '/ref/appearance_front.jpg',
  // Appearance areas — back wheel
  area_c1:          '/ref/appearance_back.jpg',
  area_d:           '/ref/appearance_back.jpg',
  area_e:           '/ref/appearance_back.jpg',
  // Laser engraving
  laser_format:     '/ref/laser.jpg',
  // Back markings
  mark_sae:         '/ref/marking.jpg',
  mark_size:        '/ref/marking.jpg',
  mark_pcd:         '/ref/marking.jpg',
  mark_cb:          '/ref/marking.jpg',
  mark_et:          '/ref/marking.jpg',
  mark_nitra:       '/ref/marking.jpg',
  // Balance
  bal_b:            '/ref/balance.jpg',
  bal_c:            '/ref/balance.jpg',
  bal_bc:           '/ref/balance.jpg',
  // Runout
  radial_top:       '/ref/runout.jpg',
  radial_bot:       '/ref/runout.jpg',
  axial_top:        '/ref/runout.jpg',
  axial_bot:        '/ref/runout.jpg',
  // Box label
  bx_label:         '/ref/box_label.jpg',
  bx_upc:           '/ref/box_label.jpg',
  bx_proddate:      '/ref/box_label.jpg',
  bx_stick:         '/ref/stick_label.jpg',
  bx_design:        '/ref/box_design.jpg',
  // Packing
  pk_cap:           '/ref/packing_1.jpg',
  pk_foam:          '/ref/packing_1.jpg',
  pk_cloth:         '/ref/packing_2.jpg',
  pk_hoop:          '/ref/packing_2.jpg',
  pk_bag:           '/ref/packing_3.jpg',
  pk_toppad:        '/ref/packing_3.jpg',
  pk_sideboard:     '/ref/packing_3.jpg',
  // Pallet
  pl_grouped:       '/ref/pallet_loading.jpg',
  pl_wood:          '/ref/pallet_loading.jpg',
  pl_height:        '/ref/pallet_loading.jpg',
  pl_straps:        '/ref/pallet_loading.jpg',
  pl_wrap:          '/ref/pallet_loading.jpg',
  pl_label4:        '/ref/pallet_label.jpg',
  pl_photo:         '/ref/pallet_loading.jpg',
  ct_photo_before:  '/ref/container.jpg',
  ct_labels_doors:  '/ref/container.jpg',
  ct_no_loose:      '/ref/container.jpg',
  ct_spares_front:  '/ref/container.jpg',
  ct_net:           '/ref/container.jpg',
}

```

### `src/lib/report.ts`

```ts
// ============================================================
// NITRA QC — browser-generated PDF report (Option A)
// Self-contained: fetches its own data, builds bilingual HTML,
// opens a print window and triggers Save-as-PDF.
// ============================================================
import { supabase } from './supabase'
import { SECTIONS, MEAS_COLS, PHOTO_SLOTS, PALLET_ITEMS, type Bi } from './standard'
import { evaluateAll, emptyFormData, type FormData, type PFNA } from './rules'

type Lang = 'en' | 'zh'

interface PhotoRow {
  id: string; storage_path: string; defect_id: string | null
  is_pass_photo: boolean; item_key: string; piece_no: number
  comment: string; checklist_key: string; media_type?: string
}
interface DefectRow {
  id: string; piece_no: number; item_key: string; item_label: string
  defect_type: string; severity: string; measurement_value: number | null
  measurement_unit: string; comment: string; tab: string
}
type Fd = FormData & {
  hundred_pct?: Record<string, Record<string, PFNA>>
  na_overrides?: Record<string, boolean>
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const DISPOSITION: Record<string, { en: string; zh: string; cls: 'pass' | 'hold' | 'fail' }> = {
  approved_loading:    { en: 'APPROVED FOR LOADING',     zh: '批准装柜',     cls: 'pass' },
  hold_rework:         { en: 'HOLD FOR REWORK & REINSPECTION', zh: '暂扣返工并重检', cls: 'hold' },
  conditional_loading: { en: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', zh: '有条件装柜 — 已剔除不合格件', cls: 'hold' },
  conditional_rework:  { en: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', zh: '有条件装柜 — 返工不合格件后装柜', cls: 'hold' },
  pending_customer:    { en: 'PENDING CUSTOMER APPROVAL', zh: '待客户批准',   cls: 'hold' },
}

// Render the corrective-action HTML for the printable report: legacy plain text is
// escaped + newline-converted; scripts/handlers are stripped.
const toRichHtml = (s?: string) => {
  if (!s) return ''
  const html = /<(\/?)(b|i|u|p|ul|ol|li|br|strong|em|span|div)\b/i.test(s)
    ? s : esc(s).replace(/\n/g, '<br>')
  return html.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '').replace(/ on\w+=("[^"]*"|'[^']*')/gi, '')
}
const sevToCls = (c?: string): 'pass' | 'hold' | 'fail' => c === 'reject' ? 'fail' : c === 'pass' ? 'pass' : 'hold'

const CSS = `
:root{--navy:#1F3A5F;--steel:#9FB6D4;--line:#D5DBE4;--ink:#18222E;--ink-soft:#5A6878;
--pass:#1F8A4C;--pass-bg:#E3F3EA;--fail:#C0392B;--fail-bg:#FBE9E7;--amber:#B7791F;--amber-bg:#FBF3E2;}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:var(--ink);font-family:Arial,"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.45}
.head{background:var(--navy);color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}
.head img.logo{height:30px;display:block}
.head .brand{font-size:20px;font-weight:800;letter-spacing:1px}
.head .doc{text-align:right;font-size:14px;font-weight:700}
.head .doc small{display:block;font-size:11px;color:var(--steel);font-weight:500}
.disp{padding:11px 24px;font-weight:800;font-size:16px;display:flex;justify-content:space-between;align-items:center}
.disp.pass{background:var(--pass-bg);color:var(--pass);border-bottom:2px solid var(--pass)}
.disp.fail{background:var(--fail-bg);color:var(--fail);border-bottom:2px solid var(--fail)}
.disp.hold{background:var(--amber-bg);color:var(--amber);border-bottom:2px solid var(--amber)}
.disp small{font-weight:600;font-size:12px;opacity:.85}
.body{padding:18px 24px}
h3{color:var(--navy);font-size:14px;margin:22px 0 8px;border-bottom:2px solid var(--navy);padding-bottom:4px}
h3 small{color:var(--ink-soft);font-weight:500;font-size:12px}
.legend{background:#F7F9FB;border-left:3px solid var(--steel);border-radius:4px;padding:8px 12px;font-size:11px;color:var(--ink-soft);margin-bottom:8px}
.meta{width:100%;border-collapse:collapse}
.meta td{padding:5px 6px;border-bottom:1px solid #EEF1F5;vertical-align:top}
.meta td.k{color:var(--ink-soft);font-size:11px;width:24%}
.meta td.k small{display:block;font-size:10px;color:#9AA7B5}
.meta td.v{font-weight:600;width:26%}
table.grid{width:100%;border-collapse:collapse;margin-top:4px}
table.grid th{background:var(--navy);color:#fff;font-size:11px;font-weight:700;padding:7px 8px;text-align:left}
table.grid th small{display:block;font-weight:500;color:var(--steel);font-size:10px}
table.grid td{padding:7px 8px;border-bottom:1px solid var(--line);font-size:12px;vertical-align:middle}
.pill{display:inline-block;border-radius:10px;padding:1px 8px;font-size:10px;font-weight:700;color:#fff}
.pill.minor{background:#7A8794}.pill.major{background:var(--amber)}.pill.critical{background:var(--fail)}
.tag{display:inline-block;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap}
.tag.full{background:var(--fail-bg);color:var(--fail)}.tag.monitor{background:var(--amber-bg);color:var(--amber)}.tag.extra{background:#EEF1F5;color:var(--ink-soft)}
.stage{display:inline-block;border-radius:5px;padding:1px 7px;font-size:10px;font-weight:700;background:#EEF1F5;color:var(--ink-soft)}
.stage.s100{background:var(--fail-bg);color:var(--fail)}
.pcs{font-weight:700;color:var(--fail)}
.grp{margin-top:12px}
.grp .lbl{font-weight:700;color:var(--navy);font-size:12.5px;margin-bottom:6px}
.gal{display:flex;flex-wrap:wrap;gap:10px}
.gal figure{margin:0;width:104px}
.gal .ph,.gal img.ph{width:104px;height:78px;border-radius:8px;background:#EEF1F5;display:flex;align-items:center;justify-content:center;color:#9AA7B5;font-size:22px;border:2px solid var(--line);object-fit:cover}
.gal .ph.f,.gal img.ph.f{border-color:var(--fail)}.gal .ph.p,.gal img.ph.p{border-color:var(--pass)}
.gal a{display:block;text-decoration:none}.photo-link{color:var(--navy);font-weight:800;text-decoration:none}.photo-link:hover{text-decoration:underline}
.gal figcaption{font-size:10px;color:var(--ink-soft);margin-top:3px;line-height:1.3}
.gal figcaption b.p{color:var(--pass)}.gal figcaption b.f{color:var(--fail)}
.remarks{background:#F7F9FB;border-radius:8px;padding:11px 14px;margin-top:6px}
.foot{padding:10px 24px;color:#9AA7B5;font-size:10px;letter-spacing:2px;display:flex;justify-content:space-between;border-top:1px solid var(--line);margin-top:18px}
@media print{.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}
h3{break-after:avoid}.grp{break-inside:avoid}tr{break-inside:avoid}
@page{size:A4;margin:12mm}}
`

export async function openInspectionReport(inspectionId: string, lang: Lang = 'en') {
  // Open the window synchronously (inside the click gesture) to avoid pop-up blocking.
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to generate the PDF report. / 请允许弹出窗口以生成PDF报告。'); return }
  w.document.write('<!doctype html><meta charset="utf-8"><title>QC Report</title><body style="font-family:Arial;padding:40px;color:#1F3A5F">Generating report… / 正在生成报告…</body>')

  try {
    const L = (b: Bi) => b[lang]

    const { data: insp } = await supabase.from('inspections').select('*').eq('id', inspectionId).single()
    if (!insp) throw new Error('Inspection not found')
    const fd: Fd = { ...emptyFormData(), na_overrides: {}, ...(insp.form_data || {}) }

    const { data: sku } = await supabase.from('skus').select('*').eq('part_no', insp.part_no).single()
    const { data: defectsRaw } = await supabase.from('defects').select('*').eq('inspection_id', inspectionId).order('created_at')
    const { data: photosRaw } = await supabase.from('photos').select('*').eq('inspection_id', inspectionId).order('created_at')
    const defects = (defectsRaw as DefectRow[]) || []
    const photos = (photosRaw as PhotoRow[]) || []

    // Names
    const ids = [insp.inspector_id, insp.reviewed_by].filter(Boolean)
    const names: Record<string, string> = {}
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      for (const p of profs || []) names[p.id] = p.full_name
    }

    // Signed URLs for photos (batch)
    const urlMap: Record<string, string> = {}
    const paths = [...new Set(photos.map(p => p.storage_path))]
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('qc-photos').createSignedUrls(paths, 3600)
      for (const s of signed || []) if (s.signedUrl && s.path) urlMap[s.path] = s.signedUrl
    }

    // ── Label maps ──
    const formItemMap: Record<string, string> = {}
    for (const sec of SECTIONS) for (const it of sec.items) formItemMap[it.key] = L(it.label)
    const measMap: Record<string, string> = {}
    for (const c of MEAS_COLS) measMap[c.key] = L(c.label)
    const palletMap: Record<string, string> = {}
    for (const it of PALLET_ITEMS) palletMap[it.key] = L(it.label)
    const slotMap: Record<string, string> = {}
    for (const s of PHOTO_SLOTS) slotMap[s.key] = L(s.label)
    const paramLabel = (key: string) => formItemMap[key] || measMap[key] || palletMap[key] || key.replace(/_/g, ' ')

    // ── Rule outcome ──
    const allFormItems = SECTIONS.flatMap(s => s.items.map(i => ({ key: i.key, label: L(i.label), group: i.group })))
    const allMeasItems = MEAS_COLS.map(c => ({ key: c.key, label: L(c.label) }))
    const verdicts = evaluateAll(fd, allFormItems, allMeasItems, insp.app_sample, insp.fun_sample, 4, 2)

    const verdictByKey = new Map(verdicts.map(v => [v.key, v]))

    const pieceName = (pieceNo: number | string) => {
      const n = Number(pieceNo)
      if (!Number.isFinite(n)) return esc(pieceNo)
      if (n < 0) return lang === 'en' ? `Extra ${-n}` : `加检 ${-n}`
      if (n > 0) return lang === 'en' ? `Piece ${n}` : `第 ${n} 件`
      return '—'
    }
    const pieceShort = (pieceNo: number | string) => {
      const n = Number(pieceNo)
      if (!Number.isFinite(n)) return esc(pieceNo)
      if (n < 0) return `#E${-n}`
      if (n > 0) return `#${n}`
      return '—'
    }
    const pieceList = (pieces: number[]) => pieces.length ? pieces.map(pieceShort).join(', ') : '—'
    const resultFor = (itemKey: string, pieceNo: number, tab: 'form' | 'measure') =>
      tab === 'measure' ? fd.meas_results?.[`${itemKey}:${pieceNo}`] : fd.results?.[`${itemKey}:${pieceNo}`]
    const extraFor = (itemKey: string, tab: 'form' | 'measure') =>
      tab === 'measure' ? (fd.meas_extra_results?.[itemKey] || []) : (fd.extra_results?.[itemKey] || [])
    const hundred = fd.hundred_pct || {}

    const statusText = (status?: string) => {
      if (status === 'full_inspection') return lang === 'en' ? '100% Inspection Required / Completed' : '需/已全检'
      if (status === 'monitor') return lang === 'en' ? 'Additional Inspection Completed' : '加检完成'
      if (status === 'extra_needed') return lang === 'en' ? 'Additional Inspection Pending' : '待加检'
      return lang === 'en' ? 'Pass' : '合格'
    }

    const allOutcomeItems: { key: string; label: string; tab: 'form' | 'measure'; sample: number }[] = [
      ...allFormItems.map(i => ({ key: i.key, label: i.label, tab: 'form' as const, sample: insp.app_sample })),
      ...allMeasItems.map(i => ({ key: i.key, label: i.label, tab: 'measure' as const, sample: insp.fun_sample })),
    ]

    const outcomeRows = allOutcomeItems.map(item => {
      const verdict = verdictByKey.get(item.key)
      const hMap = hundred[item.key] || {}
      const hEntries = Object.entries(hMap).filter(([, r]) => r === 'P' || r === 'F')

      let checked = 0
      let pass = 0
      let fail = 0
      let failingPieces: number[] = []

      // If 100% inspection has started for this parameter, use the 100% results.
      if (hEntries.length) {
        checked = hEntries.length
        pass = hEntries.filter(([, r]) => r === 'P').length
        failingPieces = hEntries.filter(([, r]) => r === 'F').map(([pc]) => Number(pc)).sort((a, b) => a - b)
        fail = failingPieces.length
      } else {
        const base = Array.from({ length: item.sample }, (_, i) => resultFor(item.key, i + 1, item.tab))
        const extras = extraFor(item.key, item.tab).filter(r => r === 'P' || r === 'F')
        checked = base.filter(r => r === 'P' || r === 'F' || r === 'NA').length + extras.length
        pass = base.filter(r => r === 'P' || r === 'NA').length + extras.filter(r => r === 'P').length
        failingPieces = base.map((r, i) => r === 'F' ? i + 1 : 0).filter(Boolean)
        fail = failingPieces.length + extras.filter(r => r === 'F').length
      }

      const cls = verdict?.status === 'full_inspection' ? 'full' : verdict?.status === 'monitor' ? 'monitor' : verdict?.status === 'extra_needed' ? 'extra' : 'monitor'
      return `<tr><td>${esc(item.label)}</td><td>${checked}</td>
        <td style="color:var(--pass);font-weight:700">${pass}</td>
        <td style="color:var(--fail);font-weight:700">${fail}</td>
        <td style="font-size:11px">${pieceList(failingPieces)}</td>
        <td><span class="tag ${cls}">${esc(statusText(verdict?.status))}</span></td></tr>`
    }).join('')

    // ── Defect log ──
    const sortedDefects = [...defects].sort((a, b) => {
      const la = a.item_label || paramLabel(a.item_key)
      const lb = b.item_label || paramLabel(b.item_key)
      return la.localeCompare(lb) || (Number(a.piece_no || 0) - Number(b.piece_no || 0))
    })
    const firstPhotoForDefect = (d: DefectRow) => photos.find(p => p.defect_id === d.id)
    const defectRows = sortedDefects.map(d => {
      const pieceTxt = d.tab === 'pallet' ? '—' : pieceShort(d.piece_no)
      const ph = firstPhotoForDefect(d)
      const url = ph ? urlMap[ph.storage_path] : ''
      const icon = ph?.media_type === 'video' ? '🎥' : '📷'
      const phTxt = ph && url ? `<a class="photo-link" href="${esc(url)}" target="_blank" rel="noopener">${icon}</a>` : (ph ? icon : '—')
      return `<tr><td>${esc(d.item_label || paramLabel(d.item_key))}</td>
        <td>${esc(pieceTxt)}</td><td>${phTxt}</td></tr>`
    }).join('')
    // ── Photo appendix ──
    const figFor = (p: PhotoRow, caption?: string) => {
      const cls = p.is_pass_photo ? 'p' : 'f'
      const tag = p.is_pass_photo ? (lang === 'en' ? 'PASS' : '合格') : (lang === 'en' ? 'FAIL' : '不合格')
      const url = urlMap[p.storage_path]
      const piece = p.piece_no ? pieceName(p.piece_no) : ''
      const media = p.media_type === 'video'
        ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><div class="ph ${cls}">🎥</div></a>` : `<div class="ph ${cls}">🎥</div>`)
        : url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="ph ${cls}" src="${esc(url)}" title="Open full-size image"></a>` : `<div class="ph ${cls}">📷</div>`
      const capParts = [piece, caption].filter(Boolean).map(esc).join(' · ')
      return `<figure>${media}<figcaption><b class="${cls}">${tag}</b>${capParts ? ` · ${capParts}` : ''}</figcaption></figure>`
    }

    const reqShots = photos.filter(p => !p.item_key && p.checklist_key)
    const reqGroup = reqShots.length
      ? `<div class="grp"><div class="lbl">${lang === 'en' ? 'Required Shots · 必拍照片' : '必拍照片 · Required Shots'}</div>
         <div class="gal">${reqShots.map(p => figFor(p, slotMap[p.checklist_key] || p.checklist_key)).join('')}</div></div>`
      : ''

    // Parameter groups, ordered by section then measure then pallet
    const orderedKeys = [
      ...SECTIONS.flatMap(s => s.items.map(i => i.key)),
      ...MEAS_COLS.map(c => c.key),
      ...PALLET_ITEMS.map(i => i.key),
    ]
    const paramPhotos = photos.filter(p => p.item_key)
    const seen = new Set<string>()
    const paramGroups = orderedKeys.filter(k => paramPhotos.some(p => p.item_key === k) && !seen.has(k) && seen.add(k))
      .map(k => {
        const list = paramPhotos.filter(p => p.item_key === k)
          .sort((a, b) => (a.is_pass_photo === b.is_pass_photo ? a.piece_no - b.piece_no : (a.is_pass_photo ? 1 : -1)))
        // defect photos first, then pass photos; piece order within each
        return `<div class="grp"><div class="lbl">${esc(paramLabel(k))}</div>
          <div class="gal">${list.map(p => figFor(p)).join('')}</div></div>`
      }).join('')

    const appendix = (reqGroup || paramGroups)
      ? `<h3>${lang === 'en' ? 'Photo Appendix' : '照片附录'} <small>${lang === 'en' ? '照片附录' : 'Photo Appendix'}</small></h3>${reqGroup}${paramGroups}`
      : ''

    // ── Meta ──
    const dispCodePdf = insp.summary?.disposition || ''
    const disp = dispCodePdf === 'custom'
      ? { en: insp.summary?.disposition_custom || 'PENDING DISPOSITION', zh: '', cls: sevToCls(insp.summary?.disposition_cls) }
      : (DISPOSITION[dispCodePdf] || { en: 'PENDING DISPOSITION', zh: '待定处置', cls: 'hold' as const })
    const dt = (s?: string) => s ? new Date(s).toLocaleString() : '—'
    const wt = sku?.wheel_weight_kg != null ? `${Number(sku.wheel_weight_kg).toFixed(2)} kg <span style="color:var(--ink-soft);font-weight:400">(± ${Number(sku.wheel_weight_tol_kg ?? 0.4)} kg)</span>` : '—'

    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>NITRA QC Report — ${esc(insp.part_no)}</title><style>${CSS}</style></head><body>
<div class="head">
  <img class="logo" src="${esc(window.location.origin)}/logo-white.png" alt="NITRA"
       onerror="this.outerHTML='<span class=&quot;brand&quot;>NITRA</span>'">
  <div class="doc">QC Inspection Report<small>质量检验报告</small></div>
</div>
<div class="disp ${disp.cls}">
  <span>${esc(disp.en)}${disp.zh ? ` <small>· ${esc(disp.zh)}</small>` : ''}</span>
  <small>${lang === 'en' ? 'Report generated' : '报告生成'} ${esc(new Date().toLocaleString())}</small>
</div>
<div class="body">
  <table class="meta">
    <tr><td class="k">Part No. / SKU<small>产品编号</small></td><td class="v">${esc(insp.part_no)}</td>
        <td class="k">Finish<small>表面处理</small></td><td class="v">${esc(sku?.finish || '—')}</td></tr>
    <tr><td class="k">Model / Size<small>型号 / 尺寸</small></td><td class="v">${esc(sku?.model || '—')} · ${esc(sku?.size || '')}</td>
        <td class="k">Wheel weight<small>轮毂重量</small></td><td class="v">${wt}</td></tr>
    <tr><td class="k">PCD · ET · CB</td><td class="v">${esc(sku?.pcd || '—')} · ${esc(sku?.offset_txt || '')} · ${esc(sku?.cb_mm ?? '')}</td>
        <td class="k">TPMS sensor<small>TPMS 传感器</small></td><td class="v">${esc(sku?.tpms_sensor_mm || '—')}</td></tr>
    <tr><td class="k">PO No.<small>订单号</small></td><td class="v">${esc(insp.po_no || '—')}</td>
        <td class="k">Batch / date<small>批次/日期</small></td><td class="v">${esc(insp.batch || '—')}</td></tr>
    <tr><td class="k">Lot size<small>批量</small></td><td class="v">${esc(insp.lot_size)} pcs</td>
        <td class="k">Samples (App / Fun)<small>抽样 外观/功能</small></td><td class="v">${esc(insp.app_sample)} / ${esc(insp.fun_sample)} pcs</td></tr>
    <tr><td class="k">Inspector<small>检验员</small></td><td class="v">${esc(names[insp.inspector_id] || '—')}</td>
        <td class="k">Submitted<small>提交时间</small></td><td class="v">${esc(dt(insp.submitted_at))}</td></tr>
    <tr><td class="k">Approved by<small>批准人</small></td><td class="v">${esc(insp.reviewed_by ? (names[insp.reviewed_by] || '—') : '—')}</td>
        <td class="k">Approved on<small>批准时间</small></td><td class="v">${esc(dt(insp.reviewed_at))}</td></tr>
  </table>

  <h3>${lang === 'en' ? 'Inspection Evaluation Criteria' : '检验评估标准'} <small>${lang === 'en' ? '检验评估标准' : 'Inspection Evaluation Criteria'}</small></h3>
  <div class="legend">
    ${lang === 'en'
      ? '<b>Visual:</b> ≤100 pcs inspect 8; each additional 100 pcs inspect +4. If 1 piece fails for a specific defect, inspect +4 for that defect; if the same defect fails again, conduct 100% inspection. If 2+ pieces fail in the initial sample, conduct 100% inspection immediately. <br><b>Technical:</b> ≤100 pcs inspect 4; each additional 100 pcs inspect +2. If 1 piece fails for a specific defect, inspect +2 for that defect; if the same defect fails again, conduct 100% inspection. If 2+ pieces fail in the initial sample, conduct 100% inspection immediately. 100% inspection applies only to the specific defect/parameter that triggered the rule.'
      : '<b>外观：</b>100件或以下抽检8件；每增加100件，加检4件。同一缺陷初检1件不合格，则针对该缺陷加检4件；加检再出现同一缺陷，则全检。初检2件或以上同一缺陷不合格，立即全检。<br><b>技术：</b>100件或以下抽检4件；每增加100件，加检2件。同一缺陷初检1件不合格，则针对该缺陷加检2件；加检再出现同一缺陷，则全检。初检2件或以上同一缺陷不合格，立即全检。全检仅适用于触发规则的具体缺陷/项目。'}
  </div>

  <h3>${lang === 'en' ? 'Inspection Outcome' : '检验结果'} <small>${lang === 'en' ? '检验结果' : 'Inspection Outcome'}</small></h3>
  <table class="grid"><tr><th>${lang === 'en' ? 'Parameter' : '项目'}</th><th>${lang === 'en' ? 'Checked' : '已检'}</th><th>${lang === 'en' ? 'Pass' : '合格'}</th><th>${lang === 'en' ? 'Fail' : '不合格'}</th><th>${lang === 'en' ? 'Failing pieces' : '不合格件号'}</th><th>${lang === 'en' ? 'Outcome' : '结果'}</th></tr>${outcomeRows}</table>

  <h3>${lang === 'en' ? 'Inspection Findings' : '检验发现'} <small>${defects.length} ${lang === 'en' ? 'logged (one row per failed piece)' : '条（每件一行）'}</small></h3>
  ${defects.length
    ? `<table class="grid"><tr><th>${lang === 'en' ? 'Inspected Parameter' : '检验项目'}</th><th>${lang === 'en' ? 'Piece #' : '件号'}</th><th>${lang === 'en' ? 'Photo' : '照片'}</th></tr>${defectRows}</table>`
    : `<div style="color:var(--ink-soft)">${lang === 'en' ? 'No defects logged.' : '暂无缺陷记录。'}</div>`}

  ${insp.summary?.corrective_action
    ? `<div class="remarks"><div style="font-size:11px;color:var(--ink-soft);margin-bottom:3px">${lang === 'en' ? 'ACTION TAKEN · 处置措施' : '处置措施 · ACTION TAKEN'}</div>${toRichHtml(insp.summary.corrective_action)}</div>`
    : ''}

  ${insp.summary?.remarks
    ? `<div class="remarks"><div style="font-size:11px;color:var(--ink-soft);margin-bottom:3px">${lang === 'en' ? 'REMARKS · 备注' : '备注 · REMARKS'}</div>${esc(insp.summary.remarks)}</div>`
    : ''}

  ${appendix}
</div>
<div class="disp ${disp.cls}" style="margin-top:16px">
  <span>${esc(disp.en)}${disp.zh ? ` <small>· ${esc(disp.zh)}</small>` : ''}</span>
  <small>${lang === 'en' ? 'Disposition · 处置' : '处置 · Disposition'}</small>
</div>
<div class="foot"><span>CONFIDENTIAL — PROPERTY OF NITRA</span><span>Generated by NITRA QC App</span></div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},500);});</script>
</body></html>`

    w.document.open()
    w.document.write(html)
    w.document.close()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try { w.document.body.innerHTML = '<p style="font-family:Arial;padding:40px;color:#C0392B">Failed to generate report: ' + esc(msg) + '</p>' } catch { /* ignore */ }
  }
}

// Printable PDF for a container loading. Reuses the container-report edge function JSON
// (photos already signed, contents + pallet checks + translations resolved).
export async function openContainerReport(id: string, lang: string = 'en') {
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to generate the PDF report. / 请允许弹出窗口以生成PDF报告。'); return }
  w.document.write('<!doctype html><meta charset="utf-8"><title>Container Report</title><body style="font-family:Arial;padding:40px;color:#1F3A5F">Generating report… / 正在生成报告…</body>')
  try {
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    const resp = await fetch(`${base}/functions/v1/container-report?id=${id}&lang=${lang}`)
    const d = await resp.json()
    if (!d.ok) throw new Error(d.error || 'Report unavailable')
    const c = d.container
    const T = lang === 'zh'
      ? { title: '集装箱装柜报告', details: '运输与集装箱信息', contents: '装载内容', packing: '托盘包装检验', pallet: '托盘', photos: '照片证据', pass: '合格', fail: '不合格', na: '不适用', po: '订单号', container: '集装箱号', seal: '封条号', bl: '提单号', type: '装柜方式', pallets: '托盘数', dl: '装柜日期', etd: '预计离港', eta: '预计到港', dep: '起运港', dest: '目的港', insp: '检验员', appr: '批准人', partNumber: '产品编号', model: '型号', size: '尺寸', pcd: 'PCD', cb: 'CB', et: 'ET', color: '颜色', qty: '装载数量' }
      : lang === 'de'
      ? { title: 'Containerverladebericht', details: 'Versand- & Containerdetails', contents: 'Geladener Inhalt', packing: 'Palettenverpackungsprüfung', pallet: 'Palette', photos: 'Fotonachweis', pass: 'i.O.', fail: 'n.i.O.', na: 'k.A.', po: 'Bestell-Nr.', container: 'Container-Nr.', seal: 'Siegel-Nr.', bl: 'BL-Nummer', type: 'Verladeart', pallets: 'Paletten', dl: 'Verladedatum', etd: 'Vorauss. Abfahrt', eta: 'Vorauss. Ankunft', dep: 'Abfahrtshafen', dest: 'Zielhafen', insp: 'Prüfer', appr: 'Genehmigt von', partNumber: 'Teilenummer', model: 'Modell', size: 'Größe', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Farbe', qty: 'Geladene Menge' }
      : { title: 'Container Loading Report', details: 'Shipping & Container Details', contents: 'Loaded Contents', packing: 'Pallet Packing Inspection', pallet: 'Pallet', photos: 'Photo Evidence', pass: 'Pass', fail: 'Fail', na: 'N/A', po: 'PO No.', container: 'Container No.', seal: 'Seal No.', bl: 'BL Number', type: 'Loading type', pallets: 'Pallets', dl: 'Date Loaded', etd: 'Est. Port Departure', eta: 'Est. Port Arrival', dep: 'Departure Port', dest: 'Destination Port', insp: 'Inspector', appr: 'Approved By', partNumber: 'Part Number', model: 'Model', size: 'Size', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Color', qty: 'Qty Loaded' }
    const dt = (s: string) => s ? new Date(s).toLocaleDateString() : '—'
    const detailRows: [string, string][] = [
      [T.po, c.po_no], [T.container, c.container_no], [T.seal, c.seal_no], [T.bl, c.bl_no],
      [T.type, c.loading_type === 'pallet' ? `Pallet (${c.pallet_count})` : 'Non-pallet'],
      [T.dl, dt(c.date_loaded)], [T.etd, dt(c.etd)], [T.eta, dt(c.eta)], [T.dep, c.dep_port], [T.dest, c.dest_port],
      [T.insp, c.inspectorName], [T.appr, c.reviewerName],
    ]
    const detailsHtml = detailRows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v || '—')}</td></tr>`).join('')
    const contentsHtml = (d.contents || []).length ? `<h3>${esc(T.contents)}</h3><table class="grid contents"><thead><tr><th>${esc(T.partNumber)}</th><th>${esc(T.model)}</th><th>${esc(T.size)}</th><th>${esc(T.pcd)}</th><th>${esc(T.cb)}</th><th>${esc(T.et)}</th><th>${esc(T.color)}</th><th class="num">${esc(T.qty)}</th></tr></thead><tbody>${d.contents.map((r: any) => `<tr><td class="pn">${esc(r.part_no)}${r.off_po ? ` <span style=\"color:#B7791F;font-weight:800;font-size:9px;border:1px solid #B7791F;border-radius:4px;padding:0 4px\">&#9888; ${lang === "zh" ? "不在订单内" : lang === "de" ? "NICHT AUF BESTELLUNG" : "NOT ON PO"}</span>` : ""}</td><td>${esc(r.model || '—')}</td><td>${esc(r.size || '—')}</td><td>${esc(r.pcd || '—')}</td><td>${esc(r.cb !== '' && r.cb != null ? r.cb : '—')}</td><td>${esc(r.et || '—')}</td><td>${esc(r.color || '—')}</td><td class="num">${esc(r.qty)}</td></tr>`).join('')}</tbody></table>` : ''
    const palletsHtml = (d.pallets || []).length ? `<h3>${esc(T.packing)}</h3>${d.pallets.map((pl: any) => `<div class="pl"><div class="pl-h">${esc(T.pallet)} ${pl.n}</div>${(pl.checks || []).length ? `<table class="grid checks"><tbody>${pl.checks.map((ck: any) => `<tr><td>${esc(ck.label)}</td><td class="v ${ck.value === 'F' ? 'f' : ck.value === 'P' ? 'p' : ''}">${ck.value === 'P' ? esc(T.pass) : ck.value === 'F' ? esc(T.fail) : esc(T.na)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">—</div>'}</div>`).join('')}` : ''
    const photosHtml = (d.photoGroups || []).length ? `<h3>${esc(T.photos)}</h3>${d.photoGroups.map((g: any) => `<div class="grp"><div class="gl">${esc(g.label)}</div><div class="gal">${g.photos.map((p: any) => p.url ? `<figure>${p.mediaType === 'video' ? `<div class="vid">🎬</div>` : `<img src="${esc(p.url)}">`}${p.comment ? `<figcaption>${esc(p.comment)}</figcaption>` : ''}</figure>` : '').join('')}</div></div>`).join('')}` : ''
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(T.title)} — ${esc(c.container_no)}</title>
<style>:root{--navy:#1F3A5F;--ink-soft:#5A6878;--line:#D5DBE4;--pass:#1F8A4C;--fail:#C0392B}
*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#18222E;margin:0;padding:0;font-size:13px}
.head{background:var(--navy);color:#fff;padding:16px 24px;display:flex;align-items:center;gap:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head img{height:42px;max-width:200px;object-fit:contain}.head .t{font-size:20px;font-weight:800}.head .sub{color:#9FB6D4;font-size:12px;margin-top:2px}
.body{padding:18px 24px}
h3{background:var(--navy);color:#fff;margin:20px 0 8px;font-size:14px;padding:8px 12px;border-radius:6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.det{width:100%;border-collapse:collapse;font-size:13px;border:1px solid var(--line)}
table.det td{padding:8px 10px;border-bottom:1px solid #EAEFF4}table.det td.k{color:var(--ink-soft);font-weight:600;width:32%;background:#F7F9FB;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.grid{width:100%;border-collapse:collapse;font-size:12.5px;border:1px solid var(--line)}
table.grid th{background:var(--navy);color:#fff;text-align:left;padding:8px 10px;font-size:11px;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.grid th.num,table.grid td.num{text-align:right}
table.grid td{padding:7px 10px;border-bottom:1px solid #EAEFF4;vertical-align:middle}
table.grid td.pn{font-weight:700}
table.contents tbody tr:nth-child(even) td{background:#F7F9FB;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.grid td.v{text-align:right;font-weight:700}td.v.p{color:var(--pass)}td.v.f{color:var(--fail)}
.pl{border:1px solid var(--line);border-radius:8px;margin-top:10px;overflow:hidden}
.pl-h{background:#EEF3F8;color:var(--navy);font-weight:700;padding:7px 12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pl .grid{border:none}.pl .grid td{padding:6px 12px}
.muted{color:var(--ink-soft);padding:8px 12px}
.grp{margin-top:12px;border:1px solid var(--line);border-radius:8px;overflow:hidden;break-inside:avoid}
.gl{background:#EEF3F8;color:var(--navy);font-weight:700;font-size:12.5px;padding:7px 12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.gal{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px}
.gal img,.gal .vid{width:100%;height:90px;object-fit:cover;border-radius:6px;display:block;border:1px solid var(--line)}
.gal .vid{display:flex;align-items:center;justify-content:center;background:#EEF1F5;font-size:24px}
.gal figcaption{font-size:10px;color:var(--ink-soft);margin-top:4px}
.foot{padding:12px 24px;color:#9AA7B5;font-size:10px;letter-spacing:2px;border-top:1px solid var(--line);margin-top:18px}
@media print{h3,.grp,.pl,tr{break-inside:avoid}@page{size:A4;margin:12mm}}</style></head>
<body><div class="head">${d.logoUrl ? `<img src="${esc(d.logoUrl)}">` : '<div class="t">NITRA</div>'}<div><div class="t">${esc(T.title)}</div><div class="sub">${esc(c.container_no || '')}</div></div></div>
<div class="body"><h3>${esc(T.details)}</h3><table class="det">${detailsHtml}</table>${contentsHtml}${palletsHtml}${photosHtml}</div>
<div class="foot">CONFIDENTIAL — PROPERTY OF NITRA</div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},600);});</script>
</body></html>`
    w.document.open(); w.document.write(html); w.document.close()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try { w.document.body.innerHTML = '<p style="font-family:Arial;padding:40px;color:#C0392B">Failed to generate report: ' + esc(msg) + '</p>' } catch { /* ignore */ }
  }
}

// Printable PDF for the consolidated PO report (containers + wheel inspections overview).
export async function openPoReport(po: string, lang: string = 'en') {
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to generate the PDF report. / 请允许弹出窗口以生成PDF报告。'); return }
  w.document.write('<!doctype html><meta charset="utf-8"><title>PO Report</title><body style="font-family:Arial;padding:40px;color:#1F3A5F">Generating report… / 正在生成报告…</body>')
  try {
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    const resp = await fetch(`${base}/functions/v1/po-report?po=${encodeURIComponent(po)}&lang=${lang}`)
    const d = await resp.json()
    if (!d.ok) throw new Error(d.error || 'Report unavailable')
    const T = lang === 'zh'
      ? { title: '订单综合报告', containersH: '集装箱装柜', wheelInsp: '轮毂检验', container: '集装箱号', bl: '提单号', etd: '预计离港', eta: '预计到港', dest: '目的港', partNo: '产品编号', size: '尺寸', pcd: 'PCD', cb: 'CB', et: 'ET', color: '颜色', disp: '处置', pending: '待定处置' }
      : lang === 'de'
      ? { title: 'Konsolidierter Bestellbericht', containersH: 'Containerverladungen', wheelInsp: 'Radprüfungen', container: 'Container-Nr.', bl: 'BL-Nummer', etd: 'Vorauss. Abfahrt', eta: 'Vorauss. Ankunft', dest: 'Zielhafen', partNo: 'Teilenummer', size: 'Größe', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Farbe', disp: 'Entscheidung', pending: 'AUSSTEHENDE ENTSCHEIDUNG' }
      : { title: 'Consolidated PO Report', containersH: 'Container Loadings', wheelInsp: 'Wheel Inspections', container: 'Container No.', bl: 'BL Number', etd: 'Est. Port Departure', eta: 'Est. Port Arrival', dest: 'Destination Port', partNo: 'Part Number', size: 'Size', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Color', disp: 'Disposition', pending: 'PENDING DISPOSITION' }
    const DISP: Record<string, Record<string, string>> = {
      approved_loading: { en: 'APPROVED FOR LOADING', de: 'FÜR VERLADUNG FREIGEGEBEN', zh: '批准装柜' },
      hold_rework: { en: 'HOLD FOR REWORK & REINSPECTION', de: 'ZURÜCKHALTEN FÜR NACHARBEIT', zh: '暂扣返工并重检' },
      conditional_loading: { en: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', de: 'BEDINGTE VERLADUNG — TEILE AUSGESCHLOSSEN', zh: '有条件装柜 — 已剔除不合格件' },
      conditional_rework: { en: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', de: 'BEDINGTE VERLADUNG — NACHARBEITEN & VERLADEN', zh: '有条件装柜 — 返工不合格件后装柜' },
      pending_customer: { en: 'PENDING CUSTOMER APPROVAL', de: 'AUSSTEHENDE KUNDENFREIGABE', zh: '待客户批准' },
    }
    const dispText = (insp: any) => {
      const c = insp?.disposition || ''
      if (c === 'custom') return insp?.disposition_custom || T.pending
      if (c && DISP[c]) return DISP[c][lang] || DISP[c].en
      return T.pending
    }
    const dt = (s: string) => s ? new Date(s).toLocaleDateString() : '—'
    const contRows = (d.containers || []).map((c: any) => `<tr><td><b>${esc(c.container_no || '—')}</b></td><td>${esc(c.bl_no || '—')}</td><td>${esc(dt(c.etd))}</td><td>${esc(dt(c.eta))}</td><td>${esc(c.dest_port || '—')}</td></tr>`).join('')
    const skuRows = (d.skus || []).map((s: any) => `<tr><td><b>${esc(s.insp?.part_no || '—')}</b></td><td>${esc(s.sku?.size || '—')}</td><td>${esc(s.sku?.pcd || '—')}</td><td>${esc(s.sku?.cb_mm ?? '—')}</td><td>${esc(s.sku?.offset_txt || '—')}</td><td>${esc(s.sku?.finish || '—')}</td><td>${esc(dispText(s.insp))}</td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(T.title)} — ${esc(po)}</title>
<style>:root{--navy:#1F3A5F;--ink-soft:#5A6878;--line:#D5DBE4}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#18222E;margin:0;font-size:13px}
.head{background:var(--navy);color:#fff;padding:16px 24px;display:flex;align-items:center;gap:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head img{height:44px;max-width:200px;object-fit:contain}.head .tt{border-left:1px solid rgba(255,255,255,.25);padding-left:16px}.head .t{font-size:20px;font-weight:800}.head .s{color:#9FB6D4;font-size:12px;margin-top:3px}
.body{padding:18px 24px}
h3{background:var(--navy);color:#fff;margin:18px 0 8px;font-size:14px;padding:8px 12px;border-radius:6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table{width:100%;border-collapse:collapse;font-size:12.5px;border:1px solid var(--line)}
th{background:var(--navy);color:#fff;text-align:left;padding:8px 10px;font-size:11px;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
td{padding:7px 10px;border-bottom:1px solid #EAEFF4}td.pn{font-weight:700}
tbody tr:nth-child(even) td{background:#F7F9FB;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.foot{padding:12px 24px;color:#9AA7B5;font-size:10px;letter-spacing:2px;border-top:1px solid var(--line);margin-top:18px}
@media print{h3,tr{break-inside:avoid}@page{size:A4 landscape;margin:12mm}}</style></head>
<body><div class="head">${d.logoUrl ? `<img src="${esc(d.logoUrl)}">` : '<div class="t">NITRA</div>'}<div class="tt"><div class="t">${esc(T.title)} · ${esc(po)}</div><div class="s">${esc(T.containersH)}: ${(d.containers || []).length} · ${esc(T.wheelInsp)}: ${(d.skus || []).length}</div></div></div>
<div class="body">
<h3>${esc(T.containersH)}</h3><table><thead><tr><th>${esc(T.container)}</th><th>${esc(T.bl)}</th><th>${esc(T.etd)}</th><th>${esc(T.eta)}</th><th>${esc(T.dest)}</th></tr></thead><tbody>${contRows || `<tr><td colspan="5">—</td></tr>`}</tbody></table>
<h3>${esc(T.wheelInsp)}</h3><table><thead><tr><th>${esc(T.partNo)}</th><th>${esc(T.size)}</th><th>${esc(T.pcd)}</th><th>${esc(T.cb)}</th><th>${esc(T.et)}</th><th>${esc(T.color)}</th><th>${esc(T.disp)}</th></tr></thead><tbody>${skuRows || `<tr><td colspan="7">—</td></tr>`}</tbody></table>
</div><div class="foot">CONFIDENTIAL — PROPERTY OF NITRA</div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},600);});</script>
</body></html>`
    w.document.open(); w.document.write(html); w.document.close()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try { w.document.body.innerHTML = '<p style="font-family:Arial;padding:40px;color:#C0392B">Failed to generate report: ' + esc(msg) + '</p>' } catch { /* ignore */ }
  }
}

```

### `src/lib/rules.ts`

```ts
// ============================================================
// NITRA Live Pass-Fail Rule Engine — v2
//
// Rule:
//   - Visual/Form parameters: base sample = appSample; if 1 fail → inspect 4 extra pieces
//   - Technical/Measure parameters: base sample = funSample; if 1 fail → inspect 2 extra pieces
//   - 2+ failures in the initial sample → immediate 100% inspection for that parameter
//   - Any failure in the extra sample → 100% inspection for that parameter
//   - Pallet tab failures do NOT count toward the rule engine
// ============================================================

export type PFNA = 'P' | 'F' | 'NA' | undefined
export type ItemStatus = 'clean' | 'extra_needed' | 'monitor' | 'full_inspection'

export interface ItemVerdict {
  key: string                       // item_key or param_key
  label: string                     // human-readable
  tab: 'form' | 'measure'
  group: 'A' | 'Fn'
  baseFailures: number
  extraResults: PFNA[]              // results for up to 4 extra pieces
  status: ItemStatus
  extrasStillNeeded: number         // how many more to inspect (0 if done)
}

export interface FormData {
  results: Record<string, PFNA>              // "item_key:piece_no" → P/F/NA
  extra_results: Record<string, PFNA[]>      // "item_key" → array of extra results
  meas_results: Record<string, PFNA>         // "param_key:piece_no" → P/F/NA
  meas_extra_results: Record<string, PFNA[]> // "param_key" → array of extra results
  pallet: Record<string, PFNA>
}

export function emptyFormData(): FormData {
  return { results: {}, extra_results: {}, meas_results: {}, meas_extra_results: {}, pallet: {} }
}

function evalItem(
  key: string, label: string, tab: 'form' | 'measure', group: 'A' | 'Fn',
  baseResults: PFNA[], extraResults: PFNA[], extrasRequired: number
): ItemVerdict {
  const baseFailures = baseResults.filter(r => r === 'F').length
  if (baseFailures === 0) {
    return { key, label, tab, group, baseFailures: 0, extraResults: [], status: 'clean', extrasStillNeeded: 0 }
  }
  // 2+ failures in the initial sample → immediate 100% inspection.
  if (baseFailures >= 2) {
    return { key, label, tab, group, baseFailures, extraResults, status: 'full_inspection', extrasStillNeeded: 0 }
  }
  // Any F in extras → immediate 100% inspection.
  if (extraResults.includes('F')) {
    return { key, label, tab, group, baseFailures, extraResults, status: 'full_inspection', extrasStillNeeded: 0 }
  }
  const done = extraResults.filter(r => r === 'P' || r === 'F').length
  if (done < extrasRequired) {
    return { key, label, tab, group, baseFailures, extraResults, status: 'extra_needed', extrasStillNeeded: extrasRequired - done }
  }
  return { key, label, tab, group, baseFailures, extraResults, status: 'monitor', extrasStillNeeded: 0 }
}

export function evaluateAll(
  fd: FormData,
  formItems: { key: string; label: string; group: 'A' | 'Fn' }[],
  measItems: { key: string; label: string }[],
  appSample: number,
  funSample: number,
  visualExtrasRequired = 4,
  technicalExtrasRequired = 2
): ItemVerdict[] {
  const out: ItemVerdict[] = []

  // Form/Visual items: every parameter under the Visual tab uses the Visual sample size.
  for (const item of formItems) {
    const base: PFNA[] = Array.from({ length: appSample }, (_, i) => fd.results[`${item.key}:${i + 1}`])
    const extras: PFNA[] = fd.extra_results[item.key] || []
    const v = evalItem(item.key, item.label, 'form', 'A', base, extras, visualExtrasRequired)
    if (v.status !== 'clean') out.push(v)
  }

  // Measure/Technical items: every parameter under the Technical tab uses the Technical sample size.
  for (const item of measItems) {
    const base: PFNA[] = Array.from({ length: funSample }, (_, i) => fd.meas_results[`${item.key}:${i + 1}`])
    const extras: PFNA[] = fd.meas_extra_results[item.key] || []
    const v = evalItem(item.key, item.label, 'measure', 'Fn', base, extras, technicalExtrasRequired)
    if (v.status !== 'clean') out.push(v)
  }

  return out.sort((a, b) => {
    const order = { full_inspection: 0, extra_needed: 1, monitor: 2, clean: 3 }
    return order[a.status] - order[b.status]
  })
}

export interface SamplingSettings {
  app_base: number; app_inc: number
  fun_base: number; fun_inc: number
  extra_on_defect: number
}
export function sampleSizes(lot: number, s: SamplingSettings) {
  const blocks = Math.max(0, Math.ceil(lot / 100) - 1)
  return { app: s.app_base + s.app_inc * blocks, fun: s.fun_base + s.fun_inc * blocks }
}

```

### `src/lib/standard.ts`

```ts
export type Lang = 'en' | 'zh'
export type Bi = { en: string; zh: string }

export interface ChecklistItem {
  key: string
  group: 'A' | 'Fn'
  label: Bi
  standard: Bi
  glossBlackOnly?: boolean   // if true, auto-NA for non-gloss-black finishes
  blackOnly?: boolean        // if true, auto-NA for non-black finishes (any black qualifies)
}
export interface Section {
  key: string
  title: Bi
  instruction?: Bi
  items: ChecklistItem[]
}

export const SECTIONS: Section[] = [
  {
    key: 'APPEARANCE',
    title: { en: 'Wheel Finish & TPMS', zh: '轮毂表面处理与TPMS' },
    instruction: { en: 'Inspect at 100 cm distance, ≥1,000 lux, against approved master sample.', zh: '检验距离100cm，≥1,000勒克斯，对照认可标准样品。' },
    items: [
      { key: 'area_a', group: 'A', label: { en: 'Area A — Front / design', zh: 'A区 — 设计面' }, standard: { en: 'Paint 3×≤0.8mm · porosity 2×≤1.0mm · scratch 1×≤5mm · dist 75mm', zh: '漆点3×≤0.8mm · 砂孔2×≤1.0mm · 划痕1×≤5mm · 间距75mm' } },
      { key: 'area_b', group: 'A', label: { en: 'Area B — Window', zh: 'B区 — 窗口区' }, standard: { en: 'Paint 2×≤1.5mm · porosity 2×≤1.0mm · scratch 2×≤5mm · dist 50mm', zh: '漆点2×≤1.5mm · 砂孔2×≤1.0mm · 划痕2×≤5mm · 间距50mm' } },
      { key: 'area_c', group: 'A', label: { en: 'Area C — Rim well outside', zh: 'C区 — 轮辋外侧' }, standard: { en: 'Paint 3×≤2.0mm · porosity 3×≤1.0mm · scratch 3×≤5mm · dist 50mm', zh: '漆点3×≤2.0mm · 砂孔3×≤1.0mm · 划痕3×≤5mm · 间距50mm' } },
      { key: 'area_c1', group: 'A', label: { en: 'Area C1 — Rim well inside', zh: 'C1区 — 轮辋内侧' }, standard: { en: 'Paint 3×≤1.0mm · porosity 2×≤1.0mm · scratch 1×≤5mm · dist 100mm', zh: '漆点3×≤1.0mm · 砂孔2×≤1.0mm · 划痕1×≤5mm · 间距100mm' } },
      { key: 'area_d', group: 'A', label: { en: 'Area D — Rim horn inside', zh: 'D区 — 轮缘内侧' }, standard: { en: 'Paint 3×≤1.0mm · porosity 3×≤1.0mm · scratch 5×≤5mm · dist 100mm', zh: '漆点3×≤1.0mm · 砂孔3×≤1.0mm · 划痕5×≤5mm · 间距100mm' } },
      { key: 'area_e', group: 'A', label: { en: 'Area E — Valve hole', zh: 'E区 — 气门孔' }, standard: { en: 'Free of burrs', zh: '无毛刺' } },
      { key: 'tpms_hole', group: 'A', label: { en: 'TPMS Dimension', zh: 'TPMS 尺寸' }, standard: { en: 'Confirm TPMS dimensions match the SKU spec shown below', zh: '确认TPMS尺寸与下方SKU规格一致' } },
      { key: 'hat_marks', group: 'A', label: { en: 'No hat marks', zh: '无压痕' }, standard: { en: 'Wheel face free of visible hat marks', zh: '轮毂正面须无可见压痕' }, glossBlackOnly: true },
      { key: 'orange_peel', group: 'A', label: { en: 'Smooth surface, no orange peel', zh: '表面光滑无橘皮' }, standard: { en: 'Per approved sample', zh: '按认可样品' }, blackOnly: true },
      { key: 'bolt_cone_paint', group: 'A', label: { en: 'Bolt hole / cone free of paint', zh: '螺栓孔/锥座无涂料' }, standard: { en: 'Free of paint', zh: '须无涂料覆盖' } },
      { key: 'rear_bore_paint', group: 'A', label: { en: 'Rear centre bore + mounting face paint-free', zh: '背面中心孔/安装面无涂料' }, standard: { en: 'Free of paint', zh: '须无涂料' } },
      { key: 'coating_total', group: 'A', label: { en: 'Total coating thickness', zh: '涂层总厚度' }, standard: { en: 'Min. between 120–130 µm', zh: '最小120至130µm' } },
      { key: 'coating_machined', group: 'A', label: { en: 'Machined-area coating', zh: '加工面涂层' }, standard: { en: 'Powder ≥80 µm', zh: '粉末≥80µm' } },
    ],
  },
  {
    key: 'FINISH',
    title: { en: 'Cap Finish & Fitment', zh: '盖子表面处理与配合' },
    items: [
      { key: 'cap_color', group: 'A', label: { en: 'Cap Color vs Wheel Color', zh: '盖子颜色与轮毂颜色对比' }, standard: { en: 'Cap color must match wheel color per approved sample', zh: '盖子颜色须与轮毂颜色一致，符合认可样品' } },
      { key: 'cap_fitment', group: 'A', label: { en: 'Cap fitment', zh: '盖子配合' }, standard: { en: 'Cap fits tightly on wheel', zh: '盖子须紧密配合轮毂' } },
      { key: 'logo', group: 'A', label: { en: 'Logo', zh: '标志' }, standard: { en: 'Same as approved sample', zh: '与认可样品一致' } },
      { key: 'cap_finish', group: 'A', label: { en: 'Cap surface finish', zh: '盖子表面处理' }, standard: { en: 'Matches approved wheel finish sample', zh: '与认可轮毂样品一致' } },
    ],
  },
  {
    key: 'MARKING',
    title: { en: 'Marking', zh: '标识' },
    items: [
      { key: 'laser_format', group: 'Fn', label: { en: 'Laser engraving format', zh: '激光雕刻格式' }, standard: { en: 'Model/SIZE/PCD/CB/ET/MAX LOAD/PROD DATE per sample', zh: '按样本格式' } },
      { key: 'mark_sae', group: 'Fn', label: { en: 'Back marking — SAE J2530', zh: '背面标识 — SAE J2530' }, standard: { en: 'Stamped, legible, permanent', zh: '冲压清晰永久' } },
      { key: 'mark_size', group: 'Fn', label: { en: 'Back marking — SIZE', zh: '背面标识 — 尺寸' }, standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_pcd', group: 'Fn', label: { en: 'Back marking — PCD', zh: '背面标识 — 节圆直径' }, standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_cb', group: 'Fn', label: { en: 'Back marking — CB', zh: '背面标识 — 中心孔' }, standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_et', group: 'Fn', label: { en: 'Back marking — ET', zh: '背面标识 — 偏距' }, standard: { en: 'Matches SKU', zh: '与SKU一致' } },
      { key: 'mark_nitra', group: 'Fn', label: { en: 'Back marking — NITRA brand', zh: '背面标识 — 品牌' }, standard: { en: 'Stamped clearly and permanently', zh: '清晰永久冲压' } },
    ],
  },
  {
    key: 'PACKING',
    title: { en: 'Packing', zh: '包装' },
    items: [
      { key: 'pk_cap', group: 'Fn', label: { en: 'Step 1 — cap on wheel', zh: '第一步：扣盖' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_foam', group: 'Fn', label: { en: 'Foam/cling on gloss black', zh: '亮黑泡沫/保鲜膜' }, standard: { en: 'Prevent hat marks', zh: '防压痕' } },
      { key: 'pk_cloth', group: 'Fn', label: { en: 'Step 2 — face cloth cover', zh: '第二步：面防护布套' }, standard: { en: '+ pearl cotton', zh: '加珍珠棉' } },
      { key: 'pk_hoop', group: 'Fn', label: { en: 'Step 3 — plastic hoop', zh: '第三步：塑料护圈' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_bag', group: 'Fn', label: { en: 'Step 4 — plastic bag', zh: '第四步：塑料袋' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_toppad', group: 'Fn', label: { en: 'Step 5 — protective top pad', zh: '第五步：顶部纸护垫' }, standard: { en: 'Per Standard', zh: '按标准' } },
      { key: 'pk_sideboard', group: 'Fn', label: { en: 'Side boards each side', zh: '两侧护角' }, standard: { en: '30cm ≤17", 40cm ≥18"', zh: '17寸及以下30CM，18寸及以上40CM' } },
      { key: 'pk_fullface', group: 'Fn', label: { en: 'Full-face cap taped at box bottom', zh: '全盖式盖子贴箱底' }, standard: { en: 'If full-face cap', zh: '全盖式适用' } },
    ],
  },
  {
    key: 'BOX',
    title: { en: 'Box & Label', zh: '纸箱标签' },
    items: [
      { key: 'bx_design', group: 'Fn', label: { en: 'Box design matches sample', zh: '纸箱设计一致' }, standard: { en: 'Match sample exactly', zh: '与样品完全一致' } },
      { key: 'bx_label', group: 'Fn', label: { en: 'Box label format & size', zh: '标签格式与尺寸' }, standard: { en: 'W80×H120mm, barcode W44mm', zh: '宽80×高120mm，条码宽44mm' } },
      { key: 'bx_upc', group: 'Fn', label: { en: 'UPC-A scans', zh: '条码可扫描' }, standard: { en: 'Scans correctly', zh: '可正常扫描' } },
      { key: 'bx_proddate', group: 'Fn', label: { en: 'Production date below UPC', zh: 'UPC下方生产日期' }, standard: { en: 'Directly below barcode', zh: '条码正下方' } },
      { key: 'bx_stick', group: 'Fn', label: { en: 'Stick-on label square, no slant', zh: '标贴端正无歪斜' }, standard: { en: 'Within designated area', zh: '指定方框内' } },
    ],
  },
]

export interface MeasCol {
  key: string; label: Bi
  nominal: (sku: Sku) => number | null
  tol: Bi
  unit: string
  ref?: string   // reference text instead of numeric tolerance (e.g. TPMS)
  expected?: (sku: Sku) => string   // non-numeric expected value (e.g. lug seat type)
  check: (v: number, sku: Sku) => boolean
}
export interface MeasSection { key: string; title: Bi; cols: MeasCol[] }

export interface Sku {
  part_no: string; model: string; size: string; diameter_in: number
  pcd: string; offset_mm: number; offset_txt: string; cb_mm: number
  lug_hole_mm: number; counter_bore_mm: number; seat_thickness_mm: number
  lug_seat_type: string; finish: string; max_load_lbs: number
  brand_name: string; factory: string
  wheel_weight_kg: number | null; wheel_weight_tol_kg: number
  tpms_sensor_mm: string
}

export function isGlossBlack(finish: string) {
  return finish.toUpperCase().includes('GLOSS BLACK')
}

export function isBlack(finish: string) {
  return finish.toUpperCase().includes('BLACK')
}

export function runoutLimits(d: number) {
  if (d < 17) return { radial: 0.4, axial: 0.4 }
  if (d <= 19) return { radial: 0.5, axial: 0.4 }
  return { radial: 0.6, axial: 0.5 }
}
export function balanceLimits(d: number) {
  if (d < 13) return { B: 20, C: 20, BC: 30 }
  if (d <= 14) return { B: 25, C: 25, BC: 40 }
  if (d <= 15) return { B: 30, C: 30, BC: 50 }
  if (d <= 16) return { B: 35, C: 35, BC: 60 }
  if (d <= 17) return { B: 30, C: 40, BC: 65 }
  if (d <= 18) return { B: 35, C: 45, BC: 70 }
  if (d <= 19) return { B: 40, C: 50, BC: 75 }
  if (d <= 22) return { B: 40, C: 55, BC: 80 }
  return { B: 40, C: 60, BC: 80 }
}

export const MEAS_SECTIONS: MeasSection[] = [
  {
    key: 'machining',
    title: { en: 'Wheel Machining', zh: '轮毂加工' },
    cols: [
      { key: 'counter_bore', label: { en: 'Counter bore', zh: '埋头孔' }, unit: 'mm',
        nominal: s => s.counter_bore_mm, tol: { en: '±0.50 mm', zh: '±0.50 mm' },
        check: (v, s) => Math.abs(v - s.counter_bore_mm) <= 0.5 },
      { key: 'lug_hole', label: { en: 'Lug hole', zh: '螺栓孔' }, unit: 'mm',
        nominal: s => s.lug_hole_mm, tol: { en: '±0.25 mm', zh: '±0.25 mm' },
        check: (v, s) => Math.abs(v - s.lug_hole_mm) <= 0.25 },
      { key: 'seat_thick', label: { en: 'Seat thickness', zh: '座厚' }, unit: 'mm',
        nominal: s => s.seat_thickness_mm, tol: { en: '±0.50 mm', zh: '±0.50 mm' },
        check: (v, s) => Math.abs(v - s.seat_thickness_mm) <= 0.5 },
      { key: 'lug_seat_type', label: { en: 'Lug seat type', zh: '螺栓座类型' }, unit: '',
        nominal: () => null, tol: { en: '', zh: '' },
        expected: s => s.lug_seat_type || '—',
        check: () => true },
      { key: 'offset', label: { en: 'Offset ET', zh: '偏距' }, unit: 'mm',
        nominal: s => s.offset_mm, tol: { en: '±1.00 mm', zh: '±1.00 mm' },
        check: (v, s) => Math.abs(v - s.offset_mm) <= 1.0 },
      { key: 'cb', label: { en: 'Center bore CB', zh: '中心孔' }, unit: 'mm',
        nominal: s => s.cb_mm, tol: { en: '+0/+0.10 mm', zh: '+0/+0.10 mm' },
        check: (v, s) => v - s.cb_mm >= 0 && v - s.cb_mm <= 0.10 },
      { key: 'wheel_weight', label: { en: 'Wheel weight', zh: '轮毂重量' }, unit: 'kg',
        nominal: s => s.wheel_weight_kg !== null ? Number((s.wheel_weight_kg).toFixed(2)) : null,
        tol: { en: '±0.4 kg (±400g)', zh: '±0.4 kg（±400g）' },
        check: (v, s) => s.wheel_weight_kg !== null ? Math.abs(v - s.wheel_weight_kg) <= (s.wheel_weight_tol_kg ?? 0.4) : true },
    ],
  },
  {
    key: 'oor',
    title: { en: 'Wheel OOR', zh: '轮毂偏摆' },
    cols: [
      { key: 'radial_top', label: { en: 'Radial top', zh: '径向上' }, unit: 'mm',
        nominal: s => runoutLimits(s.diameter_in).radial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).radial },
      { key: 'radial_bot', label: { en: 'Radial bottom', zh: '径向下' }, unit: 'mm',
        nominal: s => runoutLimits(s.diameter_in).radial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).radial },
      { key: 'axial_top', label: { en: 'Axial top', zh: '轴向上' }, unit: 'mm',
        nominal: s => runoutLimits(s.diameter_in).axial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).axial },
      { key: 'axial_bot', label: { en: 'Axial bottom', zh: '轴向下' }, unit: 'mm',
        nominal: s => runoutLimits(s.diameter_in).axial, tol: { en: 'max mm', zh: '最大 mm' },
        check: (v, s) => v <= runoutLimits(s.diameter_in).axial },
    ],
  },
  {
    key: 'balance',
    title: { en: 'Wheel Balance', zh: '轮毂动平衡' },
    cols: [
      { key: 'bal_b', label: { en: 'Balance B (g)', zh: '平衡B(g)' }, unit: 'g',
        nominal: s => balanceLimits(s.diameter_in).B, tol: { en: 'max g', zh: '最大g' },
        check: (v, s) => v <= balanceLimits(s.diameter_in).B },
      { key: 'bal_c', label: { en: 'Balance C (g)', zh: '平衡C(g)' }, unit: 'g',
        nominal: s => balanceLimits(s.diameter_in).C, tol: { en: 'max g', zh: '最大g' },
        check: (v, s) => v <= balanceLimits(s.diameter_in).C },
      { key: 'bal_bc', label: { en: 'Balance B+C (g)', zh: '平衡B+C(g)' }, unit: 'g',
        nominal: s => balanceLimits(s.diameter_in).BC, tol: { en: 'max g', zh: '最大g' },
        check: (v, s) => v <= balanceLimits(s.diameter_in).BC },
    ],
  },
]

export const MEAS_COLS: MeasCol[] = MEAS_SECTIONS.flatMap(s => s.cols)

export const PHOTO_SLOTS: { key: string; label: Bi }[] = [
  { key: 'batch_laser', label: { en: 'Batch no. / laser engraving', zh: '批次号/激光雕刻' } },
  { key: 'wheel_front', label: { en: 'Wheel front face', zh: '轮毂正面' } },
  { key: 'wheel_back', label: { en: 'Wheel back + markings', zh: '轮毂背面及标识' } },
  { key: 'box_label', label: { en: 'Box label + UPC', zh: '纸箱标签及条码' } },
  { key: 'packing_inside', label: { en: 'Packing layers inside box', zh: '箱内包装层' } },
  { key: 'pallet_full', label: { en: 'Each pallet w/ labels', zh: '托盘及标签' } },
  { key: 'container_empty', label: { en: 'Container empty + damage', zh: '空柜及破损' } },
  { key: 'container_half', label: { en: 'Container half full', zh: '半柜' } },
  { key: 'container_full', label: { en: 'Container full', zh: '满柜' } },
  { key: 'container_door', label: { en: 'Container door (# legible)', zh: '柜门(箱号清晰)' } },
  { key: 'container_seal', label: { en: 'Seal # (legible)', zh: '封号(清晰)' } },
]

export const PALLET_PACKING_ITEMS: { key: string; label: Bi }[] = [
  { key: 'pl_grouped', label: { en: 'Wheels stacked & grouped by part no.', zh: '按产品编号分类堆叠' } },
  { key: 'pl_wood', label: { en: 'Fumigation-free solid-wood pallet', zh: '免熏蒸实木托盘' } },
  { key: 'pl_height', label: { en: 'Height ≤254 cm, 3-inch fork gap', zh: '高≤254cm，留3英寸叉车位' } },
  { key: 'pl_straps', label: { en: '4 straps tight', zh: '4根打包带捆扎牢固' } },
  { key: 'pl_wrap', label: { en: 'Wrap ≥3 layers, ≥0.35 mm, tight', zh: '缠绕≥3层，≥0.35mm，紧实' } },
  { key: 'pl_label4', label: { en: 'Pallet label on all 4 sides', zh: '四面贴托盘标签' } },
  { key: 'pl_photo', label: { en: 'Photo of each pallet taken', zh: '每托盘拍照' } },
]

// Container-level checks — moving to a PO-level Container Loading tab in a later update.
export const CONTAINER_ITEMS: { key: string; label: Bi }[] = [
  { key: 'ct_photo_before', label: { en: 'Container damage + empty photographed', zh: '装柜前破损/空柜拍照' } },
  { key: 'ct_labels_doors', label: { en: 'Box labels + hand-holes face doors', zh: '标签面/把手孔朝柜门' } },
  { key: 'ct_no_loose', label: { en: 'No loose wheels', zh: '无散装轮毂' } },
  { key: 'ct_spares_front', label: { en: 'Spare boxes/caps at front', zh: '备用箱/盖置于柜门口' } },
  { key: 'ct_net', label: { en: 'Net/rope before closing doors', zh: '关门前装防护网/绳' } },
]

export const PALLET_ITEMS: { key: string; label: Bi }[] = [...PALLET_PACKING_ITEMS, ...CONTAINER_ITEMS]

// Container Loading Inspection Photos — photo-only (no P/F/NA); each requires a photo.
export const CONTAINER_PHOTO_ITEMS: { key: string; label: Bi; instruction: Bi }[] = [
  { key: 'cc_exterior', label: { en: 'Container Condition: Exterior', zh: '集装箱状况：外部' },
    instruction: { en: 'Photograph all four sides of the container, including any damaged areas, before loading.', zh: '装柜前拍摄集装箱四面，包括任何破损部位。' } },
  { key: 'cc_interior', label: { en: 'Container Condition: Interior', zh: '集装箱状况：内部' },
    instruction: { en: 'Photograph the container interior, including any damaged areas, before loading.', zh: '装柜前拍摄集装箱内部，包括任何破损部位。' } },
  { key: 'cl_empty', label: { en: 'Container Loading: Empty', zh: '装柜：空柜' },
    instruction: { en: 'Photo of the empty container at the start of loading.', zh: '装柜开始时的空柜照片。' } },
  { key: 'cl_half', label: { en: 'Container Loading: Half Full', zh: '装柜：半满' },
    instruction: { en: 'Photo of the container when roughly half loaded.', zh: '集装箱约装载一半时的照片。' } },
  { key: 'cl_full', label: { en: 'Container Loading: Full', zh: '装柜：满柜' },
    instruction: { en: 'Photo of the container when fully loaded.', zh: '集装箱完全装满时的照片。' } },
  { key: 'cl_by_size', label: { en: 'Wheels loaded by size & part number', zh: '按尺寸与产品编号装载' },
    instruction: { en: 'Show that wheels are loaded grouped by size and part number.', zh: '显示轮毂按尺寸和产品编号分组装载。' } },
  { key: 'cl_box_labels', label: { en: 'Box labels & hand-holes facing container door', zh: '箱标签与提手孔朝向柜门' },
    instruction: { en: 'Box labels and box hand-holes facing the container door.', zh: '箱标签与箱提手孔朝向集装箱门。' } },
  { key: 'cl_spares', label: { en: 'Spare boxes & caps at front', zh: '备用箱与盖置于柜门口' },
    instruction: { en: 'Spare boxes and caps placed at the container door (front).', zh: '备用箱与轮毂盖放置于集装箱门口。' } },
  { key: 'cl_net', label: { en: 'Protective net after loading', zh: '装载后防护网' },
    instruction: { en: 'Protective net fitted across the doorway after loading.', zh: '装载后在门口安装防护网。' } },
]

```

### `src/lib/supabase.ts`

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

```


---

## 9c. src/components

### `src/components/AttachInspectionModal.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { linkedInspectionIds, attachToPo } from '../lib/inspectionPos'
import type { Profile } from '../App'

interface Cand { id: string; part_no: string; batch: string | null; lot_size: number | null; updated_at: string }

// PO-side: attach an existing approved inspection to this PO. Eligible = a SKU
// this PO ordered; the "show off-PO" toggle reveals others and attaches them
// with the off_po flag set.
export default function AttachInspectionModal({ po, profile, onClose, onAttached }: {
  po: string; profile: Profile; onClose: () => void; onAttached: () => void
}) {
  const { t } = useI18n()
  const [cands, setCands] = useState<Cand[]>([])
  const [orderedParts, setOrderedParts] = useState<Set<string>>(new Set())
  const [linked, setLinked] = useState<Set<string>>(new Set())
  const [showOff, setShowOff] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data: posRow } = await supabase.from('pos').select('id').eq('po_no', po).maybeSingle()
    const pid = (posRow as { id: string } | null)?.id
    let parts = new Set<string>()
    if (pid) {
      const { data: items } = await supabase.from('po_items').select('part_no').eq('po_id', pid)
      parts = new Set(((items as { part_no: string }[]) || []).map(i => i.part_no))
    }
    setOrderedParts(parts)
    const { ids } = await linkedInspectionIds(po)
    setLinked(new Set(ids))
    const { data: appr } = await supabase.from('inspections')
      .select('id,part_no,batch,lot_size,updated_at').eq('status', 'approved').order('part_no')
    setCands((appr as Cand[]) || [])
  }, [po])
  useEffect(() => { load() }, [load])

  const attach = async (c: Cand) => {
    const onPo = orderedParts.has(c.part_no)
    setBusy(c.id); setMsg('')
    const { error } = await attachToPo(c.id, po, !onPo, profile.id)
    setBusy('')
    if (error) { setMsg(error.message); return }
    setLinked(prev => new Set(prev).add(c.id))
    onAttached()
  }

  const visible = cands.filter(c => !linked.has(c.id) && (showOff || orderedParts.has(c.part_no)))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, 94vw)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{t('attachInspection')}</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{t('attachHint')}</p>
        <label className="row" style={{ gap: 8, fontSize: 13, marginBottom: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} style={{ width: 18, height: 18 }} />
          {t('showOffPo')}
        </label>
        {visible.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noAttachCandidates')}</p>}
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {visible.map(c => {
            const onPo = orderedParts.has(c.part_no)
            return (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    {c.part_no}
                    {!onPo && <span className="pill" style={{ marginLeft: 6, background: 'var(--amber-bg)', color: 'var(--amber)' }}>⚠ {t('offPo')}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{t('batch')}: {c.batch || '—'} · {t('lotSize')}: {c.lot_size ?? '—'}</div>
                </div>
                <button className="btn" style={{ minHeight: 34, padding: '4px 14px', fontSize: 13 }} disabled={busy === c.id} onClick={() => attach(c)}>
                  {busy === c.id ? '…' : t('attach')}
                </button>
              </div>
            )
          })}
        </div>
        {msg && <p style={{ color: 'var(--fail)', fontSize: 13 }}>{msg}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn ghost" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}

```

### `src/components/Camera.tsx`

```tsx
import { useRef } from 'react'
import { supabase } from '../lib/supabase'

/** Opens the device camera, uploads to storage, returns the storage path. */
export default function Camera({ onUploaded, label }: { onUploaded: (path: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const pick = () => ref.current?.click()
  const upload = async (f: File) => {
    const path = `${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('qc-photos').upload(path, f, { contentType: f.type })
    if (!error) onUploaded(path)
  }
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = '' }} />
      <button className="btn ghost" onClick={pick}>📷 {label}</button>
    </>
  )
}

export function photoUrl(path: string) {
  return supabase.storage.from('qc-photos').createSignedUrl(path, 3600).then(r => r.data?.signedUrl || '')
}

```

### `src/components/CustomerAccessCard.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n, type Bi } from '../lib/i18n'
import { getOrCreatePoId } from '../lib/poStatus'

// Admin-only card on the PO page: which customer accounts may view this PO.
// Writes the SAME po_access table the Users page uses — just keyed by PO
// instead of by customer. Toggling is immediate (insert / delete one row).

interface Customer { id: string; email: string; full_name: string; active: boolean }

const T = {
  title:    { en: 'Customer access', zh: '客户访问权限' } as Bi,
  help:     { en: 'These customer accounts can view this PO\u2019s approved reports. Changes apply immediately.',
              zh: '以下客户账户可查看此订单的已批准报告。更改即时生效。' } as Bi,
  none:     { en: 'No customer accounts yet — add one on the Users page.', zh: '暂无客户账户——请在用户管理页添加。' } as Bi,
  grant:    { en: 'Grant', zh: '授予' } as Bi,
  granted:  { en: '\u2713 Granted', zh: '\u2713 已授予' } as Bi,
  loading:  { en: 'Loading\u2026', zh: '加载中\u2026' } as Bi,
  inactive: { en: 'deactivated', zh: '已停用' } as Bi,
}

async function listCustomers(): Promise<Customer[] | { error: string }> {
  const { data, error } = await supabase.functions.invoke('manage-users', { body: { action: 'list' } })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    }
    return { error: msg }
  }
  const res = data as { ok: boolean; users?: { id: string; email: string; full_name: string; role: string; active: boolean }[]; error?: string }
  if (!res?.ok) return { error: res?.error || 'Could not load customers.' }
  return (res.users || []).filter(u => u.role === 'customer').map(u => ({ id: u.id, email: u.email, full_name: u.full_name, active: u.active }))
}

export default function CustomerAccessCard({ po }: { po: string }) {
  const { bi } = useI18n()
  const [poId, setPoId] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const id = await getOrCreatePoId(po, true)
    setPoId(id)
    const cust = await listCustomers()
    if ('error' in cust) { setErr(cust.error); setCustomers([]); setLoading(false); return }
    setCustomers(cust)
    if (id) {
      const { data: acc } = await supabase.from('po_access').select('customer_id').eq('po_id', id)
      setAssigned(new Set(((acc as { customer_id: string }[]) || []).map(a => a.customer_id)))
    }
    setLoading(false)
  }, [po])

  useEffect(() => { load() }, [load])

  const toggle = async (customerId: string) => {
    if (!poId) return
    setBusyId(customerId); setErr('')
    const has = assigned.has(customerId)
    // optimistic
    const next = new Set(assigned)
    if (has) next.delete(customerId); else next.add(customerId)
    setAssigned(next)
    const { error } = has
      ? await supabase.from('po_access').delete().eq('po_id', poId).eq('customer_id', customerId)
      : await supabase.from('po_access').insert({ po_id: poId, customer_id: customerId })
    if (error) {
      // revert
      const back = new Set(assigned)
      setAssigned(back)
      setErr(error.message)
    }
    setBusyId(null)
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2 style={{ margin: '0 0 6px' }}>{bi(T.title)}</h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 }}>{bi(T.help)}</p>
      {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginBottom: 10 }}>{err}</div>}
      {loading ? <p className="muted">{bi(T.loading)}</p> : (
        customers.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>{bi(T.none)}</p> : (
          <div>
            {customers.map(c => {
              const on = assigned.has(c.id)
              return (
                <div key={c.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0, opacity: c.active ? 1 : 0.55 }}>
                    <div style={{ fontWeight: 700 }}>
                      {c.full_name || c.email}
                      {!c.active && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> ({bi(T.inactive)})</span>}
                    </div>
                    {c.full_name && <div className="muted" style={{ fontSize: 12 }}>{c.email}</div>}
                  </div>
                  <button
                    className={on ? 'btn ok' : 'btn ghost'}
                    style={{ minHeight: 38, padding: '4px 14px', fontSize: 14, minWidth: 108 }}
                    disabled={busyId === c.id || !poId}
                    onClick={() => toggle(c.id)}
                  >{on ? bi(T.granted) : bi(T.grant)}</button>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

```

### `src/components/EmailModal.tsx`

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Replaces window.prompt() for report emailing (QW-1).
// - One-tap chips: the saved distribution list (Settings) + recently used
//   addresses on this device.
// - Free typing still works (Enter / comma / blur adds the address).
// - Sending with nothing selected preserves the old "leave blank to use the
//   saved distribution list" behaviour where the caller supports it.

const RECENT_KEY = 'nitra_recent_recipients'
const getRecents = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
export const rememberRecipients = (emails: string[]) => {
  try {
    const cur = getRecents()
    const merged = [...emails, ...cur.filter(e => !emails.includes(e))].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(merged))
  } catch { /* ignore */ }
}

export default function EmailModal({ title, allowBlank, sending, onSend, onClose }: {
  title: string
  allowBlank?: boolean          // true = empty selection means "use saved list"
  sending?: boolean
  onSend: (emails: string[]) => void
  onClose: () => void
}) {
  const [dist, setDist] = useState<string[]>([])
  const [recents, setRecents] = useState<string[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setRecents(getRecents())
    supabase.from('settings').select('value').eq('key', 'distribution').maybeSingle()
      .then(({ data }) => {
        const emails: string[] = data?.value?.emails || []
        setDist(emails)
        setSel(new Set(emails)) // saved list pre-selected — one tap to deselect
      })
  }, [])

  const toggle = (e: string) => { const n = new Set(sel); if (n.has(e)) n.delete(e); else n.add(e); setSel(n) }
  const addTyped = () => {
    const parts = typed.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    const bad = parts.find(p => !/.+@.+\..+/.test(p))
    if (bad) { setErr(`"${bad}" doesn't look like an email address.`); return }
    setErr('')
    const n = new Set(sel); for (const p of parts) n.add(p)
    setSel(n); setTyped('')
  }
  const send = () => {
    const emails = [...sel]
    if (!emails.length && !allowBlank) { setErr('Select or type at least one recipient.'); return }
    if (typed.trim()) { setErr('Press Enter to add the typed address first, or clear it.'); return }
    if (emails.length) rememberRecipients(emails)
    onSend(emails)
  }
  const chip = (e: string) => (
    <button key={e} onClick={() => toggle(e)}
      style={{ minHeight: 40, padding: '6px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
        border: `1.5px solid ${sel.has(e) ? 'var(--navy)' : 'var(--line)'}`,
        background: sel.has(e) ? 'var(--navy)' : '#fff', color: sel.has(e) ? '#fff' : 'var(--ink, #18222E)' }}>
      {sel.has(e) ? '✓ ' : ''}{e}
    </button>
  )
  const others = recents.filter(r => !dist.includes(r))

  return (
    <div className="modal-overlay" onClick={() => !sending && onClose()}>
      <div className="modal" style={{ width: 'min(500px, 94vw)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {dist.length > 0 && (<>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Saved distribution list</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>{dist.map(chip)}</div>
        </>)}
        {others.length > 0 && (<>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Recent</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>{others.map(chip)}</div>
        </>)}
        <label className="fld"><span>Add address</span>
          <input className="txt" type="email" placeholder="name@company.com" value={typed}
            onChange={e => { setTyped(e.target.value); setErr('') }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTyped() } }}
            onBlur={addTyped} /></label>
        {allowBlank && sel.size === 0 && <p className="muted" style={{ fontSize: 12 }}>No recipients selected — the saved distribution list will be used.</p>}
        {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)' }}>{err}</div>}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn" disabled={sending} onClick={send}>{sending ? 'Sending…' : `Send${sel.size ? ` (${sel.size})` : ''}`}</button>
          <button className="btn ghost" disabled={sending} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

```

### `src/components/ErrorBoundary.tsx`

```tsx
import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

// Catches render-time crashes anywhere below it and shows the error text
// instead of a blank white screen, so issues are reportable at a glance.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error) { console.error('App error boundary caught:', error) }

  render() {
    if (this.state.error) {
      return (
        <div className="page" style={{ paddingTop: 24 }}>
          <div className="card" style={{ border: '2px solid var(--fail)' }}>
            <h2 style={{ color: 'var(--fail)' }}>Something went wrong / 出现错误</h2>
            <p className="muted">This screen failed to load. Please screenshot this message and send it for support.<br />此页面加载失败，请截图发送以便排查。</p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#F7F9FB', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--ink)' }}>{this.state.error.message}</pre>
            <button className="btn" style={{ marginTop: 12 }}
              onClick={() => { this.setState({ error: null }); window.location.assign('/') }}>
              Back to home / 返回主页
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

```

### `src/components/ExtraPieceScreen.tsx`

```tsx
import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { DefectModal, PassPhotoModal } from './PhotoModal'
import type { PFNA } from '../lib/rules'

interface Props {
  inspectionId: string
  itemKey: string
  itemLabel: string
  result: 'P' | 'F'
  existingExtras: PFNA[]
  onSave: (result: 'P' | 'F') => void
  onUndo: () => void
  onClose: () => void
  extrasRequired: number
}

export default function ExtraPieceScreen({
  inspectionId, itemKey, itemLabel, result,
  existingExtras, onSave, onUndo, onClose, extrasRequired
}: Props) {
  const { bi: _bi } = useI18n(); void _bi
  const [photoModal, setPhotoModal] = useState(false)
  const done = existingExtras.filter(r => r === 'P' || r === 'F').length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <h2 style={{ color: result === 'F' ? 'var(--fail)' : 'var(--pass)', marginBottom: 14 }}>
          {result === 'F' ? '✗ Extra Piece — Fail' : '✓ Extra Piece — Pass'}
        </h2>

        {/* Item info */}
        <div className="card" style={{ background: result === 'F' ? 'var(--fail-bg)' : 'var(--pass-bg)', marginBottom: 14, padding: 10 }}>
          <div><b>Item / 检验项目:</b> {itemLabel}</div>
          <div><b>Extra piece {done + 1} of {extrasRequired}</b></div>
        </div>

        {/* Previous extras dots */}
        {existingExtras.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="muted" style={{ marginBottom: 6 }}>Recorded so far / 已记录:</div>
            <div className="extra-recorder">
              {existingExtras.map((r, i) => (
                <div key={i} className={`extra-dot ${r === 'P' ? 'p' : 'f'}`}>{r}</div>
              ))}
            </div>
          </div>
        )}

        {/* Photo button */}
        <div style={{ marginBottom: 16 }}>
          <button
            className={`btn ${result === 'F' ? 'danger' : 'ok'} ghost`}
            style={{ width: '100%' }}
            onClick={() => setPhotoModal(true)}>
            📷+ {result === 'F' ? 'Log defect + photo' : 'Take photo (optional)'}
          </button>
        </div>

        {/* Action buttons */}
        <div className="row">
          <button
            className={`btn ${result === 'F' ? 'danger' : 'ok'}`}
            style={{ flex: 1 }}
            onClick={() => { onSave(result); onClose() }}>
            Save {result === 'F' ? 'Fail' : 'Pass'} / 保存{result === 'F' ? '不合格' : '合格'}
          </button>
          {existingExtras.length > 0 && (
            <button className="btn ghost" onClick={() => { onUndo(); onClose() }}>
              ↩ Undo last
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>

      {/* Photo modals — rendered outside the inner modal so they stack on top */}
      {photoModal && result === 'F' && (
        <DefectModal
          inspectionId={inspectionId}
          itemKey={itemKey}
          itemLabel={`${itemLabel} (extra piece ${done + 1})`}
          pieceNo={-(done + 1)}   // negative = extra piece marker
          tab="extra"
          onDone={() => { setPhotoModal(false); onSave(result); onClose() }}
          onClose={() => setPhotoModal(false)}
        />
      )}
      {photoModal && result === 'P' && (
        <PassPhotoModal
          inspectionId={inspectionId}
          itemKey={itemKey}
          itemLabel={`${itemLabel} (extra piece ${done + 1})`}
          pieceNo={-(done + 1)}
          tab="extra"
          onDone={() => { setPhotoModal(false); onSave(result); onClose() }}
          onClose={() => setPhotoModal(false)}
        />
      )}
    </div>
  )
}

```

### `src/components/HundredPctCheck.tsx`

```tsx
import { useState } from 'react'
import { DefectModal, PassPhotoModal } from './PhotoModal'
import type { PFNA } from '../lib/rules'

interface Props {
  inspectionId: string
  lotSize: number
  triggeredItems: { key: string; label: string }[]
  baseResults: Record<string, Record<string, PFNA>>
  results: Record<string, Record<string, PFNA>>
  onSave: (key: string, pieceNo: number, result: PFNA) => void
  editable: boolean
}

type ModalState =
  | { type: 'fail'; itemKey: string; itemLabel: string; pieceNo: number }
  | { type: 'pass'; itemKey: string; itemLabel: string; pieceNo: number }
  | null

export default function HundredPctCheck({ inspectionId, lotSize, triggeredItems, baseResults, results, onSave, editable }: Props) {
  const [activeItem, setActiveItem] = useState(triggeredItems[0]?.key || '')
  const [modal, setModal] = useState<ModalState>(null)

  const item = triggeredItems.find(i => i.key === activeItem) || triggeredItems[0]
  if (!item) return null
  const itemResults = results[item.key] || {}
  const baseItem = baseResults[item.key] || {}   // pieces already inspected on the Visual/Technical sample

  const pieces = Array.from({ length: lotSize }, (_, i) => i + 1)
  const verdictOf = (n: number): PFNA | undefined => baseItem[String(n)] ?? itemResults[String(n)]
  const checked = pieces.filter(n => verdictOf(n) === 'P' || verdictOf(n) === 'F').length
  const fails = pieces.filter(n => verdictOf(n) === 'F').length

  const rows: number[][] = []
  for (let i = 0; i < lotSize; i += 10)
    rows.push(Array.from({ length: Math.min(10, lotSize - i) }, (_, j) => i + j + 1))

  return (
    <div className="card">
      <h2 style={{ color:'var(--fail)' }}>⛔ 100% Inspection / 全检</h2>

      {triggeredItems.length > 1 && (
        <div className="tabs" style={{ position:'static', marginBottom:12 }}>
          {triggeredItems.map(it => (
            <button key={it.key} className={item.key === it.key ? 'on' : ''} onClick={() => setActiveItem(it.key)}>{it.label}</button>
          ))}
        </div>
      )}

      {/* Counters */}
      <div className="row" style={{ marginBottom:14 }}>
        {[['Checked / 已检', `${checked} / ${lotSize}`, 'var(--navy)'],
          ['Fails / 不合格', String(fails), fails > 0 ? 'var(--fail)' : 'var(--pass)'],
          ['Remaining / 待检', String(lotSize - checked), checked < lotSize ? 'var(--amber)' : 'var(--pass)']
        ].map(([label, val, color]) => (
          <div key={label} className="card" style={{ flex:1, marginBottom:0, textAlign:'center', padding:10 }}>
            <div className="muted" style={{ fontSize:12 }}>{label}</div>
            <div style={{ fontSize:28, fontFamily:'var(--display)', fontWeight:700, color: color as string }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="muted" style={{ marginBottom:10, fontSize:13 }}>
        Checking: <b>{item.label}</b> · Tap <b>P</b> or <b>F</b> to record instantly. Tap the piece number after to add optional photo/video.
        {Object.keys(baseItem).length > 0 && <> · 🔒 Pieces already inspected on the sample (Visual/Technical) are pre-filled with their result and locked — re-inspect only the remaining pieces.</>}
      </div>

      {rows.map((row, ri) => (
        <div key={ri} style={{ display:'flex', gap:4, marginBottom:4, flexWrap:'wrap' }}>
          {row.map(n => {
            const baseV = baseItem[String(n)]
            const locked = baseV === 'P' || baseV === 'F'   // already inspected on the sample → locked
            const val = locked ? baseV : itemResults[String(n)]
            return (
              <div key={n} style={{ width:52, border:'1.5px solid var(--line)', borderRadius:8,
                background: val === 'P' ? 'var(--pass-bg)' : val === 'F' ? 'var(--fail-bg)' : '#fff',
                borderColor: val === 'P' ? 'var(--pass)' : val === 'F' ? 'var(--fail)' : 'var(--line)',
                overflow:'hidden', opacity: locked ? 0.85 : 1 }}>
                {/* Piece number — tap to add optional photo (disabled for locked base fails) */}
                <button
                  style={{ width:'100%', textAlign:'center', fontSize:11, fontWeight:700, padding:'3px 0',
                    border:'none', borderBottom:'1px solid var(--line)', background:'rgba(0,0,0,.04)',
                    cursor: (!locked && val) ? 'pointer' : 'default', color: val ? 'var(--navy)' : 'inherit' }}
                  onClick={() => {
                    if (!editable || locked || !val) return
                    setModal({ type: val === 'F' ? 'fail' : 'pass', itemKey: item.key, itemLabel: item.label, pieceNo: n })
                  }}>
                  {locked ? `${n} 🔒` : `${n}${val ? ' 📷' : ''}`}
                </button>
                {/* P / F — instant save, no popup (locked base fails are read-only) */}
                <div style={{ display:'flex' }}>
                  <button disabled={!editable || locked}
                    style={{ flex:1, border:'none', borderRight:'1px solid var(--line)', minHeight:36,
                      background: val === 'P' ? 'var(--pass)' : 'transparent',
                      color: val === 'P' ? '#fff' : 'var(--pass)', fontWeight:700, fontSize:13, cursor: locked ? 'default' : 'pointer' }}
                    onClick={() => onSave(item.key, n, val === 'P' ? undefined : 'P')}>P</button>
                  <button disabled={!editable || locked}
                    style={{ flex:1, border:'none', minHeight:36,
                      background: val === 'F' ? 'var(--fail)' : 'transparent',
                      color: val === 'F' ? '#fff' : 'var(--fail)', fontWeight:700, fontSize:13, cursor: locked ? 'default' : 'pointer' }}
                    onClick={() => onSave(item.key, n, val === 'F' ? undefined : 'F')}>F</button>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {checked === lotSize && (
        <div className="banner ok" style={{ marginTop:14 }}>
          ✓ All {lotSize} pieces checked · {fails} fail{fails !== 1 ? 's' : ''}
        </div>
      )}

      {modal?.type === 'fail' && (
        <DefectModal inspectionId={inspectionId} itemKey={modal.itemKey}
          itemLabel={`${modal.itemLabel} (100% check)`} pieceNo={modal.pieceNo} tab="100pct"
          onDone={() => setModal(null)} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'pass' && (
        <PassPhotoModal inspectionId={inspectionId} itemKey={modal.itemKey}
          itemLabel={`${modal.itemLabel} (100% check)`} pieceNo={modal.pieceNo} tab="100pct"
          onDone={() => setModal(null)} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

```

### `src/components/PartPicker.tsx`

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cacheGet, cacheSet } from '../lib/refCache'

// Mobile-first searchable part-number picker (Phase 4).
// - Live-filters the active SKU master on part number, model, size, finish.
// - Big touch targets; keyboard also works on desktop.
// - Optional PO awareness: pass poParts (part numbers on the current PO) and
//   items on the PO sort first and are badged; picking an off-PO part asks
//   "not listed on the selected PO — continue anyway?" and reports the flag
//   to the parent via onChange(part, offPo).

export interface SkuLite { part_no: string; model: string | null; size: string | null; finish: string | null }

let skuCache: SkuLite[] | null = null
export async function loadSkuLite(): Promise<SkuLite[]> {
  if (skuCache) return skuCache
  const { data, error } = await supabase.from('skus').select('part_no,model,size,finish').eq('active', true).order('part_no')
  if (data && !error) {
    skuCache = data as SkuLite[]                 // memoize only a real online result
    void cacheSet('skus_lite', data)             // persist for offline reads
    return skuCache
  }
  // Offline / fetch failed — fall back to the on-device copy WITHOUT memoizing,
  // so a later online call still refreshes from the server.
  return (await cacheGet<SkuLite[]>('skus_lite')) || []
}

export default function PartPicker({ value, disabled, poParts, placeholder, allowFreeText, onChange }: {
  value: string
  disabled?: boolean
  poParts?: Set<string> | null   // part numbers on the current PO (null/undefined = no PO context)
  placeholder?: string
  allowFreeText?: boolean         // when true, typed text propagates live (a part not in the SKU master is still allowed)
  onChange: (part: string, offPo: boolean) => void
}) {
  const [skus, setSkus] = useState<SkuLite[]>([])
  const [q, setQ] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadSkuLite().then(setSkus) }, [])
  useEffect(() => { setQ(value) }, [value])
  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close) }
  }, [])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hay = skus.filter(s => !needle
      || s.part_no.toLowerCase().includes(needle)
      || (s.model || '').toLowerCase().includes(needle)
      || (s.size || '').toLowerCase().includes(needle)
      || (s.finish || '').toLowerCase().includes(needle))
    // PO items first, then alphabetical
    const rank = (s: SkuLite) => (poParts && poParts.has(s.part_no) ? 0 : 1)
    return hay.sort((a, b) => rank(a) - rank(b) || a.part_no.localeCompare(b.part_no)).slice(0, 40)
  }, [q, skus, poParts])

  const pick = (part: string) => {
    const offPo = !!(poParts && poParts.size > 0 && !poParts.has(part))
    if (offPo && !confirm(`${part} is not listed on the selected PO.\n\nContinue anyway? (It will be flagged.)`)) return
    onChange(part, offPo)
    setQ(part); setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 2, minWidth: 0 }}>
      <input className="txt" style={{ width: '100%' }} disabled={disabled}
        placeholder={placeholder || 'Search part / model / size…'}
        value={q}
        onFocus={() => !disabled && setOpen(true)}
        onChange={e => { const v = e.target.value; setQ(v); setOpen(true); if (allowFreeText || v === '') onChange(v, false) }}
        onKeyDown={e => { if (e.key === 'Enter' && results.length) { e.preventDefault(); pick(results[0].part_no) } if (e.key === 'Escape') setOpen(false) }}
      />
      {open && !disabled && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 40, top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#fff', border: '1.5px solid var(--line)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(16,32,54,.14)', maxHeight: 288, overflowY: 'auto' }}>
          {results.map(s => {
            const onPo = !!(poParts && poParts.has(s.part_no))
            return (
              <div key={s.part_no}
                onMouseDown={e => { e.preventDefault(); pick(s.part_no) }}
                style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', minHeight: 48 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{s.part_no}</span>
                  {onPo && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pass, #1F8A4C)', border: '1px solid var(--pass, #1F8A4C)', borderRadius: 6, padding: '1px 6px' }}>ON PO</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {[s.model, s.size, s.finish].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

```

### `src/components/PhotoModal.tsx`

```tsx
import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export const MEAS_UNIT: Record<string, string> = {
  coating_total: 'µm', coating_machined: 'µm',
  bal_b: 'g', bal_c: 'g', bal_bc: 'g', wheel_weight: 'kg',
}
export const getMeasUnit = (key: string) => MEAS_UNIT[key] || 'mm'

// Defect-type options apply ONLY to the appearance areas. Every other
// parameter just needs a photo (a fail already means it missed the standard).
const APPEARANCE_DEFECTS = [
  { value: 'paint_inclusion', label: 'Paint Inclusions / 漆点杂质' },
  { value: 'casting_porosity', label: 'Casting Failure / Porosity / 铸造缺陷·砂孔' },
  { value: 'scratch_hair_lint', label: 'Scratches / Hair Lint / 划痕·毛丝' },
]
const DEFECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  area_a: APPEARANCE_DEFECTS, area_b: APPEARANCE_DEFECTS, area_c: APPEARANCE_DEFECTS,
  area_c1: APPEARANCE_DEFECTS, area_d: APPEARANCE_DEFECTS,
  area_e: [{ value: 'burrs_tpms_hole', label: 'Burrs on TPMS Hole / TPMS孔毛刺' }],
}

interface BaseProps {
  inspectionId: string
  itemKey: string; itemLabel: string; pieceNo: number
  tab: 'form'|'measure'|'pallet'|'extra'|'100pct'
  onDone: () => void; onClose: () => void
}

// ── Media capture: photo or video ──
export function MediaCapture({ onUploaded, label }: { onUploaded: (path: string, type: 'photo'|'video') => void; label: string }) {
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const upload = async (f: File, type: 'photo'|'video') => {
    setUploading(true)
    const ext = type === 'video' ? 'mp4' : 'jpg'
    const path = `${crypto.randomUUID()}.${ext}`
    // Weak-WiFi protection: retry up to 3 times with backoff before failing.
    let error: { message: string } | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await supabase.storage.from('qc-photos').upload(path, f, { contentType: f.type, upsert: true })
      error = res.error
      if (!error) break
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
    }
    setUploading(false)
    if (!error) onUploaded(path, type)
    else alert(`Upload failed after 3 attempts (${error.message}). Check the WiFi and try again — the photo is still on your device.`)
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f,'photo'); e.currentTarget.value='' }} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f,'video'); e.currentTarget.value='' }} />
      <button className="btn ghost" style={{ flex: 1 }} disabled={uploading} onClick={() => photoRef.current?.click()}>
        📷 {label || 'Photo'}
      </button>
      <button className="btn ghost" style={{ flex: 1 }} disabled={uploading} onClick={() => videoRef.current?.click()}>
        🎥 Video
      </button>
    </div>
  )
}

// ── Media preview thumbnail ──
export function MediaThumb({ type, url, onClick }: { path?: string; type?: string; url: string; onClick?: () => void }) {
  if (!url) return <div style={{ width: 80, height: 80, background: 'var(--steel)', borderRadius: 8, display:'grid', placeItems:'center', fontSize:12 }}>…</div>
  if (type === 'video') {
    return (
      <div style={{ position:'relative', width:80, height:80, borderRadius:8, overflow:'hidden', cursor:'pointer', background:'#000' }} onClick={onClick}>
        <video src={url} style={{ width:'100%', height:'100%', objectFit:'cover' }} muted />
        <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', background:'rgba(0,0,0,.35)' }}>
          <span style={{ fontSize:24 }}>▶</span>
        </div>
      </div>
    )
  }
  return <img src={url} style={{ width:80, height:80, objectFit:'cover', borderRadius:8, cursor:'pointer' }} onClick={onClick} />
}

// ── FAIL MODAL ──────────────────────────────────────────────
export function DefectModal({ inspectionId, itemKey, itemLabel, pieceNo, tab, onDone, onClose }: BaseProps) {
  const { t } = useI18n()
  const defectOptions = DEFECT_OPTIONS[itemKey]
  const [defectType, setDefectType] = useState(defectOptions ? defectOptions[0].value : 'unspecified')
  const [measValue, setMeasValue] = useState('')
  const [comment, setComment] = useState('')
  const [mediaPath, setMediaPath] = useState<string|null>(null)
  const [mediaType, setMediaType] = useState<'photo'|'video'>('photo')
  const [mediaUrl, setMediaUrl] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const unit = tab === 'measure' ? getMeasUnit(itemKey) : ''

  const save = async () => {
    setSaving(true)
    const { data: existing } = await supabase.from('defects').select('id')
      .eq('inspection_id', inspectionId).eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tab)
      .limit(1).maybeSingle()
    const fields = {
      inspection_id: inspectionId, piece_no: pieceNo, tab,
      section: tab.toUpperCase(), item_key: itemKey, item_label: itemLabel,
      defect_type: defectType, severity: 'na',
      measurement_value: measValue !== '' ? +measValue : null,
      measurement_unit: unit || 'mm', comment, is_extra_piece: tab === 'extra',
    }
    let defectId = existing?.id as string|undefined
    if (defectId) await supabase.from('defects').update(fields).eq('id', defectId)
    else { const { data } = await supabase.from('defects').insert(fields).select('id').single(); defectId = data?.id }
    if (defectId && mediaPath) {
      await supabase.from('photos').insert({
        inspection_id: inspectionId, defect_id: defectId,
        storage_path: mediaPath, media_type: mediaType,
        is_pass_photo: false, item_key: itemKey, piece_no: pieceNo, comment,
      })
    }
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ color:'var(--fail)', marginBottom:14 }}>⚠ {t('failDefect')}</h2>
        <div className="card" style={{ background:'var(--fail-bg)', marginBottom:14, padding:10 }}>
          <div><b>{t('inspParam')}:</b> {itemLabel}</div>
          <div><b>{t('piece')}:</b> {pieceNo > 0 ? pieceNo : `extra ${-pieceNo}`}</div>
        </div>
        <div style={{ display:'grid', gap:10 }}>
          {defectOptions && (
            <label className="fld"><span>{t('defectType')}</span>
              <select className="sel" value={defectType} onChange={e => setDefectType(e.target.value)}>
                {defectOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
          )}
          {(tab === 'measure' || tab === 'form') && unit && (
            <label className="fld"><span>{t('measurement')} ({unit}) — optional</span>
              <input className="txt" type="number" step="0.01" inputMode="decimal" value={measValue}
                onChange={e => setMeasValue(e.target.value)} placeholder={`Value in ${unit}`} />
            </label>
          )}
          <label className="fld"><span>{t('comment')}</span>
            <textarea className="txt" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
          </label>
          <div>
            <div className="fld"><span>Media (optional)</span></div>
            {mediaUrl
              ? <div style={{ marginBottom:8 }}>
                  {mediaType === 'video'
                    ? <video src={mediaUrl} controls style={{ width:'100%', maxHeight:200, borderRadius:8 }} />
                    : <img src={mediaUrl} style={{ width:'100%', maxHeight:200, objectFit:'cover', borderRadius:8 }} />}
                </div>
              : <div style={{ background:'var(--steel)', height:80, borderRadius:8, display:'grid', placeItems:'center', color:'var(--ink-soft)', marginBottom:8 }}>No media yet</div>}
            <MediaCapture label={mediaUrl ? 'Retake' : t('takePhoto')} onUploaded={async (path, type) => { setMediaPath(path); setMediaType(type); const {data}=await supabase.storage.from('qc-photos').createSignedUrl(path,3600); if(data?.signedUrl) setMediaUrl(data.signedUrl) }} />
          </div>
        </div>
        <div className="row" style={{ marginTop:16 }}>
          <button className="btn danger" style={{ flex:1 }} disabled={saving} onClick={save}>
            {saving ? '…' : t('saveDefect')}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── PASS MODAL ──────────────────────────────────────────────
export function PassPhotoModal({ inspectionId, itemKey, itemLabel, pieceNo, tab: _tab, onDone, onClose }: BaseProps) {
  const { t } = useI18n()
  const [comment, setComment] = useState('')
  const [mediaPath, setMediaPath] = useState<string|null>(null)
  const [mediaType, setMediaType] = useState<'photo'|'video'>('photo')
  const [mediaUrl, setMediaUrl] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!mediaPath) { onDone(); return }
    setSaving(true)
    await supabase.from('photos').insert({
      inspection_id: inspectionId, storage_path: mediaPath, media_type: mediaType,
      is_pass_photo: true, item_key: itemKey, piece_no: pieceNo, comment,
    })
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ color:'var(--pass)', marginBottom:14 }}>✓ {t('passPhoto')}</h2>
        <div className="card" style={{ background:'var(--pass-bg)', marginBottom:14, padding:10 }}>
          <div><b>{t('inspParam')}:</b> {itemLabel}</div>
          <div><b>{t('piece')}:</b> {pieceNo > 0 ? pieceNo : `extra ${-pieceNo}`}</div>
        </div>
        {mediaUrl
          ? <div style={{ marginBottom:10 }}>
              {mediaType === 'video'
                ? <video src={mediaUrl} controls style={{ width:'100%', maxHeight:220, borderRadius:8 }} />
                : <img src={mediaUrl} style={{ width:'100%', maxHeight:220, objectFit:'cover', borderRadius:8 }} />}
            </div>
          : <div style={{ background:'var(--steel)', height:100, borderRadius:8, display:'grid', placeItems:'center', color:'var(--ink-soft)', marginBottom:10 }}>No media yet</div>}
        <MediaCapture label={mediaUrl ? 'Retake' : t('takePhoto')} onUploaded={async (path, type) => { setMediaPath(path); setMediaType(type); const {data}=await supabase.storage.from('qc-photos').createSignedUrl(path,3600); if(data?.signedUrl) setMediaUrl(data.signedUrl) }} />
        <label className="fld" style={{ marginTop:10 }}><span>{t('comment')}</span>
          <textarea className="txt" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
        </label>
        <div className="row" style={{ marginTop:14 }}>
          <button className="btn ok" style={{ flex:1 }} disabled={saving} onClick={save}>
            {saving ? '…' : t('save')}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── REASSIGN MODAL ──────────────────────────────────────────
interface ReassignProps {
  photo: { id: string; item_key: string; piece_no: number; is_pass_photo: boolean; defect_id: string|null }
  allItems: { key: string; label: string }[]
  maxPiece: number
  onDone: () => void; onClose: () => void
}
export function ReassignModal({ photo, allItems, maxPiece, onDone, onClose }: ReassignProps) {
  const { t } = useI18n()
  const [itemKey, setItemKey] = useState(photo.item_key)
  const [pieceNo, setPieceNo] = useState(photo.piece_no)
  const [isPass, setIsPass] = useState(photo.is_pass_photo)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    // Update photo record (return the row so we can detect a silent RLS 0-row update)
    const { data, error } = await supabase.from('photos').update({
      item_key: itemKey, piece_no: pieceNo, is_pass_photo: isPass,
      reassigned_from: { item_key: photo.item_key, piece_no: photo.piece_no },
    }).eq('id', photo.id).select('id')
    if (error) { setSaving(false); alert('Reassign failed: ' + error.message); return }
    if (!data || data.length === 0) {
      setSaving(false)
      alert('Reassignment did not save — the database blocked the update (photos RLS). Run migration 06 in the Supabase SQL Editor, then try again.')
      return
    }
    // If it was linked to a defect and now it's pass, unlink
    if (isPass && photo.defect_id) {
      await supabase.from('photos').update({ defect_id: null }).eq('id', photo.id)
    }
    setSaving(false); onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom:14 }}>🔄 Reassign Photo/Video</h2>
        <div style={{ display:'grid', gap:10 }}>
          <label className="fld"><span>Inspection parameter</span>
            <select className="sel" value={itemKey} onChange={e => setItemKey(e.target.value)}>
              {allItems.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </label>
          <label className="fld"><span>{t('piece')}</span>
            <input className="txt" type="number" min={0} max={maxPiece} value={pieceNo}
              onChange={e => setPieceNo(+e.target.value)} />
          </label>
          <label className="fld"><span>Result</span>
            <select className="sel" value={isPass ? 'pass' : 'fail'} onChange={e => setIsPass(e.target.value === 'pass')}>
              <option value="pass">Pass ✓</option>
              <option value="fail">Fail ✗</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop:16 }}>
          <button className="btn" style={{ flex:1 }} disabled={saving} onClick={save}>
            {saving ? '…' : 'Save reassignment'}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── COPY MODAL ──────────────────────────────────────────────
interface CopyProps {
  inspectionId?: string
  containerLoadingId?: string
  photo: { storage_path: string; media_type?: string; is_pass_photo: boolean; piece_no: number; item_key: string; comment?: string }
  allItems: { key: string; label: string }[]
  onDone: () => void; onClose: () => void
}
export function CopyModal({ inspectionId, containerLoadingId, photo, allItems, onDone, onClose }: CopyProps) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const toggle = (k: string) => setSelected(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })

  const save = async () => {
    if (selected.size === 0) { onClose(); return }
    setSaving(true)
    const rows = [...selected].map(k => ({
      ...(containerLoadingId ? { container_loading_id: containerLoadingId } : { inspection_id: inspectionId }),
      storage_path: photo.storage_path, media_type: photo.media_type || 'photo',
      is_pass_photo: photo.is_pass_photo, item_key: k, piece_no: photo.piece_no, comment: photo.comment || '',
      reassigned_from: { item_key: photo.item_key, piece_no: photo.piece_no, copied: true },
    }))
    const { error } = await supabase.from('photos').insert(rows)
    setSaving(false)
    if (error) { alert('Copy failed: ' + error.message); return }
    onDone()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom:6 }}>⧉ Copy to parameters</h2>
        <p className="muted" style={{ fontSize:13, marginTop:0, marginBottom:12 }}>
          Attach this same {photo.media_type === 'video' ? 'video' : 'photo'} to other inspection parameters
          (e.g. one back-of-wheel shot for every back-marking check). The original stays where it is.
        </p>
        <div style={{ maxHeight:'46vh', overflowY:'auto', display:'grid', gap:4 }}>
          {allItems.filter(i => i.key !== photo.item_key).map(i => {
            const on = selected.has(i.key)
            return (
              <button key={i.key} onClick={() => toggle(i.key)}
                style={{ display:'flex', alignItems:'center', gap:8, textAlign:'left', padding:'9px 10px', borderRadius:8,
                  border:`1.5px solid ${on ? 'var(--navy)' : 'var(--line)'}`, background: on ? 'var(--navy)' : '#fff',
                  color: on ? '#fff' : 'inherit', cursor:'pointer', fontSize:14 }}>
                <span style={{ fontWeight:700 }}>{on ? '☑' : '☐'}</span> {i.label}
              </button>
            )
          })}
        </div>
        <div className="row" style={{ marginTop:16 }}>
          <button className="btn" style={{ flex:1 }} disabled={saving || selected.size === 0} onClick={save}>
            {saving ? '…' : `Copy to ${selected.size} parameter${selected.size === 1 ? '' : 's'}`}
          </button>
          <button className="btn ghost" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

```

### `src/components/PoStatusStrip.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n, type Bi } from '../lib/i18n'
import { computeStages, getOrCreatePoId, type PoStages, type StageResult, type StageUnit } from '../lib/poStatus'
import type { Profile } from '../App'

// The PO command center's status strip: PO Ordered Items ▸ Inspection ▸ Loading,
// each with a live done/total count, followed by a de-emphasised dashed
// "Shipped" cap marking where this QC app's job ends and the separate shipping
// app takes over (until the two systems merge). "Loaded" is not a stage: an
// approved container-loading inspection already means those pieces are loaded.

const NAMES: Record<keyof PoStages, Bi> = {
  items:      { en: 'PO Ordered Items', zh: '订购项目' },
  inspection: { en: 'Inspection',       zh: '检验' },
  loading:    { en: 'Loading',          zh: '装柜' },
}

const STATE_WORD = {
  done:   { en: 'Done',        zh: '完成' } as Bi,
  active: { en: 'In progress', zh: '进行中' } as Bi,
  todo:   { en: 'Not started', zh: '未开始' } as Bi,
}

const UNIT: Record<StageUnit, Bi> = {
  sku:  { en: 'SKUs', zh: 'SKU' },
  pcs:  { en: 'pcs',  zh: '件' },
  none: { en: '',     zh: '' },
}

const NO_ITEMS: Bi = { en: 'No items yet', zh: '暂无项目' }
const SHIPPED: Bi = { en: 'Shipped', zh: '已发货' }
const SHIPPED_NOTE: Bi = { en: 'separate app', zh: '独立系统' }

const ORDER: (keyof PoStages)[] = ['items', 'inspection', 'loading']

export default function PoStatusStrip({ po, profile, refreshKey }: { po: string; profile: Profile; refreshKey?: number }) {
  const { bi } = useI18n()
  const [stages, setStages] = useState<PoStages | null>(null)

  const load = useCallback(async () => {
    const poId = await getOrCreatePoId(po, profile.role === 'admin')
    const linkRes = await supabase.from('inspection_pos').select('inspection_id').eq('po_no', po)
    const inspIds = ((linkRes.data as { inspection_id: string }[]) || []).map(r => r.inspection_id)
    const [itemsRes, inspRes, contRes] = await Promise.all([
      poId
        ? supabase.from('po_items').select('part_no,qty_ordered').eq('po_id', poId)
        : Promise.resolve({ data: [] as { part_no: string; qty_ordered: number }[] }),
      inspIds.length
        ? supabase.from('inspections').select('status,part_no').in('id', inspIds)
        : Promise.resolve({ data: [] as { status: string; part_no: string | null }[] }),
      supabase.from('container_loadings').select('insp_status,data').eq('po_no', po),
    ])
    setStages(computeStages({
      items: (itemsRes.data as { part_no: string; qty_ordered: number }[]) || [],
      insps: (inspRes.data as { status: string; part_no: string | null }[]) || [],
      conts: (contRes.data as { insp_status: string; data: unknown }[]) || [],
    }))
  }, [po, profile.role])

  useEffect(() => { load() }, [load, refreshKey])

  const blank: StageResult = { state: 'todo', done: 0, total: 0, unit: 'none' }
  const view: PoStages = stages || { items: blank, inspection: blank, loading: blank }

  // Subtitle for a stage: the "PO Ordered Items" stage just shows its count;
  // the others show a state word plus a done/total count so progress is clear
  // (e.g. "In progress · 5/6 SKUs", "✓ 600/600 pcs").
  const subtitle = (key: keyof PoStages, s: StageResult): string => {
    const unit = bi(UNIT[s.unit])
    const count = s.total > 0 ? `${s.done}/${s.total} ${unit}` : `${s.done} ${unit}`
    if (key === 'items') return s.total > 0 ? `${s.total} ${unit}` : bi(NO_ITEMS)
    if (s.state === 'todo') return bi(STATE_WORD.todo)
    if (s.state === 'done') return `✓ ${count}`
    return `${bi(STATE_WORD.active)} · ${count}`
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="pstrip">
        {ORDER.map(key => (
          <div key={key} className={`pseg ${view[key].state}`}>
            <span className="pseg-name">{bi(NAMES[key])}</span>
            <span className="pseg-state">{subtitle(key, view[key])}</span>
          </div>
        ))}
        <div className="pseg ext" aria-hidden="true">
          <span className="pseg-name">{bi(SHIPPED)}</span>
          <span className="pseg-state">{bi(SHIPPED_NOTE)}</span>
        </div>
      </div>
    </div>
  )
}

```

### `src/components/RichText.tsx`

```tsx
import { useEffect, useRef } from 'react'

// A tiny, dependency-free rich-text editor (bold / italic / underline / bullet list).
// Stores its value as simple HTML. Uncontrolled internally to keep the caret stable.
// IMPORTANT: focus state is tracked in a ref, NOT React state — focusing must not
// trigger a re-render, or the browser drops the freshly-placed caret and the first
// click into an empty box fails to type (needing a second/third click). This was
// the "can't type until I double-click" bug.
export default function RichText({
  value, onChange, disabled, placeholder,
}: {
  value: string
  onChange: (html: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)

  // Push the parent value into the DOM only when the box is NOT focused, so the
  // caret is never disturbed while typing. Runs on value change only.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!focusedRef.current && el.innerHTML !== (value || '')) el.innerHTML = value || ''
  }, [value])

  const exec = (cmd: string) => {
    if (disabled) return
    const el = ref.current
    if (!el) return
    el.focus()
    document.execCommand(cmd, false)
    onChange(el.innerHTML)
  }

  const isEmpty = !value || value === '<br>' || value.replace(/<[^>]*>/g, '').trim() === ''

  const Btn = ({ cmd, label, style }: { cmd: string; label: string; style?: React.CSSProperties }) => (
    <button type="button" disabled={disabled} title={label}
      onMouseDown={e => { e.preventDefault(); exec(cmd) }}
      style={{
        minWidth: 32, height: 30, border: '1px solid var(--line)', background: '#fff',
        borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontSize: 14, color: 'var(--ink)',
        opacity: disabled ? .5 : 1, ...style,
      }}>{label}</button>
  )

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: disabled ? '#F5F7FA' : '#fff' }}>
      {!disabled && (
        <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid var(--line)', background: '#F8FAFC' }}>
          <Btn cmd="bold" label="B" style={{ fontWeight: 800 }} />
          <Btn cmd="italic" label="I" style={{ fontStyle: 'italic' }} />
          <Btn cmd="underline" label="U" style={{ textDecoration: 'underline' }} />
          <span style={{ width: 1, background: 'var(--line)', margin: '2px 2px' }} />
          <Btn cmd="insertUnorderedList" label="• ⋮" />
          <Btn cmd="insertOrderedList" label="1." />
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <div
          ref={ref}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={e => onChange((e.target as HTMLDivElement).innerHTML)}
          onFocus={() => { focusedRef.current = true }}
          onBlur={e => { focusedRef.current = false; onChange((e.target as HTMLDivElement).innerHTML) }}
          style={{
            minHeight: 96, padding: '10px 12px', outline: 'none', fontSize: 14, lineHeight: 1.5,
            color: 'var(--ink)', whiteSpace: 'pre-wrap',
          }}
        />
        {isEmpty && placeholder && (
          <div style={{ position: 'absolute', top: 10, left: 12, color: 'var(--ink-soft)', pointerEvents: 'none', fontSize: 14 }}>
            {placeholder}
          </div>
        )}
      </div>
    </div>
  )
}

```

### `src/components/SharedPosCard.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '../lib/i18n'
import { posForInspection, posOrderingPart, allPoNos, attachToPo, detachFromPo, type PoLink } from '../lib/inspectionPos'
import type { Profile } from '../App'

// Inspection-side: manage which POs this SKU inspection covers. Eligible POs are
// those that ordered this part number; the off-PO toggle offers all others and
// attaches them with the off_po flag.
export default function SharedPosCard({ inspId, partNo, profile }: {
  inspId: string; partNo: string; profile: Profile
}) {
  const { t } = useI18n()
  const [links, setLinks] = useState<PoLink[]>([])
  const [options, setOptions] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [showOff, setShowOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const cur = await posForInspection(inspId)
    setLinks(cur)
    const linkedNos = cur.map(l => l.po_no)
    const opts = showOff ? await allPoNos(linkedNos) : await posOrderingPart(partNo, linkedNos)
    setOptions(opts)
    setPick('')
  }, [inspId, partNo, showOff])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!pick) return
    setBusy(true); setMsg('')
    // off-PO if the chosen PO does not order this part (only possible via the toggle)
    const eligible = await posOrderingPart(partNo)
    const offPo = !eligible.includes(pick)
    const { error } = await attachToPo(inspId, pick, offPo, profile.id)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    load()
  }

  const remove = async (po: string) => {
    setBusy(true); setMsg('')
    const { error } = await detachFromPo(inspId, po)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    load()
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2 style={{ margin: '0 0 4px' }}>{t('sharedWithPos')}</h2>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>{t('sharedHint')}</p>

      {links.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noPosLinked')}</p>}
      {links.map(l => (
        <div key={l.po_no} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 600 }}>
            {l.po_no}
            {l.off_po && <span className="pill" style={{ marginLeft: 6, background: 'var(--amber-bg)', color: 'var(--amber)' }}>⚠ {t('offPo')}</span>}
          </div>
          <button className="btn ghost" style={{ minHeight: 32, padding: '3px 12px', fontSize: 13 }} disabled={busy} onClick={() => remove(l.po_no)}>{t('remove')}</button>
        </div>
      ))}

      <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
        <select className="txt" value={pick} onChange={e => setPick(e.target.value)} style={{ flex: 1, minHeight: 40 }}>
          <option value="">{t('addToPo')}…</option>
          {options.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn" style={{ minHeight: 40, padding: '4px 16px' }} disabled={!pick || busy} onClick={add}>＋</button>
      </div>
      <label className="row" style={{ gap: 8, fontSize: 13, marginTop: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} style={{ width: 18, height: 18 }} />
        {t('showOffPo')}
      </label>
      {msg && <p style={{ color: 'var(--fail)', fontSize: 13 }}>{msg}</p>}
    </div>
  )
}

```


---

## 9d. src/pages

### `src/pages/AdminDashboard.tsx`

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// B3 — Admin dashboard: answers "what needs me?" at a glance.
// Card 1: everything awaiting approval (the money card), direct links in.
// Card 2: PO snapshot. Card 3: recently approved. Card 4: quick actions.

interface Pending { kind: 'inspection' | 'container'; id: string; label: string; po: string; at: string | null }
interface Recent extends Pending { disposition?: string }

const fmt = (dt: string | null) => dt ? new Date(dt).toLocaleDateString() + ' ' + new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

export default function AdminDashboard() {
  const [pending, setPending] = useState<Pending[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const [poCount, setPoCount] = useState<number | null>(null)
  const [openDrafts, setOpenDrafts] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      const [pi, pc, ri, rc, pos, di, dc] = await Promise.all([
        supabase.from('inspections').select('id,part_no,po_no,submitted_at').eq('status', 'submitted').order('submitted_at'),
        supabase.from('container_loadings').select('id,container_no,po_no,submitted_at').eq('insp_status', 'submitted').order('submitted_at'),
        supabase.from('inspections').select('id,part_no,po_no,updated_at').eq('status', 'approved').order('updated_at', { ascending: false }).limit(5),
        supabase.from('container_loadings').select('id,container_no,po_no,updated_at').eq('insp_status', 'approved').order('updated_at', { ascending: false }).limit(5),
        supabase.from('pos').select('id', { count: 'exact', head: true }),
        supabase.from('inspections').select('id', { count: 'exact', head: true }).in('status', ['draft', 'rejected']),
        supabase.from('container_loadings').select('id', { count: 'exact', head: true }).in('insp_status', ['draft', 'rejected']),
      ])
      const p: Pending[] = []
      for (const r of (pi.data as any[]) || []) p.push({ kind: 'inspection', id: r.id, label: r.part_no || '(no part no.)', po: r.po_no || '', at: r.submitted_at })
      for (const r of (pc.data as any[]) || []) p.push({ kind: 'container', id: r.id, label: r.container_no || '(no container no.)', po: r.po_no || '', at: r.submitted_at })
      p.sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      setPending(p)
      const rec: Recent[] = []
      for (const r of (ri.data as any[]) || []) rec.push({ kind: 'inspection', id: r.id, label: r.part_no || '', po: r.po_no || '', at: r.updated_at })
      for (const r of (rc.data as any[]) || []) rec.push({ kind: 'container', id: r.id, label: r.container_no || '', po: r.po_no || '', at: r.updated_at })
      rec.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
      setRecent(rec.slice(0, 5))
      setPoCount(pos.count ?? 0)
      setOpenDrafts((di.count ?? 0) + (dc.count ?? 0))
      setLoaded(true)
    })()
  }, [])

  const itemRow = (x: Pending, showLink = true) => (
    <Link key={x.kind + x.id} to={x.kind === 'inspection' ? `/inspection/${x.id}` : `/container/${x.id}`}
      style={{ textDecoration: showLink ? 'none' : undefined, color: 'inherit' }}>
      <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>{x.kind === 'inspection' ? '🛞' : '📦'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{x.label} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· PO {x.po || '—'}</span></div>
          <div className="muted" style={{ fontSize: 12 }}>{fmt(x.at)}</div>
        </div>
        <span style={{ color: 'var(--navy)' }}>›</span>
      </div>
    </Link>
  )

  return (
    <div className="page">
      <div className="card" style={{ border: pending.length ? '1.5px solid var(--amber, #B7791F)' : undefined }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Awaiting your approval {loaded ? `(${pending.length})` : ''}</h2>
          <Link to="/approvals"><button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}>Open Approvals</button></Link>
        </div>
        {loaded && pending.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>Nothing waiting — all caught up. ✓</p>}
        {pending.slice(0, 6).map(x => itemRow(x))}
        {pending.length > 6 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>+ {pending.length - 6} more in Approvals</p>}
      </div>

      <div className="row" style={{ gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
        <Link to="/" style={{ flex: 1, minWidth: 200, textDecoration: 'none', color: 'inherit' }}>
          <div className="card" style={{ cursor: 'pointer' }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>PURCHASE ORDERS</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--navy)' }}>{poCount ?? '…'}</div>
            <div className="muted" style={{ fontSize: 12 }}>open the PO list ›</div>
          </div>
        </Link>
        <div className="card" style={{ flex: 1, minWidth: 200 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>WORK IN PROGRESS</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--navy)' }}>{openDrafts ?? '…'}</div>
          <div className="muted" style={{ fontSize: 12 }}>draft or returned items across all inspectors</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>Recently approved</h2>
        {loaded && recent.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>Nothing approved yet.</p>}
        {recent.map(x => itemRow(x))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>Quick actions</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to="/"><button className="btn">＋ New PO</button></Link>
          <Link to="/users"><button className="btn ghost">＋ Add user</button></Link>
          <Link to="/skus"><button className="btn ghost">Manage SKUs</button></Link>
        </div>
      </div>
    </div>
  )
}

```

### `src/pages/Approvals.tsx`

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import EmailModal from '../components/EmailModal'
import { useI18n } from '../lib/i18n'
import { openInspectionReport } from '../lib/report'

interface Row { id: string; part_no: string; po_no: string; lot_size: number; status: string; submitted_at: string; inspector_id: string }
interface CRow { id: string; po_no: string; container_no: string; seal_no: string; status: string; inspector_id: string }

export default function Approvals() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [crows, setCrows] = useState<CRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [cnote, setCnote] = useState<Record<string, string>>({})

  const load = async () => {
    const { data } = await supabase.from('inspections').select('*').eq('status', 'submitted').order('submitted_at')
    setRows((data as Row[]) || [])
    const { data: cd } = await supabase.from('container_loadings').select('id,po_no,container_no,seal_no,status,inspector_id').eq('insp_status', 'submitted').order('submitted_at')
    setCrows((cd as CRow[]) || [])
    const { data: ps } = await supabase.from('profiles').select('id, full_name')
    setNames(Object.fromEntries((ps || []).map(p => [p.id, p.full_name])))
  }
  useEffect(() => { load() }, [])

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('inspections').update({
      status, reviewed_at: new Date().toISOString(), reviewed_by: user?.id, review_note: note[id] || '',
    }).eq('id', id)
    if (status === 'approved') {
      // fire the report email (edge function); non-blocking
      supabase.functions.invoke('send-report', { body: { inspection_id: id } }).catch(() => {})
    }
    load()
  }

  const decideCont = async (id: string, status: 'approved' | 'rejected') => {
    if (!confirm(status === 'approved' ? 'Approve this container loading?' : 'Reject and send back to the inspector?')) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('container_loadings').update({
      insp_status: status, reviewed_at: new Date().toISOString(), reviewed_by: user?.id, review_note: cnote[id] || '',
    }).eq('id', id)
    load()
  }

  const [emailFor, setEmailFor] = useState<{ kind: 'container' | 'inspection'; id: string } | null>(null)
  const [emailBusy, setEmailBusy] = useState(false)
  const emailContReport = (id: string) => setEmailFor({ kind: 'container', id })
  const emailInteractiveReport = (id: string) => setEmailFor({ kind: 'inspection', id })
  const doEmail = async (emails: string[]) => {
    if (!emailFor) return
    setEmailBusy(true)
    const fn = emailFor.kind === 'container' ? 'send-container-report' : 'send-report'
    const body = emailFor.kind === 'container' ? { container_loading_id: emailFor.id, emails } : { inspection_id: emailFor.id, emails }
    const { data, error } = await supabase.functions.invoke(fn, { body })
    setEmailBusy(false)
    if (error || data?.ok === false) { alert('Email failed: ' + (error?.message || data?.error || 'Unknown error')); return }
    setEmailFor(null)
    alert(emailFor.kind === 'container' ? 'Container report email sent.' : 'Interactive report email sent.')
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{t('approvals')}</h2>
        {rows.length === 0 && <p className="muted">—</p>}
        {rows.map(r => (
          <div key={r.id} className="card" style={{ background: '#F7F9FB' }}>
            <div className="row">
              <Link to={`/inspection/${r.id}`} style={{ fontWeight: 700, fontSize: 18 }}>{r.part_no}</Link>
              <span className="muted">PO {r.po_no} · lot {r.lot_size} · {names[r.inspector_id] || ''}</span>
            </div>
            <input className="txt" placeholder="Review note…" style={{ margin: '10px 0' }}
              value={note[r.id] || ''} onChange={e => setNote({ ...note, [r.id]: e.target.value })} />
            <div className="row">
              <button className="btn ok" onClick={() => decide(r.id, 'approved')}>{t('approve')}</button>
              <button className="btn danger" onClick={() => decide(r.id, 'rejected')}>{t('reject')}</button>
              <button className="btn ghost" onClick={() => openInspectionReport(r.id, lang)}>{t('pdfReport')}</button>
              <button className="btn ghost" onClick={() => emailInteractiveReport(r.id)}>Email Interactive Report</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Container loadings — sign-off</h2>
        {crows.length === 0 && <p className="muted">—</p>}
        {crows.map(c => (
          <div key={c.id} className="card" style={{ background: '#F7F9FB' }}>
            <div className="row">
              <Link to={`/container/${c.id}`} style={{ fontWeight: 700, fontSize: 18 }}>{c.container_no || '(no container no.)'}</Link>
              <span className="muted">PO {c.po_no || '—'} · seal {c.seal_no || '—'} · {names[c.inspector_id] || ''}</span>
            </div>
            <input className="txt" placeholder="Review note…" style={{ margin: '10px 0' }}
              value={cnote[c.id] || ''} onChange={e => setCnote({ ...cnote, [c.id]: e.target.value })} />
            <div className="row">
              <button className="btn ok" onClick={() => decideCont(c.id, 'approved')}>{t('approve')}</button>
              <button className="btn danger" onClick={() => decideCont(c.id, 'rejected')}>{t('reject')}</button>
              <button className="btn ghost" onClick={() => emailContReport(c.id)}>Email Container Report</button>
            </div>
          </div>
        ))}
      </div>
      {emailFor && <EmailModal title="Email report" allowBlank sending={emailBusy}
        onSend={doEmail} onClose={() => setEmailFor(null)} />}
    </div>
  )
}

```

### `src/pages/ContainerLoading.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { PALLET_PACKING_ITEMS, CONTAINER_PHOTO_ITEMS } from '../lib/standard'
import { MediaCapture, MediaThumb, ReassignModal, CopyModal } from '../components/PhotoModal'
import { openContainerReport } from '../lib/report'
import type { Profile } from '../App'
import PartPicker from '../components/PartPicker'
import EmailModal from '../components/EmailModal'
import { saveLocalDraft, getLocalDraft, clearLocalDraft } from '../lib/localDraft'

type PFNA = 'P' | 'F' | 'NA' | undefined
interface Content { part_no: string; qty: number; off_po?: boolean }
interface LabelScan { raw_text: string; part_no: string | null; qty: number | null; pallet_no: string | null; at: string; by: string }
interface PalletData { contents: Content[]; checks: Record<string, PFNA>; label_scan?: LabelScan }
interface CLData { loading_type?: 'pallet' | 'non_pallet'; pallet_count?: number; pallets?: Record<string, PalletData>; non_pallet_contents?: Content[]; date_loaded?: string; etd?: string; eta?: string; bl_no?: string; dest_port?: string; dep_port?: string }
interface CL {
  id: string; po_no: string; container_no: string; seal_no: string
  status: string; insp_status: string; inspector_id: string
  data: CLData; summary: { disposition?: string; corrective_action?: string }; review_note: string; report_logo_path?: string
}
interface Photo { id: string; storage_path: string; media_type: string; item_key: string; piece_no: number; is_pass_photo: boolean }

export default function ContainerLoading({ profile }: { profile: Profile }) {
  const { id } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { bi, t } = useI18n()
  const [cl, setCl] = useState<CL | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [skuList, setSkuList] = useState<string[]>([])
  const [poParts, setPoParts] = useState<Set<string> | null>(null)
  const [poQty, setPoQty] = useState<Map<string, number>>(new Map())
  const [scan, setScan] = useState<{ pallet: number; busy: boolean; fields?: { part_no: string; qty: string; pallet_no: string }; raw?: string; warn?: string[]; err?: string } | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [capture, setCapture] = useState<{ itemKey: string; pieceNo: number; isPass: boolean } | null>(null)
  const [history, setHistory] = useState<{ palletNo: number; prevChecks: Record<string, PFNA> }[]>([])
  const [activePallet, setActivePallet] = useState(1)
  const [reviewNote, setReviewNote] = useState('')
  const [err, setErr] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [photoModal, setPhotoModal] = useState<{ type: 'reassign' | 'copy'; photo: Photo } | null>(null)
  const [restore, setRestore] = useState<{ data?: unknown; container_no?: unknown; seal_no?: unknown; status?: unknown; summary?: unknown } | null>(null)

  useEffect(() => {
    const path = cl?.report_logo_path
    if (!path) { setLogoUrl(''); return }
    supabase.storage.from('qc-photos').createSignedUrl(path, 3600).then(({ data }) => setLogoUrl(data?.signedUrl || ''))
  }, [cl?.report_logo_path])

  const loadPhotos = useCallback(async (clId: string) => {
    const { data } = await supabase.from('photos').select('*').eq('container_loading_id', clId).order('created_at')
    const ph = (data || []) as Photo[]
    setPhotos(ph)
    const paths = [...new Set(ph.map(p => p.storage_path))]
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('qc-photos').createSignedUrls(paths, 60 * 60 * 6)
      const m: Record<string, string> = {}
      for (const s of signed || []) if (s.path && s.signedUrl) m[s.path] = s.signedUrl
      setUrls(prev => ({ ...prev, ...m }))
    }
  }, [])

  // Ordered items for this CL's PO — powers the ON-PO badge, off-PO warning,
  // and the qty-vs-remaining check in the label scan review.
  const loadPoItems = async (poNo: string) => {
    if (!poNo || !poNo.trim()) { setPoParts(null); setPoQty(new Map()); return }
    const { data: po } = await supabase.from('pos').select('id').eq('po_no', poNo).maybeSingle()
    if (!po) { setPoParts(null); setPoQty(new Map()); return }
    const { data: items } = await supabase.from('po_items').select('part_no,qty_ordered').eq('po_id', po.id)
    const list = (items as { part_no: string; qty_ordered: number }[]) || []
    setPoParts(list.length ? new Set(list.map(i => i.part_no)) : null)
    setPoQty(new Map(list.map(i => [i.part_no, i.qty_ordered])))
  }

  // ---- Sticky progress bar (QW-2) ----
  const checksDone = (n: number) => PALLET_PACKING_ITEMS.filter(it => palletOf(n).checks[it.key] !== undefined).length
  const palletComplete = (n: number) => checksDone(n) === PALLET_PACKING_ITEMS.length
  const jumpNextCheck = () => {
    const missing = PALLET_PACKING_ITEMS.find(it => palletOf(activePallet).checks[it.key] === undefined)
    if (missing) { document.getElementById(`chk-${missing.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
    const count = cl?.data.pallet_count ?? 0
    const next = Array.from({ length: count }, (_, i) => i + 1).find(pn => pn !== activePallet && !palletComplete(pn))
    if (next) { setActivePallet(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }

  useEffect(() => {
    (async () => {
      const { data: skus } = await supabase.from('skus').select('part_no').eq('active', true).order('part_no')
      setSkuList((skus || []).map((s: { part_no: string }) => s.part_no))
      if (id === 'new') {
        const { data, error } = await supabase.from('container_loadings').insert({ inspector_id: profile.id, po_no: params.get('po') || '' }).select('id').single()
        if (error) { setErr(error.message); return }
        if (data) nav(`/container/${data.id}`, { replace: true })
        return
      }
      const { data, error } = await supabase.from('container_loadings').select('*').eq('id', id).single()
      if (error) { setErr(error.message); return }
      const draft = await getLocalDraft('container', id!)
      setCl(data as CL)
      await loadPhotos(id!)
      loadPoItems((data as CL).po_no)
      if (draft) {
        const c = data as CL
        const serverContent = JSON.stringify({ data: c.data, container_no: c.container_no, seal_no: c.seal_no, status: c.status, summary: c.summary })
        if (JSON.stringify(draft.data) !== serverContent) setRestore(draft.data as { data?: unknown; container_no?: unknown; seal_no?: unknown; status?: unknown; summary?: unknown })
        else await clearLocalDraft('container', id!)
      }
    })()
  }, [id, profile.id, nav, loadPhotos])

  // B6 Stage 1 — mirror the open container loading to this device on every change.
  useEffect(() => {
    if (!cl?.id) return
    saveLocalDraft('container', cl.id, { data: cl.data, container_no: cl.container_no, seal_no: cl.seal_no, status: cl.status, summary: cl.summary }, (cl as { updated_at?: string }).updated_at ?? null)
  }, [cl])

  const applyRestore = async () => {
    if (!cl || !restore) return
    const r = restore
    const next = {
      ...cl,
      data: (r.data as CL['data']) ?? cl.data,
      container_no: (r.container_no as string) ?? cl.container_no,
      seal_no: (r.seal_no as string) ?? cl.seal_no,
      status: (r.status as string) ?? cl.status,
      summary: (r.summary as CL['summary']) ?? cl.summary,
    }
    setCl(next)
    setRestore(null)
    try {
      await supabase.from('container_loadings').update({ data: next.data, container_no: next.container_no, seal_no: next.seal_no, status: next.status, summary: next.summary, updated_at: new Date().toISOString() }).eq('id', cl.id)
    } catch { /* remains in the local draft until the next successful save */ }
  }
  const discardRestore = async () => { if (cl) await clearLocalDraft('container', cl.id); setRestore(null) }

  if (err) return <div className="page" style={{ paddingTop: 24 }}><p style={{ color: 'var(--fail)' }}>Error: {err}</p></div>
  if (!cl) return <div className="page" style={{ paddingTop: 24 }}><p className="muted">Loading…</p></div>

  const editable = ['draft', 'rejected'].includes(cl.insp_status) || profile.role === 'admin'
  const loadingType = cl.data.loading_type || 'pallet'
  const palletCount = cl.data.pallet_count ?? 0
  const pallets = Array.from({ length: palletCount }, (_, i) => i + 1)
  const curPallet = Math.min(Math.max(activePallet, 1), palletCount || 1)

  const allItemsForReassign = [
    { key: 'container_no_photo', label: 'Container number' },
    { key: 'seal_no_photo', label: 'Seal number' },
    ...CONTAINER_PHOTO_ITEMS.map(i => ({ key: i.key, label: bi(i.label) })),
    { key: 'pallet_label', label: 'Pallet label' },
    ...PALLET_PACKING_ITEMS.map(i => ({ key: i.key, label: bi(i.label) })),
  ]

  const patch = async (fields: Partial<CL>) => {
    const next = { ...cl, ...fields }; setCl(next)
    await supabase.from('container_loadings').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', cl.id)
  }
  const setData = (d: CLData) => patch({ data: d })

  const palletOf = (n: number): PalletData => cl.data.pallets?.[n] || { contents: [], checks: {} }
  const snapshot = (n: number) => setHistory(h => [...h, { palletNo: n, prevChecks: { ...palletOf(n).checks } }])

  const setPalletCheck = (n: number, key: string, v: PFNA) => {
    snapshot(n)
    const pallets = { ...(cl.data.pallets || {}) }; const pd = palletOf(n)
    const checks = { ...pd.checks }; if (checks[key] === v) delete checks[key]; else checks[key] = v
    pallets[n] = { ...pd, checks }; setData({ ...cl.data, pallets })
  }
  const setAllPallet = (n: number, v: PFNA) => {
    snapshot(n)
    const pallets = { ...(cl.data.pallets || {}) }; const pd = palletOf(n)
    const checks = { ...pd.checks }; for (const it of PALLET_PACKING_ITEMS) checks[it.key] = v
    pallets[n] = { ...pd, checks }; setData({ ...cl.data, pallets })
  }
  const undoPallet = (n: number) => {
    let idx = -1; for (let i = history.length - 1; i >= 0; i--) if (history[i].palletNo === n) { idx = i; break }
    if (idx < 0) return
    const entry = history[idx]; setHistory(h => h.filter((_, i) => i !== idx))
    const pallets = { ...(cl.data.pallets || {}) }; pallets[n] = { ...palletOf(n), checks: entry.prevChecks }
    setData({ ...cl.data, pallets })
  }
  const updateContents = (n: number, contents: Content[]) => {
    const pallets = { ...(cl.data.pallets || {}) }; pallets[n] = { ...palletOf(n), contents }
    setData({ ...cl.data, pallets })
  }

  const insertPhoto = async (itemKey: string, pieceNo: number, isPass: boolean, path: string, type: 'photo' | 'video') => {
    const { error } = await supabase.from('photos').insert({
      container_loading_id: cl.id, storage_path: path, media_type: type, item_key: itemKey, piece_no: pieceNo, is_pass_photo: isPass, comment: '',
    }).select('id')
    if (error) { alert('Could not save photo: ' + error.message + '\n\nIf this mentions a missing column or policy, run migration 07 in the Supabase SQL Editor.'); return false }
    return true
  }
  // AI label scan: runs OCR on a just-uploaded pallet-label photo, then shows
  // an editable review with PO comparison warnings. Nothing saves until the
  // inspector confirms.
  const runScan = async (palletNo: number, path: string) => {
    setScan({ pallet: palletNo, busy: true })
    const { data, error } = await supabase.functions.invoke('ocr-label', { body: { path } })
    if (error || !data?.ok) {
      let msg = error?.message || data?.error || 'Scan failed.'
      try { const ctx = (error as { context?: Response } | null)?.context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error } } catch { /* ignore */ }
      setScan({ pallet: palletNo, busy: false, err: msg })
      return
    }
    const f = data.fields || {}
    const warn: string[] = []
    if (!f.part_no) warn.push('Part number could not be read — enter it manually below.')
    if (f.part_no && poParts && poParts.size > 0 && !poParts.has(f.part_no)) warn.push(`${f.part_no} is not listed on PO ${cl?.po_no}.`)
    if (f.part_no && f.qty && poQty.has(f.part_no)) {
      const ordered = poQty.get(f.part_no) || 0
      const already = loadedSoFar(f.part_no)
      if (already + f.qty > ordered) warn.push(`Quantity check: ${already} already recorded + ${f.qty} on this label exceeds ${ordered} ordered.`)
    }
    setScan({ pallet: palletNo, busy: false, raw: data.raw_text || '',
      warn, fields: { part_no: f.part_no || '', qty: f.qty ? String(f.qty) : '', pallet_no: f.pallet_no || '' } })
  }
  // Loaded so far for a part, across THIS container's saved contents.
  const loadedSoFar = (part: string) => {
    let sum = 0
    for (const pd of Object.values(cl?.data.pallets || {})) for (const c of (pd.contents || [])) if (c.part_no === part) sum += c.qty || 0
    for (const c of (cl?.data.non_pallet_contents || [])) if (c.part_no === part) sum += c.qty || 0
    return sum
  }
  const confirmScan = () => {
    if (!scan?.fields || !cl) return
    const part = scan.fields.part_no.trim()
    const qty = parseInt(scan.fields.qty, 10)
    if (!part) { alert('Enter the part number before confirming.'); return }
    if (!Number.isFinite(qty) || qty <= 0) { alert('Enter a valid quantity.'); return }
    const offPo = !!(poParts && poParts.size > 0 && !poParts.has(part))
    const n = scan.pallet
    const pd = palletOf(n)
    const pallets = { ...(cl.data.pallets || {}) }
    pallets[n] = {
      ...pd,
      contents: [...(pd.contents || []).filter(c => c.part_no), { part_no: part, qty, off_po: offPo || undefined }],
      label_scan: { raw_text: scan.raw || '', part_no: part, qty, pallet_no: scan.fields.pallet_no || null, at: new Date().toISOString(), by: profile.full_name },
    }
    setData({ ...cl.data, pallets })
    setScan(null)
  }

  const onCaptured = async (path: string, type: 'photo' | 'video') => {
    if (!capture) return
    const ok = await insertPhoto(capture.itemKey, capture.pieceNo, capture.isPass, path, type)
    setCapture(null); if (ok) loadPhotos(cl.id)
  }
  const deletePhoto = async (p: Photo) => {
    if (!confirm('Delete this photo/video?')) return
    const { data, error } = await supabase.from('photos').delete().eq('id', p.id).select('id')
    if (error) { alert('Delete failed: ' + error.message); return }
    if (!data?.length) { alert('Delete blocked by database (run migration 06/07).'); return }
    loadPhotos(cl.id)
  }
  const photosFor = (itemKey: string, pieceNo: number) => photos.filter(p => p.item_key === itemKey && p.piece_no === pieceNo)

  const PhotoStrip = ({ itemKey, pieceNo }: { itemKey: string; pieceNo: number }) => {
    const ph = photosFor(itemKey, pieceNo); if (!ph.length) return null
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {ph.map(p => (
          <div key={p.id} style={{ position: 'relative' }}>
            <MediaThumb type={p.media_type} url={urls[p.storage_path] || ''} onClick={() => urls[p.storage_path] && window.open(urls[p.storage_path], '_blank')} />
            {editable && (
              <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 3 }}>
                <button onClick={() => setPhotoModal({ type: 'reassign', photo: p })} title="Reassign to another parameter" style={{ background: 'rgba(31,58,95,.92)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, padding: '1px 5px', cursor: 'pointer' }}>↻</button>
                <button onClick={() => setPhotoModal({ type: 'copy', photo: p })} title="Copy to other parameters" style={{ background: 'rgba(31,58,95,.92)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, padding: '1px 5px', cursor: 'pointer' }}>⧉</button>
                <button onClick={() => deletePhoto(p)} title="Delete" style={{ background: 'rgba(204,17,34,.9)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, padding: '1px 5px', cursor: 'pointer' }}>🗑</button>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }
  const CamBtn = ({ itemKey, pieceNo, isPass = true, label = '📷 +' }: { itemKey: string; pieceNo: number; isPass?: boolean; label?: string }) =>
    editable ? <button className="btn ghost" style={{ minHeight: 38, padding: '4px 14px', fontSize: 13 }} onClick={() => setCapture({ itemKey, pieceNo, isPass })}>{label}</button> : null

  // Loaded contents per pallet
  const palletContents = pallets.map(n => ({ n, contents: (palletOf(n).contents || []).filter(c => c.part_no) })).filter(x => x.contents.length)

  const submit = async () => {
    if (!cl.container_no.trim()) { alert('Container number is required before submitting.'); return }
    const missingPhotos: string[] = []
    for (const item of CONTAINER_PHOTO_ITEMS) if (photosFor(item.key, 0).length === 0) missingPhotos.push(bi(item.label))
    if (loadingType === 'pallet') for (const n of pallets) if (photosFor('pallet_label', n).length === 0) missingPhotos.push(`Pallet ${n} — label`)
    if (missingPhotos.length) {
      const ok = confirm(`The following inspection items have no photo attached:\n\n• ${missingPhotos.join('\n• ')}\n\nDo you want to submit for approval anyway, without these photos?`)
      if (!ok) return
    }
    await patch({ insp_status: 'submitted' })
    await supabase.from('container_loadings').update({ submitted_at: new Date().toISOString(), inspector_id: profile.id }).eq('id', cl.id)
    await clearLocalDraft('container', cl.id)
    alert('Submitted for approval.')
  }

  const decide = async (status: 'approved' | 'rejected') => {
    if (!confirm(status === 'approved' ? 'Approve this container loading?' : 'Reject and send back to the inspector?')) return
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('container_loadings').update({
      insp_status: status, reviewed_at: new Date().toISOString(), reviewed_by: user?.id, review_note: reviewNote,
    }).eq('id', cl.id)
    if (error) { alert('Sign-off failed: ' + error.message); return }
    setCl({ ...cl, insp_status: status, review_note: reviewNote })
    alert(status === 'approved' ? 'Approved. Use “Email container report” to send it when ready.' : 'Rejected and sent back to the inspector.')
  }

  const emailReport = () => setEmailOpen(true)
  const doEmail = async (emails: string[]) => {
    setEmailBusy(true)
    const { data, error } = await supabase.functions.invoke('send-container-report', { body: { container_loading_id: cl.id, emails } })
    setEmailBusy(false)
    if (error || data?.ok === false) { alert('Email failed: ' + (error?.message || data?.error || 'Unknown error')); return }
    setEmailOpen(false)
    alert('Container report email sent.')
  }

  const removeLogoBackground = (file: File): Promise<Blob> => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight
      const ctx = cv.getContext('2d'); if (!ctx) { reject(new Error('no canvas')); return }
      ctx.drawImage(img, 0, 0)
      const imgData = ctx.getImageData(0, 0, cv.width, cv.height); const px = imgData.data
      const corners = [[0, 0], [cv.width - 1, 0], [0, cv.height - 1], [cv.width - 1, cv.height - 1]].map(([x, y]) => { const i = (y * cv.width + x) * 4; return [px[i], px[i + 1], px[i + 2]] })
      const bg = [0, 1, 2].map(c => Math.round(corners.reduce((s, k) => s + k[c], 0) / corners.length)); const tol = 70
      for (let i = 0; i < px.length; i += 4) { const dd = Math.sqrt((px[i] - bg[0]) ** 2 + (px[i + 1] - bg[1]) ** 2 + (px[i + 2] - bg[2]) ** 2); if (dd < tol) px[i + 3] = 0 }
      ctx.putImageData(imgData, 0, 0); cv.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    }
    img.onerror = () => reject(new Error('image load failed')); img.src = URL.createObjectURL(file)
  })
  const uploadLogo = async (file: File, cutBg = false) => {
    let body: Blob = file; let ext = (file.name.split('.').pop() || 'png').toLowerCase(); let contentType = file.type || 'image/png'
    if (cutBg) { try { body = await removeLogoBackground(file); ext = 'png'; contentType = 'image/png' } catch { alert('Could not remove the background; uploading the original instead.') } }
    const path = `logos/cl-${cl.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('qc-photos').upload(path, body, { upsert: true, contentType })
    if (upErr) { alert('Logo upload failed: ' + upErr.message); return }
    await patch({ report_logo_path: path }); alert('Report logo updated.')
  }
  const clearLogo = async () => { await patch({ report_logo_path: '' }); alert('Report logo reset.') }
  const openReport = () => window.open(`/container-report/${cl.id}`, '_blank')
  const openPdf = () => openContainerReport(cl.id)

  return (
    <div className="page" style={{ paddingTop: 16, paddingBottom: editable ? 84 : undefined }}>
      {restore && (
        <div className="card" style={{ borderColor: 'var(--amber)', background: 'var(--amber-bg)', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('restoreTitle')}</div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{t('restoreBody')}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={applyRestore}>{t('restoreBtn')}</button>
            <button className="btn ghost" onClick={discardRestore}>{t('restoreDiscard')}</button>
          </div>
        </div>
      )}
      <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, marginBottom: 12 }} onClick={() => nav(-1)}>← Back</button>

      {(profile.role === 'admin' || cl.insp_status === 'approved') && (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ flex: 1, marginBottom: 0 }}>Container Loading Inspection</h2>
            <button className="btn ghost" style={{ minHeight: 40, padding: '6px 14px' }} onClick={openPdf}>PDF Report</button>
            <button className="btn ghost" style={{ minHeight: 40, padding: '6px 14px' }} onClick={openReport}>View Interactive Report</button>
            <button className="btn" style={{ minHeight: 40, padding: '6px 14px' }} onClick={emailReport}>Email Interactive Report</button>
          </div>
          {profile.role === 'admin' && (
            <>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <label className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, cursor: 'pointer' }}>
                  🖼 {cl.report_logo_path ? 'Change report logo' : 'Set report logo'}
                  <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); (e.target as HTMLInputElement).value = '' }} />
                </label>
                <label className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, cursor: 'pointer' }} title="Uploads the logo with its solid background made transparent, so it blends onto the navy report header">
                  🪄 Logo · cut out background
                  <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f, true); (e.target as HTMLInputElement).value = '' }} />
                </label>
                {cl.report_logo_path && <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13 }} onClick={clearLogo}>Reset logo</button>}
              </div>
              {logoUrl && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Report logo (shown on the report instead of NITRA):</div>
                  <div style={{ display: 'inline-block', background: 'var(--navy)', borderRadius: 8, padding: '8px 14px' }}>
                    <img src={logoUrl} alt="report logo" style={{ height: 40, maxWidth: 220, objectFit: 'contain', display: 'block' }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>Container Details</h2>
        <div className="grid2">
          <label className="fld"><span>PO number</span>
            <input className="txt" disabled={!editable} value={cl.po_no}
              onChange={e => patch({ po_no: e.target.value })}
              onBlur={e => loadPoItems(e.target.value)} /></label>
          <label className="fld"><span>Status</span>
            <select className="sel" disabled={!editable} value={cl.status} onChange={e => patch({ status: e.target.value })}>
              <option value="in_progress">In progress</option><option value="loaded">Loaded</option><option value="hold">Hold</option>
            </select></label>
          <label className="fld"><span>Loading type</span>
            <select className="sel" disabled={!editable} value={loadingType} onChange={e => setData({ ...cl.data, loading_type: e.target.value as 'pallet' | 'non_pallet' })}>
              <option value="pallet">Pallet</option><option value="non_pallet">Non-pallet</option>
            </select></label>
          <div />
          <div>
            <label className="fld"><span>Container number</span>
              <input className="txt" disabled={!editable} value={cl.container_no} onChange={e => patch({ container_no: e.target.value })} /></label>
            <div style={{ marginTop: 6 }}><CamBtn itemKey="container_no_photo" pieceNo={0} label="📷 Photo of container no." /><PhotoStrip itemKey="container_no_photo" pieceNo={0} /></div>
          </div>
          <div>
            <label className="fld"><span>Seal number</span>
              <input className="txt" disabled={!editable} value={cl.seal_no} onChange={e => patch({ seal_no: e.target.value })} /></label>
            <div style={{ marginTop: 6 }}><CamBtn itemKey="seal_no_photo" pieceNo={0} label="📷 Photo of seal no." /><PhotoStrip itemKey="seal_no_photo" pieceNo={0} /></div>
          </div>
        </div>
        {palletContents.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <b>Loaded contents:</b>
            {palletContents.map(x => (
              <div key={x.n} style={{ marginTop: 2 }}>Pallet {x.n}: {x.contents.map(c => `${c.part_no} × ${c.qty}`).join(', ')}</div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Shipping Details</h2>
        <div className="grid2">
          <label className="fld"><span>Date Loaded</span>
            <input className="txt" type="date" disabled={!editable} value={cl.data.date_loaded || ''} onChange={e => setData({ ...cl.data, date_loaded: e.target.value })} /></label>
          <label className="fld"><span>BL Number</span>
            <input className="txt" disabled={!editable} value={cl.data.bl_no || ''} onChange={e => setData({ ...cl.data, bl_no: e.target.value })} /></label>
          <label className="fld"><span>Estimated Port Departure Date</span>
            <input className="txt" type="date" disabled={!editable} value={cl.data.etd || ''} onChange={e => setData({ ...cl.data, etd: e.target.value })} /></label>
          <label className="fld"><span>Estimated Port Arrival Date</span>
            <input className="txt" type="date" disabled={!editable} value={cl.data.eta || ''} onChange={e => setData({ ...cl.data, eta: e.target.value })} /></label>
          <label className="fld"><span>Departure Port</span>
            <input className="txt" disabled={!editable} value={cl.data.dep_port || ''} onChange={e => setData({ ...cl.data, dep_port: e.target.value })} /></label>
          <label className="fld"><span>Destination Port</span>
            <input className="txt" disabled={!editable} value={cl.data.dest_port || ''} onChange={e => setData({ ...cl.data, dest_port: e.target.value })} /></label>
        </div>
      </div>

      <datalist id="cl-skus">{skuList.map(s => <option key={s} value={s} />)}</datalist>

      {loadingType === 'non_pallet' && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>SKUs Loaded: Non-Pallet Loading</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Add each part number loaded into the container and the quantity.</p>
          {(cl.data.non_pallet_contents || []).map((c, ci) => {
            const set = (contents: Content[]) => setData({ ...cl.data, non_pallet_contents: contents })
            const arr = cl.data.non_pallet_contents || []
            return (
              <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <PartPicker value={c.part_no} disabled={!editable} poParts={poParts}
                  onChange={(part, offPo) => { const a = [...arr]; a[ci] = { ...a[ci], part_no: part, off_po: offPo || undefined }; set(a) }} />
                <input className="txt" type="number" min={0} placeholder="Qty" disabled={!editable} value={c.qty || ''} style={{ flex: 1 }}
                  onChange={e => { const a = [...arr]; a[ci] = { ...a[ci], qty: +e.target.value || 0 }; set(a) }} />
                {editable && <button className="btn ghost" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => set(arr.filter((_, i) => i !== ci))}>✕</button>}
              </div>
            )
          })}
          {editable && <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}
            onClick={() => setData({ ...cl.data, non_pallet_contents: [...(cl.data.non_pallet_contents || []), { part_no: '', qty: 0 }] })}>＋ Add part no.</button>}
        </div>
      )}

      {loadingType === 'pallet' && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>SKUs Loaded: Pallet Loading</h2>
          <label className="fld" style={{ maxWidth: 240 }}><span>Number of pallets (1–22)</span>
            <input className="txt" type="number" min={1} max={22} disabled={!editable} value={cl.data.pallet_count ?? ''}
              onChange={e => { const n = Math.max(0, Math.min(22, Math.floor(+e.target.value || 0))); setData({ ...cl.data, pallet_count: n }) }} /></label>

          {palletCount < 1 ? <p className="muted" style={{ marginTop: 12 }}>Enter the number of pallets.</p> : (
            <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
              {pallets.map(pn => {
                const filled = (palletOf(pn).contents || []).some(c => c.part_no) || Object.keys(palletOf(pn).checks || {}).length > 0 || photosFor('pallet_label', pn).length > 0
                return (
                  <button key={pn} onClick={() => setActivePallet(pn)}
                    style={{ minHeight: 44, minWidth: 48, padding: '4px 10px', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                      border: `1.5px solid ${curPallet === pn ? 'var(--navy)' : 'var(--line)'}`,
                      background: curPallet === pn ? 'var(--navy)' : (filled ? 'var(--pass-bg)' : '#fff'),
                      color: curPallet === pn ? '#fff' : 'var(--navy)' }}>{pn}</button>
                )
              })}
            </div>
            {(() => {
              const n = curPallet
              const pd = palletOf(n); const labelPhotos = photosFor('pallet_label', n)
              const undoCount = history.filter(e => e.palletNo === n).length
              return (
              <div key={n} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 12 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Pallet {n}</div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Pallet label photo {labelPhotos.length === 0 && <span style={{ color: 'var(--ink-soft)' }}>· no photo yet</span>}</div>
                  {editable && <MediaCapture label="Label" onUploaded={async (path, type) => { const ok = await insertPhoto('pallet_label', n, true, path, type); if (ok) { loadPhotos(cl.id); if (type === 'photo') runScan(n, path) } }} />}
                  {editable && labelPhotos.length > 0 && (
                    <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13, marginTop: 6 }}
                      onClick={() => runScan(n, labelPhotos[labelPhotos.length - 1].storage_path)}>🔍 Scan label with AI</button>
                  )}
                  <PhotoStrip itemKey="pallet_label" pieceNo={n} />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Contents (part no. + quantity)</div>
                  {(pd.contents || []).map((c, ci) => (
                    <div key={ci} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <PartPicker value={c.part_no} disabled={!editable} poParts={poParts}
                        onChange={(part, offPo) => { const arr = [...pd.contents]; arr[ci] = { ...arr[ci], part_no: part, off_po: offPo || undefined }; updateContents(n, arr) }} />
                      <input className="txt" type="number" min={0} placeholder="Qty" disabled={!editable} value={c.qty || ''} style={{ flex: 1 }}
                        onChange={e => { const arr = [...pd.contents]; arr[ci] = { ...arr[ci], qty: +e.target.value || 0 }; updateContents(n, arr) }} />
                      {editable && <button className="btn ghost" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => updateContents(n, pd.contents.filter((_, i) => i !== ci))}>✕</button>}
                    </div>
                  ))}
                  {editable && <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => updateContents(n, [...(pd.contents || []), { part_no: '', qty: 0 }])}>＋ Add part no.</button>}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Packing checks</span>
                    {editable && <>
                      <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12, color: 'var(--pass)', borderColor: 'var(--pass)' }} onClick={() => setAllPallet(n, 'P')}>All P</button>
                      <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12, color: 'var(--fail)', borderColor: 'var(--fail)' }} onClick={() => setAllPallet(n, 'F')}>All F</button>
                      <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12 }} onClick={() => setAllPallet(n, 'NA')}>All NA</button>
                      {undoCount > 0 && <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12, borderColor: 'var(--amber)', color: 'var(--amber)' }} onClick={() => undoPallet(n)}>↶ Undo</button>}
                    </>}
                  </div>
                  {PALLET_PACKING_ITEMS.map(item => (
                    <div key={item.key} id={`chk-${item.key}`} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="row" style={{ gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 14 }}>{bi(item.label)}</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <div className="pfna">
                            {(['P', 'F', 'NA'] as const).map(v => (
                              <button key={v} disabled={!editable} className={`${v === 'P' ? 'p' : v === 'F' ? 'f' : 'n'} ${pd.checks[item.key] === v ? 'on' : ''}`}
                                onClick={() => setPalletCheck(n, item.key, pd.checks[item.key] === v ? undefined : v)}>{v}</button>
                            ))}
                          </div>
                          <CamBtn itemKey={item.key} pieceNo={n} isPass={pd.checks[item.key] !== 'F'} />
                        </div>
                      </div>
                      <PhotoStrip itemKey={item.key} pieceNo={n} />
                    </div>
                  ))}
                </div>
              </div>
            )
            })()}
            </>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Container Loading Inspection Photos</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Add a photo for each item below. Photos are recommended but not required — you'll be asked to confirm at submission if any are missing.</p>
        {CONTAINER_PHOTO_ITEMS.map(item => {
          const ph = photosFor(item.key, 0)
          return (
            <div key={item.key} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{bi(item.label)} {ph.length === 0 && <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>· no photo yet</span>}</div>
              <div className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>{bi(item.instruction)}</div>
              <CamBtn itemKey={item.key} pieceNo={0} label="📷 Add photo / video" />
              <PhotoStrip itemKey={item.key} pieceNo={0} />
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Submit &amp; Sign-off</h2>
        {cl.insp_status === 'rejected' && cl.review_note && <div className="banner bad" style={{ marginBottom: 10 }}>↩ {cl.review_note}</div>}

        {['draft', 'rejected'].includes(cl.insp_status) && editable &&
          <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={submit}>Submit for approval</button>}

        {cl.insp_status === 'submitted' && profile.role !== 'admin' &&
          <p className="muted" style={{ marginTop: 10 }}>Submitted — awaiting admin sign-off.</p>}

        {cl.insp_status === 'submitted' && profile.role === 'admin' && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Admin sign-off</div>
            <input className="txt" placeholder="Review note (optional)…" value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn ok" style={{ flex: 1 }} onClick={() => decide('approved')}>Approve</button>
              <button className="btn danger" style={{ flex: 1 }} onClick={() => decide('rejected')}>Reject</button>
            </div>
          </div>
        )}

        {cl.insp_status === 'approved' && <p style={{ color: 'var(--pass)', fontWeight: 600, marginTop: 12 }}>✓ Approved</p>}
      </div>

      {photoModal?.type === 'reassign' && (
        <ReassignModal photo={{ ...photoModal.photo, defect_id: null }} allItems={allItemsForReassign} maxPiece={palletCount || 0}
          onDone={() => { setPhotoModal(null); loadPhotos(cl.id) }} onClose={() => setPhotoModal(null)} />
      )}
      {photoModal?.type === 'copy' && (
        <CopyModal containerLoadingId={cl.id} photo={photoModal.photo} allItems={allItemsForReassign}
          onDone={() => { setPhotoModal(null); loadPhotos(cl.id) }} onClose={() => setPhotoModal(null)} />
      )}

      {capture && (
        <div className="modal-overlay" onClick={() => setCapture(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 12 }}>Add photo / video</h2>
            <MediaCapture label="Photo" onUploaded={onCaptured} />
            <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setCapture(null)}>Cancel</button>
          </div>
        </div>
      )}
      {scan && (
        <div className="modal-overlay" onClick={() => !scan.busy && setScan(null)}>
          <div className="modal" style={{ width: 'min(480px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Label scan — Pallet {scan.pallet}</h2>
            {scan.busy && <p className="muted">Reading the label…</p>}
            {!scan.busy && scan.err && (
              <>
                <p style={{ color: 'var(--fail)' }}>{scan.err}</p>
                <button className="btn ghost" onClick={() => setScan(null)}>Close</button>
              </>
            )}
            {!scan.busy && scan.fields && (
              <>
                <p className="muted" style={{ fontSize: 13 }}>Check the values read from the label. Nothing is saved until you confirm.</p>
                {(scan.warn || []).map((w, i) => (
                  <div key={i} style={{ background: '#FCF2DD', border: '1px solid var(--amber, #B7791F)', color: '#7A5514', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 8 }}>⚠ {w}</div>
                ))}
                <label className="fld"><span>Part number</span>
                  <PartPicker value={scan.fields.part_no} poParts={poParts}
                    onChange={(part) => setScan({ ...scan, fields: { ...scan.fields!, part_no: part } })} /></label>
                <label className="fld"><span>Quantity on label</span>
                  <input className="txt" inputMode="numeric" value={scan.fields.qty}
                    onChange={e => setScan({ ...scan, fields: { ...scan.fields!, qty: e.target.value } })} /></label>
                <label className="fld"><span>Pallet no. on label</span>
                  <input className="txt" value={scan.fields.pallet_no}
                    onChange={e => setScan({ ...scan, fields: { ...scan.fields!, pallet_no: e.target.value } })} /></label>
                <div className="row" style={{ marginTop: 12, gap: 8 }}>
                  <button className="btn" onClick={confirmScan}>Confirm & add to contents</button>
                  <button className="btn ghost" onClick={() => setScan(null)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {emailOpen && <EmailModal title="Email container report" allowBlank sending={emailBusy}
        onSend={doEmail} onClose={() => setEmailOpen(false)} />}
      {editable && ['draft', 'rejected'].includes(cl.insp_status) && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: '#fff', borderTop: '1.5px solid var(--line)',
          padding: '10px 14px calc(10px + env(safe-area-inset-bottom))',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            {(cl.data.loading_type || 'pallet') === 'pallet' && (cl.data.pallet_count ?? 0) > 0
              ? <><b>Pallet {activePallet}</b>: {checksDone(activePallet)}/{PALLET_PACKING_ITEMS.length} checks
                  <span className="muted"> · {Array.from({ length: cl.data.pallet_count ?? 0 }, (_, i) => i + 1).filter(palletComplete).length}/{cl.data.pallet_count} pallets ✓</span></>
              : <span className="muted">Container loading</span>}
          </div>
          {(cl.data.loading_type || 'pallet') === 'pallet' && (cl.data.pallet_count ?? 0) > 0 &&
            !Array.from({ length: cl.data.pallet_count ?? 0 }, (_, i) => i + 1).every(palletComplete) &&
            <button className="btn ghost" style={{ minHeight: 44, padding: '4px 12px', fontSize: 13, whiteSpace: 'nowrap' }} onClick={jumpNextCheck}>Next ↓</button>}
          <button className="btn" style={{ minHeight: 44, padding: '4px 16px', whiteSpace: 'nowrap' }} onClick={submit}>Submit</button>
        </div>
      )}
    </div>
  )
}

```

### `src/pages/ContainerReportPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

type Lang = 'en' | 'de' | 'zh'
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' }]

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Container Loading Report', subtitle: 'Live report · clickable photo & video evidence', viewed: 'Viewed',
    details: 'Shipping & Container Details', po: 'PO No.', container: 'Container No.', seal: 'Seal No.', bl: 'BL Number',
    loadingType: 'Loading Type', pallets: 'Pallets', dateLoaded: 'Date Loaded', etd: 'Est. Port Departure',
    eta: 'Est. Port Arrival', depPort: 'Departure Port', destPort: 'Destination Port', inspector: 'Inspector',
    approver: 'Approved By', notOnPo: 'NOT ON PO', contents: 'Loaded Contents', packing: 'Pallet Packing Inspection', pallet: 'Pallet',
    photos: 'Photo / Video Appendix', pass: 'Pass', fail: 'Fail', na: 'N/A',
    partNumber: 'Part Number', model: 'Model', size: 'Size', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Color', qty: 'Qty Loaded',
    statusLoaded: 'LOADED', statusInProgress: 'IN PROGRESS', statusHold: 'HOLD', statusUnset: 'IN PROGRESS', statusTag: 'CONTAINER STATUS',
    palletType: 'Palletised', nonPalletType: 'Non-palletised', noPhotos: 'No photos uploaded.', loading: 'Loading report…',
    txUnavailable: 'Automatic translation is unavailable — some fields are shown in the original language.',
  },
  de: {
    title: 'Containerverladebericht', subtitle: 'Live-Bericht · anklickbare Foto- & Videonachweise', viewed: 'Angesehen',
    details: 'Versand- & Containerdetails', po: 'Bestell-Nr.', container: 'Container-Nr.', seal: 'Siegel-Nr.', bl: 'BL-Nummer',
    loadingType: 'Verladeart', pallets: 'Paletten', dateLoaded: 'Verladedatum', etd: 'Vorauss. Hafenabfahrt',
    eta: 'Vorauss. Hafenankunft', depPort: 'Abfahrtshafen', destPort: 'Zielhafen', inspector: 'Prüfer',
    approver: 'Genehmigt von', notOnPo: 'NICHT AUF BESTELLUNG', contents: 'Geladener Inhalt', packing: 'Palettenverpackungsprüfung', pallet: 'Palette',
    photos: 'Foto- / Video-Anhang', pass: 'i.O.', fail: 'n.i.O.', na: 'k.A.',
    partNumber: 'Teilenummer', model: 'Modell', size: 'Größe', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Farbe', qty: 'Geladene Menge',
    statusLoaded: 'GELADEN', statusInProgress: 'IN BEARBEITUNG', statusHold: 'ZURÜCKGEHALTEN', statusTag: 'CONTAINERSTATUS',
    palletType: 'Palettiert', nonPalletType: 'Nicht palettiert', noPhotos: 'Keine Fotos hochgeladen.', loading: 'Bericht wird geladen…',
    txUnavailable: 'Automatische Übersetzung nicht verfügbar — einige Felder erscheinen in der Originalsprache.',
  },
  zh: {
    title: '集装箱装柜报告', subtitle: '实时报告 · 可点击照片与视频证据', viewed: '查看时间',
    details: '运输与集装箱信息', po: '订单号', container: '集装箱号', seal: '封条号', bl: '提单号',
    loadingType: '装柜方式', pallets: '托盘数', dateLoaded: '装柜日期', etd: '预计离港',
    eta: '预计到港', depPort: '起运港', destPort: '目的港', inspector: '检验员',
    approver: '批准人', notOnPo: '不在订单内', contents: '装载内容', packing: '托盘包装检验', pallet: '托盘',
    photos: '照片 / 视频附录', pass: '合格', fail: '不合格', na: '不适用',
    partNumber: '产品编号', model: '型号', size: '尺寸', pcd: 'PCD', cb: 'CB', et: 'ET', color: '颜色', qty: '装载数量',
    statusLoaded: '已装柜', statusInProgress: '进行中', statusHold: '暂扣', statusTag: '集装箱状态',
    palletType: '托盘装', nonPalletType: '非托盘装', noPhotos: '暂无照片。', loading: '正在加载报告…',
    txUnavailable: '自动翻译不可用 — 部分内容以原文显示。',
  },
}

function statusInfo(s: string, L: Record<string, string>) {
  if (s === 'loaded') return { text: L.statusLoaded, color: 'var(--pass)', bg: '#E8F5EC' }
  if (s === 'hold') return { text: L.statusHold, color: 'var(--fail)', bg: '#FBE9E7' }
  return { text: L.statusInProgress, color: 'var(--amber)', bg: '#FCF2DD' }
}
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString() : '—'

export default function ContainerReportPage() {
  const { id } = useParams<{ id: string }>()
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const L = DICT[lang]

  useEffect(() => {
    setData(null); setErr('')
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    fetch(`${base}/functions/v1/container-report?id=${id}&lang=${lang}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error || 'Report unavailable') })
      .catch(e => setErr(String(e)))
  }, [id, lang])

  if (err) return <div style={page}><div style={{ ...card, borderColor: 'var(--fail)' }}><h2 style={{ color: 'var(--fail)' }}>Report unavailable</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: 'var(--ink-soft)', padding: 20 }}>{L.loading}</p></div>

  const c = data.container
  const st = statusInfo(c.status, L)

  return (
    <div style={page}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl ? <img src={data.logoUrl} alt="logo" style={{ height: 46, maxWidth: 240, objectFit: 'contain', display: 'block' }} /> : <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>NITRA</span>}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: .3 }}>{L.title}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{c.container_no || ''} · {L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.12)', borderRadius: 999, padding: 3 }}>
              {LANGS.map(o => (
                <button key={o.id} onClick={() => setLang(o.id)} style={{ border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? 'var(--navy)' : '#CFE0F5' }}>{o.label}</button>
              ))}
            </div>
            <div style={{ color: '#9FB6D4', fontSize: 11.5, whiteSpace: 'nowrap' }}>{L.viewed} {new Date().toLocaleString()}</div>
          </div>
        </div>
        <div style={{ background: st.bg, borderTop: `3px solid ${st.color}` }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: st.color, flexShrink: 0 }} />
              <span style={{ color: st.color, fontWeight: 800, fontSize: 15 }}>{st.text}</span>
            </div>
            <span style={{ color: st.color, opacity: .6, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>{L.statusTag}</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '22px auto', padding: '0 14px' }}>
        {data.translationNote && (
          <div style={{ background: '#FCF2DD', border: '1px solid var(--amber)', color: '#7A5200', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{L.txUnavailable}</div>
        )}

        <section style={card}>
          <h2 style={h2}>{L.details}</h2>
          <table style={metaTable}><tbody>
            <tr><Td k>{L.po}</Td><Td>{c.po_no || '—'}</Td><Td k>{L.container}</Td><Td>{c.container_no || '—'}</Td></tr>
            <tr><Td k>{L.seal}</Td><Td>{c.seal_no || '—'}</Td><Td k>{L.bl}</Td><Td>{c.bl_no || '—'}</Td></tr>
            <tr><Td k>{L.loadingType}</Td><Td>{c.loading_type === 'pallet' ? `${L.palletType} (${c.pallet_count})` : L.nonPalletType}</Td><Td k>{L.dateLoaded}</Td><Td>{fmtDate(c.date_loaded)}</Td></tr>
            <tr><Td k>{L.etd}</Td><Td>{fmtDate(c.etd)}</Td><Td k>{L.eta}</Td><Td>{fmtDate(c.eta)}</Td></tr>
            <tr><Td k>{L.depPort}</Td><Td>{c.dep_port || '—'}</Td><Td k>{L.destPort}</Td><Td>{c.dest_port || '—'}</Td></tr>
            <tr><Td k>{L.inspector}</Td><Td>{c.inspectorName || '—'}</Td><Td k>{L.approver}</Td><Td>{c.reviewerName || '—'}</Td></tr>
          </tbody></table>
        </section>

        {data.contents?.length > 0 && (
          <section style={card}>
            <h2 style={h2}>{L.contents}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={gridTable}>
                <thead><tr>{[L.partNumber, L.model, L.size, L.pcd, L.cb, L.et, L.color, L.qty].map(t => <Th key={t}>{t}</Th>)}</tr></thead>
                <tbody>
                  {data.contents.map((raw: any, i: number) => {
                    const r = typeof raw === 'string' ? { part_no: raw, model: '', size: '', pcd: '', cb: '', et: '', color: '', qty: '' } : raw
                    return (
                      <tr key={i}>
                        <Td>{r.part_no}{r.off_po && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#B7791F', border: '1px solid #B7791F', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}>⚠ {L.notOnPo}</span>}</Td><Td2>{r.model || '—'}</Td2><Td2>{r.size || '—'}</Td2><Td2>{r.pcd || '—'}</Td2>
                        <Td2>{r.cb !== '' && r.cb != null ? r.cb : '—'}</Td2><Td2>{r.et || '—'}</Td2><Td2>{r.color || '—'}</Td2>
                        <Td2 b>{r.qty}</Td2>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data.pallets?.length > 0 && (
          <section style={card}>
            <h2 style={h2}>{L.packing}</h2>
            {data.pallets.map((pl: any) => (
              <div key={pl.n} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>{L.pallet} {pl.n}{pl.failCount > 0 && <span style={{ color: 'var(--fail)', fontSize: 12, marginLeft: 8 }}>● {pl.failCount} {L.fail}</span>}</div>
                {pl.checks?.length ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}><tbody>
                    {pl.checks.map((ck: any, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: '7px 8px', borderBottom: '1px solid #EEF1F5' }}>{ck.label}</td>
                        <td style={{ padding: '7px 8px', borderBottom: '1px solid #EEF1F5', textAlign: 'right', fontWeight: 700, color: ck.value === 'F' ? 'var(--fail)' : ck.value === 'P' ? 'var(--pass)' : 'var(--ink-soft)' }}>
                          {ck.value === 'P' ? L.pass : ck.value === 'F' ? L.fail : L.na}</td></tr>
                    ))}
                  </tbody></table>
                ) : <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>—</span>}
              </div>
            ))}
          </section>
        )}

        <section style={card}>
          <h2 style={h2}>{L.photos}</h2>
          {data.photoGroups?.length ? data.photoGroups.map((g: any) => (
            <div key={g.key} style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '4px 0', color: 'var(--navy)' }}>{g.label}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {g.photos.map((p: any, i: number) => (
                  <figure key={i} style={fig}>
                    <a href={p.url || '#'} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                      {p.url ? (p.mediaType === 'video' ? <div style={{ ...imgS, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#EEF1F5' }}><span style={{ fontSize: 32, color: 'var(--navy)' }}>▶</span></div> : <img src={p.url} style={imgS} />) : <div style={{ ...imgS, background: '#EEF1F5' }} />}
                    </a>
                    {p.comment ? <figcaption style={cap}>{p.comment}</figcaption> : null}
                  </figure>
                ))}
              </div>
            </div>
          )) : <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{L.noPhotos}</p>}
        </section>

        <div style={{ textAlign: 'center', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, padding: '14px 0' }}>CONFIDENTIAL — PROPERTY OF NITRA</div>
      </main>
    </div>
  )
}

const page: React.CSSProperties = { minHeight: '100vh', fontFamily: 'Arial, sans-serif', color: 'var(--ink)', background: '#F4F7FA' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: '0 4px 14px rgba(31,58,95,.08)' }
const h2: React.CSSProperties = { margin: '0 0 12px', color: 'var(--navy)', fontSize: 18 }
const metaTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const gridTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const fig: React.CSSProperties = { margin: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }
const imgS: React.CSSProperties = { width: '100%', height: 110, objectFit: 'cover', display: 'block' }
const cap: React.CSSProperties = { fontSize: 11, color: 'var(--ink-soft)', padding: 6 }

function Td({ children, k }: { children: React.ReactNode; k?: boolean }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, color: k ? 'var(--ink-soft)' : 'var(--ink)', fontSize: k ? 12 : 13, fontWeight: k ? 400 : 700, whiteSpace: k ? 'nowrap' : 'normal' }}>{children}</td>
}
function Td2({ children, b }: { children: React.ReactNode; b?: boolean }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, color: 'var(--ink)', fontSize: 13, fontWeight: b ? 700 : 400 }}>{children}</td>
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ background: 'var(--navy)', color: '#fff', textAlign: 'left', padding: 9, fontSize: 12, whiteSpace: 'nowrap' }}>{children}</th>
}

```

### `src/pages/CustomerHome.tsx`

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'

// Customer dashboard (Phase 3). RLS scopes every query server-side: a customer
// can only read their assigned POs, and only APPROVED inspections/loadings of
// those POs — so this page simply queries and renders. Report links go to the
// public consolidated report page (no login required there).
// Languages: English / German / Canadian French.

type CLang = 'en' | 'de' | 'fr'
const DICT: Record<CLang, Record<string, string>> = {
  en: {
    myPos: 'My Purchase Orders', greeting: 'Welcome', signOut: 'Sign out',
    po: 'PO Number', date: 'PO Date', dest: 'Destination', skus: 'SKUs',
    status: 'Inspection Status', disp: 'Disposition', report: 'Report',
    open: 'Open report', copy: 'Copy link', copied: 'Link copied', none: 'No purchase orders have been assigned to your account yet. Please contact your NITRA representative.',
    pending: 'Pending Inspection', inprog: 'Inspection In Progress', approved: 'Approved',
    loading: 'Loading…',
  },
  de: {
    myPos: 'Meine Bestellungen', greeting: 'Willkommen', signOut: 'Abmelden',
    po: 'Bestellnummer', date: 'Bestelldatum', dest: 'Zielort', skus: 'SKUs',
    status: 'Prüfstatus', disp: 'Disposition', report: 'Bericht',
    open: 'Bericht öffnen', copy: 'Link kopieren', copied: 'Link kopiert', none: 'Ihrem Konto wurden noch keine Bestellungen zugewiesen. Bitte kontaktieren Sie Ihren NITRA-Ansprechpartner.',
    pending: 'Prüfung ausstehend', inprog: 'Prüfung läuft', approved: 'Freigegeben',
    loading: 'Wird geladen…',
  },
  fr: {
    myPos: 'Mes bons de commande', greeting: 'Bienvenue', signOut: 'Se déconnecter',
    po: 'Nº de commande', date: 'Date de commande', dest: 'Destination', skus: 'SKU',
    status: 'État de l’inspection', disp: 'Disposition', report: 'Rapport',
    open: 'Ouvrir le rapport', copy: 'Copier le lien', copied: 'Lien copié', none: 'Aucun bon de commande n’a encore été attribué à votre compte. Veuillez contacter votre représentant NITRA.',
    pending: 'Inspection à venir', inprog: 'Inspection en cours', approved: 'Approuvé',
    loading: 'Chargement…',
  },
}

// Disposition display (matches the app's canonical dispositions)
const DISP: Record<string, Record<CLang, string>> = {
  approved_loading: { en: 'APPROVED FOR LOADING', de: 'FÜR VERLADUNG FREIGEGEBEN', fr: 'APPROUVÉ POUR LE CHARGEMENT' },
  hold_rework: { en: 'HOLD FOR REWORK & REINSPECTION', de: 'ZURÜCKHALTEN FÜR NACHARBEIT & NACHPRÜFUNG', fr: 'EN ATTENTE — REPRISE ET RÉINSPECTION' },
  conditional_loading: { en: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE AUSGESCHLOSSEN', fr: 'CHARGEMENT CONDITIONNEL — PIÈCES NON CONFORMES EXCLUES' },
  conditional_rework: { en: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', de: 'BEDINGTE VERLADUNG — TEILE NACHARBEITEN & VERLADEN', fr: 'CHARGEMENT CONDITIONNEL — REPRISE DES PIÈCES PUIS CHARGEMENT' },
  pending_customer: { en: 'PENDING CUSTOMER APPROVAL', de: 'AUSSTEHENDE KUNDENFREIGABE', fr: 'EN ATTENTE D’APPROBATION DU CLIENT' },
}

interface PoRow { id: string; po_no: string; po_date: string | null; destination: string | null }
interface Row extends PoRow { totalSkus: number; approvedInsp: number; disposition: string | null; dispositionCustom: string | null }

export default function CustomerHome({ profile }: { profile: Profile }) {
  const [lang, setLang] = useState<CLang>(() => (localStorage.getItem('nitra_cust_lang') as CLang) || 'en')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [narrow, setNarrow] = useState(window.innerWidth < 720)
  const [copiedPo, setCopiedPo] = useState('')
  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth < 720)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  const copyLink = async (poNo: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/po-report/${encodeURIComponent(poNo)}`)
      setCopiedPo(poNo); setTimeout(() => setCopiedPo(''), 2000)
    } catch { /* ignore */ }
  }
  const L = DICT[lang]

  const pick = (l: CLang) => { setLang(l); localStorage.setItem('nitra_cust_lang', l) }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      // RLS already scopes all three queries to this customer's assigned POs
      // (and to approved rows only, for inspections/loadings).
      const [{ data: pos }, { data: items }, { data: insp }, { data: conts }] = await Promise.all([
        supabase.from('pos').select('id,po_no,po_date,destination').order('po_date', { ascending: false }),
        supabase.from('po_items').select('po_id'),
        supabase.from('inspections').select('po_no,status,updated_at'),
        supabase.from('container_loadings').select('po_no,insp_status,summary,updated_at'),
      ])
      const itemCount = new Map<string, number>()
      for (const it of (items as { po_id: string }[]) || []) itemCount.set(it.po_id, (itemCount.get(it.po_id) || 0) + 1)
      const inspByPo = new Map<string, number>()
      for (const r of (insp as { po_no: string }[]) || []) inspByPo.set(r.po_no, (inspByPo.get(r.po_no) || 0) + 1)
      // Latest approved container disposition per PO (the loading decision is
      // the customer-facing final outcome).
      const dispByPo = new Map<string, { code: string | null; custom: string | null; at: string }>()
      for (const c of (conts as { po_no: string; summary: any; updated_at: string }[]) || []) {
        const cur = dispByPo.get(c.po_no)
        if (!cur || c.updated_at > cur.at) {
          dispByPo.set(c.po_no, { code: c.summary?.disposition || null, custom: c.summary?.disposition_custom || null, at: c.updated_at })
        }
      }
      const out: Row[] = ((pos as PoRow[]) || []).map(p => ({
        ...p,
        totalSkus: itemCount.get(p.id) || 0,
        approvedInsp: inspByPo.get(p.po_no) || 0,
        disposition: dispByPo.get(p.po_no)?.code || null,
        dispositionCustom: dispByPo.get(p.po_no)?.custom || null,
      }))
      setRows(out)
      setLoading(false)
    }
    load()
  }, [])

  const statusOf = (r: Row) => {
    if (r.disposition || r.dispositionCustom) return L.approved
    if (r.approvedInsp > 0) return `${L.inprog} (${r.approvedInsp}${r.totalSkus ? '/' + r.totalSkus : ''})`
    return L.pending
  }
  const dispOf = (r: Row) => r.dispositionCustom || (r.disposition && DISP[r.disposition] ? DISP[r.disposition][lang] : '—')
  const fmtDate = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-CA' : lang === 'de' ? 'de-DE' : 'fr-CA') : '—'

  return (
    <>
      <header className="topbar">
        <img src="/logo-white.png" alt="NITRA" />
        <span className="title">QC Inspection</span>
        <nav className="topbar-nav open" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {(['en', 'de', 'fr'] as CLang[]).map(l => (
            <button key={l} style={lang === l ? { fontWeight: 800, textDecoration: 'underline' } : undefined}
              onClick={() => pick(l)}>{l.toUpperCase()}</button>
          ))}
          <button onClick={async () => { await supabase.auth.signOut(); location.href = '/' }}>{L.signOut}</button>
        </nav>
      </header>
      <div className="page">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{L.greeting}, {profile.full_name}</h2>
          <h3 style={{ marginBottom: 8 }}>{L.myPos}</h3>
          {loading && <p className="muted">{L.loading}</p>}
          {!loading && rows.length === 0 && <p className="muted">{L.none}</p>}
          {!loading && rows.length > 0 && narrow && (
            <div>
              {rows.map(r => (
                <div key={r.id} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{r.po_no}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{fmtDate(r.po_date)}{r.destination ? ` · ${r.destination}` : ''}{r.totalSkus ? ` · ${r.totalSkus} ${L.skus}` : ''}</div>
                  <div style={{ marginTop: 6, fontSize: 14 }}><b>{L.status}:</b> {statusOf(r)}</div>
                  <div style={{ marginTop: 2, fontSize: 14 }}><b>{L.disp}:</b> {dispOf(r)}</div>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <a href={`/po-report/${encodeURIComponent(r.po_no)}`} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                      <button className="btn" style={{ width: '100%', minHeight: 44 }}>{L.open}</button>
                    </a>
                    <button className="btn ghost" style={{ minHeight: 44 }} onClick={() => copyLink(r.po_no)}>{copiedPo === r.po_no ? '✓ ' + L.copied : L.copy}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && rows.length > 0 && !narrow && (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>{L.po}</th><th>{L.date}</th><th>{L.dest}</th>
                  <th>{L.skus}</th><th>{L.status}</th><th style={{ textAlign: 'left' }}>{L.disp}</th><th>{L.report}</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700 }}>{r.po_no}</td>
                      <td style={{ textAlign: 'center' }}>{fmtDate(r.po_date)}</td>
                      <td style={{ textAlign: 'center' }}>{r.destination || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{r.totalSkus || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{statusOf(r)}</td>
                      <td>{dispOf(r)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                          <a href={`/po-report/${encodeURIComponent(r.po_no)}`} target="_blank" rel="noreferrer">
                            <button className="btn ghost" style={{ minHeight: 34, padding: '4px 10px', fontSize: 13 }}>{L.open}</button>
                          </a>
                          <button className="btn ghost" style={{ minHeight: 34, padding: '4px 10px', fontSize: 13 }} onClick={() => copyLink(r.po_no)}>{copiedPo === r.po_no ? '✓' : L.copy}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

```

### `src/pages/Home.tsx`

```tsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'

interface InspRow { id: string; po_no: string | null; updated_at: string }
interface ContRow { id: string; po_no: string | null; updated_at: string }
interface PoMaster { po_no: string; customer_name: string | null; destination: string | null; created_at: string }
interface POGroup { po: string; inspCount: number; contCount: number; latest: string; customer?: string; destination?: string }

export default function Home({ profile }: { profile: Profile }) {
  const nav = useNavigate()
  const [groups, setGroups] = useState<POGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [newPo, setNewPo] = useState<{ po_no: string; customer_name: string; po_date: string; destination: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [resume, setResume] = useState<{ kind: 'inspection' | 'container'; id: string; label: string; po: string; at: string } | null>(null)

  const load = async () => {
    const { data: i } = await supabase.from('inspections').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500)
    const { data: c } = await supabase.from('container_loadings').select('id,po_no,updated_at').order('updated_at', { ascending: false }).limit(500)
    const { data: p } = await supabase.from('pos').select('po_no,customer_name,destination,created_at').order('created_at', { ascending: false }).limit(500)
    const map = new Map<string, POGroup>()
    const bump = (key: string, when: string, kind: 'insp' | 'cont') => {
      const g = map.get(key) || { po: key, inspCount: 0, contCount: 0, latest: when }
      if (kind === 'insp') g.inspCount++; else g.contCount++
      if (when > g.latest) g.latest = when
      map.set(key, g)
    }
    for (const r of (i as InspRow[]) || []) bump(r.po_no || '', r.updated_at, 'insp')
    for (const r of (c as ContRow[]) || []) bump(r.po_no || '', r.updated_at, 'cont')
    // Merge PO master rows: POs created ahead of any inspection still appear,
    // and customer/destination annotate every group that has them.
    for (const m of (p as PoMaster[]) || []) {
      const g = map.get(m.po_no) || { po: m.po_no, inspCount: 0, contCount: 0, latest: m.created_at }
      g.customer = m.customer_name || undefined
      g.destination = m.destination || undefined
      map.set(m.po_no, g)
    }
    setGroups([...map.values()].sort((a, b) => b.latest.localeCompare(a.latest)))
    setLoaded(true)
  }
  useEffect(() => { load() }, [])

  // "Continue where you left off": the newest draft/rejected item started by me.
  useEffect(() => {
    (async () => {
      const [{ data: i }, { data: c }] = await Promise.all([
        supabase.from('inspections').select('id,part_no,po_no,updated_at').eq('inspector_id', profile.id).in('status', ['draft', 'rejected']).order('updated_at', { ascending: false }).limit(1),
        supabase.from('container_loadings').select('id,container_no,po_no,updated_at').eq('inspector_id', profile.id).in('insp_status', ['draft', 'rejected']).order('updated_at', { ascending: false }).limit(1),
      ])
      const insp = (i || [])[0] as { id: string; part_no: string; po_no: string; updated_at: string } | undefined
      const cont = (c || [])[0] as { id: string; container_no: string; po_no: string; updated_at: string } | undefined
      if (insp && (!cont || insp.updated_at > cont.updated_at)) {
        setResume({ kind: 'inspection', id: insp.id, label: insp.part_no || '(no part no.)', po: insp.po_no || '', at: insp.updated_at })
      } else if (cont) {
        setResume({ kind: 'container', id: cont.id, label: cont.container_no || '(no container no.)', po: cont.po_no || '', at: cont.updated_at })
      }
    })()
  }, [profile.id])

  const newPO = () => {
    if (profile.role === 'admin') {
      setErr(''); setNewPo({ po_no: '', customer_name: '', po_date: '', destination: '' })
      return
    }
    // Inspectors keep the quick open-a-PO flow (no master-data editing rights).
    const po = window.prompt('Enter the PO number:')
    if (po === null) return
    nav(`/po/${encodeURIComponent(po.trim())}`)
  }

  const createPO = async () => {
    if (!newPo) return
    const po_no = newPo.po_no.trim()
    if (!po_no) { setErr('PO number is required.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('pos').upsert({
      po_no,
      customer_name: newPo.customer_name.trim() || null,
      po_date: newPo.po_date || null,
      destination: newPo.destination.trim() || null,
    }, { onConflict: 'po_no' })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setNewPo(null)
    nav(`/po/${encodeURIComponent(po_no)}`)
  }

  const delPO = async (g: POGroup) => {
    const label = g.po || '(No PO)'
    if (!confirm(`Delete the ENTIRE PO “${label}”?\n\nThis permanently deletes its ${g.inspCount} wheel inspection(s) and ${g.contCount} container loading(s), including their photos.\n\nThis cannot be undone.`)) return
    const { error: e1 } = await supabase.from('inspections').delete().eq('po_no', g.po)
    const { error: e2 } = await supabase.from('container_loadings').delete().eq('po_no', g.po)
    if (e1 || e2) { alert('Delete failed: ' + (e1?.message || e2?.message)); return }
    await supabase.from('pos').delete().eq('po_no', g.po) // master row + items (cascade)
    load()
  }

  return (
    <div className="page">
      {resume && (
        <Link to={resume.kind === 'inspection' ? `/inspection/${resume.id}` : `/container/${resume.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card" style={{ marginBottom: 12, border: '1.5px solid var(--navy)', cursor: 'pointer' }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: .5 }}>▶ CONTINUE WHERE YOU LEFT OFF</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
              {resume.kind === 'inspection' ? 'Wheel inspection' : 'Container loading'} · {resume.label}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>PO {resume.po || '—'} · last edited {new Date(resume.at).toLocaleString()}</div>
          </div>
        </Link>
      )}
      <button className="btn" style={{ width: '100%', marginBottom: 16 }} onClick={newPO}>＋ New PO</button>
      <div className="card">
        <h2>Purchase Orders / 采购订单</h2>
        {loaded && groups.length === 0 && <p className="muted">No POs yet. Tap “＋ New PO” to start.</p>}
        {groups.map(g => (
          <div key={g.po} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to={`/po/${encodeURIComponent(g.po)}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--navy)' }}>{g.po || '(No PO)'}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                {g.customer ? <>{g.customer}{g.destination ? ` → ${g.destination}` : ''} · </> : (g.destination ? <>→ {g.destination} · </> : null)}
                {g.inspCount} wheel inspection(s) · {g.contCount} container loading(s)
              </div>
            </Link>
            {profile.role === 'admin' && (
              <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delPO(g)}>🗑</button>
            )}
          </div>
        ))}
      </div>

      {newPo && (
        <div className="modal-overlay" onClick={() => setNewPo(null)}>
          <div className="modal" style={{ width: 'min(460px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>New Purchase Order</h2>
            <label className="fld"><span>PO number *</span>
              <input className="txt" value={newPo.po_no} autoFocus onChange={e => setNewPo({ ...newPo, po_no: e.target.value })} /></label>
            <label className="fld"><span>Customer name</span>
              <input className="txt" value={newPo.customer_name} onChange={e => setNewPo({ ...newPo, customer_name: e.target.value })} /></label>
            <label className="fld"><span>PO date</span>
              <input className="txt" type="date" value={newPo.po_date} onChange={e => setNewPo({ ...newPo, po_date: e.target.value })} /></label>
            <label className="fld"><span>Destination</span>
              <input className="txt" value={newPo.destination} onChange={e => setNewPo({ ...newPo, destination: e.target.value })} /></label>
            <p className="muted" style={{ fontSize: 12 }}>Ordered part numbers and quantities are added on the next screen (manually or by Excel upload).</p>
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={createPO}>{busy ? 'Creating…' : 'Create PO'}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setNewPo(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

```

### `src/pages/Inspection.tsx`

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { SECTIONS, MEAS_SECTIONS, MEAS_COLS, PHOTO_SLOTS, PALLET_ITEMS, isGlossBlack, isBlack, type Sku } from '../lib/standard'
import { evaluateAll, emptyFormData, type FormData, type PFNA, type ItemVerdict } from '../lib/rules'
import { computeOutcomes, summaryItems, outcomeColor } from '../lib/outcome'
import { DefectModal, PassPhotoModal, ReassignModal, CopyModal, MediaThumb, MediaCapture } from '../components/PhotoModal'
import ExtraPieceScreen from '../components/ExtraPieceScreen'
import HundredPctCheck from '../components/HundredPctCheck'
import RichText from '../components/RichText'
import { REF_MAP } from '../lib/refmap'
import { openInspectionReport } from '../lib/report'
import type { Profile } from '../App'
import EmailModal from '../components/EmailModal'
import { saveLocalDraft, getLocalDraft, clearLocalDraft } from '../lib/localDraft'
import { cacheGet } from '../lib/refCache'
import { getPendingInspection, updatePendingInspection, syncOnePending, setOpenInspection } from '../lib/offlineSync'
import { useOnline } from '../lib/connectivity'
import SharedPosCard from '../components/SharedPosCard'

// A save/load failure caused by being offline (vs a real server error). We treat
// these softly: keep the on-screen + on-device work, show a calm notice, and
// never strand the user on a dead-end error page. (Real auto-sync is Stage 2's
// write-queue batch; this just stops offline edits from crashing the screen.)
function isNetworkErr(e?: { message?: string } | null): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = (e?.message || '').toLowerCase()
  return /load failed|failed to fetch|networkerror|network request failed|network error/.test(m)
}

type Tab5 = 'form'|'measure'|'pallet'|'extra'|'100pct'

interface Insp {
  id: string; part_no: string; po_no: string; batch: string; lot_size: number
  app_sample: number; fun_sample: number; status: string; inspector_id: string
  form_data: FormData & {
    hundred_pct?: Record<string, Record<string, PFNA>>
    na_overrides?: Record<string, boolean>
    pallet_count?: number
  }
  pallet_data: Record<string, PFNA>
  summary: { remarks?: string; disposition?: string; corrective_action?: string; disposition_custom?: string; disposition_cls?: string }
  review_note: string
  amended_at?: string | null; amended_by?: string | null
  amend_log?: { at: string; by: string; label: string }[]
  report_logo_path?: string | null
}
interface Photo {
  id: string; storage_path: string; defect_id: string|null
  is_pass_photo: boolean; item_key: string; piece_no: number
  comment: string; checklist_key: string; media_type?: string
}
interface Defect {
  id: string; piece_no: number; item_key: string; item_label: string
  defect_type: string; severity: string; measurement_value: number|null
  measurement_unit: string; comment: string; tab: string
}
interface HistoryEntry {
  type: 'set_result'|'set_meas'|'select_all'|'set_pallet'|'pallet_all'|'set_na'
  key: string; prev: PFNA; isMeas?: boolean
  prevMap?: Record<string,PFNA>
}

type ModalState =
  | { type:'fail'; itemKey:string; itemLabel:string; pieceNo:number; tab:Tab5 }
  | { type:'pass'; itemKey:string; itemLabel:string; pieceNo:number; tab:Tab5 }
  | { type:'extra'; verdict:ItemVerdict; result:'P'|'F' }
  | { type:'preview'; url:string; mediaType?:string }
  | { type:'refimg'; src:string; label:string }
  | { type:'reassign'; photo:Photo }
  | { type:'copy'; photo:Photo }
  | { type:'na_setup' }
  | null

const TABS = ['form','measure','photos','summary','100pct'] as const

// Treat stored corrective_action as HTML. Legacy values were plain text with newlines,
// so convert those for display the first time they're loaded into the editor.
const looksLikeHtml = (s: string) => /<(\/?)(b|i|u|p|ul|ol|li|br|strong|em|span|div)\b/i.test(s)
const escHtml = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
const toHtml = (s: string) => (!s ? '' : looksLikeHtml(s) ? s : escHtml(s).replace(/\n/g, '<br>'))

// Custom-disposition severity buckets → banner colour on the report.
const DISP_SEVERITIES: { cls: string; label: string; color: string }[] = [
  { cls: 'pass',    label: 'Approved (green)', color: '#1F8A4C' },
  { cls: 'hold',    label: 'Caution (amber)',  color: '#B7791F' },
  { cls: 'reject',  label: 'Reject (red)',     color: '#C0392B' },
  { cls: 'pending', label: 'Neutral (grey)',   color: '#5A6878' },
]

interface CustomDisp { id: string; label: string; cls: string }


const CORRECTIVE_TEMPLATES: { label: string; text: (f: string) => string }[] = [
  { label: 'Rework failed param + load', text: f => `Factory to rework wheels with failed parameter(s): ${f} (100% inspection conducted), and load after rework.` },
  { label: '100% inspect + rework + reinspect', text: f => `Factory to conduct 100% inspection and rework all wheels affected by: ${f}, then re-submit for QC re-inspection before loading.` },
  { label: 'Exclude failed pieces', text: f => `Wheels with failed parameter(s): ${f} to be segregated and excluded from loading. Only pieces passing 100% inspection may be shipped.` },
  { label: 'Pending customer', text: f => `Findings for: ${f} to be communicated to the customer; shipment pending customer acceptance of the noted defects.` },
  { label: 'Acceptable — load', text: () => `Findings are within acceptable limits. Container approved for loading.` },
]

export default function Inspection({ profile }: { profile: Profile }) {
  const { id } = useParams()
  const nav = useNavigate()
  const { t, bi, lang } = useI18n()
  const online = useOnline()
  const [insp, setInsp] = useState<Insp|null>(null)
  const [sku, setSku] = useState<Sku|null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [offlineNote, setOfflineNote] = useState(false)
  const [isPending, setIsPending] = useState(false)  // offline-created, not yet synced to the server
  const loadedOnceRef = useRef(false)  // true after one full successful load — lets offline reloads keep the working screen
  const [defects, setDefects] = useState<Defect[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string,string>>({})
  const [tab, setTab] = useState<typeof TABS[number]>('form')
  const [piece, setPiece] = useState(1)
  const [modal, setModal] = useState<ModalState>(null)
  const [submitMsg, setSubmitMsg] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [photoFilter, setPhotoFilter] = useState<'all'|'approved'|'failed'>('all')
  const [amendOpen, setAmendOpen] = useState(false)
  const [amendPo, setAmendPo] = useState('')
  const [amendPart, setAmendPart] = useState('')
  const [amendBatch, setAmendBatch] = useState('')
  const [amendLot, setAmendLot] = useState(0)
  const [amendApp, setAmendApp] = useState(0)
  const [amendFun, setAmendFun] = useState(0)
  const [histOpen, setHistOpen] = useState(false)
  const [skuOptions, setSkuOptions] = useState<string[]>([])
  const [logoUrl, setLogoUrl] = useState('')
  const [customDisps, setCustomDisps] = useState<CustomDisp[]>([])
  const [dispSaveChecked, setDispSaveChecked] = useState(false)
  const [restore, setRestore] = useState<{ form_data?: unknown; summary?: unknown; pallet_data?: unknown } | null>(null)
  const extrasRequiredFor = (tab: 'form' | 'measure') => tab === 'measure' ? 2 : 4

  const load = useCallback(async () => {
    const draft = await getLocalDraft('inspection', id!)
    const { data: i, error: ie } = await supabase.from('inspections').select('*').eq('id', id).single()
    let row: Insp
    let pending = false
    if (i && !ie) {
      row = i as Insp
    } else {
      // Not on the server — is this an offline-created inspection on this device?
      const pend = await getPendingInspection(id!)
      if (!pend) {
        if (loadedOnceRef.current && isNetworkErr(ie)) { setOfflineNote(true); return }
        setLoadErr(ie?.message || 'Inspection not found'); return
      }
      // Already loaded this pending inspection? Don't overwrite the live optimistic
      // edits with the queued copy (which can lag a render behind) — the trailing
      // load() after each edit would otherwise revert the tap.
      if (loadedOnceRef.current) { setIsPending(true); return }
      row = pend as unknown as Insp
      pending = true
    }
    setIsPending(pending)
    const fi: Insp = {
      ...row,
      form_data: { ...emptyFormData(), na_overrides: {}, ...row.form_data },
      pallet_data: row.pallet_data || {},
      summary: row.summary || {},
    }
    setInsp(fi)
    // SKU: live first, then the offline reference cache.
    const { data: s, error: se } = await supabase.from('skus').select('*').eq('part_no', row.part_no).single()
    let skuRow: Sku | null = (s && !se) ? (s as Sku) : null
    if (!skuRow) {
      const cached = await cacheGet<Sku[]>('skus')
      skuRow = cached?.find(x => x.part_no === row.part_no) || null
    }
    if (!skuRow) {
      if (loadedOnceRef.current && isNetworkErr(se)) { setOfflineNote(true); return }
      setLoadErr(`SKU "${row.part_no}" not found` + (se ? `: ${se.message}` : '')); return
    }
    setSku(skuRow)
    loadedOnceRef.current = true  // one full load succeeded — offline reloads may now keep the screen
    if (!pending) setOfflineNote(false)  // a live server load means we're online
    const { data: d } = await supabase.from('defects').select('*').eq('inspection_id', id).order('created_at')
    setDefects((d as Defect[]) || [])
    const { data: p } = await supabase.from('photos').select('*').eq('inspection_id', id).order('created_at')
    setPhotos((p as Photo[]) || [])
    if (draft) {
      const serverContent = JSON.stringify({ form_data: fi.form_data, summary: fi.summary, pallet_data: fi.pallet_data })
      if (JSON.stringify(draft.data) !== serverContent) setRestore(draft.data as { form_data?: unknown; summary?: unknown; pallet_data?: unknown })
      else await clearLocalDraft('inspection', id!)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // B6 Stage 1 — mirror the open inspection to this device on every change, as a
  // safety net alongside the normal Supabase writes. Pure insurance; failures in
  // localDraft are swallowed and never affect the live inspection.
  useEffect(() => {
    if (!insp?.id) return
    saveLocalDraft('inspection', insp.id, { form_data: insp.form_data, summary: insp.summary, pallet_data: insp.pallet_data }, (insp as { updated_at?: string }).updated_at ?? null)
    // If this is an offline-created (pending) inspection, keep its queued copy
    // current so the sync-on-reconnect pushes the latest results. Self-guards.
    if (isPending) void updatePendingInspection(insp)
  }, [insp, isPending])

  // Tell the batch sync which inspection is open so it doesn't race this screen.
  useEffect(() => { setOpenInspection(id || null); return () => setOpenInspection(null) }, [id])

  // When this is a pending (offline-created) inspection and connectivity returns,
  // sync IT from here — capturing the latest edits — then drop the pending state so
  // further saves go straight to the now-live server row.
  const selfSyncedRef = useRef(false)
  useEffect(() => {
    if (!isPending) { selfSyncedRef.current = false; return }
    if (online && insp && sku && !selfSyncedRef.current) {
      selfSyncedRef.current = true
      syncOnePending(insp, profile.id).then(ok => {
        if (ok) { setIsPending(false); setOfflineNote(false) }
        else selfSyncedRef.current = false   // retry on the next change/reconnect
      })
    }
  }, [online, isPending, insp, sku, profile.id])

  const applyRestore = async () => {
    if (!insp || !restore) return
    const r = restore
    const next = {
      ...insp,
      form_data: (r.form_data as Insp['form_data']) ?? insp.form_data,
      summary: (r.summary as Insp['summary']) ?? insp.summary,
      pallet_data: (r.pallet_data as Insp['pallet_data']) ?? insp.pallet_data,
    }
    setInsp(next)
    setRestore(null)
    try {
      await supabase.from('inspections').update({ form_data: next.form_data, summary: next.summary, pallet_data: next.pallet_data, updated_at: new Date().toISOString() }).eq('id', insp.id)
    } catch { /* remains in the local draft until the next successful save */ }
  }
  const discardRestore = async () => { if (insp) await clearLocalDraft('inspection', insp.id); setRestore(null) }

  const loadCustomDisps = useCallback(async () => {
    const { data } = await supabase.from('custom_dispositions').select('id,label,cls').order('label')
    setCustomDisps((data as CustomDisp[]) || [])
  }, [])
  useEffect(() => { loadCustomDisps() }, [loadCustomDisps])

  const saveSummary = async (patch: Partial<Insp['summary']>) => {
    if (!insp) return
    const s = { ...insp.summary, ...patch }
    setInsp({ ...insp, summary: s })
    await supabase.from('inspections').update({ summary: s, updated_at: new Date().toISOString() }).eq('id', insp.id)
  }
  const onDispChange = async (val: string) => {
    if (val === '__add__') { await saveSummary({ disposition: 'custom', disposition_custom: '', disposition_cls: 'hold' }); return }
    if (val.startsWith('saved:')) {
      const c = customDisps.find(d => d.id === val.slice(6))
      if (c) await saveSummary({ disposition: 'custom', disposition_custom: c.label, disposition_cls: c.cls })
      return
    }
    await saveSummary({ disposition: val, disposition_custom: '', disposition_cls: '' })
  }
  const saveCustomDisp = async () => {
    if (!insp) return
    const label = (insp.summary.disposition_custom || '').trim()
    const cls = insp.summary.disposition_cls || 'hold'
    if (!label) { alert('Type the disposition text first.'); return }
    const { error } = await supabase.from('custom_dispositions').insert({ label, cls, created_by: profile.id })
    if (error && !/duplicate|unique/i.test(error.message)) { alert('Could not save: ' + error.message); return }
    setDispSaveChecked(false)
    await loadCustomDisps()
    setSubmitMsg('Custom disposition saved for future use.')
  }
  useEffect(() => {
    photos.forEach(async p => {
      if (!photoUrls[p.storage_path]) {
        const { data } = await supabase.storage.from('qc-photos').createSignedUrl(p.storage_path, 3600)
        if (data?.signedUrl) setPhotoUrls(prev => ({ ...prev, [p.storage_path]: data.signedUrl }))
      }
    })
  }, [photos]) // eslint-disable-line

  const inspectorEditable = !!(insp && (insp.status==='draft'||insp.status==='rejected') && insp.inspector_id===profile.id)
  const canAmend = profile.role === 'admin'
  const editable = inspectorEditable || canAmend

  // Audit: stamp who/when + a short log when the APPROVER edits a non-draft report
  const recordAmend = async (label: string, dedupe = false) => {
    if (!insp || !canAmend || insp.status === 'draft') return
    const now = new Date().toISOString()
    const log = Array.isArray(insp.amend_log) ? [...insp.amend_log] : []
    const last = log[log.length - 1]
    if (!(dedupe && last && last.label === label)) {
      log.push({ at: now, by: profile.full_name, label })
      if (log.length > 50) log.splice(0, log.length - 50)
    }
    setInsp(prev => prev ? { ...prev, amended_at: now, amended_by: profile.id, amend_log: log } : prev)
    try { await supabase.from('inspections').update({ amended_at: now, amended_by: profile.id, amend_log: log }).eq('id', insp.id) } catch { /* non-blocking */ }
  }

  const resendReport = async () => {
    if (!insp) return
    if (!confirm('Re-send the updated report to the saved distribution list?')) return
    const { data, error } = await supabase.functions.invoke('send-report', { body: { inspection_id: insp.id } })
    if (error || data?.ok === false) { alert('Re-send failed: ' + (error?.message || data?.error || 'Unknown error')); return }
    alert('Updated report re-sent.')
  }

  const changeStatus = async (status: string, label: string, confirmMsg: string) => {
    if (!insp) return
    if (!confirm(confirmMsg)) return
    await recordAmend(label)
    const { error } = await supabase.from('inspections').update({ status }).eq('id', insp.id)
    if (error) { alert('Failed: ' + error.message); return }
    setSubmitMsg(label); load()
  }

  useEffect(() => {
    if (!canAmend) return
    supabase.from('skus').select('part_no').eq('active', true).order('part_no')
      .then(({ data }) => setSkuOptions((data || []).map((s: { part_no: string }) => s.part_no)))
  }, [canAmend])

  useEffect(() => {
    if (insp?.report_logo_path) {
      supabase.storage.from('qc-photos').createSignedUrl(insp.report_logo_path, 3600)
        .then(({ data }) => setLogoUrl(data?.signedUrl || ''))
    } else setLogoUrl('')
  }, [insp?.report_logo_path])

  // Make the logo's solid background transparent (samples the corners, keys out that
  // colour) so the logo's lettering blends onto the report's navy header.
  const removeLogoBackground = (file: File): Promise<Blob> => new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas')
      cv.width = img.naturalWidth; cv.height = img.naturalHeight
      const ctx = cv.getContext('2d')
      if (!ctx) { reject(new Error('no canvas')); return }
      ctx.drawImage(img, 0, 0)
      const imgData = ctx.getImageData(0, 0, cv.width, cv.height)
      const px = imgData.data
      const corners = [[0, 0], [cv.width - 1, 0], [0, cv.height - 1], [cv.width - 1, cv.height - 1]]
        .map(([x, y]) => { const i = (y * cv.width + x) * 4; return [px[i], px[i + 1], px[i + 2]] })
      const bg = [0, 1, 2].map(c => Math.round(corners.reduce((s, k) => s + k[c], 0) / corners.length))
      const tol = 70
      for (let i = 0; i < px.length; i += 4) {
        const d = Math.sqrt((px[i] - bg[0]) ** 2 + (px[i + 1] - bg[1]) ** 2 + (px[i + 2] - bg[2]) ** 2)
        if (d < tol) px[i + 3] = 0
      }
      ctx.putImageData(imgData, 0, 0)
      cv.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = URL.createObjectURL(file)
  })

  const uploadLogo = async (file: File, cutBg = false) => {
    if (!insp) return
    let body: Blob = file
    let ext = (file.name.split('.').pop() || 'png').toLowerCase()
    let contentType = file.type || 'image/png'
    if (cutBg) {
      try { body = await removeLogoBackground(file); ext = 'png'; contentType = 'image/png' }
      catch { alert('Could not remove the background; uploading the original instead.') }
    }
    const path = `logos/${insp.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('qc-photos').upload(path, body, { upsert: true, contentType })
    if (upErr) { alert('Logo upload failed: ' + upErr.message); return }
    const { error } = await supabase.from('inspections').update({ report_logo_path: path }).eq('id', insp.id)
    if (error) { alert('Could not save logo: ' + error.message); return }
    await recordAmend('Changed report logo')
    setSubmitMsg('Report logo updated.'); load()
  }
  const clearLogo = async () => {
    if (!insp) return
    if (!confirm('Reset to the default NITRA logo?')) return
    const { error } = await supabase.from('inspections').update({ report_logo_path: null }).eq('id', insp.id)
    if (error) { alert('Failed: ' + error.message); return }
    await recordAmend('Reset report logo to default')
    setLogoUrl(''); setSubmitMsg('Logo reset to default.'); load()
  }

  const openAmend = () => {
    if (!insp) return
    setAmendPo(insp.po_no || ''); setAmendPart(insp.part_no || ''); setAmendBatch(insp.batch || '')
    setAmendLot(insp.lot_size || 0); setAmendApp(insp.app_sample || 0); setAmendFun(insp.fun_sample || 0)
    setAmendOpen(true)
  }
  const applyAmend = async () => {
    if (!insp) return
    const newPart = amendPart.trim()
    if (newPart && newPart !== insp.part_no) {
      const { data: s, error } = await supabase.from('skus').select('part_no').eq('part_no', newPart).maybeSingle()
      if (error) { alert('Lookup failed: ' + error.message); return }
      if (!s) { alert(`No SKU named "${newPart}" exists. Add/import it first, then amend.`); return }
    }
    const changes: string[] = []
    if (amendPo.trim() !== (insp.po_no || '')) changes.push(`PO → ${amendPo.trim() || '(blank)'}`)
    if (newPart && newPart !== insp.part_no) changes.push(`Part No → ${newPart}`)
    if (amendBatch.trim() !== (insp.batch || '')) changes.push(`Batch → ${amendBatch.trim() || '(blank)'}`)
    if (amendLot !== insp.lot_size) changes.push(`Lot size → ${amendLot}`)
    if (amendApp !== insp.app_sample) changes.push(`App sample → ${amendApp}`)
    if (amendFun !== insp.fun_sample) changes.push(`Fun sample → ${amendFun}`)
    const wasApproved = insp.status === 'approved'
    const { error } = await supabase.from('inspections').update({
      po_no: amendPo.trim(), part_no: newPart || insp.part_no, batch: amendBatch.trim(),
      lot_size: amendLot, app_sample: amendApp, fun_sample: amendFun, updated_at: new Date().toISOString(),
    }).eq('id', insp.id)
    if (error) { alert('Amendment failed: ' + error.message); return }
    if (changes.length) await recordAmend(changes.join(' · '))
    setAmendOpen(false); setSubmitMsg('Report amended.'); await load()
    if (wasApproved && changes.length && confirm('This report was already approved (and likely emailed). Re-send the updated report to the distribution list?')) {
      const { data, error: e2 } = await supabase.functions.invoke('send-report', { body: { inspection_id: insp.id } })
      if (e2 || data?.ok === false) alert('Re-send failed: ' + (e2?.message || data?.error || '')); else alert('Updated report re-sent.')
    }
  }

  const saveFd = async (fd: Insp['form_data']) => {
    if (!insp) return
    setInsp({ ...insp, form_data: fd })
    // Offline-created and not yet on the server: the local mirror + self-sync own
    // this write. Skipping the (doomed) server update here avoids a 0-row update
    // racing the reconnect sync. Once synced, isPending clears and saves resume.
    if (isPending) return
    const { error } = await supabase.from('inspections').update({ form_data: fd, updated_at: new Date().toISOString() }).eq('id', insp.id)
    if (error) {
      // Offline: keep the optimistic edit (already in state + the local draft) and
      // show a calm notice — don't nag with a scary "TypeError" alert.
      if (isNetworkErr(error)) setOfflineNote(true)
      else alert('Save failed: ' + error.message)
    } else setOfflineNote(false)
    if (canAmend && insp.status !== 'draft') recordAmend('Edited inspection results', true)
  }

  const ensureDefect = async (itemKey: string, itemLabel: string, pieceNo: number, tabName: string) => {
    if (!insp) return
    const { data } = await supabase.from('defects').select('id')
      .eq('inspection_id', insp.id).eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tabName)
      .limit(1).maybeSingle()
    if (!data) await supabase.from('defects').insert({
      inspection_id: insp.id, piece_no: pieceNo, tab: tabName,
      section: tabName.toUpperCase(), item_key: itemKey, item_label: itemLabel,
      defect_type: 'unspecified', severity: 'minor', measurement_value: null, measurement_unit: 'mm', comment: '',
    })
  }
  const removeDefect = async (itemKey: string, pieceNo: number, tabName: string) => {
    if (!insp) return
    // Detach photos from the defect FIRST so the defect's cascade-delete can't remove
    // them; they survive and become pass photos (never deleted on a Fail→Pass change).
    const { error: pErr } = await supabase.from('photos').update({ defect_id: null, is_pass_photo: true })
      .eq('inspection_id', insp.id).eq('item_key', itemKey).eq('piece_no', pieceNo)
    if (pErr) console.error('photo detach failed', pErr)
    await supabase.from('defects').delete()
      .eq('inspection_id', insp.id).eq('item_key', itemKey).eq('piece_no', pieceNo).eq('tab', tabName)
  }

  // N/A overrides — apply N/A for a param across ALL pieces at once
  const naOverrides = insp?.form_data.na_overrides || {}
  const toggleNaOverride = async (itemKey: string, _itemLabel: string, isMeas: boolean) => {
    if (!insp) return
    const fd = { ...insp.form_data, na_overrides: { ...naOverrides } }
    if (fd.na_overrides![itemKey]) {
      delete fd.na_overrides![itemKey]
    } else {
      fd.na_overrides![itemKey] = true
      // Apply NA to all pieces for this item
      const n = isMeas ? insp.fun_sample : insp.app_sample
      for (let p = 1; p <= n; p++) {
        const rkey = `${itemKey}:${p}`
        const old = isMeas ? fd.meas_results?.[rkey] : fd.results[rkey]
        if (isMeas) fd.meas_results = { ...fd.meas_results, [rkey]: 'NA' }
        else fd.results = { ...fd.results, [rkey]: 'NA' }
        if (old === 'F') await removeDefect(itemKey, p, isMeas ? 'measure' : 'form')
      }
    }
    await saveFd(fd)
    load()
  }

  // Auto-NA: gloss-black-only items on non-gloss-black finishes; black-only items
  // (e.g. orange peel) on non-black finishes. Any black finish keeps orange peel.
  const autoNaItems = useMemo(() => {
    if (!sku) return new Set<string>()
    const gb = isGlossBlack(sku.finish)
    const bk = isBlack(sku.finish)
    const na = new Set<string>()
    for (const s of SECTIONS) for (const i of s.items) {
      if (i.glossBlackOnly && !gb) na.add(i.key)
      if (i.blackOnly && !bk) na.add(i.key)
    }
    return na
  }, [sku])

  // ---- Sticky progress bar (QW-2) ----
  const formKeys = useMemo(() => SECTIONS.flatMap(sc => sc.items.map(i => i.key)), [])
  const measKeys = useMemo(() => MEAS_SECTIONS.flatMap(mc => mc.cols.map(c => c.key)), [])
  const formAnswered = (key: string, pc: number) =>
    autoNaItems.has(key) || !!naOverrides[key] || insp?.form_data.results[`${key}:${pc}`] !== undefined
  const measAnswered = (key: string, pc: number) =>
    !!naOverrides[key] || insp?.form_data.meas_results?.[`${key}:${pc}`] !== undefined
  const progress = useMemo(() => {
    if (!insp) return null
    if (tab === 'form') {
      const done = formKeys.filter(k => formAnswered(k, piece)).length
      const piecesDone = Array.from({ length: insp.app_sample }, (_, i) => i + 1)
        .filter(pc => formKeys.every(k => formAnswered(k, pc))).length
      return { done, total: formKeys.length, piecesDone, pieces: insp.app_sample }
    }
    if (tab === 'measure') {
      const done = measKeys.filter(k => measAnswered(k, piece)).length
      const piecesDone = Array.from({ length: insp.fun_sample }, (_, i) => i + 1)
        .filter(pc => measKeys.every(k => measAnswered(k, pc))).length
      return { done, total: measKeys.length, piecesDone, pieces: insp.fun_sample }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insp, tab, piece, autoNaItems, naOverrides])
  const jumpNextUnanswered = () => {
    if (!insp) return
    if (tab === 'form') {
      const k = formKeys.find(key => !formAnswered(key, piece))
      if (k) { document.getElementById(`row-form-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
      const nextPc = Array.from({ length: insp.app_sample }, (_, i) => i + 1).find(pc => pc !== piece && !formKeys.every(key => formAnswered(key, pc)))
      if (nextPc) { setPiece(nextPc); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    } else if (tab === 'measure') {
      const k = measKeys.find(key => !measAnswered(key, piece))
      if (k) { document.getElementById(`row-meas-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
      const nextPc = Array.from({ length: insp.fun_sample }, (_, i) => i + 1).find(pc => pc !== piece && !measKeys.every(key => measAnswered(key, pc)))
      if (nextPc) { setPiece(nextPc); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    }
  }

  // ---- B2: per-step completion states for the stepper header ----
  type StepState = 'done' | 'partial' | 'empty'
  const stepState = (k: typeof TABS[number]): StepState => {
    if (!insp) return 'empty'
    if (k === 'form') {
      const total = insp.app_sample * formKeys.length
      let done = 0
      for (let pc = 1; pc <= insp.app_sample; pc++) done += formKeys.filter(key => formAnswered(key, pc)).length
      return done === 0 ? 'empty' : done >= total ? 'done' : 'partial'
    }
    if (k === 'measure') {
      const total = insp.fun_sample * measKeys.length
      let done = 0
      for (let pc = 1; pc <= insp.fun_sample; pc++) done += measKeys.filter(key => measAnswered(key, pc)).length
      return done === 0 ? 'empty' : done >= total ? 'done' : 'partial'
    }
    if (k === 'photos') return photos.length > 0 ? 'done' : 'empty'
    if (k === '100pct') {
      // Only meaningful when triggered; treated as partial until the trigger clears.
      return triggeredItems.length > 0 ? 'partial' : 'done'
    }
    // summary: complete once a decision is chosen
    const d = insp.summary.disposition
    return d && (d !== 'custom' || (insp.summary.disposition_custom || '').trim()) ? 'done' : 'empty'
  }
  const stepGlyph = (st: StepState) => st === 'done' ? '✓' : st === 'partial' ? '●' : '○'

  const setResult = async (itemKey: string, itemLabel: string, pieceNo: number, val: PFNA, isMeas: boolean) => {
    if (!insp) return
    if (autoNaItems.has(itemKey)) return  // blocked — auto-NA
    if (naOverrides[itemKey]) return       // blocked — global NA override
    const rkey = `${itemKey}:${pieceNo}`
    const fd = { ...insp.form_data }
    const old = isMeas ? fd.meas_results?.[rkey] : fd.results[rkey]
    setHistory(h => [...h, { type: isMeas?'set_meas':'set_result', key: rkey, prev: old, isMeas }])
    if (isMeas) fd.meas_results = { ...fd.meas_results, [rkey]: val }
    else fd.results = { ...fd.results, [rkey]: val }
    await saveFd(fd)
    const tabName = isMeas ? 'measure' : 'form'
    if (val==='F' && old!=='F') await ensureDefect(itemKey, itemLabel, pieceNo, tabName)
    if (old==='F' && val!=='F') await removeDefect(itemKey, pieceNo, tabName)
    // Keep any photos for this piece in sync with the new verdict (never delete them)
    if (val==='P' || val==='F') {
      const { error: pErr } = await supabase.from('photos').update({ is_pass_photo: val==='P' })
        .eq('inspection_id', insp.id).eq('item_key', itemKey).eq('piece_no', pieceNo)
      if (pErr) console.error('photo sync failed', pErr)
    }
    load()
  }

  // Per-parameter undo for the pallet/container tab (reverts the latest matching action)
  const undoLast = async () => {
    if (!insp || history.length===0) return
    const last = history[history.length-1]
    setHistory(h => h.slice(0,-1))
    const fd = { ...insp.form_data }
    if (last.type==='set_result'||last.type==='set_meas') {
      const old = last.isMeas ? fd.meas_results?.[last.key] : fd.results[last.key]
      if (last.isMeas) {
        if (last.prev===undefined) delete fd.meas_results[last.key]
        else fd.meas_results = { ...fd.meas_results, [last.key]: last.prev }
      } else {
        if (last.prev===undefined) delete fd.results[last.key]
        else fd.results = { ...fd.results, [last.key]: last.prev }
      }
      await saveFd(fd)
      const [ik, pn] = last.key.split(':')
      const tn = last.isMeas ? 'measure' : 'form'
      if (old==='F' && last.prev!=='F') await removeDefect(ik, +pn, tn)
      if (old!=='F' && last.prev==='F') await ensureDefect(ik, ik, +pn, tn)
    } else if (last.type==='select_all' && last.prevMap) {
      if (last.isMeas) fd.meas_results = { ...fd.meas_results, ...last.prevMap }
      else fd.results = { ...fd.results, ...last.prevMap }
      await saveFd(fd)
      for (const rkey of Object.keys(last.prevMap)) {
        const [ik, pn] = rkey.split(':'); const tn = last.isMeas?'measure':'form'
        const curVal = last.isMeas ? fd.meas_results[rkey] : fd.results[rkey]
        const prevVal = last.prevMap[rkey]
        if (curVal==='F' && prevVal!=='F') await removeDefect(ik, +pn, tn)
        if (curVal!=='F' && prevVal==='F') await ensureDefect(ik, ik, +pn, tn)
      }
    } else if (last.type==='set_pallet') {
      const pd = { ...insp.pallet_data }
      if (last.prev===undefined) delete pd[last.key]; else pd[last.key]=last.prev
      setInsp({ ...insp, pallet_data: pd })
      await supabase.from('inspections').update({ pallet_data: pd, updated_at: new Date().toISOString() }).eq('id', insp.id)
    } else if (last.type==='pallet_all' && last.prevMap) {
      const pd = { ...insp.pallet_data }
      for (const [k,v] of Object.entries(last.prevMap)) { if (v===undefined) delete pd[k]; else pd[k]=v }
      setInsp({ ...insp, pallet_data: pd })
      await supabase.from('inspections').update({ pallet_data: pd, updated_at: new Date().toISOString() }).eq('id', insp.id)
    }
    load()
  }

  const selectAllSection = async (sectionKey: string, val: PFNA, isMeas: boolean, cols?: string[]) => {
    if (!insp) return
    const fd = { ...insp.form_data }
    const prevMap: Record<string,PFNA> = {}
    if (isMeas && cols) {
      for (const key of cols) {
        if (naOverrides[key]) continue
        const rkey = `${key}:${piece}`
        prevMap[rkey] = fd.meas_results?.[rkey]
        fd.meas_results = { ...fd.meas_results, [rkey]: val }
        if (val==='F' && prevMap[rkey]!=='F') await ensureDefect(key, key, piece, 'measure')
        if (val!=='F' && prevMap[rkey]==='F') await removeDefect(key, piece, 'measure')
      }
    } else {
      const sec = SECTIONS.find(s => s.key===sectionKey); if (!sec) return
      for (const item of sec.items) {
        if (naOverrides[item.key] || autoNaItems.has(item.key)) continue
        const n = insp.app_sample
        if (piece > n) continue
        const rkey = `${item.key}:${piece}`
        prevMap[rkey] = fd.results[rkey]
        fd.results = { ...fd.results, [rkey]: val }
        if (val==='F' && prevMap[rkey]!=='F') await ensureDefect(item.key, bi(item.label), piece, 'form')
        if (val!=='F' && prevMap[rkey]==='F') await removeDefect(item.key, piece, 'form')
      }
    }
    setHistory(h => [...h, { type:'select_all', key:sectionKey, prev:undefined, isMeas, prevMap }])
    await saveFd(fd)
    load()
  }

  // Rule engine
  const allFormItems = useMemo(() => SECTIONS.flatMap(s => s.items.map(i => ({ key:i.key, label:bi(i.label), group:i.group }))), [bi])
  const allMeasItems = useMemo(() => MEAS_COLS.map(c => ({ key:c.key, label:bi(c.label) })), [bi])
  const labelOf = useMemo(() => {
    const m: Record<string,string> = {}
    for (const s of SECTIONS) for (const it of s.items) m[it.key] = bi(it.label)
    for (const c of MEAS_COLS) m[c.key] = bi(c.label)
    for (const it of PALLET_ITEMS) m[it.key] = bi(it.label)
    for (const sl of PHOTO_SLOTS) m[sl.key] = bi(sl.label)
    return (k: string) => m[k] || k.replace(/_/g,' ')
  }, [bi])
  const outcomeRows = useMemo(() => computeOutcomes(insp?.form_data, labelOf), [insp, labelOf])
  const failedParamStr = useMemo(() => {
    const f = outcomeRows.filter(r => r.fail > 0).map(r => r.parameter)
    return f.length ? f.join(', ') : 'the affected parameter(s)'
  }, [outcomeRows])
  const verdicts = useMemo(() => {
    if (!insp) return []
    return evaluateAll(insp.form_data, allFormItems, allMeasItems, insp.app_sample, insp.fun_sample, 4, 2)
  }, [insp, allFormItems, allMeasItems])

  const addExtra = async (verdict: ItemVerdict, result: 'P'|'F') => {
    if (!insp) return
    const fd = { ...insp.form_data }; let idx: number
    if (verdict.tab==='form') { const prev=fd.extra_results[verdict.key]||[]; idx=prev.length+1; fd.extra_results={...fd.extra_results,[verdict.key]:[...prev,result]} }
    else { const prev=fd.meas_extra_results[verdict.key]||[]; idx=prev.length+1; fd.meas_extra_results={...fd.meas_extra_results,[verdict.key]:[...prev,result]} }
    await saveFd(fd)
    if (result==='F') await ensureDefect(verdict.key, `${verdict.label} (extra)`, -idx, 'extra')
    load()
  }
  const undoExtra = async (verdict: ItemVerdict) => {
    if (!insp) return
    const fd = { ...insp.form_data }; let popped: PFNA, idx: number
    if (verdict.tab==='form') { const prev=[...(fd.extra_results[verdict.key]||[])]; popped=prev.pop(); idx=prev.length+1; fd.extra_results={...fd.extra_results,[verdict.key]:prev} }
    else { const prev=[...(fd.meas_extra_results[verdict.key]||[])]; popped=prev.pop(); idx=prev.length+1; fd.meas_extra_results={...fd.meas_extra_results,[verdict.key]:prev} }
    await saveFd(fd)
    if (popped==='F') await removeDefect(verdict.key, -idx, 'extra')
    load()
  }

  const submit = async () => {
    if (!insp) return
    const missing: string[] = []
    if (!insp.summary.disposition || (insp.summary.disposition === 'custom' && !(insp.summary.disposition_custom||'').trim())) missing.push(t('disposition'))
    const pending = verdicts.filter(v => v.status==='extra_needed')
    if (pending.length) missing.push(`${t('extraNeeded')}: ${pending.map(v=>v.label).join(', ')}`)
    if (missing.length) { alert('Cannot submit yet:\n\n• '+missing.join('\n• ')); return }
    const confirmed = confirm(`${t('submitConfirm')}\n\n${t('partNo')}: ${insp.part_no}\n${t('poNo')}: ${insp.po_no||'—'}\n${t('lotSize')}: ${insp.lot_size}\nDefects: ${defects.length}\n${t('disposition')}: ${insp.summary.disposition}\n\n${t('submitWarning')}`)
    if (!confirmed) return
    const { error } = await supabase.from('inspections').update({ status:'submitted', submitted_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id', insp.id)
    if (error) { alert(isNetworkErr(error) ? t('offlineCantSubmit') : 'Submit failed: '+error.message); return }
    await clearLocalDraft('inspection', insp.id)
    setSubmitMsg('✓ '+t('submit')); load()
  }



  const [emailOpen, setEmailOpen] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const emailInteractiveReport = () => { if (insp) setEmailOpen(true) }
  const doEmailReport = async (emails: string[]) => {
    if (!insp) return
    setEmailBusy(true)
    const { data, error } = await supabase.functions.invoke('send-report', { body: { inspection_id: insp.id, emails } })
    setEmailBusy(false)
    if (error || data?.ok === false) { alert('Email failed: ' + (error?.message || data?.error || 'Unknown error')); return }
    setEmailOpen(false)
    alert('Interactive report email sent.')
  }

  const getPhotosFor = (itemKey: string, pNo: number) => photos.filter(p => p.item_key===itemKey && p.piece_no===pNo)
  const allItems = SECTIONS.flatMap(s => s.items.map(i => ({ key:i.key, label:bi(i.label) })))
  const allMeasItemsFlat = MEAS_COLS.map(c => ({ key:c.key, label:bi(c.label) }))
  const allItemsForReassign = [...allItems, ...allMeasItemsFlat]

  const RefIcon = ({ itemKey, label }: { itemKey:string; label:string }) => {
    const src = REF_MAP[itemKey]; if (!src) return null
    return <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:16, padding:'0 4px', color:'var(--navy)', minHeight:36 }} onClick={e => { e.stopPropagation(); setModal({ type:'refimg', src, label }) }}>📋</button>
  }

  const PlusBtn = ({ itemKey, itemLabel, pieceNo, result, tabName }: { itemKey:string; itemLabel:string; pieceNo:number; result:PFNA; tabName:Tab5 }) => {
    if (!result || result==='NA' || !editable) return null
    const ph = getPhotosFor(itemKey, pieceNo)
    const cls = result==='F' ? (ph.some(p=>!p.is_pass_photo)?'plus-btn has-fail-photo':'plus-btn') : (ph.some(p=>p.is_pass_photo)?'plus-btn has-photo':'plus-btn')
    return <button className={cls} onClick={() => setModal({ type:result==='F'?'fail':'pass', itemKey, itemLabel, pieceNo, tab:tabName })}>{ph.length>0?`📷 ${ph.length}`:'📷+'}</button>
  }

  // NA Override toggle button
  const NaOverrideBtn = ({ itemKey, itemLabel, isMeas }: { itemKey:string; itemLabel:string; isMeas:boolean }) => {
    if (!editable) return null
    const on = naOverrides[itemKey]
    return (
      <button className="btn ghost" style={{ minHeight:32, padding:'2px 10px', fontSize:12, borderColor: on?'var(--amber)':'var(--line)', color:on?'var(--amber)':'var(--ink-soft)', background: on?'var(--amber-bg)':'transparent' }}
        title={on ? 'Click to remove N/A override' : 'Mark N/A for ALL pieces of this inspection'} onClick={() => toggleNaOverride(itemKey, itemLabel, isMeas)}>
        {on ? '🔒 NA all' : 'NA all'}
      </button>
    )
  }

  const PFNAButtons = ({ val, itemKey, itemLabel, pieceNo, isMeas, tabName }: { val:PFNA; itemKey:string; itemLabel:string; pieceNo:number; isMeas:boolean; tabName:Tab5 }) => {
    const blocked = autoNaItems.has(itemKey) || naOverrides[itemKey]
    const effVal = (autoNaItems.has(itemKey) || naOverrides[itemKey]) ? 'NA' : val
    return (
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <div className="pfna">
          {(['P','F','NA'] as const).map(v => (
            <button key={v} disabled={!editable || blocked}
              className={`${v==='P'?'p':v==='F'?'f':'n'} ${effVal===v?'on':''}`}
              onClick={() => setResult(itemKey, itemLabel, pieceNo, effVal===v?undefined:v, isMeas)}>{v}</button>
          ))}
        </div>
        <PlusBtn itemKey={itemKey} itemLabel={itemLabel} pieceNo={pieceNo} result={effVal} tabName={tabName} />
      </div>
    )
  }

  const SectionControls = ({ sectionKey, isMeas, cols }: { sectionKey:string; isMeas:boolean; cols?:string[] }) => {
    if (!editable) return null
    return (
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <button className="btn ok" style={{ minHeight:36, padding:'4px 12px', fontSize:13 }} onClick={() => selectAllSection(sectionKey,'P',isMeas,cols)}>{t('allPass')}</button>
        <button className="btn danger" style={{ minHeight:36, padding:'4px 12px', fontSize:13 }} onClick={() => selectAllSection(sectionKey,'F',isMeas,cols)}>{t('allFail')}</button>
        <button className="btn ghost" style={{ minHeight:36, padding:'4px 12px', fontSize:13 }} onClick={() => selectAllSection(sectionKey,'NA',isMeas,cols)}>{t('allNA')}</button>
        <button className="btn ghost" style={{ minHeight:36, padding:'4px 12px', fontSize:13, borderColor:'var(--amber)', color:'var(--amber)' }}
          onClick={undoLast} disabled={history.length===0}>{t('undo')} {history.length>0?`(${history.length})`:''}</button>
      </div>
    )
  }

  const triggeredItems = verdicts.filter(v=>v.status==='full_inspection').map(v=>({ key:v.key, label:v.label }))
  const baseResultsByKey: Record<string, Record<string, PFNA>> = (() => {
    const out: Record<string, Record<string, PFNA>> = {}
    const scan = (map: Record<string, PFNA> | undefined) => {
      for (const [k, v] of Object.entries(map || {})) {
        if (v !== 'P' && v !== 'F') continue
        const [key, pc] = k.split(':'); if (!pc) continue
        ;(out[key] ||= {})[pc] = v
      }
    }
    scan(insp?.form_data?.results); scan(insp?.form_data?.meas_results)
    return out
  })()
  const nPieces = insp?.app_sample ?? 0

  // ── Photos tab: every parameter (even empty) grouped by section header ──
  const photoSections = useMemo(() => {
    const byKey: Record<string, Photo[]> = {}
    for (const p of photos) { if (!p.item_key) continue; (byKey[p.item_key] ||= []).push(p) }
    for (const k in byKey) byKey[k].sort((a, b) => (a.is_pass_photo ? 1 : 0) - (b.is_pass_photo ? 1 : 0) || a.piece_no - b.piece_no)
    const secs: { title: string; params: { key: string; label: string; photos: Photo[] }[] }[] = []
    for (const s of SECTIONS) secs.push({ title: bi(s.title), params: s.items.map(i => ({ key: i.key, label: bi(i.label), photos: byKey[i.key] || [] })) })
    for (const ms of MEAS_SECTIONS) secs.push({ title: bi(ms.title), params: ms.cols.map(c => ({ key: c.key, label: bi(c.label), photos: byKey[c.key] || [] })) })
    return secs
  }, [photos, bi])

  const deletePhoto = async (p: Photo) => {
    if (!confirm('Delete this photo/video? This cannot be undone.')) return
    const { data, error } = await supabase.from('photos').delete().eq('id', p.id).select('id')
    if (error) { alert('Delete failed: ' + error.message); return }
    if (!data || data.length === 0) { alert('Delete was blocked by the database (photos RLS). Run migration 06 in the Supabase SQL Editor, then try again.'); return }
    recordAmend('Deleted a photo')
    load()
  }

  const addAppendixPhoto = async (path: string, type: 'photo'|'video') => {
    if (!insp) return
    const { error } = await supabase.from('photos').insert({
      inspection_id: insp.id, storage_path: path, media_type: type,
      is_pass_photo: true, item_key: 'appendix', piece_no: 0, comment: '',
    })
    if (error) { alert('Could not add appendix photo: ' + error.message); return }
    recordAmend('Added an appendix photo')
    load()
  }

  // Report appendix: section header → parameter, split Approved / Failed (mirrors the Photos tab)
  const appendixSections = (pass: boolean) => {
    const secs = photoSections
      .map(sec => ({
        title: sec.title,
        params: sec.params
          .map(pm => ({ label: pm.label, photos: pm.photos.filter(p => p.is_pass_photo === pass) }))
          .filter(pm => pm.photos.length),
      }))
      .filter(sec => sec.params.length)
    const known = new Set<string>()
    for (const sec of photoSections) for (const pm of sec.params) known.add(pm.key)
    const otherByKey = new Map<string, Photo[]>()
    for (const p of photos) {
      if (!p.item_key || known.has(p.item_key) || p.is_pass_photo !== pass) continue
      if (!otherByKey.has(p.item_key)) otherByKey.set(p.item_key, [])
      otherByKey.get(p.item_key)!.push(p)
    }
    if (otherByKey.size) secs.push({ title: 'Other', params: [...otherByKey.entries()].map(([k, ph]) => ({ label: labelOf(k), photos: ph })) })
    return secs
  }

  // Keep all hooks above these early returns. React error #310 can happen if a hook is skipped on the loading render.
  if (loadErr) return (
    <div className="page" style={{ paddingTop:24 }}>
      <div className="card" style={{ border:'2px solid var(--fail)' }}>
        <h2 style={{ color:'var(--fail)' }}>Could not load inspection / 无法加载检验单</h2>
        <p className="muted" style={{ whiteSpace:'pre-wrap' }}>{loadErr}</p>
      </div>
    </div>
  )
  if (!insp || !sku) return <div className="page" style={{ textAlign:'center', paddingTop:40 }}>Loading…</div>

  return (
    <div className="page" style={{ paddingBottom: inspectorEditable ? 84 : undefined }}>
      {isPending && (
        <div className="banner warn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⏳</span><span>{t('notSyncedYet')}</span>
        </div>
      )}
      {offlineNote && (
        <div className="banner warn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📴</span><span>{t('offlineSaved')}</span>
        </div>
      )}
      {restore && (
        <div className="card" style={{ borderColor: 'var(--amber)', background: 'var(--amber-bg)', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('restoreTitle')}</div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{t('restoreBody')}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={applyRestore}>{t('restoreBtn')}</button>
            <button className="btn ghost" onClick={discardRestore}>{t('restoreDiscard')}</button>
          </div>
        </div>
      )}
      <button className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13, marginBottom:12 }} onClick={() => nav(-1)}>← Back</button>
      {(profile.role === 'admin' || profile.role === 'inspector') && <SharedPosCard inspId={insp.id} partNo={insp.part_no} profile={profile} />}
      {/* Header */}
      <div className="card">
        <div className="row"><h2 style={{ flex:1 }}>{insp.part_no} <span className={`pill ${insp.status}`}>{insp.status}</span></h2></div>
        <p className="muted">{sku.model} · {sku.size} · PCD {sku.pcd} · ET {sku.offset_txt} · CB {sku.cb_mm} · {sku.finish}
          {sku.wheel_weight_kg && <> · {sku.wheel_weight_kg.toFixed(2)} kg</>}</p>
        <p className="muted">{t('poNo')}: {insp.po_no||'—'} · {t('batch')}: {insp.batch||'—'} · {t('lotSize')}: {insp.lot_size} · App: {insp.app_sample} · Fun: {insp.fun_sample}</p>
        {insp.status==='rejected' && insp.review_note && <div className="banner bad" style={{ marginTop:8 }}>↩ {insp.review_note}</div>}
        {submitMsg && <div className="banner ok" style={{ marginTop:8 }}>{submitMsg}</div>}
        {insp.amended_at && (
          <div className="muted" style={{ fontSize:12, marginTop:6 }}>
            ✎ Amended by {insp.amend_log?.[insp.amend_log.length-1]?.by || '—'} · {new Date(insp.amended_at).toLocaleString()}
            {!!insp.amend_log?.length && <button style={{ background:'none', border:'none', color:'var(--navy)', cursor:'pointer', textDecoration:'underline', fontSize:12, marginLeft:6 }} onClick={()=>setHistOpen(o=>!o)}>{histOpen?'hide':'history'}</button>}
          </div>
        )}
        {histOpen && !!insp.amend_log?.length && (
          <div style={{ marginTop:6, fontSize:12, border:'1px solid var(--line)', borderRadius:8, padding:8, maxHeight:160, overflowY:'auto' }}>
            {[...insp.amend_log].reverse().map((e,i)=>(
              <div key={i} style={{ padding:'3px 0', borderBottom:'1px solid var(--line)' }}>
                <span className="muted">{new Date(e.at).toLocaleString()} · {e.by}</span><br />{e.label}
              </div>
            ))}
          </div>
        )}
        {canAmend && (
          <div className="row" style={{ gap:8, marginTop:10, flexWrap:'wrap' }}>
            <button className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13 }} onClick={openAmend}>✎ Amend details (admin)</button>
            {insp.status==='submitted' && <button className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13 }} onClick={()=>changeStatus('draft','Returned to inspector','Return this submitted report to the inspector for edits?')}>↩ Return to inspector</button>}
            {insp.status==='approved' && <>
              <button className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13 }} onClick={()=>changeStatus('draft','Re-opened to draft','Re-open this approved report to draft for re-work?')}>↩ Re-open to draft</button>
              <button className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13 }} onClick={resendReport}>📧 Re-send report</button>
            </>}
            <label className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13, cursor:'pointer' }}>
              🖼 {insp.report_logo_path ? 'Change report logo' : 'Set report logo'}
              <input type="file" accept="image/*" hidden onChange={e => { const f=e.target.files?.[0]; if (f) uploadLogo(f); (e.target as HTMLInputElement).value='' }} />
            </label>
            <label className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13, cursor:'pointer' }} title="Uploads the logo with its solid background made transparent, so it blends onto the navy report header">
              🪄 Logo · cut out background
              <input type="file" accept="image/*" hidden onChange={e => { const f=e.target.files?.[0]; if (f) uploadLogo(f, true); (e.target as HTMLInputElement).value='' }} />
            </label>
            {insp.report_logo_path && <button className="btn ghost" style={{ minHeight:34, padding:'4px 12px', fontSize:13 }} onClick={clearLogo}>Reset logo</button>}
          </div>
        )}
        {canAmend && logoUrl && (
          <div style={{ marginTop:8 }}>
            <span className="muted" style={{ fontSize:12 }}>Report logo (shown on the report instead of NITRA):</span><br />
            <img src={logoUrl} alt="logo" style={{ maxHeight:46, maxWidth:240, marginTop:4, background:'var(--navy)', padding:6, borderRadius:6 }} />
          </div>
        )}
      </div>

      {amendOpen && (
        <div className="modal-overlay" onClick={() => setAmendOpen(false)}>
          <div className="modal" style={{ width:'min(560px,94vw)', maxHeight:'88vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop:0 }}>Amend report</h2>
            <div className="grid2">
              <label className="fld"><span>{t('poNo')}</span>
                <input className="txt" value={amendPo} onChange={e => setAmendPo(e.target.value)} /></label>
              <label className="fld"><span>{t('partNo')}</span>
                <input className="txt" list="amend-skus" value={amendPart} onChange={e => setAmendPart(e.target.value)} /></label>
              <label className="fld"><span>{t('batch')}</span>
                <input className="txt" value={amendBatch} onChange={e => setAmendBatch(e.target.value)} /></label>
              <label className="fld"><span>{t('lotSize')}</span>
                <input className="txt" type="number" value={amendLot||''} onChange={e => setAmendLot(+e.target.value||0)} /></label>
              <label className="fld"><span>App sample</span>
                <input className="txt" type="number" value={amendApp||''} onChange={e => setAmendApp(+e.target.value||0)} /></label>
              <label className="fld"><span>Fun sample</span>
                <input className="txt" type="number" value={amendFun||''} onChange={e => setAmendFun(+e.target.value||0)} /></label>
            </div>
            <datalist id="amend-skus">{skuOptions.map(s => <option key={s} value={s} />)}</datalist>
            <p className="muted" style={{ fontSize:12, marginTop:8 }}>Changing the part number re-points this report to that SKU’s specs. Recorded results and photos are kept — use the Photos tab to re-assign pictures. Amendments are logged.</p>
            <div className="row" style={{ marginTop:14 }}>
              <button className="btn" onClick={applyAmend}>Apply</button>
              <button className="btn ghost" onClick={() => setAmendOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Rule engine banners */}
      {verdicts.length===0
        ? <div className="banner ok">✓ {t('allClean')}</div>
        : verdicts.map(v => (
          <div key={v.key} className={`banner ${v.status==='full_inspection'?'bad':v.status==='extra_needed'?'warn':'ok'}`}>
            {v.status==='full_inspection' && <div>⛔ <b>{t('fullInsp')} — {v.label}</b></div>}
            {v.status==='extra_needed' && (
              <div>
                <div>⚠ <b>{t('extraNeeded')} {v.extrasStillNeeded} — {v.label}</b></div>
                <div className="extra-recorder" style={{ marginTop:6 }}>
                  {v.extraResults.map((r,i) => <div key={i} className={`extra-dot ${r==='P'?'p':'f'}`}>{r}</div>)}
                  {editable && v.extrasStillNeeded>0 && (
                    <><button className="btn ok" style={{ minHeight:38, padding:'6px 14px', fontSize:14 }} onClick={() => setModal({ type:'extra', verdict:v, result:'P' })}>+ P</button>
                    <button className="btn danger" style={{ minHeight:38, padding:'6px 14px', fontSize:14 }} onClick={() => setModal({ type:'extra', verdict:v, result:'F' })}>+ F</button></>
                  )}
                </div>
              </div>
            )}
            {v.status==='monitor' && <div>👁 {t('monitor')}: <b>{v.label}</b></div>}
          </div>
        ))}

      {/* B2: Stepper — ordered steps with live completion states */}
      <div className="tabs">
        {TABS.filter(k => k!=='100pct'||triggeredItems.length>0).map((k, idx) => {
          const label = k==='form'?t('tabVisual'):k==='measure'?t('tabTechnical'):k==='photos'?`${t('tabPhotos')} (${photos.length})`:k==='100pct'?t('tab100pct'):t('tabSummary')
          const st = stepState(k)
          const glyphColor = st === 'done' ? 'var(--pass, #1F8A4C)' : st === 'partial' ? 'var(--amber, #B7791F)' : 'var(--ink-soft, #8A97A6)'
          return (
            <button key={k} className={`${tab===k?'on':''}${k==='100pct'?' crit':''}`} onClick={() => setTab(k)}>
              <span className="tab-ico" aria-hidden="true" style={{ color: tab===k ? undefined : glyphColor, fontWeight: 800 }}>
                {k==='100pct' ? '⛔' : stepGlyph(st)}
              </span>
              <span className="tab-txt">{idx + 1}. {label}</span>
            </button>
          )
        })}
      </div>

      {/* ── VISUAL TAB ── */}
      {tab==='form' && (
        <>
          <div className="row" style={{ marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:15 }}>{t('piece')}:</span>
            {Array.from({ length:nPieces }, (_,i) => i+1).map(n => (
              <button key={n} className="btn ghost" style={{ minHeight:44, minWidth:44, padding:'8px 12px', ...(piece===n?{ background:'var(--navy)', color:'#fff', borderColor:'var(--navy)' }:{}) }} onClick={() => setPiece(n)}>{n}</button>
            ))}
          </div>
          {SECTIONS.map(sec => {
            const visibleItems = sec.items.filter(() => piece <= insp.app_sample)
            if (visibleItems.length===0) return null
            return (
              <div className="card" key={sec.key}>
                <div className="row" style={{ marginBottom:8, alignItems:'flex-start' }}>
                  <h2 style={{ flex:1, marginBottom:0 }}>{bi(sec.title)}</h2>
                  <SectionControls sectionKey={sec.key} isMeas={false} />
                </div>
                {sec.instruction && <div style={{ padding:'8px 12px', background:'var(--steel)', borderRadius:8, marginBottom:10, fontSize:13, color:'var(--ink-soft)' }}>ℹ️ {bi(sec.instruction)}</div>}
                {visibleItems.map(item => {
                  const rkey = `${item.key}:${piece}`
                  const rawVal = insp.form_data.results[rkey]
                  const val: PFNA = (autoNaItems.has(item.key)||naOverrides[item.key]) ? 'NA' : rawVal
                  // For TPMS show the dimension from SKU
                  const subtext = item.key==='tpms_hole' && sku.tpms_sensor_mm ? `Dimension: ${sku.tpms_sensor_mm} mm` : null
                  return (
                    <div key={item.key} id={`row-form-${item.key}`} style={{ padding:'11px 0', borderBottom:'1px solid var(--line)', opacity: (autoNaItems.has(item.key)||naOverrides[item.key]) ? 0.6 : 1 }}>
                      <div className="row" style={{ gap:8 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <span style={{ fontWeight:600, fontSize:15 }}>{bi(item.label)}</span>
                            <span className="pill draft" style={{ fontSize:11 }}>{item.group}</span>
                            <RefIcon itemKey={item.key} label={bi(item.label)} />
                            <NaOverrideBtn itemKey={item.key} itemLabel={bi(item.label)} isMeas={false} />
                            {autoNaItems.has(item.key) && <span className="pill draft" style={{ fontSize:10 }}>auto-NA</span>}
                          </div>
                          <div className="muted" style={{ fontSize:13, marginTop:3 }}>{bi(item.standard)}</div>
                          {subtext && <div style={{ fontSize:12, color:'var(--navy)', fontWeight:600, marginTop:2 }}>📐 {subtext}</div>}
                        </div>
                        <PFNAButtons val={val} itemKey={item.key} itemLabel={bi(item.label)} pieceNo={piece} isMeas={false} tabName="form" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </>
      )}

      {/* ── TECHNICAL TAB ── */}
      {tab==='measure' && (
        <>
          <div className="row" style={{ marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ fontWeight:700, fontSize:15 }}>{t('piece')}:</span>
            {Array.from({ length:insp.fun_sample }, (_,i) => i+1).map(n => (
              <button key={n} className="btn ghost" style={{ minHeight:44, minWidth:44, padding:'8px 12px', ...(piece===n?{ background:'var(--navy)', color:'#fff', borderColor:'var(--navy)' }:{}) }} onClick={() => setPiece(n)}>{n}</button>
            ))}
          </div>
          {piece>insp.fun_sample
            ? <div className="banner warn">{t('funSample')}: {insp.fun_sample}</div>
            : MEAS_SECTIONS.map(msec => (
              <div className="card" key={msec.key}>
                <div className="row" style={{ marginBottom:8, alignItems:'flex-start' }}>
                  <h2 style={{ flex:1, marginBottom:0 }}>{bi(msec.title)} — {t('piece')} {piece}</h2>
                  <SectionControls sectionKey={msec.key} isMeas={true} cols={msec.cols.map(c=>c.key)} />
                </div>
                {msec.cols.map(col => {
                  const rkey = `${col.key}:${piece}`
                  const rawVal = insp.form_data.meas_results?.[rkey]
                  const val: PFNA = naOverrides[col.key] ? 'NA' : rawVal
                  const nom = col.nominal(sku)
                  return (
                    <div key={col.key} id={`row-meas-${col.key}`} style={{ padding:'11px 0', borderBottom:'1px solid var(--line)', opacity:naOverrides[col.key]?0.6:1 }}>
                      <div className="row" style={{ gap:8 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <span style={{ fontWeight:600, fontSize:15 }}>{bi(col.label)}</span>
                            <RefIcon itemKey={col.key} label={bi(col.label)} />
                            <NaOverrideBtn itemKey={col.key} itemLabel={bi(col.label)} isMeas={true} />
                          </div>
                          <div className="muted" style={{ fontSize:13, marginTop:3 }}>
                            {col.expected
                              ? <>{bi({ en: 'Required', zh: '要求' })}: <b>{col.expected(sku)}</b></>
                              : <>{t('nominal')}: <b>{nom!==null?`${nom} ${col.unit}`:'—'}</b> · {t('tolerance')}: <b>{bi(col.tol)}</b></>}
                          </div>
                        </div>
                        <PFNAButtons val={val} itemKey={col.key} itemLabel={bi(col.label)} pieceNo={piece} isMeas={true} tabName="measure" />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
        </>
      )}

      {/* ── PHOTOS TAB ── */}
      {tab==='photos' && (
        <div className="card">
          <h2 style={{ marginBottom:10 }}>{t('allPhotos')} ({photos.filter(p=>p.item_key).length})</h2>
          <p className="muted" style={{ marginTop:0, fontSize:13 }}>
            Every parameter is listed below — even empty ones — so you can fill a blank parameter by tapping ↻ Reassign or ⧉ Copy on a photo elsewhere and choosing it as the target.
          </p>
          <div style={{ display:'flex', gap:6, margin:'10px 0 14px' }}>
            {([['all','All'],['approved','Approved'],['failed','Failed']] as const).map(([f,lbl]) => (
              <button key={f} className="btn ghost"
                style={{ minHeight:36, padding:'5px 16px', fontSize:13, ...(photoFilter===f?{ background:'var(--navy)', color:'#fff', borderColor:'var(--navy)' }:{}) }}
                onClick={() => setPhotoFilter(f)}>{lbl}</button>
            ))}
          </div>

          {photoSections.map(sec => (
            <div key={sec.title} style={{ marginBottom:16 }}>
              <div style={{ background:'var(--navy)', color:'#fff', borderRadius:8, padding:'9px 14px', fontWeight:700, fontFamily:'var(--display)' }}>{sec.title}</div>
              {sec.params.map(param => {
                const visible = param.photos.filter(p => photoFilter==='all' ? true : photoFilter==='approved' ? p.is_pass_photo : !p.is_pass_photo)
                return (
                  <div key={param.key} style={{ marginLeft:6, marginTop:12, paddingBottom:10, borderBottom:'1px solid var(--line)' }}>
                    <div style={{ fontWeight:600, color:'var(--navy)', marginBottom:8, fontSize:14 }}>{param.label}</div>
                    {visible.length>0 ? (
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        {visible.map(p => {
                          const url = photoUrls[p.storage_path]
                          return (
                            <div key={p.id} style={{ position:'relative' }}>
                              <div style={{ border:`2px solid ${p.is_pass_photo?'var(--pass)':'var(--fail)'}`, borderRadius:10, overflow:'hidden', cursor:'pointer' }}
                                onClick={() => url && setModal({ type:'preview', url, mediaType:p.media_type })}>
                                <MediaThumb path={p.storage_path} type={p.media_type} url={url||''} />
                                <div style={{ padding:'3px 6px', background:p.is_pass_photo?'var(--pass-bg)':'var(--fail-bg)', fontSize:10 }}>
                                  <b style={{ color:p.is_pass_photo?'var(--pass)':'var(--fail)' }}>{p.is_pass_photo?'✓P':'✗F'}</b>
                                  {p.piece_no>0&&<> · pc{p.piece_no}</>}
                                  {p.comment && <div style={{ marginTop:2, color:'var(--ink)', fontWeight:400, lineHeight:1.3, whiteSpace:'normal' }}>{p.comment}</div>}
                                </div>
                              </div>
                              {(editable || canAmend) && (
                                <div style={{ position:'absolute', top:4, right:4, display:'flex', gap:4 }}>
                                  <button title="Reassign to another parameter" style={{ background:'rgba(0,0,0,.62)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                                    onClick={() => setModal({ type:'reassign', photo:p })}>↻</button>
                                  <button title="Copy to other parameters" style={{ background:'rgba(0,0,0,.62)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                                    onClick={() => setModal({ type:'copy', photo:p })}>⧉</button>
                                  <button title="Delete" style={{ background:'rgba(204,17,34,.85)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                                    onClick={() => deletePhoto(p)}>🗑</button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : <span className="muted" style={{ fontSize:12 }}>— no photos —</span>}
                  </div>
                )
              })}
            </div>
          ))}

          {/* Appendix — extra photos not tied to any inspection parameter */}
          <div style={{ marginTop:20 }}>
            <div style={{ background:'var(--navy)', color:'#fff', borderRadius:8, padding:'9px 14px', fontWeight:700, fontFamily:'var(--display)' }}>Appendix — Additional Photos</div>
            <p className="muted" style={{ fontSize:12, margin:'8px 0 10px' }}>Extra photos or videos not related to any inspection parameter (shown in a dedicated Appendix on the report).</p>
            {(editable || canAmend) && (
              <div style={{ maxWidth:340, marginBottom:12 }}>
                <MediaCapture label="Add appendix photo" onUploaded={addAppendixPhoto} />
              </div>
            )}
            {(() => {
              const appx = photos.filter(p => p.item_key === 'appendix')
              return appx.length ? (
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {appx.map(p => {
                    const url = photoUrls[p.storage_path]
                    return (
                      <div key={p.id} style={{ position:'relative' }}>
                        <div style={{ border:'2px solid var(--line)', borderRadius:10, overflow:'hidden', cursor:'pointer' }}
                          onClick={() => url && setModal({ type:'preview', url, mediaType:p.media_type })}>
                          <MediaThumb path={p.storage_path} type={p.media_type} url={url||''} />
                        </div>
                        {(editable || canAmend) && (
                          <button title="Delete" style={{ position:'absolute', top:4, right:4, background:'rgba(204,17,34,.85)', color:'#fff', border:'none', borderRadius:6, padding:'2px 6px', fontSize:11, cursor:'pointer' }}
                            onClick={() => deletePhoto(p)}>🗑</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : <span className="muted" style={{ fontSize:12 }}>— no appendix photos —</span>
            })()}
          </div>
        </div>
      )}
      {tab==='100pct' && (
        <HundredPctCheck inspectionId={insp.id} lotSize={insp.lot_size} triggeredItems={triggeredItems}
          baseResults={baseResultsByKey}
          results={(insp.form_data.hundred_pct||{}) as Record<string,Record<string,PFNA>>}
          editable={editable}
          onSave={async (itemKey, pieceNo, result) => {
            const fd={...insp.form_data}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const hp:any={...(fd.hundred_pct||{})}
            const old=hp[itemKey]?.[String(pieceNo)]
            hp[itemKey]={...(hp[itemKey]||{}),[String(pieceNo)]:result}
            fd.hundred_pct=hp; await saveFd(fd)
            const label=triggeredItems.find(i=>i.key===itemKey)?.label||itemKey
            if (result==='F'&&old!=='F') await ensureDefect(itemKey, `${label} (100%)`, pieceNo, '100pct')
            if (old==='F'&&result!=='F') await removeDefect(itemKey, pieceNo, '100pct')
            load()
          }} />
      )}

      {/* ── SUMMARY TAB ── */}
      {tab==='summary' && (
        <div className="card">
          <div className="row" style={{ alignItems:'center' }}>
            <h2 style={{ flex:1, marginBottom:0 }}>Inspection Report</h2>
            <button className="btn ghost" style={{ minHeight:40, padding:'6px 14px' }} onClick={() => openInspectionReport(insp.id, lang)}>{t('pdfReport')}</button>
            <button className="btn ghost" style={{ minHeight:40, padding:'6px 14px' }} onClick={() => window.open(`/report/${insp.id}`, '_blank')}>View Interactive Report</button>
            <button className="btn" style={{ minHeight:40, padding:'6px 14px' }} onClick={emailInteractiveReport}>Email Interactive Report</button>
          </div>
          <div style={{ height:14 }} />

          <h2 style={{ marginBottom:8, fontSize:18 }}>{t('inspectionFindings')}</h2>
          <ul style={{ marginTop:0, paddingLeft:20 }}>
            {summaryItems(outcomeRows).map((s,i) => <li key={i} style={{ marginBottom:4 }}>{s}</li>)}
          </ul>
          {triggeredItems.length>0 && <div className="banner bad">⛔ {t('fullInsp')}: {triggeredItems.map(v=>v.label).join(', ')}</div>}

          <label className="fld" style={{ marginTop:14 }}><span>{t('correctiveAction')}</span>
            <RichText disabled={!editable} placeholder="Type the corrective action / disposition notes…"
              value={toHtml(insp.summary.corrective_action||'')}
              onChange={html => saveSummary({ corrective_action: html })} />
          </label>
          {editable && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
              <span className="muted" style={{ fontSize:12, alignSelf:'center', marginRight:2 }}>{t('insertTemplate')}:</span>
              {CORRECTIVE_TEMPLATES.map((tpl,i) => (
                <button key={i} className="btn ghost" style={{ minHeight:34, padding:'4px 10px', fontSize:12 }}
                  onClick={async () => {
                    const line = `<p>${escHtml(tpl.text(failedParamStr))}</p>`
                    const cur = toHtml(insp.summary.corrective_action||'')
                    await saveSummary({ corrective_action: cur ? `${cur}${line}` : line })
                  }}>{tpl.label}</button>
              ))}
            </div>
          )}

          <h2 style={{ margin:'18px 0 8px', fontSize:18 }}>Inspection Outcome</h2>
          {outcomeRows.length>0 ? (
            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr><th>{t('inspParam')}</th><th>Checked</th><th>Pass</th><th>Fail</th><th>Defect Pieces</th><th>Outcome</th></tr></thead>
                <tbody>
                  {outcomeRows.map((o,i) => (
                    <tr key={i}>
                      <td>{o.parameter}</td>
                      <td>{o.checked}</td>
                      <td style={{ fontWeight:700, color:'var(--pass)' }}>{o.pass}</td>
                      <td style={{ fontWeight:700, color:o.fail>0?'var(--fail)':'var(--ink-soft)' }}>{o.fail}</td>
                      <td>{o.defectPieces}</td>
                      <td style={{ fontWeight:700, color:outcomeColor(o.outcome) }}>{o.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No parameters inspected yet.</p>}

          <h2 style={{ margin:'18px 0 8px', fontSize:18 }}>Photo / Video Appendix</h2>
          {(['pass','fail'] as const).map(kind => {
            const pass = kind==='pass'
            const secs = appendixSections(pass)
            return (
              <div key={kind} style={{ marginBottom:14 }}>
                <div style={{ background: pass?'var(--pass)':'var(--fail)', color:'#fff', borderRadius:8, padding:'7px 12px', fontWeight:700, fontFamily:'var(--display)' }}>
                  {pass?'✓ Approved Inspection Photos':'✗ Failed Inspection Photos'}
                </div>
                {secs.length>0 ? secs.map(sec => (
                  <div key={sec.title} style={{ marginTop:10 }}>
                    <div style={{ fontWeight:700, color:'var(--navy)', fontSize:13, margin:'6px 0 4px' }}>{sec.title}</div>
                    {sec.params.map(pm => (
                      <div key={pm.label} style={{ marginLeft:8, marginBottom:8 }}>
                        <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{pm.label}</div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(110px, 1fr))', gap:8 }}>
                          {pm.photos.map(p => {
                            const u = photoUrls[p.storage_path]
                            const pieceTxt = p.piece_no ? (p.piece_no<0?`Additional`:`Piece ${p.piece_no}`) : 'Required photo'
                            return (
                              <figure key={p.id} style={{ margin:0, border:'1px solid var(--line)', borderRadius:10, overflow:'hidden', background:'#fff' }}>
                                <button onClick={() => { if(u) setModal({ type:'preview', url:u, mediaType:p.media_type }) }}
                                  style={{ width:'100%', height:90, border:0, background:'#EEF1F5', cursor:'pointer', padding:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  {p.media_type==='video' ? <span style={{ fontSize:26, color:'var(--navy)' }}>▶</span>
                                    : u ? <img src={u} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <span className="muted" style={{ fontSize:12 }}>…</span>}
                                </button>
                                <figcaption style={{ fontSize:11, color:'var(--ink-soft)', padding:6 }}>
                                  <b style={{ color: pass?'var(--pass)':'var(--fail)' }}>{pass?'PASS':'FAIL'}</b> · {pieceTxt}
                                </figcaption>
                              </figure>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )) : <p className="muted" style={{ marginTop:8, marginBottom:0 }}>{pass?'No approved photos.':'No failed photos.'}</p>}
              </div>
            )
          })}

          <div style={{ height:14 }} />
          <label className="fld"><span>{t('disposition')} *</span>
            <select className="sel" disabled={!editable}
              value={(() => {
                const d = insp.summary.disposition || ''
                if (d === 'custom') {
                  const m = customDisps.find(c => c.label === insp.summary.disposition_custom && c.cls === insp.summary.disposition_cls)
                  return m ? `saved:${m.id}` : '__add__'
                }
                return d
              })()}
              onChange={e => onDispChange(e.target.value)}>
              <option value="">— {t('status')} —</option>
              <optgroup label="Standard">
                <option value="approved_loading">{t('dispApprovedLoading')}</option>
                <option value="hold_rework">{t('dispHoldRework')}</option>
                <option value="conditional_loading">{t('dispConditional')}</option>
                <option value="conditional_rework">{t('dispConditionalRework')}</option>
                <option value="pending_customer">{t('dispPendingCustomer')}</option>
              </optgroup>
              {customDisps.length>0 && (
                <optgroup label="Saved custom">
                  {customDisps.map(c => <option key={c.id} value={`saved:${c.id}`}>{c.label}</option>)}
                </optgroup>
              )}
              <option value="__add__">➕ Add custom disposition…</option>
            </select>
          </label>

          {editable && insp.summary.disposition === 'custom' && (
            <div style={{ border:'1px solid var(--line)', borderRadius:10, padding:12, marginTop:8, background:'#F8FAFC' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--navy)', marginBottom:8 }}>Custom disposition</div>
              <input className="sel" style={{ width:'100%' }} placeholder="e.g. CONDITIONAL — SHIP WITH CUSTOMER WAIVER"
                value={insp.summary.disposition_custom||''}
                onChange={e => saveSummary({ disposition_custom: e.target.value })} />
              <div style={{ fontSize:12, color:'var(--ink-soft)', margin:'10px 0 6px' }}>Banner colour on the report:</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {DISP_SEVERITIES.map(s => {
                  const on = (insp.summary.disposition_cls||'hold') === s.cls
                  return (
                    <button key={s.cls} onClick={() => saveSummary({ disposition_cls: s.cls })}
                      style={{ padding:'5px 10px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer',
                        border:`1.5px solid ${s.color}`, background: on ? s.color : '#fff', color: on ? '#fff' : s.color }}>
                      {s.label}
                    </button>
                  )
                })}
              </div>
              <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:12, fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={dispSaveChecked} onChange={e => setDispSaveChecked(e.target.checked)} />
                Save this disposition for future use
              </label>
              {dispSaveChecked && (
                <button className="btn" style={{ marginTop:8, minHeight:36, padding:'6px 14px', fontSize:13 }}
                  onClick={saveCustomDisp}>Save to library</button>
              )}
            </div>
          )}
          {inspectorEditable && <button className="btn" style={{ width:'100%', marginTop:16 }} onClick={submit}>{t('submit')}</button>}
        </div>
      )}

      {/* ── MODALS ── */}
      {modal?.type==='fail' && <DefectModal inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel} pieceNo={modal.pieceNo} tab={modal.tab} onDone={() => { setModal(null); load() }} onClose={() => { setModal(null); load() }} />}
      {modal?.type==='pass' && <PassPhotoModal inspectionId={insp.id} itemKey={modal.itemKey} itemLabel={modal.itemLabel} pieceNo={modal.pieceNo} tab={modal.tab} onDone={() => { setModal(null); load() }} onClose={() => setModal(null)} />}
      {modal?.type==='extra' && <ExtraPieceScreen inspectionId={insp.id} itemKey={modal.verdict.key} itemLabel={modal.verdict.label} result={modal.result} existingExtras={modal.verdict.extraResults} extrasRequired={extrasRequiredFor(modal.verdict.tab)} onSave={r => addExtra(modal.verdict, r)} onUndo={() => undoExtra(modal.verdict)} onClose={() => setModal(null)} />}
      {modal?.type==='preview' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          {modal.mediaType==='video'
            ? <video src={modal.url} controls autoPlay style={{ maxWidth:'94vw', maxHeight:'88vh', borderRadius:12 }} onClick={e=>e.stopPropagation()} />
            : <img src={modal.url} style={{ maxWidth:'94vw', maxHeight:'88vh', borderRadius:12 }} onClick={e=>e.stopPropagation()} />}
        </div>
      )}
      {modal?.type==='refimg' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth:700 }}>
            <div className="row" style={{ marginBottom:10 }}>
              <h2 style={{ flex:1, fontSize:16 }}>📋 {modal.label}</h2>
              <button className="btn ghost" style={{ minHeight:36, padding:'4px 12px' }} onClick={() => setModal(null)}>{t('close')}</button>
            </div>
            <img src={modal.src} style={{ width:'100%', borderRadius:8, border:'1px solid var(--line)' }} />
          </div>
        </div>
      )}
      {modal?.type==='reassign' && (
        <ReassignModal photo={modal.photo} allItems={allItemsForReassign} maxPiece={Math.max(insp.app_sample, insp.fun_sample)}
          onDone={() => { setModal(null); recordAmend('Re-assigned a photo'); load() }} onClose={() => setModal(null)} />
      )}
      {modal?.type==='copy' && (
        <CopyModal inspectionId={insp.id} photo={modal.photo} allItems={allItemsForReassign}
          onDone={() => { setModal(null); recordAmend('Copied a photo'); load() }} onClose={() => setModal(null)} />
      )}
      {emailOpen && <EmailModal title="Email inspection report" allowBlank sending={emailBusy}
        onSend={doEmailReport} onClose={() => setEmailOpen(false)} />}
      {inspectorEditable && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: '#fff', borderTop: '1.5px solid var(--line)',
          padding: '10px 14px calc(10px + env(safe-area-inset-bottom))',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            {progress
              ? <><b>{tab === 'form' ? t('tabVisual') : t('tabTechnical')}</b> · {t('piece')} {piece}: <b>{progress.done}/{progress.total}</b>
                  <span className="muted"> · {progress.piecesDone}/{progress.pieces} ✓</span></>
              : <span className="muted">{insp.status === 'rejected' ? '↩ Returned — fix and resubmit' : 'Draft'}</span>}
          </div>
          {progress && progress.done < progress.total &&
            <button className="btn ghost" style={{ minHeight: 44, padding: '4px 12px', fontSize: 13, whiteSpace: 'nowrap' }} onClick={jumpNextUnanswered}>Next ↓</button>}
          {progress && progress.done === progress.total && progress.piecesDone < progress.pieces &&
            <button className="btn ghost" style={{ minHeight: 44, padding: '4px 12px', fontSize: 13, whiteSpace: 'nowrap' }} onClick={jumpNextUnanswered}>Next piece →</button>}
          <button className="btn" style={{ minHeight: 44, padding: '4px 16px', whiteSpace: 'nowrap' }} onClick={submit}>{t('submit')}</button>
        </div>
      )}
    </div>
  )
}

```

### `src/pages/Login.tsx`

```tsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function Login() {
  const { t, lang, setLang } = useI18n()
  const [email, setEmail] = useState(() => localStorage.getItem('saved_email') || '')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [stayIn, setStayIn] = useState(true)
  const [mode, setMode] = useState<'login'|'reset'>('login')
  const [resetEmail, setResetEmail] = useState('')
  const [resetMsg, setResetMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true); setErr('')
    if (stayIn) localStorage.setItem('saved_email', email)
    else localStorage.removeItem('saved_email')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr(error.message)
    setBusy(false)
  }

  const resetPassword = async () => {
    setBusy(true); setErr(''); setResetMsg('')
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else setResetMsg('Password reset email sent! Check your inbox.')
  }

  return (
    <div style={{ minHeight:'100%', display:'grid', placeItems:'center', background:'var(--navy)' }}>
      <div className="card" style={{ width:'min(420px, 92vw)', padding:28 }}>
        <img src="/logo-white.png" alt="NITRA" style={{ height:34, filter:'invert(1) brightness(0.2)' }} />
        <h2 style={{ margin:'14px 0' }}>{t('appTitle')}</h2>

        {mode === 'login' ? (
          <>
            <label className="fld"><span>{t('email')}</span>
              <input className="txt" type="email" value={email} onChange={e => setEmail(e.target.value)}
                autoComplete="username" />
            </label>
            <div style={{ height:10 }} />
            <label className="fld"><span>{t('password')}</span>
              <div style={{ position:'relative' }}>
                <input className="txt" type={showPw ? 'text' : 'password'} value={pw}
                  onChange={e => setPw(e.target.value)} autoComplete="current-password"
                  onKeyDown={e => e.key === 'Enter' && signIn()}
                  style={{ paddingRight:48 }} />
                <button onClick={() => setShowPw(!showPw)}
                  style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--ink-soft)' }}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:10, marginTop:12, cursor:'pointer' }}>
              <input type="checkbox" checked={stayIn} onChange={e => setStayIn(e.target.checked)}
                style={{ width:20, height:20, accentColor:'var(--navy)' }} />
              <span style={{ fontSize:14 }}>{t('staySignedIn')}</span>
            </label>
            {err && <p style={{ color:'var(--fail)', marginTop:10, fontSize:14 }}>{err}</p>}
            <button className="btn" style={{ width:'100%', marginTop:16 }}
              disabled={busy || !email || !pw} onClick={signIn}>
              {busy ? '…' : t('signIn')}
            </button>
            <button style={{ background:'none', border:'none', color:'var(--navy)', cursor:'pointer', marginTop:12, fontSize:14, textDecoration:'underline' }}
              onClick={() => { setMode('reset'); setResetEmail(email); setErr('') }}>
              Forgot password? / 忘记密码？
            </button>
          </>
        ) : (
          <>
            <p style={{ marginBottom:14, color:'var(--ink-soft)' }}>Enter your email and we'll send a password reset link.</p>
            <label className="fld"><span>{t('email')}</span>
              <input className="txt" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} />
            </label>
            {err && <p style={{ color:'var(--fail)', marginTop:10, fontSize:14 }}>{err}</p>}
            {resetMsg && <p style={{ color:'var(--pass)', marginTop:10, fontSize:14 }}>{resetMsg}</p>}
            <button className="btn" style={{ width:'100%', marginTop:16 }}
              disabled={busy || !resetEmail} onClick={resetPassword}>
              {busy ? '…' : 'Send reset email / 发送重置邮件'}
            </button>
            <button style={{ background:'none', border:'none', color:'var(--navy)', cursor:'pointer', marginTop:12, fontSize:14, textDecoration:'underline' }}
              onClick={() => { setMode('login'); setErr(''); setResetMsg('') }}>
              ← Back to sign in / 返回登录
            </button>
          </>
        )}

        <button className="btn ghost" style={{ width:'100%', marginTop:10 }}
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
          {lang === 'en' ? '中文' : 'English'}
        </button>
      </div>
    </div>
  )
}

```

### `src/pages/MyWork.tsx`

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile } from '../App'

// B1 — "My Work": everything the signed-in user has open, in priority order:
// returned items (need fixing) first, then drafts in progress. Self-serve
// model per Kwong's decision — no admin assignment concept.

interface WorkItem {
  kind: 'inspection' | 'container'
  id: string
  label: string
  po: string
  status: string
  at: string
  note?: string
}

const fmt = (dt: string) => new Date(dt).toLocaleDateString() + ' ' + new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function MyWork({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      const [{ data: i }, { data: c }] = await Promise.all([
        supabase.from('inspections').select('id,part_no,po_no,status,updated_at,review_note')
          .eq('inspector_id', profile.id).in('status', ['draft', 'rejected'])
          .order('updated_at', { ascending: false }).limit(50),
        supabase.from('container_loadings').select('id,container_no,po_no,insp_status,updated_at,review_note')
          .eq('inspector_id', profile.id).in('insp_status', ['draft', 'rejected'])
          .order('updated_at', { ascending: false }).limit(50),
      ])
      const out: WorkItem[] = []
      for (const r of (i as any[]) || []) out.push({ kind: 'inspection', id: r.id, label: r.part_no || '(no part no.)', po: r.po_no || '', status: r.status, at: r.updated_at, note: r.review_note || undefined })
      for (const r of (c as any[]) || []) out.push({ kind: 'container', id: r.id, label: r.container_no || '(no container no.)', po: r.po_no || '', status: r.insp_status, at: r.updated_at, note: r.review_note || undefined })
      // Returned first (they block approval), then newest drafts.
      out.sort((a, b) => (a.status === 'rejected' ? 0 : 1) - (b.status === 'rejected' ? 0 : 1) || b.at.localeCompare(a.at))
      setItems(out)
      setLoaded(true)
    })()
  }, [profile.id])

  const returned = items.filter(x => x.status === 'rejected')
  const drafts = items.filter(x => x.status !== 'rejected')

  const row = (x: WorkItem) => (
    <Link key={x.kind + x.id} to={x.kind === 'inspection' ? `/inspection/${x.id}` : `/container/${x.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 18 }}>{x.kind === 'inspection' ? '🛞' : '📦'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {x.label} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· PO {x.po || '—'}</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {x.kind === 'inspection' ? 'Wheel inspection' : 'Container loading'} · {fmt(x.at)}
            </div>
            {x.status === 'rejected' && x.note && (
              <div style={{ fontSize: 12, marginTop: 4, color: '#7A5514', background: '#FCF2DD', borderRadius: 6, padding: '4px 8px' }}>↩ {x.note}</div>
            )}
          </div>
          <span className={`pill ${x.status}`}>{x.status}</span>
        </div>
      </div>
    </Link>
  )

  return (
    <div className="page">
      {returned.length > 0 && (
        <div className="card" style={{ border: '1.5px solid var(--amber, #B7791F)' }}>
          <h2 style={{ marginTop: 0 }}>↩ Returned to you ({returned.length})</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>These were sent back by an admin and need fixing before they can be approved.</p>
          {returned.map(row)}
        </div>
      )}
      <div className="card" style={{ marginTop: returned.length ? 14 : 0 }}>
        <h2 style={{ marginTop: 0 }}>In progress ({drafts.length})</h2>
        {loaded && drafts.length === 0 && <p className="muted">Nothing in progress. Open a PO to start an inspection or container loading.</p>}
        {drafts.map(row)}
      </div>
    </div>
  )
}

```

### `src/pages/NewInspection.tsx`

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { sampleSizes, type SamplingSettings } from '../lib/rules'
import type { Sku } from '../lib/standard'
import type { Profile } from '../App'
import { cacheGet, cacheSet } from '../lib/refCache'
import { savePendingInspection } from '../lib/offlineSync'

export default function NewInspection({ profile }: { profile: Profile }) {
  const { t } = useI18n()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const presetPo = params.get('po') || ''
  const [skus, setSkus] = useState<Sku[]>([])
  const [samp, setSamp] = useState<SamplingSettings | null>(null)
  const [search, setSearch] = useState('')
  const [partNo, setPartNo] = useState('')
  const [po, setPo] = useState(presetPo)
  const [batch, setBatch] = useState('')
  const [lot, setLot] = useState(100)
  const [busy, setBusy] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Read-through cache: refresh from the server when online, fall back to the
    // on-device copy when offline, so the form still works with no signal.
    supabase.from('skus').select('*').eq('active', true).order('part_no')
      .then(({ data, error }) => {
        if (data && !error) { setSkus(data as Sku[]); void cacheSet('skus', data) }
        else cacheGet<Sku[]>('skus').then(c => { if (c) setSkus(c) })
      })
    supabase.from('settings').select('value').eq('key', 'sampling').single()
      .then(({ data, error }) => {
        if (data && !error) { setSamp(data.value as SamplingSettings); void cacheSet('sampling', data.value) }
        else cacheGet<SamplingSettings>('sampling').then(c => { if (c) setSamp(c) })
      })
  }, [])

  // Close the SKU dropdown when clicking anywhere outside it
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const sku = useMemo(() => skus.find(s => s.part_no === partNo), [skus, partNo])
  const selectedLabel = sku ? `${sku.part_no} — ${sku.model} ${sku.size}` : ''
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return skus
    // When a SKU is already selected and its label fills the box, show the full
    // list rather than filtering the combined label string down to "No matches".
    if (sku && search === selectedLabel) return skus
    return skus.filter(s => s.part_no.toLowerCase().includes(q) || s.model.toLowerCase().includes(q) || s.size.includes(q))
  }, [skus, search, sku, selectedLabel])

  const sizes = useMemo(() => samp ? sampleSizes(lot, samp) : { app: 0, fun: 0 }, [lot, samp])

  const select = (pn: string) => {
    setPartNo(pn)
    const s = skus.find(x => x.part_no === pn)
    setSearch(s ? `${pn} — ${s.model} ${s.size}` : pn)
    setShowDropdown(false)
  }

  const start = async () => {
    setBusy(true)
    // Client-minted id so an offline-created inspection carries a stable id that
    // inserts cleanly on sync (verified against the live INSERT RLS).
    const id = (globalThis.crypto?.randomUUID?.()) || `off-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const now = new Date().toISOString()
    const emptyForm = { results: {}, extra_results: {}, meas_results: {}, meas_extra_results: {}, pallet: {}, na_overrides: {} }
    const { data, error } = await supabase.from('inspections').insert({
      id, part_no: partNo, po_no: po, batch, lot_size: lot,
      app_sample: sizes.app, fun_sample: sizes.fun,
      inspector_id: profile.id, form_data: emptyForm,
    }).select('id').single()
    if (data && !error) { setBusy(false); nav(`/inspection/${data.id}`); return }
    // Offline / network failure → create the inspection on the device and queue it.
    const offline = (typeof navigator !== 'undefined' && !navigator.onLine) ||
      /load failed|failed to fetch|network/i.test(error?.message || '')
    if (offline) {
      await savePendingInspection({
        id, part_no: partNo, po_no: po, batch, lot_size: lot,
        app_sample: sizes.app, fun_sample: sizes.fun, inspector_id: profile.id,
        status: 'draft', form_data: emptyForm, summary: {}, pallet_data: {},
        created_at: now, updated_at: now, pendingSince: now,
      })
      setBusy(false)
      nav(`/inspection/${id}`)
      return
    }
    setBusy(false)
    alert('Could not start inspection / 无法开始检验:\n\n' + (error?.message || 'Unknown error'))
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{t('newInspection')}</h2>
        <div className="grid2">
          {/* Searchable Part No. */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="fld"><span>{t('partNo')}</span>
              <div ref={boxRef} style={{ position: 'relative' }}>
                <input className="txt" value={search}
                  onChange={e => { setSearch(e.target.value); setPartNo(''); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Type to search or scroll…" />
                {showDropdown && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff',
                    border:'1.5px solid var(--navy)', borderRadius:8, zIndex:100,
                    maxHeight:260, overflowY:'auto', boxShadow:'0 4px 20px rgba(0,0,0,.15)' }}>
                    {filtered.length === 0 && <div className="muted" style={{ padding:12 }}>No matches</div>}
                    {filtered.map(s => (
                      <div key={s.part_no} style={{ padding:'10px 14px', cursor:'pointer', borderBottom:'1px solid var(--line)',
                        background: s.part_no === partNo ? 'var(--steel)' : '#fff' }}
                        onMouseDown={e => { e.preventDefault(); select(s.part_no) }}>
                        <div style={{ fontWeight:600 }}>{s.part_no}</div>
                        <div className="muted" style={{ fontSize:13 }}>{s.model} · {s.size} · {s.finish}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </label>
          </div>
          <label className="fld"><span>{t('poNo')}</span>
            <input className="txt" value={po} disabled={!!presetPo} onChange={e => setPo(e.target.value)} />
          </label>
          <label className="fld"><span>{t('batch')}</span>
            <input className="txt" value={batch} onChange={e => setBatch(e.target.value)} />
          </label>
          <label className="fld"><span>{t('lotSize')}</span>
            <input className="txt" type="number" min={1} value={lot} onChange={e => setLot(+e.target.value)} />
          </label>
        </div>
        {sku && (
          <div className="banner ok" style={{ marginTop:14 }}>
            {sku.model} · {sku.size} · PCD {sku.pcd} · ET {sku.offset_txt} · CB {sku.cb_mm} · {sku.finish}
            {sku.wheel_weight_kg && <> · {sku.wheel_weight_kg.toFixed(2)} kg</>}
            {sku.tpms_sensor_mm && <> · TPMS: {sku.tpms_sensor_mm}</>}
          </div>
        )}
        <div className="row" style={{ marginTop:12 }}>
          <div className="card" style={{ flex:1, marginBottom:0, textAlign:'center' }}>
            <div className="muted">{t('appSample')}</div>
            <div style={{ fontSize:34, fontFamily:'var(--display)', fontWeight:700, color:'var(--navy)' }}>{sizes.app}</div>
          </div>
          <div className="card" style={{ flex:1, marginBottom:0, textAlign:'center' }}>
            <div className="muted">{t('funSample')}</div>
            <div style={{ fontSize:34, fontFamily:'var(--display)', fontWeight:700, color:'var(--navy)' }}>{sizes.fun}</div>
          </div>
        </div>
        {!samp && (
          <div className="banner warn" style={{ marginTop:12, fontSize:13 }}>{t('sampleSettingsMissing')}</div>
        )}
        <button className="btn" style={{ width:'100%', marginTop:16 }}
          disabled={!partNo || !lot || !samp || busy} onClick={start}>
          {t('start')}
        </button>
      </div>
    </div>
  )
}

```

### `src/pages/PoHub.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import type { Profile } from '../App'
import PoInfo from './PoInfo'
import EmailModal from '../components/EmailModal'
import AttachInspectionModal from '../components/AttachInspectionModal'
import { linkedInspectionIds, deletePoLinksAndOrphans } from '../lib/inspectionPos'
import PoStatusStrip from '../components/PoStatusStrip'
import CustomerAccessCard from '../components/CustomerAccessCard'

interface Insp { id: string; part_no: string; status: string; updated_at: string; inspector_id: string; off_po?: boolean }
interface Cont { id: string; container_no: string; seal_no: string; status: string; insp_status: string; updated_at: string; inspector_id: string }

function fmt(dt: string | null) {
  if (!dt) return '—'
  const d = new Date(dt)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function PoHub({ profile }: { profile: Profile }) {
  const { poNo } = useParams()
  const po = decodeURIComponent(poNo || '')
  const nav = useNavigate()
  const { t } = useI18n()
  const [insps, setInsps] = useState<Insp[]>([])
  const [conts, setConts] = useState<Cont[]>([])
  const [busy, setBusy] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)

  const load = useCallback(async () => {
    const { ids, offPo } = await linkedInspectionIds(po)
    let inspList: Insp[] = []
    if (ids.length) {
      const { data: i } = await supabase.from('inspections').select('id,part_no,status,updated_at,inspector_id').in('id', ids).order('updated_at', { ascending: false })
      inspList = ((i as Insp[]) || []).map(x => ({ ...x, off_po: offPo[x.id] || false }))
    }
    setInsps(inspList)
    const { data: c } = await supabase.from('container_loadings').select('id,container_no,seal_no,status,insp_status,updated_at,inspector_id').eq('po_no', po).order('updated_at', { ascending: false })
    setConts((c as Cont[]) || [])
  }, [po])
  useEffect(() => { load() }, [load])

  const addContainer = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('container_loadings').insert({ inspector_id: profile.id, po_no: po }).select('id').single()
    setBusy(false)
    if (error) { alert(error.message); return }
    if (data) nav(`/container/${data.id}`)
  }

  const [emailOpen, setEmailOpen] = useState(false)
  const emailPoReport = () => setEmailOpen(true)
  const doEmailPo = async (emails: string[]) => {
    setBusy(true)
    const { error } = await supabase.functions.invoke('send-po-report', { body: { po, emails } })
    setBusy(false)
    if (error) { alert('Email failed: ' + error.message); return }
    setEmailOpen(false)
    alert('Consolidated PO report link sent.')
  }

  const delInsp = async (r: Insp) => {
    if (!confirm(t('delWheelConfirm'))) return
    await supabase.from('inspection_pos').delete().eq('inspection_id', r.id).eq('po_no', po)
    const { data: still } = await supabase.from('inspection_pos').select('inspection_id').eq('inspection_id', r.id).limit(1)
    if (!still || still.length === 0) {
      const { error } = await supabase.from('inspections').delete().eq('id', r.id)
      if (error) { alert('Delete failed: ' + error.message); return }
    }
    load()
  }
  const delCont = async (c: Cont) => {
    if (!confirm(t('delContConfirm'))) return
    const { error } = await supabase.from('container_loadings').delete().eq('id', c.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }
  const canDelInsp = (r: Insp) => profile.role === 'admin' || (r.status === 'draft' && r.inspector_id === profile.id)
  const canDelCont = (c: Cont) => profile.role === 'admin' || (['draft', 'rejected'].includes(c.insp_status) && c.inspector_id === profile.id)

  const delPO = async () => {
    if (!confirm(`Delete the ENTIRE PO “${po || '(No PO)'}”?\n\nThis permanently deletes its ${insps.length} wheel inspection(s) and ${conts.length} container loading(s), including their photos.\n\nThis cannot be undone.`)) return
    await deletePoLinksAndOrphans(po)
    const { error: e2 } = await supabase.from('container_loadings').delete().eq('po_no', po)
    if (e2) { alert('Delete failed: ' + e2.message); return }
    await supabase.from('pos').delete().eq('po_no', po) // master row + items (cascade)
    nav('/')
  }

  return (
    <div className="page">
      <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, marginBottom: 12 }} onClick={() => nav('/')}>← {t('allPos')}</button>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>PO: {po || t('noPo')}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{insps.length} {t('wheelInspections')} · {conts.length} {t('containerLoadings')}</p>
        {profile.role === 'admin' && (insps.length > 0 || conts.length > 0) &&
          <button className="btn danger" style={{ minHeight: 36, padding: '6px 12px', fontSize: 13, marginTop: 8 }} onClick={delPO}>🗑 {t('deleteEntirePo')}</button>}
      </div>

      <PoStatusStrip po={po} profile={profile} refreshKey={insps.length + conts.length} />

      <PoInfo po={po} profile={profile} refreshKey={insps.length + conts.length} />

      {profile.role === 'admin' && <CustomerAccessCard po={po} />}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('wheelInspections')}</h2>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => setAttachOpen(true)}>🔗 {t('attachInspection')}</button>
            <Link to={`/new?po=${encodeURIComponent(po)}`}><button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}>＋ {t('addSku')}</button></Link>
          </div>
        </div>
        {insps.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noWheelInspections')}</p>}
        {insps.map(r => (
          <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Link to={`/inspection/${r.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{r.part_no}</Link>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                  {r.off_po && <span className="pill" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>⚠ {t('offPo')}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{t('updated')}: {fmt(r.updated_at)}</div>
              </div>
              {canDelInsp(r) && <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delInsp(r)}>🗑</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('containerLoadings')}</h2>
          <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} disabled={busy} onClick={addContainer}>＋ {t('addContainer')}</button>
        </div>
        {conts.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noContainerLoadings')}</p>}
        {conts.map(c => (
          <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Link to={`/container/${c.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{c.container_no || t('noContainerNo')}</Link>
                  <span className={`pill ${c.insp_status}`}>{c.insp_status}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{t('seal')}: {c.seal_no || '—'} · {t('status')}: {c.status} · {t('updated')}: {fmt(c.updated_at)}</div>
              </div>
              {canDelCont(c) && <button className="btn danger" style={{ minHeight: 36, padding: '4px 10px', fontSize: 13 }} onClick={() => delCont(c)}>🗑</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: '0 0 10px' }}>Consolidated PO report</h2>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5 }}>One shareable report with a container-loading and wheel-inspection overview for this PO. Each row links out to its own interactive report.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to={`/po-report/${encodeURIComponent(po)}`} target="_blank">
            <button className="btn" style={{ minHeight: 40, padding: '6px 16px' }}>Open consolidated report</button>
          </Link>
          <button className="btn ghost" style={{ minHeight: 40, padding: '6px 16px' }} disabled={busy} onClick={emailPoReport}>✉ Email consolidated report</button>
        </div>
      </div>
      {attachOpen && <AttachInspectionModal po={po} profile={profile} onClose={() => setAttachOpen(false)} onAttached={load} />}
      {emailOpen && <EmailModal title="Email consolidated PO report" sending={busy}
        onSend={doEmailPo} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}

```

### `src/pages/PoInfo.tsx`

```tsx
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import type { Profile } from '../App'
import * as XLSX from 'xlsx'
import { sumLoadedByPart } from '../lib/poStatus'
import PartPicker from '../components/PartPicker'

// PO master info + ordered items for the PO detail page (Phase 1).
// - Info card: customer / date / destination, editable by admin.
// - Items card: part numbers with ordered vs loaded vs remaining quantities.
//   Loaded is computed from confirmed container-loading contents for this PO.
// - Excel upload (admin): flexible header matching -> review screen -> save.

interface PoRow { id: string; po_no: string; customer_name: string | null; po_date: string | null; destination: string | null }
interface Item { id?: string; part_no: string; qty_ordered: number }
interface ReviewRow { part_no: string; qty: string; ok: boolean; note: string }

const HDR_PART = ['part number', 'part no', 'part no.', 'partnumber', 'part', 'sku', 'part_no', 'item', 'item no', 'part#', 'p/n']
const HDR_QTY = ['qty', 'quantity', 'qty ordered', 'ordered qty', 'order qty', 'pcs', 'amount', 'qty_ordered']

export default function PoInfo({ po, profile, refreshKey }: { po: string; profile: Profile; refreshKey?: number }) {
  const { t } = useI18n()
  const [row, setRow] = useState<PoRow | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loadedQty, setLoadedQty] = useState<Record<string, number>>({})
  const [editInfo, setEditInfo] = useState<{ customer_name: string; po_date: string; destination: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [review, setReview] = useState<ReviewRow[] | null>(null)
  const [addItem, setAddItem] = useState<{ part_no: string; qty: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const isApprover = profile.role === 'admin'

  const load = useCallback(async () => {
    setErr('')
    // PO master row — create lazily if missing (covers POs typed before Phase 1).
    let { data: p } = await supabase.from('pos').select('*').eq('po_no', po).maybeSingle()
    if (!p && isApprover && po.trim() !== '') {
      const ins = await supabase.from('pos').insert({ po_no: po }).select('*').single()
      if (!ins.error) p = ins.data
    }
    setRow((p as PoRow) || null)
    if (p) {
      const { data: it } = await supabase.from('po_items').select('id,part_no,qty_ordered').eq('po_id', (p as PoRow).id).order('part_no')
      setItems((it as Item[]) || [])
    } else setItems([])
    // Loaded quantities: sum confirmed container-loading contents for this PO.
    const { data: conts } = await supabase.from('container_loadings').select('data').eq('po_no', po)
    setLoadedQty(sumLoadedByPart((conts as { data: unknown }[]) || []))
  }, [po, isApprover])
  useEffect(() => { load() }, [load, refreshKey])

  const saveInfo = async () => {
    if (!row || !editInfo) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('pos').update({
      customer_name: editInfo.customer_name.trim() || null,
      po_date: editInfo.po_date || null,
      destination: editInfo.destination.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setEditInfo(null); load()
  }

  const saveNewItem = async () => {
    if (!row || !addItem) return
    const part = addItem.part_no.trim()
    const qty = parseInt(addItem.qty, 10)
    if (!part) { setErr(t('partRequired')); return }
    if (!Number.isFinite(qty) || qty < 0) { setErr('Quantity must be a number.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('po_items').upsert({ po_id: row.id, part_no: part, qty_ordered: qty }, { onConflict: 'po_id,part_no' })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setAddItem(null); load()
  }

  const updateQty = async (it: Item, v: string) => {
    const qty = parseInt(v, 10)
    if (!Number.isFinite(qty) || qty < 0 || !it.id) return
    const { error } = await supabase.from('po_items').update({ qty_ordered: qty }).eq('id', it.id)
    if (error) setErr(error.message); else load()
  }

  const removeItem = async (it: Item) => {
    if (!it.id) return
    if (!confirm(`Remove ${it.part_no} from this PO's order list?\n\n(Existing inspections and reports are NOT affected.)`)) return
    const { error } = await supabase.from('po_items').delete().eq('id', it.id)
    if (error) setErr(error.message); else load()
  }

  // ---- Excel upload: flexible header match -> review -> confirm ----
  const onFile = async (f: File) => {
    setErr('')
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      if (!rows.length) { setErr('The file appears to be empty.'); return }
      // Find the header row: first row containing a part-ish and a qty-ish header.
      const norm = (s: any) => String(s || '').trim().toLowerCase()
      let hdrIdx = -1, partCol = -1, qtyCol = -1
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const cells = rows[r].map(norm)
        const pc = cells.findIndex(c => HDR_PART.includes(c))
        const qc = cells.findIndex(c => HDR_QTY.includes(c))
        if (pc >= 0 && qc >= 0) { hdrIdx = r; partCol = pc; qtyCol = qc; break }
      }
      const out: ReviewRow[] = []
      if (hdrIdx >= 0) {
        for (let r = hdrIdx + 1; r < rows.length; r++) {
          const part = String(rows[r][partCol] || '').trim()
          const qty = String(rows[r][qtyCol] || '').trim()
          if (!part && !qty) continue
          const qn = parseInt(qty.replace(/[, ]/g, ''), 10)
          out.push({ part_no: part, qty: Number.isFinite(qn) ? String(qn) : qty, ok: !!part && Number.isFinite(qn), note: !part ? 'Missing part number' : (!Number.isFinite(qn) ? 'Quantity is not a number' : '') })
        }
      } else {
        // No recognisable header: assume col A = part, col B = qty, let the
        // review screen sort it out. Nothing is saved until confirmed.
        for (const r of rows) {
          const part = String(r[0] || '').trim()
          const qty = String(r[1] || '').trim()
          if (!part && !qty) continue
          const qn = parseInt(qty.replace(/[, ]/g, ''), 10)
          out.push({ part_no: part, qty: Number.isFinite(qn) ? String(qn) : qty, ok: !!part && Number.isFinite(qn), note: 'No header row detected — please verify' })
        }
      }
      if (!out.length) { setErr('No item rows found in the file.'); return }
      setReview(out)
    } catch (e) {
      setErr('Could not read the file: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const confirmReview = async () => {
    if (!row || !review) return
    const good = review.filter(r => r.part_no.trim() && Number.isFinite(parseInt(r.qty, 10)))
    if (!good.length) { setErr('No valid rows to save. Fix the highlighted rows first.'); return }
    setBusy(true); setErr('')
    const payload = good.map(r => ({ po_id: row.id, part_no: r.part_no.trim(), qty_ordered: parseInt(r.qty, 10) }))
    const { error } = await supabase.from('po_items').upsert(payload, { onConflict: 'po_id,part_no' })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setReview(null); load()
  }

  const fmtDate = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString() : '—'
  const totOrdered = items.reduce((a, b) => a + (b.qty_ordered || 0), 0)
  const totLoaded = items.reduce((a, b) => a + (loadedQty[b.part_no] || 0), 0)

  return (
    <>
      {/* ---- PO information ---- */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('poInformation')}</h2>
          {isApprover && row && !editInfo && (
            <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }}
              onClick={() => setEditInfo({ customer_name: row.customer_name || '', po_date: row.po_date || '', destination: row.destination || '' })}>✎ {t('edit')}</button>
          )}
        </div>
        {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginTop: 8 }}>{err}</div>}
        {!editInfo && (
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.9 }}>
            <div><span className="muted">{t('customer')}:</span> <b>{row?.customer_name || '—'}</b></div>
            <div><span className="muted">{t('poDate')}:</span> <b>{fmtDate(row?.po_date || null)}</b></div>
            <div><span className="muted">{t('destination')}:</span> <b>{row?.destination || '—'}</b></div>
          </div>
        )}
        {editInfo && (
          <div style={{ marginTop: 10 }}>
            <label className="fld"><span>{t('customerName')}</span>
              <input className="txt" value={editInfo.customer_name} onChange={e => setEditInfo({ ...editInfo, customer_name: e.target.value })} /></label>
            <label className="fld"><span>{t('poDate')}</span>
              <input className="txt" type="date" value={editInfo.po_date} onChange={e => setEditInfo({ ...editInfo, po_date: e.target.value })} /></label>
            <label className="fld"><span>{t('destination')}</span>
              <input className="txt" value={editInfo.destination} onChange={e => setEditInfo({ ...editInfo, destination: e.target.value })} /></label>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={saveInfo}>{busy ? t('saving') : t('save')}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setEditInfo(null)}>{t('cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Ordered items ---- */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>{t('orderedItems')}</h2>
          {isApprover && row && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => { setErr(''); setAddItem({ part_no: '', qty: '' }) }}>＋ {t('addItem')}</button>
              <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', fontSize: 13 }} onClick={() => fileRef.current?.click()}>⬆ {t('uploadExcel')}</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
            </div>
          )}
        </div>
        {items.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('noOrderedItems')}{isApprover ? t('addUploadHint') : ''}</p>}
        {items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ marginTop: 8, minWidth: 420 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>{t('partNumber')}</th><th>{t('ordered')}</th><th>{t('loaded')}</th><th>{t('remainingQty')}</th>{isApprover && <th />}</tr></thead>
              <tbody>
                {items.map(it => {
                  const loaded = loadedQty[it.part_no] || 0
                  const rem = (it.qty_ordered || 0) - loaded
                  return (
                    <tr key={it.part_no}>
                      <td style={{ fontWeight: 700 }}>{it.part_no}</td>
                      <td style={{ textAlign: 'center' }}>
                        {isApprover
                          ? <input className="txt" style={{ width: 84, minHeight: 34, textAlign: 'center' }} defaultValue={it.qty_ordered} inputMode="numeric"
                              onBlur={e => { if (e.target.value !== String(it.qty_ordered)) updateQty(it, e.target.value) }} />
                          : it.qty_ordered}
                      </td>
                      <td style={{ textAlign: 'center' }}>{loaded}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: rem < 0 ? 'var(--fail, #C0392B)' : rem === 0 ? 'var(--pass, #1F8A4C)' : 'inherit' }}>
                        {rem}{rem < 0 ? ' ⚠' : ''}
                      </td>
                      {isApprover && <td><button className="btn danger" style={{ minHeight: 34, padding: '2px 10px', fontSize: 13 }} onClick={() => removeItem(it)}>🗑</button></td>}
                    </tr>
                  )
                })}
                <tr>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{totOrdered}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{totLoaded}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{totOrdered - totLoaded}</td>
                  {isApprover && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Loaded = confirmed container-loading contents recorded for this PO.</p>
      </div>

      {/* ---- Add item modal ---- */}
      {addItem && (
        <div className="modal-overlay" onClick={() => setAddItem(null)}>
          <div className="modal" style={{ width: 'min(420px, 94vw)', overflow: 'visible' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>{t('addOrderedItem')}</h2>
            <label className="fld" style={{ position: 'relative', zIndex: 1 }}><span>{t('partNumber')}</span>
              <PartPicker value={addItem.part_no} poParts={null} allowFreeText
                placeholder={t('partNumber')}
                onChange={part => setAddItem({ ...addItem, part_no: part })} /></label>
            <label className="fld"><span>{t('qtyOrdered')}</span>
              <input className="txt" inputMode="numeric" value={addItem.qty} onChange={e => setAddItem({ ...addItem, qty: e.target.value })} /></label>
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={saveNewItem}>{busy ? t('saving') : t('saveItem')}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setAddItem(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Excel review modal ---- */}
      {review && (
        <div className="modal-overlay" onClick={() => setReview(null)}>
          <div className="modal" style={{ width: 'min(560px, 96vw)', maxHeight: '86vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>{t('reviewExtracted')}</h2>
            <p className="muted" style={{ fontSize: 13 }}>{t('reviewHint')}</p>
            <table className="tbl">
              <thead><tr><th style={{ textAlign: 'left' }}>{t('partNumber')}</th><th>{t('qty')}</th><th /></tr></thead>
              <tbody>
                {review.map((r, i) => {
                  const bad = !r.part_no.trim() || !Number.isFinite(parseInt(r.qty, 10))
                  return (
                    <tr key={i} style={bad ? { background: '#FBE9E7' } : undefined}>
                      <td><input className="txt" style={{ minHeight: 34 }} value={r.part_no}
                        onChange={e => setReview(review.map((x, j) => j === i ? { ...x, part_no: e.target.value } : x))} /></td>
                      <td style={{ width: 110 }}><input className="txt" style={{ minHeight: 34, textAlign: 'center' }} inputMode="numeric" value={r.qty}
                        onChange={e => setReview(review.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></td>
                      <td style={{ width: 44 }}><button className="btn danger" style={{ minHeight: 32, padding: '2px 8px', fontSize: 13 }}
                        onClick={() => setReview(review.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {review.some(r => r.note) && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{[...new Set(review.map(r => r.note).filter(Boolean))].join(' · ')}</p>}
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginTop: 6 }}>{err}</div>}
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={confirmReview}>{busy ? 'Saving…' : `Confirm & save ${review.length} item(s)`}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

```

### `src/pages/PoReportPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { openPoReport } from '../lib/report'
import EmailModal from '../components/EmailModal'

type Lang = 'en' | 'de' | 'zh'
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' }]

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Consolidated PO Report', subtitle: 'All container loadings & wheel inspections for this PO', viewed: 'Viewed',
    containersH: 'Container Loadings', wheelInsp: 'Wheel Inspections',
    container: 'Container No.', bl: 'BL Number', etd: 'Est. Port Departure', eta: 'Est. Port Arrival', destPort: 'Destination Port',
    partNo: 'Part Number', size: 'Size', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Color', disposition: 'Decision',
    noSkus: 'No wheel inspections in this PO.', noConts: 'No container loadings in this PO.',
    pendingDisp: 'PENDING DISPOSITION', email: 'Email', pdf: 'PDF', loading: 'Loading consolidated report…',
  },
  de: {
    title: 'Konsolidierter Bestellbericht', subtitle: 'Alle Containerverladungen & Radprüfungen dieser Bestellung', viewed: 'Angesehen',
    containersH: 'Containerverladungen', wheelInsp: 'Radprüfungen',
    container: 'Container-Nr.', bl: 'BL-Nummer', etd: 'Vorauss. Hafenabfahrt', eta: 'Vorauss. Hafenankunft', destPort: 'Zielhafen',
    partNo: 'Teilenummer', size: 'Größe', pcd: 'PCD', cb: 'CB', et: 'ET', color: 'Farbe', disposition: 'Entscheidung',
    noSkus: 'Keine Radprüfungen in dieser Bestellung.', noConts: 'Keine Containerverladungen in dieser Bestellung.',
    pendingDisp: 'AUSSTEHENDE ENTSCHEIDUNG', email: 'E-Mail', pdf: 'PDF', loading: 'Konsolidierter Bericht wird geladen…',
  },
  zh: {
    title: '订单综合报告', subtitle: '本订单的所有集装箱装柜与轮毂检验', viewed: '查看时间',
    containersH: '集装箱装柜', wheelInsp: '轮毂检验',
    container: '集装箱号', bl: '提单号', etd: '预计离港', eta: '预计到港', destPort: '目的港',
    partNo: '产品编号', size: '尺寸', pcd: 'PCD', cb: 'CB', et: 'ET', color: '颜色', disposition: '决定',
    noSkus: '本订单暂无轮毂检验。', noConts: '本订单暂无集装箱装柜。',
    pendingDisp: '待定处置', email: '邮件', pdf: 'PDF', loading: '正在加载综合报告…',
  },
}

const DISP: Record<string, Record<Lang, string>> = {
  approved_loading: { en: 'APPROVED FOR LOADING', de: 'FÜR VERLADUNG FREIGEGEBEN', zh: '批准装柜' },
  hold_rework: { en: 'HOLD FOR REWORK & REINSPECTION', de: 'ZURÜCKHALTEN FÜR NACHARBEIT & NACHPRÜFUNG', zh: '暂扣返工并重检' },
  conditional_loading: { en: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE AUSGESCHLOSSEN', zh: '有条件装柜 — 已剔除不合格件' },
  conditional_rework: { en: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD', de: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE NACHARBEITEN & VERLADEN', zh: '有条件装柜 — 返工不合格件后装柜' },
  pending_customer: { en: 'PENDING CUSTOMER APPROVAL', de: 'AUSSTEHENDE KUNDENFREIGABE', zh: '待客户批准' },
}
const DISP_CLS: Record<string, string> = { approved_loading: 'pass', hold_rework: 'hold', conditional_loading: 'hold', conditional_rework: 'hold', pending_customer: 'hold' }
const clsColor = (c: string) => c === 'pass' ? 'var(--pass)' : c === 'hold' ? 'var(--amber)' : c === 'reject' ? 'var(--fail)' : '#5A6878'
const clsBg = (c: string) => c === 'pass' ? '#E8F5EC' : c === 'hold' ? '#FCF2DD' : c === 'reject' ? '#FBE9E7' : '#EEF1F5'

function dispOf(insp: any, lang: Lang, L: Record<string, string>) {
  const code = insp?.disposition || ''
  if (code === 'custom') return { text: insp?.disposition_custom || L.pendingDisp, cls: insp?.disposition_cls || 'pending' }
  if (code && DISP[code]) return { text: DISP[code][lang], cls: DISP_CLS[code] || 'pending' }
  return { text: L.pendingDisp, cls: 'pending' }
}
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString() : '—'

export default function PoReportPage() {
  const { po: poParam } = useParams<{ po: string }>()
  const po = decodeURIComponent(poParam || '')
  const [lang, setLang] = useState<Lang>('en')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [emailing, setEmailing] = useState(false)
  const L = DICT[lang]

  useEffect(() => {
    setData(null); setErr('')
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    fetch(`${base}/functions/v1/po-report?po=${encodeURIComponent(po)}&lang=${lang}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error || 'Report unavailable') })
      .catch(e => setErr(String(e)))
  }, [po, lang])

  const skus: any[] = data?.skus || []
  const containers: any[] = data?.containers || []

  const [emailOpen, setEmailOpen] = useState(false)
  const emailReport = () => setEmailOpen(true)
  const doEmail = async (emails: string[]) => {
    setEmailing(true)
    const { data: res, error } = await supabase.functions.invoke('send-po-report', { body: { po, emails } })
    setEmailing(false)
    if (error || (res && res.ok === false)) { alert('Email failed: ' + (error?.message || res?.error || 'Unknown error')); return }
    setEmailOpen(false)
    alert('Consolidated PO report sent to: ' + emails.join(', '))
  }

  if (err) return <div style={page}><div style={{ ...card, borderColor: 'var(--fail)' }}><h2 style={{ color: 'var(--fail)' }}>Report unavailable</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: 'var(--ink-soft)', padding: 20 }}>{L.loading}</p></div>

  return (
    <div style={page}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl ? <img src={data.logoUrl} alt="logo" style={{ height: 46, maxWidth: 240, objectFit: 'contain', display: 'block' }} /> : <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>NITRA</span>}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: .3 }}>{L.title} · {po}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,.12)', borderRadius: 999, padding: 3 }}>
              {LANGS.map(o => (
                <button key={o.id} onClick={() => setLang(o.id)} style={{ border: 0, cursor: 'pointer', padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? 'var(--navy)' : '#CFE0F5' }}>{o.label}</button>
              ))}
            </div>
            <button onClick={() => openPoReport(po, lang)} style={hdrBtn}>{L.pdf}</button>
            <button onClick={emailReport} disabled={emailing} style={{ ...hdrBtn, opacity: emailing ? .6 : 1 }}>{L.email}</button>
          </div>
        </div>
        <div style={{ height: 4, background: 'var(--amber)' }} />
      </header>

      <main style={{ maxWidth: 1100, margin: '22px auto', padding: '0 14px' }}>
        <section style={card}>
          <h2 style={h2}>{L.containersH}</h2>
          {containers.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}>
                <thead><tr>{[L.container, L.bl, L.etd, L.eta, L.destPort].map(t => <Th key={t}>{t}</Th>)}</tr></thead>
                <tbody>
                  {containers.map((c, i) => (
                    <tr key={i}>
                      <Td><a href={`/container-report/${c.id}`} target="_blank" rel="noreferrer" style={link}>{c.container_no || `#${i + 1}`}</a></Td>
                      <Td2>{c.bl_no || '—'}</Td2><Td2>{fmtDate(c.etd)}</Td2><Td2>{fmtDate(c.eta)}</Td2><Td2>{c.dest_port || '—'}</Td2>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p style={muted}>{L.noConts}</p>}
        </section>

        <section style={card}>
          <h2 style={h2}>{L.wheelInsp}</h2>
          {skus.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}>
                <thead><tr>{[L.partNo, L.size, L.pcd, L.cb, L.et, L.color, L.disposition].map(t => <Th key={t}>{t}</Th>)}</tr></thead>
                <tbody>
                  {skus.map((s, i) => {
                    const d = dispOf(s.insp, lang, L)
                    return (
                      <tr key={i}>
                        <Td><a href={`/report/${s.id}`} target="_blank" rel="noreferrer" style={link}>{s.insp?.part_no || `SKU ${i + 1}`}</a></Td>
                        <Td2>{s.sku?.size || '—'}</Td2><Td2>{s.sku?.pcd || '—'}</Td2><Td2>{s.sku?.cb_mm ?? '—'}</Td2>
                        <Td2>{s.sku?.offset_txt || '—'}</Td2><Td2>{s.sku?.finish || '—'}</Td2>
                        <Td2><span style={{ ...pill, background: clsBg(d.cls), color: clsColor(d.cls) }}>{d.text}</span></Td2>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p style={muted}>{L.noSkus}</p>}
        </section>

        <div style={{ textAlign: 'center', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, padding: '14px 0' }}>CONFIDENTIAL — PROPERTY OF NITRA</div>
      </main>
      {emailOpen && <EmailModal title="Email consolidated PO report" sending={emailing}
        onSend={doEmail} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}

const page: React.CSSProperties = { minHeight: '100vh', fontFamily: 'Arial, sans-serif', color: 'var(--ink)', background: '#F4F7FA' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: '0 4px 14px rgba(31,58,95,.08)' }
const h2: React.CSSProperties = { margin: '0 0 12px', color: 'var(--navy)', fontSize: 18 }
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const muted: React.CSSProperties = { color: 'var(--ink-soft)', fontSize: 13 }
const pill: React.CSSProperties = { display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }
const link: React.CSSProperties = { color: 'var(--navy)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }
const hdrBtn: React.CSSProperties = { border: '1px solid rgba(255,255,255,.3)', background: 'rgba(255,255,255,.12)', color: '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 9, fontSize: 13, fontWeight: 700 }}>{children}</td>
}
function Td2({ children }: { children: React.ReactNode }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 9, fontSize: 13 }}>{children}</td>
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ background: 'var(--navy)', color: '#fff', textAlign: 'left', padding: 9, fontSize: 12, whiteSpace: 'nowrap' }}>{children}</th>
}

```

### `src/pages/RefLibrary.tsx`

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import Camera, { photoUrl } from '../components/Camera'
import type { Profile } from '../App'

interface Ref { id: string; storage_path: string; caption: string; ref_category: string; ref_verdict: string }
interface InspPhoto { id: string; storage_path: string; item_key: string; piece_no: number; is_pass_photo: boolean }
const BASE_CATS = ['porosity', 'paint_inclusion', 'scratch', 'hat_marks', 'coating', 'marking', 'packing', 'general']

export default function RefLibrary({ profile }: { profile: Profile }) {
  const { t } = useI18n()
  const [refs, setRefs] = useState<Ref[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [cats, setCats] = useState<string[]>(BASE_CATS)
  const [cat, setCat] = useState(BASE_CATS[0])
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'acceptable' | 'defect'>('all')
  const [caption, setCaption] = useState('')
  const [newVerdict, setNewVerdict] = useState<'acceptable' | 'defect'>('defect')
  const [newCat, setNewCat] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [inspPhotos, setInspPhotos] = useState<InspPhoto[]>([])
  const [preview, setPreview] = useState('')
  const isApprover = profile.role === 'admin'

  const load = async () => {
    const { data } = await supabase.from('photos').select('*').eq('is_reference', true).order('ref_category')
    setRefs((data as Ref[]) || [])
    const { data: cs } = await supabase.from('settings').select('value').eq('key', 'ref_categories').maybeSingle()
    const extra: string[] = cs?.value?.extra || []
    setCats([...BASE_CATS, ...extra])
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    refs.forEach(async r => {
      if (!urls[r.storage_path]) {
        const u = await photoUrl(r.storage_path)
        if (u) setUrls(prev => ({ ...prev, [r.storage_path]: u }))
      }
    })
  }, [refs]) // eslint-disable-line

  const addCategory = async () => {
    const c = newCat.trim().toLowerCase().replace(/\s+/g, '_')
    if (!c || cats.includes(c)) return
    const extra = [...cats.filter(x => !BASE_CATS.includes(x)), c]
    await supabase.from('settings').upsert({ key: 'ref_categories', value: { extra } })
    setNewCat(''); load()
  }

  const openPicker = async () => {
    const { data } = await supabase.from('photos').select('id,storage_path,item_key,piece_no,is_pass_photo')
      .eq('is_reference', false).order('created_at', { ascending: false }).limit(60)
    const ps = (data as InspPhoto[]) || []
    setInspPhotos(ps)
    ps.forEach(async p => {
      if (!urls[p.storage_path]) {
        const u = await photoUrl(p.storage_path)
        if (u) setUrls(prev => ({ ...prev, [p.storage_path]: u }))
      }
    })
    setPickerOpen(true)
  }

  const copyToLibrary = async (p: InspPhoto) => {
    await supabase.from('photos').insert({
      is_reference: true, ref_category: cat, ref_verdict: newVerdict,
      storage_path: p.storage_path, caption: caption || `From inspection (${p.item_key || 'photo'})`,
      uploaded_by: profile.id, item_key: p.item_key, piece_no: p.piece_no,
    })
    setPickerOpen(false); load()
  }

  const shown = refs.filter(r => r.ref_category === cat && (verdictFilter === 'all' || r.ref_verdict === verdictFilter))

  return (
    <div className="page">
      <div className="card">
        <h2>{t('refLibrary')}</h2>
        <p className="muted">Acceptable vs defect examples per category — training reference for inspectors.</p>

        {/* Category chips */}
        <div className="tabs" style={{ position: 'static' }}>
          {cats.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c.replace(/_/g, ' ')}</button>)}
        </div>

        {/* Verdict filter */}
        <div className="row" style={{ marginBottom: 12 }}>
          {(['all', 'acceptable', 'defect'] as const).map(v => (
            <button key={v} className="btn ghost" style={{ minHeight: 38, padding: '6px 14px', fontSize: 13, ...(verdictFilter === v ? { background: v === 'defect' ? 'var(--fail)' : v === 'acceptable' ? 'var(--pass)' : 'var(--navy)', color: '#fff' } : {}) }}
              onClick={() => setVerdictFilter(v)}>
              {v === 'all' ? 'All' : v === 'acceptable' ? '✓ Acceptable' : '✗ Defect'}
            </button>
          ))}
        </div>

        {/* Gallery */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
          {shown.map(r => (
            <figure key={r.id} style={{ margin: 0, borderRadius: 10, overflow: 'hidden', border: `2px solid ${r.ref_verdict === 'acceptable' ? 'var(--pass)' : 'var(--fail)'}` }}>
              {urls[r.storage_path] && (
                <img src={urls[r.storage_path]} style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                  onClick={() => setPreview(urls[r.storage_path])} />
              )}
              <figcaption style={{ padding: '5px 8px', fontSize: 12, background: r.ref_verdict === 'acceptable' ? 'var(--pass-bg)' : 'var(--fail-bg)' }}>
                <b style={{ color: r.ref_verdict === 'acceptable' ? 'var(--pass)' : 'var(--fail)' }}>
                  {r.ref_verdict === 'acceptable' ? '✓ Acceptable' : '✗ Defect'}
                </b>
                <div className="muted">{r.caption}</div>
                {isApprover && (
                  <button className="btn ghost" style={{ minHeight: 30, padding: '2px 8px', fontSize: 11, marginTop: 4 }}
                    onClick={async () => { if (confirm('Remove from library?')) { await supabase.from('photos').delete().eq('id', r.id); load() } }}>🗑</button>
                )}
              </figcaption>
            </figure>
          ))}
          {shown.length === 0 && <p className="muted">No reference photos in this view yet.</p>}
        </div>

        {/* Approver controls */}
        {isApprover && (
          <div className="card" style={{ marginTop: 16, background: '#F7F9FB' }}>
            <h2 style={{ fontSize: 17 }}>Add to library → {cat.replace(/_/g, ' ')}</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              {(['acceptable', 'defect'] as const).map(v => (
                <button key={v} className="btn ghost" style={{ minHeight: 40, ...(newVerdict === v ? { background: v === 'defect' ? 'var(--fail)' : 'var(--pass)', color: '#fff' } : {}) }}
                  onClick={() => setNewVerdict(v)}>
                  {v === 'acceptable' ? '✓ Acceptable' : '✗ Defect'}
                </button>
              ))}
            </div>
            <input className="txt" placeholder="Caption…" style={{ marginBottom: 10 }} value={caption} onChange={e => setCaption(e.target.value)} />
            <div className="row">
              <Camera label={t('takePhoto')} onUploaded={async path => {
                await supabase.from('photos').insert({
                  is_reference: true, ref_category: cat, ref_verdict: newVerdict,
                  caption, storage_path: path, uploaded_by: profile.id,
                })
                setCaption(''); load()
              }} />
              <button className="btn ghost" onClick={openPicker}>📂 From past inspections</button>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <input className="txt" style={{ flex: 1 }} placeholder="New category name…" value={newCat} onChange={e => setNewCat(e.target.value)} />
              <button className="btn" onClick={addCategory}>+ Add category</button>
            </div>
          </div>
        )}
      </div>

      {/* Inspection photo picker */}
      {pickerOpen && (
        <div className="modal-overlay" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 10 }}>📂 Pick a photo → {cat.replace(/_/g, ' ')} ({newVerdict})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
              {inspPhotos.map(p => (
                <div key={p.id} style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}
                  onClick={() => copyToLibrary(p)}>
                  {urls[p.storage_path]
                    ? <img src={urls[p.storage_path]} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                    : <div style={{ height: 90, background: 'var(--steel)' }} />}
                  <div style={{ fontSize: 10, padding: '3px 6px' }}>{p.item_key ? p.item_key.replace(/_/g, ' ') : 'photo'}</div>
                </div>
              ))}
              {inspPhotos.length === 0 && <p className="muted">No inspection photos found.</p>}
            </div>
            <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setPickerOpen(false)}>Close</button>
          </div>
        </div>
      )}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview('')}>
          <img src={preview} style={{ maxWidth: '94vw', maxHeight: '88vh', borderRadius: 12 }} />
        </div>
      )}
    </div>
  )
}

```

### `src/pages/ReportPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { SECTIONS, MEAS_SECTIONS } from '../lib/standard'

const APPENDIX_SECTION_DEFS: { title: string; keys: string[] }[] = [
  ...SECTIONS.map(s => ({ title: s.title.en, keys: s.items.map(i => i.key) })),
  ...MEAS_SECTIONS.map(ms => ({ title: ms.title.en, keys: ms.cols.map(c => c.key) })),
]
const SECTION_OF: Record<string, string> = {}
for (const s of APPENDIX_SECTION_DEFS) for (const k of s.keys) SECTION_OF[k] = s.title
const APPENDIX_TITLES = [...APPENDIX_SECTION_DEFS.map(s => s.title), 'Other']

interface DefectRow { parameter: string; pieceLabel: string; mediaUrl: string | null; mediaType: string | null }
interface PhotoItem { isPass: boolean; pieceLabel: string; mediaUrl: string | null; mediaType: string; comment: string }
interface PhotoGroup { key: string; label: string; photos: PhotoItem[] }
interface OutcomeRow { parameter: string; checked: number; pass: number; fail: number; defectPieces: string; outcome: string }
interface ReportData {
  ok: boolean
  error?: string
  lang?: string
  translationNote?: string | null
  logoUrl?: string | null
  insp: {
    part_no: string; po_no: string; batch: string; lot_size: number
    app_sample: number; fun_sample: number
    submitted_at: string | null; reviewed_at: string | null
    disposition: string | null; remarks: string; corrective_action: string
    disposition_custom?: string | null; disposition_cls?: string | null
  }
  sku: { model: string; size: string; pcd: string; offset_txt: string; cb_mm: number | null; finish: string } | null
  inspectorName: string
  reviewerName: string
  defects: DefectRow[]
  photoGroups: PhotoGroup[]
  outcomes: OutcomeRow[]
}

type Lang = 'en' | 'de' | 'zh'
const LANG_LABELS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' }, { id: 'de', label: 'DE' }, { id: 'zh', label: '中文' },
]

// Disposition class (colour) is language-independent; the wording is localised below.
const DISPOSITION_CLS: Record<string, string> = {
  approved_loading: 'pass',
  hold_rework: 'hold',
  conditional_loading: 'hold',
  conditional_rework: 'hold',
  pending_customer: 'hold',
}

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'QC Interactive Report', subtitle: 'Live report · clickable photo & video evidence',
    viewed: 'Viewed', finalDisposition: 'DISPOSITION', pendingDisposition: 'PENDING DISPOSITION',
    inspectionReport: 'Inspection Report',
    partNo: 'Part No. / SKU', finish: 'Finish', modelSize: 'Model / Size', pcdEtCb: 'PCD · ET · CB',
    poNo: 'PO No.', batch: 'Batch', lotSize: 'Lot Size', samples: 'Samples', inspector: 'Inspector',
    submitted: 'Submitted', approvedBy: 'Approved By', approvedOn: 'Approved On',
    pcs: 'pcs', visualWord: 'Visual', technicalWord: 'Technical',
    findings: 'Inspection Findings', corrective: 'Action Taken',
    criteria: 'Inspection Evaluation Criteria',
    sampleSize: 'Sample size', onePieceFails: '1 piece fails', sameDefectAgain: 'Same defect fails again',
    twoPlusFail: '2+ fail in initial sample', pct100: '100% inspection', immediately: 'immediately',
    ruleSampleSize: '≤100 pcs → inspect {b}; +{a} for each additional 100 pcs',
    ruleOneFail: 'inspect +{a} more for that specific defect',
    criteriaNote: '100% inspection applies only to the specific defect / parameter that triggered the rule.',
    outcomeHeading: 'Inspection Outcome',
    thParameter: 'Inspected Parameter', thChecked: 'Checked', thPass: 'Pass', thFail: 'Fail',
    thDefectPieces: 'Defect Pieces', thOutcome: 'Outcome', noParams: 'No parameters inspected.',
    photoHeading: 'Photo / Video Appendix', approvedPhotos: 'Approved Inspection Photos',
    failedPhotos: 'Failed Inspection Photos', noApproved: 'No approved photos.', noFailed: 'No failed photos.',
    appendixHeading: 'Appendix — Additional Photos', noMedia: 'No media',
    passWord: 'PASS', failWord: 'FAIL', confidential: 'CONFIDENTIAL — PROPERTY OF NITRA',
    loadingReport: 'Loading report…', reportUnavailable: 'Report unavailable', translating: 'Translating…',
    txUnavailable: 'Automatic translation is unavailable — some fields are shown in the original language.',
    findRequired100: '{p} — required 100% inspection', findAddPass: '{p} — passed after additional sampling',
    findAddRequired: '{p} — failed the initial sample; additional inspection required',
    findAllInitial: 'All inspected parameters passed on the initial sample.',
    findAllOther: 'All other inspected parameters passed.',
    out_pass: 'Pass', out_100: '100% Inspection',
    out_addpass: 'Additional Inspection — Pass', out_addreq: 'Additional Inspection Required',
    disp_approved_loading: 'APPROVED FOR LOADING', disp_hold_rework: 'HOLD FOR REWORK & REINSPECTION',
    disp_conditional_loading: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED',
    disp_conditional_rework: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD',
    disp_pending_customer: 'PENDING CUSTOMER APPROVAL',
  },
  de: {
    title: 'Interaktiver QC-Bericht', subtitle: 'Live-Bericht · anklickbare Foto- & Videonachweise',
    viewed: 'Angesehen', finalDisposition: 'ENDGÜLTIGE ENTSCHEIDUNG', pendingDisposition: 'ENTSCHEIDUNG AUSSTEHEND',
    inspectionReport: 'Prüfbericht',
    partNo: 'Teile-Nr. / SKU', finish: 'Oberfläche', modelSize: 'Modell / Größe', pcdEtCb: 'PCD · ET · CB',
    poNo: 'Bestell-Nr.', batch: 'Charge', lotSize: 'Losgröße', samples: 'Stichproben', inspector: 'Prüfer',
    submitted: 'Eingereicht', approvedBy: 'Genehmigt von', approvedOn: 'Genehmigt am',
    pcs: 'Stk.', visualWord: 'Visuell', technicalWord: 'Technisch',
    findings: 'Prüfergebnisse', corrective: 'Korrekturmaßnahme / Entscheidung',
    criteria: 'Bewertungskriterien der Prüfung',
    sampleSize: 'Stichprobengröße', onePieceFails: '1 Teil fällt durch', sameDefectAgain: 'Gleicher Fehler erneut',
    twoPlusFail: '2+ Teile in Erststichprobe durchgefallen', pct100: '100%-Prüfung', immediately: 'sofort',
    ruleSampleSize: '≤100 Stk. → {b} prüfen; +{a} je weitere 100 Stk.',
    ruleOneFail: '+{a} weitere für diesen spezifischen Fehler prüfen',
    criteriaNote: 'Die 100%-Prüfung gilt nur für den spezifischen Fehler / Parameter, der die Regel ausgelöst hat.',
    outcomeHeading: 'Prüfergebnis',
    thParameter: 'Geprüfter Parameter', thChecked: 'Geprüft', thPass: 'Bestanden', thFail: 'Durchgefallen',
    thDefectPieces: 'Fehlerhafte Teile', thOutcome: 'Ergebnis', noParams: 'Keine Parameter geprüft.',
    photoHeading: 'Foto- / Videoanhang', approvedPhotos: 'Freigegebene Prüffotos',
    failedPhotos: 'Fehlerhafte Prüffotos', noApproved: 'Keine freigegebenen Fotos.', noFailed: 'Keine fehlerhaften Fotos.',
    appendixHeading: 'Anhang — Zusätzliche Fotos', noMedia: 'Keine Medien',
    passWord: 'BESTANDEN', failWord: 'DURCHGEFALLEN', confidential: 'VERTRAULICH — EIGENTUM VON NITRA',
    loadingReport: 'Bericht wird geladen …', reportUnavailable: 'Bericht nicht verfügbar', translating: 'Übersetzen …',
    txUnavailable: 'Automatische Übersetzung nicht verfügbar — einige Felder werden im Original angezeigt.',
    findRequired100: '{p} — 100%-Prüfung erforderlich', findAddPass: '{p} — nach zusätzlicher Stichprobe bestanden',
    findAddRequired: '{p} — Erststichprobe nicht bestanden; zusätzliche Prüfung erforderlich',
    findAllInitial: 'Alle geprüften Parameter haben die Erststichprobe bestanden.',
    findAllOther: 'Alle übrigen geprüften Parameter bestanden.',
    out_pass: 'Bestanden', out_100: '100%-Prüfung',
    out_addpass: 'Zusätzliche Prüfung — Bestanden', out_addreq: 'Zusätzliche Prüfung erforderlich',
    disp_approved_loading: 'FÜR VERLADUNG FREIGEGEBEN', disp_hold_rework: 'ZURÜCKHALTEN FÜR NACHARBEIT & NACHPRÜFUNG',
    disp_conditional_loading: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE AUSGESCHLOSSEN',
    disp_conditional_rework: 'BEDINGTE VERLADUNG — FEHLERHAFTE TEILE NACHARBEITEN & VERLADEN',
    disp_pending_customer: 'AUSSTEHENDE KUNDENFREIGABE',
  },
  zh: {
    title: 'QC 互动报告', subtitle: '实时报告 · 可点击的照片和视频证据',
    viewed: '查看时间', finalDisposition: '处置', pendingDisposition: '待定处置',
    inspectionReport: '检验报告',
    partNo: '零件号 / SKU', finish: '表面处理', modelSize: '型号 / 尺寸', pcdEtCb: 'PCD · ET · CB',
    poNo: '采购订单号', batch: '批次', lotSize: '批量', samples: '抽样', inspector: '检验员',
    submitted: '提交时间', approvedBy: '审批人', approvedOn: '审批时间',
    pcs: '件', visualWord: '外观', technicalWord: '技术',
    findings: '检验发现', corrective: '处置措施',
    criteria: '检验评估标准',
    sampleSize: '抽样数量', onePieceFails: '1 件不合格', sameDefectAgain: '同一缺陷再次出现',
    twoPlusFail: '初始样本中 2 件及以上不合格', pct100: '全检 (100%)', immediately: '（立即）',
    ruleSampleSize: '≤100 件 → 抽检 {b} 件；每增加 100 件加检 {a} 件',
    ruleOneFail: '针对该特定缺陷加检 {a} 件',
    criteriaNote: '全检仅适用于触发该规则的特定缺陷 / 参数。',
    outcomeHeading: '检验结果',
    thParameter: '检验参数', thChecked: '检验数', thPass: '合格', thFail: '不合格',
    thDefectPieces: '不合格件号', thOutcome: '结果', noParams: '未检验任何参数。',
    photoHeading: '照片 / 视频附录', approvedPhotos: '合格检验照片',
    failedPhotos: '不合格检验照片', noApproved: '无合格照片。', noFailed: '无不合格照片。',
    appendixHeading: '附录 — 补充照片', noMedia: '无媒体',
    passWord: '合格', failWord: '不合格', confidential: '机密 — NITRA 财产',
    loadingReport: '报告加载中…', reportUnavailable: '报告不可用', translating: '翻译中…',
    txUnavailable: '自动翻译不可用 — 部分字段显示原文。',
    findRequired100: '{p} — 需进行全检', findAddPass: '{p} — 加抽样后合格',
    findAddRequired: '{p} — 初始样本不合格；需加抽检验',
    findAllInitial: '所有检验参数在初始样本中均合格。',
    findAllOther: '所有其他检验参数均合格。',
    out_pass: '合格', out_100: '全检 (100%)',
    out_addpass: '加检 — 合格', out_addreq: '需加检',
    disp_approved_loading: '批准装柜', disp_hold_rework: '暂扣返工并重检',
    disp_conditional_loading: '有条件装柜 — 已剔除不合格件',
    disp_conditional_rework: '有条件装柜 — 返工不合格件后装柜',
    disp_pending_customer: '待客户批准',
  },
}

// Photo-appendix section group titles, keyed by their English title.
const SECT: Record<Lang, Record<string, string>> = {
  en: {},
  de: {
    'Wheel Finish & TPMS': 'Radoberfläche & TPMS', 'Cap Finish & Fitment': 'Nabenkappe — Oberfläche & Passung',
    'Marking': 'Kennzeichnung', 'Packing': 'Verpackung', 'Box & Label': 'Karton & Etikett',
    'Wheel Machining': 'Radbearbeitung', 'Wheel OOR': 'Rad-Rundlauf (OOR)', 'Wheel Balance': 'Radwuchtung',
    'Other': 'Sonstiges',
  },
  zh: {
    'Wheel Finish & TPMS': '轮毂表面处理与TPMS', 'Cap Finish & Fitment': '盖子表面处理与配合',
    'Marking': '标识', 'Packing': '包装', 'Box & Label': '纸箱标签',
    'Wheel Machining': '轮毂加工', 'Wheel OOR': '轮毂偏摆', 'Wheel Balance': '轮毂动平衡',
    'Other': '其他',
  },
}

const OUT_KEY: Record<string, string> = {
  'Pass': 'out_pass', '100% Inspection': 'out_100',
  'Additional Inspection — Pass': 'out_addpass', 'Additional Inspection Required': 'out_addreq',
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')
const outcomeColor = (o: string) => (o === '100% Inspection' ? 'var(--fail)' : o.startsWith('Additional') ? 'var(--amber)' : 'var(--pass)')

function buildFindings(rows: OutcomeRow[], L: Record<string, string>): string[] {
  const hundred = rows.filter(x => x.outcome === '100% Inspection')
  const addRequired = rows.filter(x => x.outcome === 'Additional Inspection Required')
  const addPass = rows.filter(x => x.outcome.startsWith('Additional Inspection — Pass'))
  const items: string[] = []
  for (const r of hundred) items.push(L.findRequired100.replace('{p}', r.parameter))
  for (const r of addRequired) items.push(L.findAddRequired.replace('{p}', r.parameter))
  for (const r of addPass) items.push(L.findAddPass.replace('{p}', r.parameter))
  items.push((!hundred.length && !addRequired.length && !addPass.length) ? L.findAllInitial : L.findAllOther)
  return items
}

// Allow only simple formatting tags from the corrective-action editor; strip everything
// else (and all attributes) before injecting into the public report. Legacy plain-text
// values (no tags) are escaped and newline-converted.
function sanitizeHtml(input: string): string {
  if (!input) return ''
  const html = /<(\/?)(b|i|u|p|ul|ol|li|br|strong|em|span|div)\b/i.test(input)
    ? input
    : input.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)).replace(/\n/g, '<br>')
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'UL', 'OL', 'LI', 'BR', 'SPAN', 'DIV'])
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstChild as HTMLElement
  const walk = (node: Element) => {
    Array.from(node.children).forEach(child => {
      if (!allowed.has(child.tagName)) { child.replaceWith(doc.createTextNode(child.textContent || '')); return }
      Array.from(child.attributes).forEach(a => child.removeAttribute(a.name))
      walk(child)
    })
  }
  walk(root)
  return root.innerHTML
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReportData | null>(null)
  const [err, setErr] = useState('')
  const [lang, setLang] = useState<Lang>('en')
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState<{ url: string; type: string } | null>(null)

  useEffect(() => {
    if (!id) return
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')
    setBusy(true)
    fetch(`${base}/functions/v1/interactive-report?id=${encodeURIComponent(id)}&lang=${lang}`)
      .then(r => r.json())
      .then((d: ReportData) => { if (d.ok) { setData(d); setErr('') } else setErr(d.error || 'Report unavailable') })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }, [id, lang])

  const L = DICT[lang]

  if (err) return <div style={page}><div style={{ ...card, borderColor: 'var(--fail)' }}><h2 style={{ color: 'var(--fail)' }}>{L.reportUnavailable}</h2><p>{err}</p></div></div>
  if (!data) return <div style={page}><p style={{ color: 'var(--ink-soft)' }}>{L.loadingReport}</p></div>

  const dispCode = data.insp.disposition || ''
  const isCustomDisp = dispCode === 'custom'
  const dispCls = isCustomDisp ? (data.insp.disposition_cls || 'pending') : (DISPOSITION_CLS[dispCode] || 'pending')
  const dispText = isCustomDisp
    ? (data.insp.disposition_custom || L.pendingDisposition)
    : ((dispCode && L['disp_' + dispCode]) ? L['disp_' + dispCode] : L.pendingDisposition)
  const bannerColor = dispCls === 'pass' ? 'var(--pass)' : dispCls === 'hold' ? 'var(--amber)' : dispCls === 'reject' ? 'var(--fail)' : '#5A6878'
  const bannerBg = dispCls === 'pass' ? '#E8F5EC' : dispCls === 'hold' ? '#FCF2DD' : dispCls === 'reject' ? '#FBE9E7' : '#EEF1F5'
  const sectTitle = (t: string) => (lang === 'en' ? t : (SECT[lang][t] || t))
  const outLabel = (o: string) => L[OUT_KEY[o]] || o

  return (
    <div style={page}>
      <style>{`.rich-body p{margin:0 0 8px}.rich-body ul,.rich-body ol{margin:0 0 8px;padding-left:22px}.rich-body li{margin:2px 0}.rich-body u{text-decoration:underline}`}</style>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {data.logoUrl
              ? <img src={data.logoUrl} alt="logo" style={{ height: 46, maxWidth: 240, objectFit: 'contain', display: 'block' }} />
              : <img src="/logo-white.png" alt="NITRA" style={{ height: 32 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.22)', paddingLeft: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: .3 }}>{L.title}</div>
              <div style={{ color: '#9FB6D4', fontSize: 12, marginTop: 2 }}>{L.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.10)', borderRadius: 999, padding: 3 }}>
              {LANG_LABELS.map(o => (
                <button key={o.id} onClick={() => setLang(o.id)} disabled={busy}
                  style={{
                    border: 0, borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
                    background: lang === o.id ? '#fff' : 'transparent', color: lang === o.id ? 'var(--navy)' : '#CFE0F5',
                  }}>{o.label}</button>
              ))}
            </div>
            <div style={{ color: '#9FB6D4', fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
              {busy ? L.translating : `${L.viewed} ${new Date().toLocaleString()}`}
            </div>
          </div>
        </div>
        <div style={{ background: bannerBg, borderTop: `3px solid ${bannerColor}` }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: bannerColor, flexShrink: 0 }} />
              <span style={{ color: bannerColor, fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>{dispText}</span>
            </div>
            <span style={{ color: bannerColor, opacity: .6, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>{L.finalDisposition}</span>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '22px auto', padding: '0 14px' }}>
        {data.translationNote && (
          <div style={{ background: '#FCF2DD', border: '1px solid var(--amber)', color: '#7A5200', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
            {L.txUnavailable}
          </div>
        )}

        <section style={card}>
          <h2 style={h2}>{L.inspectionReport}</h2>
          <table style={metaTable}>
            <tbody>
              <tr><Td k>{L.partNo}</Td><Td>{data.insp.part_no}</Td><Td k>{L.finish}</Td><Td>{data.sku?.finish || '—'}</Td></tr>
              <tr><Td k>{L.modelSize}</Td><Td>{data.sku?.model || '—'} {data.sku?.size || ''}</Td><Td k>{L.pcdEtCb}</Td><Td>{data.sku?.pcd || '—'} · {data.sku?.offset_txt || ''} · {data.sku?.cb_mm ?? ''}</Td></tr>
              <tr><Td k>{L.poNo}</Td><Td>{data.insp.po_no || '—'}</Td><Td k>{L.batch}</Td><Td>{data.insp.batch || '—'}</Td></tr>
              <tr><Td k>{L.lotSize}</Td><Td>{data.insp.lot_size} {L.pcs}</Td><Td k>{L.samples}</Td><Td>{L.visualWord} {data.insp.app_sample} / {L.technicalWord} {data.insp.fun_sample}</Td></tr>
              <tr><Td k>{L.inspector}</Td><Td>{data.inspectorName}</Td><Td k>{L.submitted}</Td><Td>{fmt(data.insp.submitted_at)}</Td></tr>
              <tr><Td k>{L.approvedBy}</Td><Td>{data.reviewerName}</Td><Td k>{L.approvedOn}</Td><Td>{fmt(data.insp.reviewed_at)}</Td></tr>
            </tbody>
          </table>
        </section>

        <section style={card}>
          <h2 style={h2}>{L.findings}</h2>
          <ul style={{ marginTop: 0, paddingLeft: 20 }}>
            {buildFindings(data.outcomes, L).map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
          {data.insp.corrective_action && (
            <div style={{ marginTop: 14 }}>
              <h2 style={h2}>{L.corrective}</h2>
              <div style={{ marginTop: 0 }} className="rich-body"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.insp.corrective_action) }} />
            </div>
          )}
        </section>

        <section style={card}>
          <h2 style={h2}>{L.criteria}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {[{ title: L.visualWord, base: 8, add: 4 }, { title: L.technicalWord, base: 4, add: 2 }].map(c => (
              <div key={c.title} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 14px', fontWeight: 700 }}>{c.title}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <tbody>
                    <tr>
                      <td style={ruleK}>{L.sampleSize}</td>
                      <td style={ruleV} dangerouslySetInnerHTML={{ __html: L.ruleSampleSize.replace('{b}', `<b>${c.base}</b>`).replace('{a}', `<b>${c.add}</b>`) }} />
                    </tr>
                    <tr>
                      <td style={ruleK}>{L.onePieceFails}</td>
                      <td style={ruleV} dangerouslySetInnerHTML={{ __html: L.ruleOneFail.replace('{a}', `<b>${c.add}</b>`) }} />
                    </tr>
                    <tr>
                      <td style={ruleK}>{L.sameDefectAgain}</td>
                      <td style={ruleV}><b style={{ color: 'var(--fail)' }}>{L.pct100}</b></td>
                    </tr>
                    <tr>
                      <td style={{ ...ruleK, borderBottom: 0 }}>{L.twoPlusFail}</td>
                      <td style={{ ...ruleV, borderBottom: 0 }}><b style={{ color: 'var(--fail)' }}>{L.pct100}</b> {L.immediately}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: 'var(--ink-soft)' }}>{L.criteriaNote}</p>
        </section>

        <section style={card}>
          <h2 style={h2}>{L.outcomeHeading}</h2>
          {data.outcomes.length ? (
            <table style={gridTable}>
              <thead><tr><Th>{L.thParameter}</Th><Th>{L.thChecked}</Th><Th>{L.thPass}</Th><Th>{L.thFail}</Th><Th>{L.thDefectPieces}</Th><Th>{L.thOutcome}</Th></tr></thead>
              <tbody>
                {data.outcomes.map((o, i) => (
                  <tr key={i}>
                    <Td>{o.parameter}</Td>
                    <Td>{o.checked}</Td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: 'var(--pass)' }}>{o.pass}</td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: o.fail > 0 ? 'var(--fail)' : 'var(--ink-soft)' }}>{o.fail}</td>
                    <Td>{o.defectPieces}</Td>
                    <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, fontSize: 13, fontWeight: 700, color: outcomeColor(o.outcome) }}>{outLabel(o.outcome)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--ink-soft)' }}>{L.noParams}</p>}
        </section>

        <section style={card}>
          <h2 style={h2}>{L.photoHeading}</h2>
          {(['pass', 'fail'] as const).map(kind => {
            const pass = kind === 'pass'
            const secs = APPENDIX_TITLES.map(title => {
              const params = data.photoGroups
                .map(g => ({ key: g.key, label: g.label, photos: g.photos.filter(p => p.isPass === pass) }))
                .filter(g => g.photos.length && g.key !== 'appendix' && (SECTION_OF[g.key] || 'Other') === title)
              return { title, params }
            }).filter(s => s.params.length)
            return (
              <div key={kind} style={{ marginBottom: 16 }}>
                <div style={{ background: pass ? 'var(--pass)' : 'var(--fail)', color: '#fff', borderRadius: 8, padding: '7px 13px', fontWeight: 700 }}>
                  {pass ? L.approvedPhotos : L.failedPhotos}
                </div>
                {secs.length ? secs.map(sec => (
                  <div key={sec.title} style={{ marginTop: 10 }}>
                    <h4 style={{ margin: '4px 0', color: 'var(--navy)' }}>{sectTitle(sec.title)}</h4>
                    {sec.params.map((pm, pmi) => (
                      <div key={pmi} style={{ marginLeft: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{pm.label}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                          {pm.photos.map((p, pi) => (
                            <figure key={pi} style={{ margin: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                              {p.mediaUrl ? (
                                <button onClick={() => setLightbox({ url: p.mediaUrl!, type: p.mediaType })}
                                  style={{ width: '100%', height: 110, border: 0, background: '#EEF1F5', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {p.mediaType === 'video' ? <span style={{ fontSize: 32, color: 'var(--navy)' }}>▶</span>
                                    : <img src={p.mediaUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                </button>
                              ) : <div style={{ width: '100%', height: 110, background: '#EEF1F5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>{L.noMedia}</div>}
                              <figcaption style={{ fontSize: 11, color: 'var(--ink-soft)', padding: 8 }}>
                                <b style={{ color: pass ? 'var(--pass)' : 'var(--fail)' }}>{pass ? L.passWord : L.failWord}</b> · {p.pieceLabel}
                                {p.comment && <><br />{p.comment}</>}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )) : <p style={{ color: 'var(--ink-soft)', marginTop: 8 }}>{pass ? L.noApproved : L.noFailed}</p>}
              </div>
            )
          })}
          {(() => {
            const appx = data.photoGroups.find(g => g.key === 'appendix')
            if (!appx || !appx.photos.length) return null
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 8, padding: '7px 13px', fontWeight: 700 }}>{L.appendixHeading}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
                  {appx.photos.map((p, pi) => (
                    <figure key={pi} style={{ margin: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                      {p.mediaUrl ? (
                        <button onClick={() => setLightbox({ url: p.mediaUrl!, type: p.mediaType })}
                          style={{ width: '100%', height: 110, border: 0, background: '#EEF1F5', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {p.mediaType === 'video' ? <span style={{ fontSize: 32, color: 'var(--navy)' }}>▶</span>
                            : <img src={p.mediaUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </button>
                      ) : <div style={{ width: '100%', height: 110, background: '#EEF1F5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>{L.noMedia}</div>}
                      {p.comment && <figcaption style={{ fontSize: 11, color: 'var(--ink-soft)', padding: 8 }}>{p.comment}</figcaption>}
                    </figure>
                  ))}
                </div>
              </div>
            )
          })()}
        </section>
      </main>

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.86)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <button onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 16, right: 20, background: '#fff', border: 0, borderRadius: 999, width: 42, height: 42, fontSize: 28, cursor: 'pointer' }}>×</button>
          {lightbox.type === 'video'
            ? <video src={lightbox.url} controls autoPlay style={{ maxWidth: '96vw', maxHeight: '90vh', borderRadius: 10, background: '#000' }} onClick={e => e.stopPropagation()} />
            : <img src={lightbox.url} style={{ maxWidth: '96vw', maxHeight: '90vh', borderRadius: 10 }} onClick={e => e.stopPropagation()} />}
        </div>
      )}

      <div style={{ background: bannerBg, borderTop: `3px solid ${bannerColor}`, borderBottom: `3px solid ${bannerColor}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: bannerColor, flexShrink: 0 }} />
            <span style={{ color: bannerColor, fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>{dispText}</span>
          </div>
          <span style={{ color: bannerColor, opacity: .6, fontWeight: 700, fontSize: 10.5, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>{L.finalDisposition}</span>
        </div>
      </div>

      <div style={{ padding: '10px 24px', color: '#9AA7B5', fontSize: 10, letterSpacing: 2, textAlign: 'center' }}>{L.confidential}</div>
    </div>
  )
}

const page: React.CSSProperties = { minHeight: '100vh', padding: 24, fontFamily: 'Arial, sans-serif', color: 'var(--ink)' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 16, boxShadow: '0 4px 14px rgba(31,58,95,.08)' }
const h2: React.CSSProperties = { margin: '0 0 12px', color: 'var(--navy)', fontSize: 18 }
const metaTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const gridTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const ruleK: React.CSSProperties = { padding: '9px 14px', fontWeight: 600, color: 'var(--ink-soft)', verticalAlign: 'top', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }
const ruleV: React.CSSProperties = { padding: '9px 14px', borderBottom: '1px solid var(--line)' }

function Td({ children, k }: { children: React.ReactNode; k?: boolean }) {
  return <td style={{ borderBottom: '1px solid #EEF1F5', padding: 8, color: k ? 'var(--ink-soft)' : 'var(--ink)', fontSize: k ? 12 : 13, fontWeight: k ? 400 : 700 }}>{children}</td>
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ background: 'var(--navy)', color: '#fff', textAlign: 'left', padding: 9, fontSize: 12 }}>{children}</th>
}

```

### `src/pages/SetPassword.tsx`

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Shown when a user arrives via an invite (or password-reset) link, OR — in
// `forced` mode — when an admin-created account with a temporary password
// signs in for the first time and must choose their own password.
export default function SetPassword({ onDone, forced = false }: { onDone: () => void; forced?: boolean }) {
  const [ready, setReady] = useState(forced)   // forced: session already exists
  const [linkError, setLinkError] = useState(false) // link invalid/expired
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  // The token in the URL is exchanged for a session asynchronously by the client.
  // Wait for it (with a timeout) before showing the form.
  useEffect(() => {
    if (forced) return // session already exists (temp-password sign-in)
    let cancelled = false
    const sub = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled && session) setReady(true)
    })
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (!cancelled && data.session) { setReady(true); return true }
      return false
    }
    ;(async () => {
      for (let i = 0; i < 20; i++) { // ~5s of polling
        if (await check()) return
        await new Promise(r => setTimeout(r, 250))
      }
      if (!cancelled) setLinkError(true)
    })()
    return () => { cancelled = true; sub.data.subscription.unsubscribe() }
  }, [forced])

  const submit = async () => {
    setErr('')
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pw !== pw2) { setErr('The two passwords do not match.'); return }
    setBusy(true)
    // In forced mode also clear the must_reset flag so the gate lifts.
    const { error } = await supabase.auth.updateUser(
      forced ? { password: pw, data: { must_reset: false } } : { password: pw })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(true)
  }

  return (
    <div className="page" style={{ maxWidth: 420, margin: '0 auto' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Set your password</h2>

        {linkError && !ready && (
          <>
            <p className="muted">This invite link is invalid or has expired. Ask your admin to send a new invite.</p>
            <button className="btn" onClick={onDone}>Go to sign in</button>
          </>
        )}

        {!ready && !linkError && <p className="muted">Verifying your invite…</p>}

        {ready && !done && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Choose a password to finish setting up your account.</p>
            <label className="fld"><span>New password</span>
              <input className="txt" type="password" value={pw} autoFocus
                onChange={e => setPw(e.target.value)} /></label>
            <label className="fld"><span>Confirm password</span>
              <input className="txt" type="password" value={pw2}
                onChange={e => setPw2(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit() }} /></label>
            {err && <div className="muted" style={{ color: 'var(--red, #C0392B)' }}>{err}</div>}
            <button className="btn" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : 'Save password & continue'}
            </button>
          </>
        )}

        {done && (
          <>
            <p style={{ color: 'var(--green, #1F8A4C)', fontWeight: 600 }}>Password set. You’re all set.</p>
            <button className="btn" onClick={onDone}>Continue to the app</button>
          </>
        )}
      </div>
    </div>
  )
}

```

### `src/pages/Settings.tsx`

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function Settings() {
  const { t } = useI18n()
  const [samp, setSamp] = useState({ app_base: 8, app_inc: 4, fun_base: 4, fun_inc: 2, extra_on_defect: 4 })
  const [pf, setPf] = useState({ trigger_rate: 0.10 })
  const [emails, setEmails] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('key, value').then(({ data }) => {
      for (const row of data || []) {
        if (row.key === 'sampling') setSamp(row.value)
        if (row.key === 'passfail') setPf(row.value)
        if (row.key === 'distribution') setEmails((row.value.emails || []).join(', '))
      }
    })
  }, [])

  const save = async () => {
    await supabase.from('settings').upsert([
      { key: 'sampling', value: samp },
      { key: 'passfail', value: pf },
      { key: 'distribution', value: { emails: emails.split(',').map(s => s.trim()).filter(Boolean) } },
    ])
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  const num = (v: string) => (v === '' ? 0 : +v)

  return (
    <div className="page">
      <div className="card">
        <h2>{t('settings')} — Sampling</h2>
        <div className="grid2">
          <label className="fld"><span>Appearance base (per ≤100)</span>
            <input className="txt" type="number" value={samp.app_base} onChange={e => setSamp({ ...samp, app_base: num(e.target.value) })} /></label>
          <label className="fld"><span>Appearance increment (per +100)</span>
            <input className="txt" type="number" value={samp.app_inc} onChange={e => setSamp({ ...samp, app_inc: num(e.target.value) })} /></label>
          <label className="fld"><span>Functional base (per ≤100)</span>
            <input className="txt" type="number" value={samp.fun_base} onChange={e => setSamp({ ...samp, fun_base: num(e.target.value) })} /></label>
          <label className="fld"><span>Functional increment (per +100)</span>
            <input className="txt" type="number" value={samp.fun_inc} onChange={e => setSamp({ ...samp, fun_inc: num(e.target.value) })} /></label>
          <label className="fld"><span>Extra pieces on defect</span>
            <input className="txt" type="number" value={samp.extra_on_defect} onChange={e => setSamp({ ...samp, extra_on_defect: num(e.target.value) })} /></label>

        </div>
      </div>
      <div className="card">
        <h2>Report distribution list</h2>
        <label className="fld"><span>Emails (comma-separated)</span>
          <input className="txt" value={emails} onChange={e => setEmails(e.target.value)} placeholder="kwong@nitrawheels.com, client@example.com" /></label>
      </div>
      <button className="btn" onClick={save}>{saved ? '✓' : t('save')}</button>
    </div>
  )
}

```

### `src/pages/Skus.tsx`

```tsx
import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import type { Sku } from '../lib/standard'

type Row = Sku & { part_no_old: string; upc_code: string; fitment: string; active: boolean; bolt_circle_mm: number; wheel_weight_kg: number|null; wheel_weight_tol_kg: number; tpms_sensor_mm: string }
const EMPTY: Row = { part_no: '', part_no_old: '', model: '', size: '', diameter_in: 18, pcd: '', bolt_circle_mm: 0, offset_txt: '', offset_mm: 0, cb_mm: 0, lug_hole_mm: 15, counter_bore_mm: 34, seat_thickness_mm: 9.5, lug_seat_type: '', finish: '', max_load_lbs: 0, brand_name: '', factory: '', upc_code: '', fitment: '', wheel_weight_kg: null, wheel_weight_tol_kg: 0.4, tpms_sensor_mm: '', active: true }

export default function Skus() {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [edit, setEdit] = useState<Row | null>(null)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ newRows: Row[]; updateRows: Partial<Row>[]; news: string[]; updates: string[]; backup: Row[] } | null>(null)
  const [canUndo, setCanUndo] = useState(false)

  useEffect(() => { try { setCanUndo(!!localStorage.getItem('sku_import_backup')) } catch { /* ignore */ } }, [])

  const load = () => supabase.from('skus').select('*').order('part_no').then(({ data }) => setRows((data as Row[]) || []))
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.part_no) { alert('Part No. is required.'); return }
    const { error } = await supabase.from('skus').upsert(edit)
    if (error) { alert('Save failed: ' + error.message); return }
    setEdit(null); load()
  }

  // Excel import — header-aware. Parses the file, then shows a confirm preview.
  // On existing SKUs only the columns present in the file are changed (merge),
  // so e.g. adding just Brand/Factory won't blank the rest. A backup is kept so
  // the last import can be undone.
  const importXlsx = async (f: File) => {
    const wb = XLSX.read(await f.arrayBuffer())
    const ws = wb.Sheets[wb.SheetNames[0]]
    const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    const num = (v: unknown) => Number(String(v ?? '').replace(/[^\d.\-]/g, '')) || 0
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

    const present = new Set<string>()
    for (const rec of recs) for (const k of Object.keys(rec)) present.add(norm(k))
    const has = (...al: string[]) => al.some(a => present.has(a))

    const existing = new Map(rows.map(r => [r.part_no, r]))
    const newRows: Row[] = [], updateRows: Partial<Row>[] = []
    const news: string[] = [], updates: string[] = [], backup: Row[] = []

    for (const rec of recs) {
      const m: Record<string, unknown> = {}
      for (const k of Object.keys(rec)) m[norm(k)] = rec[k]
      const pick = (...al: string[]) => { for (const a of al) if (m[a] != null && m[a] !== '') return m[a]; return '' }

      const hasNew = 'newpartnumber' in m
      const partNo = (hasNew ? String(m['newpartnumber'] || '') : String(pick('partno', 'partnumber', 'part') || '')).trim().replace(/\s+/g, ' ')
      if (!partNo) continue

      let dia = 0, wid = 0
      const sizeStr = String(pick('size', 'wheelsize'))
      if (sizeStr) { const [a, b] = sizeStr.toLowerCase().replace(/\s/g, '').split('x'); dia = num(a); wid = num(b) }
      else { dia = num(pick('wheeldiameter')); wid = num(pick('wheelwidth')) }
      let holes = '', bcd = 0
      const pcdStr = String(pick('pcd'))
      if (pcdStr) { const [a, b] = pcdStr.toLowerCase().replace(/\s/g, '').split('x'); holes = a; bcd = num(b) }
      else { holes = String(pick('lugholes') || ''); bcd = num(pick('boltcirclemm', 'boltcircle')) }
      const dm = String(pick('drillno') || '').match(/∮(\d+(?:\.\d+)?).*?∮(\d+(?:\.\d+)?)/)
      const et = num(pick('offsetmm', 'et', 'offset'))
      const wheelLoad = String(pick('wheelload', 'load'))
      const maxLoadLbs = pick('loadratinglbs') !== '' ? num(pick('loadratinglbs'))
        : wheelLoad ? Math.round(/kg/i.test(wheelLoad) ? num(wheelLoad) / 0.45359237 : num(wheelLoad)) : 0
      const wWtLbs = pick('wheelweightlbs'), wWtKg = pick('wheelweightkg')
      const wheelWeightKg = wWtLbs !== '' ? Number((num(wWtLbs) * 0.45359237).toFixed(3))
        : wWtKg !== '' ? Number(num(wWtKg).toFixed(3)) : null

      // Only include fields whose source column is actually in the file
      const fields: Partial<Row> = {}
      if (has('stylename', 'model', 'style')) fields.model = String(pick('stylename', 'model', 'style')).trim()
      if (sizeStr || has('wheeldiameter')) { fields.size = dia && wid ? `${dia}x${wid.toFixed(1)}` : sizeStr; fields.diameter_in = dia }
      if (pcdStr || has('lugholes', 'boltcirclemm', 'boltcircle')) { fields.pcd = holes && bcd ? `${holes}x${bcd % 1 ? bcd.toFixed(1) : bcd}` : pcdStr; fields.bolt_circle_mm = bcd }
      if (has('offsetmm', 'et', 'offset')) { fields.offset_mm = et; fields.offset_txt = hasNew ? String(pick('offsetmm') || '') : (et ? `ET${et}` : '') }
      if (has('productioncbmm', 'cb', 'cbmm')) fields.cb_mm = num(pick('productioncbmm', 'cb', 'cbmm'))
      if (has('factoryfinishname', 'color', 'colour', 'finish')) fields.finish = String(pick('factoryfinishname', 'color', 'colour', 'finish')).trim()
      if (has('loadratinglbs', 'wheelload', 'load')) fields.max_load_lbs = maxLoadLbs
      if (has('brandname', 'brand')) fields.brand_name = String(pick('brandname', 'brand')).trim()
      if (has('factory', 'factoryname', 'plant')) fields.factory = String(pick('factory', 'factoryname', 'plant')).trim()
      if (has('wheelweightlbs', 'wheelweightkg')) fields.wheel_weight_kg = wheelWeightKg
      if (has('tpmssensormm', 'tpms')) fields.tpms_sensor_mm = String(pick('tpmssensormm', 'tpms')).trim().replace(/[xX]/g, '×')
      if (dm) { fields.lug_hole_mm = +dm[1]; fields.counter_bore_mm = +dm[2] }
      if (has('lugholemm', 'lugholediameter')) fields.lug_hole_mm = num(pick('lugholemm', 'lugholediameter'))
      if (has('counterboremm', 'counterbore')) fields.counter_bore_mm = num(pick('counterboremm', 'counterbore'))
      if (has('lugseatthickness1mm', 'seatthickness', 'seatthicknessmm')) fields.seat_thickness_mm = num(pick('lugseatthickness1mm', 'seatthickness', 'seatthicknessmm'))
      if (has('lugseat', 'seattype', 'lugseattype')) fields.lug_seat_type = String(pick('lugseat', 'seattype', 'lugseattype') || '')
      if (has('upccode', 'upc')) fields.upc_code = String(pick('upccode', 'upc') || '')
      if (has('fitment')) fields.fitment = String(pick('fitment') || '')
      if (hasNew) fields.part_no_old = String(m['partnumber'] || '')

      const ex = existing.get(partNo)
      if (ex) { updateRows.push({ part_no: partNo, ...fields }); updates.push(partNo); backup.push(ex) }
      else { newRows.push({ ...EMPTY, part_no: partNo, ...fields, active: true }); news.push(partNo) }
    }

    if (!newRows.length && !updateRows.length) { setMsg('No SKUs recognised — the file needs at least a part-number column (e.g. "Part No." or "NEW_PART_NUMBER").'); return }
    setMsg('')
    setPending({ newRows, updateRows, news, updates, backup })
  }

  const confirmImport = async () => {
    if (!pending) return
    const { newRows, updateRows, news, backup } = pending
    let error = null
    if (newRows.length) { const r = await supabase.from('skus').upsert(newRows); error = error || r.error }
    if (updateRows.length) { const r = await supabase.from('skus').upsert(updateRows); error = error || r.error }
    if (error) { setMsg('Import failed: ' + error.message); setPending(null); return }
    try { localStorage.setItem('sku_import_backup', JSON.stringify({ backup, news, at: Date.now() })); setCanUndo(true) } catch { /* ignore */ }
    setMsg(`Imported ✓ — ${updateRows.length} updated, ${newRows.length} new`)
    setPending(null); load()
  }

  const undoImport = async () => {
    let saved: { backup: Row[]; news: string[] } | null = null
    try { const s = localStorage.getItem('sku_import_backup'); if (s) saved = JSON.parse(s) } catch { /* ignore */ }
    if (!saved) { setMsg('Nothing to undo.'); setCanUndo(false); return }
    if (!confirm(`Undo the last import?\n\nThis restores ${saved.backup.length} SKU(s) to their values before the import and removes ${saved.news.length} SKU(s) the import added.`)) return
    let error = null
    if (saved.backup.length) { const r = await supabase.from('skus').upsert(saved.backup); error = error || r.error }
    if (saved.news.length) { const r = await supabase.from('skus').delete().in('part_no', saved.news); error = error || r.error }
    if (error) { setMsg('Undo failed: ' + error.message); return }
    try { localStorage.removeItem('sku_import_backup') } catch { /* ignore */ }
    setCanUndo(false); setMsg('Reverted to the values before the last import.'); load()
  }

  const F = (k: keyof Row, label: string, type = 'text') => (
    <label className="fld"><span>{label}</span>
      <input className="txt" type={type} value={String(edit?.[k] ?? '')}
        onChange={e => setEdit({ ...edit!, [k]: type === 'number' ? +e.target.value : e.target.value })} />
    </label>
  )

  return (
    <div className="page">
      <div className="card">
        <h2>{t('skus')} ({rows.length})</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Add SKU</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Import Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = '' }} />
          {canUndo && <button className="btn ghost" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }} onClick={undoImport}>↶ Undo last import</button>}
          {msg && <span className="muted">{msg}</span>}
        </div>
        <table className="tbl">
          <thead><tr><th>Part No.</th><th>Brand</th><th>Factory</th><th>Model</th><th>Size</th><th>PCD</th><th>ET</th><th>CB</th><th>Finish</th><th>Wt(kg)</th><th>TPMS</th><th /></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.part_no}>
                <td>{r.part_no}</td><td>{r.brand_name || '—'}</td><td>{r.factory || '—'}</td><td>{r.model}</td><td>{r.size}</td><td>{r.pcd}</td>
                <td>{r.offset_txt}</td><td>{r.cb_mm}</td><td>{r.finish}</td>
                <td>{r.wheel_weight_kg ?? '—'}</td><td>{r.tpms_sensor_mm || '—'}</td>
                <td><button className="btn ghost" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => setEdit(r)}>✎</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending && (
        <div className="modal-overlay" onClick={() => setPending(null)}>
          <div className="modal" style={{ width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Confirm import</h2>
            <p style={{ fontSize: 15 }}>
              <b>{pending.updates.length}</b> existing SKU(s) will be updated · <b>{pending.news.length}</b> new SKU(s) will be added.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              On existing SKUs, only the columns present in your file change — everything else is kept. Part numbers must match exactly to count as “existing” (mind spaces vs dashes).
            </p>
            {pending.updates.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Will update ({pending.updates.length}):</div>
                <div className="muted" style={{ fontSize: 12, maxHeight: 110, overflowY: 'auto' }}>{pending.updates.join(', ')}</div>
              </div>
            )}
            {pending.news.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--navy)' }}>Will add as new ({pending.news.length}):</div>
                <div className="muted" style={{ fontSize: 12, maxHeight: 110, overflowY: 'auto' }}>{pending.news.join(', ')}</div>
              </div>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" onClick={confirmImport}>Confirm import</button>
              <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {edit && (
        <div className="modal-overlay" onClick={() => setEdit(null)}>
          <div className="modal" style={{ width: 'min(680px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>{edit.part_no || 'New SKU'}</h2>
              <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => setEdit(null)}>✕</button>
            </div>
            <div className="grid2">
              {F('part_no', 'Part No.')}{F('model', 'Model')}{F('size', 'Size (e.g. 18x8.0)')}
              {F('diameter_in', 'Diameter (in)', 'number')}{F('pcd', 'PCD (e.g. 5x114.3)')}
              {F('offset_txt', 'Offset text (e.g. +40)')}{F('offset_mm', 'Offset mm', 'number')}
              {F('cb_mm', 'CB mm', 'number')}{F('lug_hole_mm', 'Lug hole mm', 'number')}
              {F('counter_bore_mm', 'Counter bore mm', 'number')}{F('seat_thickness_mm', 'Seat thickness mm', 'number')}
              {F('lug_seat_type', 'Lug seat type')}{F('finish', 'Finish')}
              {F('brand_name', 'Brand Name')}{F('factory', 'Factory')}
              {F('max_load_lbs', 'Max load lbs', 'number')}{F('upc_code', 'UPC')}{F('fitment', 'Fitment')}
              {F('wheel_weight_kg', 'Wheel weight (kg)', 'number')}{F('wheel_weight_tol_kg', 'Weight tol ± (kg)', 'number')}
              {F('tpms_sensor_mm', 'TPMS sensor (mm)')}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" onClick={save}>{t('save')}</button>
              <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

```

### `src/pages/TeamPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Role = 'inspector' | 'admin' | 'customer'
interface TeamUser {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
  is_self: boolean
}
interface InviteDraft { full_name: string; email: string; role: Role; mode: 'invite' | 'password'; password: string }
const EMPTY_INVITE: InviteDraft = { full_name: '', email: '', role: 'inspector', mode: 'invite', password: '' }
const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', inspector: 'Inspector', customer: 'Customer' }
const genPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  const rnd = new Uint32Array(12); crypto.getRandomValues(rnd)
  for (const n of rnd) out += chars[n % chars.length]
  return out
}

interface ManageResult {
  ok: boolean
  error?: string
  warning?: string
  users?: TeamUser[]
  user_id?: string
  email?: string
}

// All privileged work happens server-side in the manage-users edge function,
// which re-verifies that the caller is an admin. The browser only ever holds
// the anon key + the logged-in session (auto-attached by functions.invoke).
async function callManageUsers(body: Record<string, unknown>): Promise<ManageResult> {
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  if (error) {
    // Edge function returned non-2xx; try to surface its JSON error message.
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    }
    return { ok: false, error: msg }
  }
  return data as ManageResult
}

export default function TeamPage() {
  const [rows, setRows] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [invite, setInvite] = useState<InviteDraft | null>(null)
  const [inviting, setInviting] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null)
  // PO assignment for customer users
  const [assignFor, setAssignFor] = useState<TeamUser | null>(null)
  const [allPos, setAllPos] = useState<{ id: string; po_no: string; customer_name: string | null }[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [assignBusy, setAssignBusy] = useState(false)

  const openAssign = async (u: TeamUser) => {
    setErr(''); setAssignBusy(true); setAssignFor(u)
    const [{ data: pos }, { data: acc }] = await Promise.all([
      supabase.from('pos').select('id,po_no,customer_name').order('po_no'),
      supabase.from('po_access').select('po_id').eq('customer_id', u.id),
    ])
    setAllPos((pos as { id: string; po_no: string; customer_name: string | null }[]) || [])
    setChecked(new Set(((acc as { po_id: string }[]) || []).map(a => a.po_id)))
    setAssignBusy(false)
  }

  const saveAssign = async () => {
    if (!assignFor) return
    setAssignBusy(true); setErr('')
    const del = await supabase.from('po_access').delete().eq('customer_id', assignFor.id)
    if (del.error) { setErr(del.error.message); setAssignBusy(false); return }
    if (checked.size) {
      const ins = await supabase.from('po_access').insert([...checked].map(po_id => ({ customer_id: assignFor.id, po_id })))
      if (ins.error) { setErr(ins.error.message); setAssignBusy(false); return }
    }
    setAssignBusy(false)
    flash(`${assignFor.full_name || assignFor.email}: ${checked.size} PO(s) assigned.`)
    setAssignFor(null)
  }

  const load = async () => {
    setLoading(true); setErr('')
    const res = await callManageUsers({ action: 'list' })
    if (res?.ok) setRows(res.users as TeamUser[])
    else setErr(res?.error || 'Could not load users.')
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const sendInvite = async () => {
    if (!invite) return
    if (!invite.full_name.trim()) { setErr('Full name is required.'); return }
    if (!/.+@.+\..+/.test(invite.email.trim())) { setErr('Enter a valid email.'); return }
    if (invite.mode === 'password' && invite.password.length < 8) { setErr('Temporary password must be at least 8 characters.'); return }
    setInviting(true); setErr('')
    const res = await callManageUsers(invite.mode === 'invite'
      ? { action: 'invite', full_name: invite.full_name.trim(), email: invite.email.trim(), role: invite.role }
      : { action: 'create_with_password', full_name: invite.full_name.trim(), email: invite.email.trim(), role: invite.role, password: invite.password })
    setInviting(false)
    if (res?.ok) {
      const created = invite
      setInvite(null)
      if (created.mode === 'password') {
        setCreatedCreds({ email: created.email.trim(), password: created.password })
      } else {
        flash(res.warning ? res.warning : `Invite sent to ${created.email.trim()}.`)
      }
      load()
    } else {
      setErr(res?.error || 'Could not create the user.')
    }
  }

  const changeRole = async (u: TeamUser, role: Role) => {
    if (role === u.role) return
    setBusyId(u.id); setErr('')
    const res = await callManageUsers({ action: 'set_role', user_id: u.id, role })
    setBusyId(null)
    if (res?.ok) { flash(`${u.full_name || u.email} is now ${ROLE_LABEL[role]}.`); load() }
    else { setErr(res?.error || 'Could not change role.'); load() }
  }

  const toggleActive = async (u: TeamUser) => {
    const deactivating = u.active
    const verb = deactivating ? 'Deactivate' : 'Reactivate'
    if (!confirm(`${verb} ${u.full_name || u.email}?\n\n${deactivating
      ? 'They will be blocked from signing in. You can reactivate them at any time.'
      : 'They will be able to sign in again.'}`)) return
    setBusyId(u.id); setErr('')
    const res = await callManageUsers({ action: deactivating ? 'deactivate' : 'reactivate', user_id: u.id })
    setBusyId(null)
    if (res?.ok) { flash(`${u.full_name || u.email} ${deactivating ? 'deactivated' : 'reactivated'}.`); load() }
    else { setErr(res?.error || `Could not ${verb.toLowerCase()}.`); load() }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Users {rows.length ? `(${rows.length})` : ''}</h2>
          <button className="btn" onClick={() => { setErr(''); setInvite({ ...EMPTY_INVITE }) }}>+ Add user</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Add users and set their access level. Admins have full control; Inspectors record inspections; Customers can only view reports for POs assigned to them (customer dashboard arrives in the next update).
        </p>

        {err && <div className="muted" style={{ color: 'var(--red, #C0392B)', marginBottom: 10 }}>{err}</div>}
        {msg && <div className="muted" style={{ color: 'var(--green, #1F8A4C)', marginBottom: 10 }}>{msg}</div>}

        {loading ? <p className="muted">Loading…</p> : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                  <td>{u.full_name || '—'}{u.is_self && <span className="muted" style={{ fontSize: 12 }}> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className="txt"
                      style={{ minHeight: 36, padding: '4px 8px' }}
                      value={u.role}
                      disabled={busyId === u.id || (u.is_self)}
                      title={u.is_self ? 'You cannot change your own role' : ''}
                      onChange={e => changeRole(u, e.target.value as Role)}
                    >
                      <option value="admin">Admin</option>
                      <option value="inspector">Inspector</option>
                      <option value="customer">Customer</option>
                    </select>
                  </td>
                  <td style={{ color: u.active ? 'var(--green, #1F8A4C)' : 'var(--red, #C0392B)', fontWeight: 600 }}>
                    {u.active ? 'Active' : 'Deactivated'}
                  </td>
                  <td>
                    {u.role === 'customer' && (
                      <button className="btn ghost" style={{ minHeight: 36, padding: '4px 10px', marginRight: 6 }}
                        disabled={busyId === u.id} onClick={() => openAssign(u)}>POs</button>
                    )}
                    {!u.is_self && (
                      <button
                        className="btn ghost"
                        style={{ minHeight: 36, padding: '4px 10px', borderColor: u.active ? 'var(--amber, #B7791F)' : 'var(--green, #1F8A4C)', color: u.active ? 'var(--amber, #B7791F)' : 'var(--green, #1F8A4C)' }}
                        disabled={busyId === u.id}
                        onClick={() => toggleActive(u)}
                      >{u.active ? 'Deactivate' : 'Reactivate'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invite && (
        <div className="modal-overlay" onClick={() => setInvite(null)}>
          <div className="modal" style={{ width: 'min(460px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Add a user</h2>
              <button className="btn ghost" style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => setInvite(null)}>✕</button>
            </div>
            <div className="grid2">
              <label className="fld"><span>Full name</span>
                <input className="txt" value={invite.full_name} autoFocus
                  onChange={e => setInvite({ ...invite, full_name: e.target.value })} /></label>
              <label className="fld"><span>Email</span>
                <input className="txt" type="email" value={invite.email}
                  onChange={e => setInvite({ ...invite, email: e.target.value })} /></label>
              <label className="fld"><span>Role</span>
                <select className="txt" value={invite.role}
                  onChange={e => setInvite({ ...invite, role: e.target.value as Role })}>
                  <option value="admin">Admin</option>
                  <option value="inspector">Inspector</option>
                  <option value="customer">Customer</option>
                </select></label>
            </div>
            <label className="fld"><span>How should they get access?</span>
              <select className="txt" value={invite.mode}
                onChange={e => setInvite({ ...invite, mode: e.target.value as 'invite' | 'password', password: e.target.value === 'password' && !invite.password ? genPassword() : invite.password })}>
                <option value="invite">Send invite email (they set their own password)</option>
                <option value="password">I’ll give them a temporary password</option>
              </select></label>
            {invite.mode === 'password' && (
              <label className="fld"><span>Temporary password</span>
                <div className="row" style={{ gap: 8 }}>
                  <input className="txt" style={{ flex: 1 }} value={invite.password}
                    onChange={e => setInvite({ ...invite, password: e.target.value })} />
                  <button className="btn ghost" style={{ minHeight: 40, padding: '4px 12px' }} onClick={() => setInvite({ ...invite, password: genPassword() })}>↻ New</button>
                </div>
              </label>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              {invite.mode === 'invite'
                ? 'They’ll get a branded email from kyong@nitrawheels.com with a link to set their own password.'
                : 'No email is sent. Share the temporary password with them securely — they’ll be required to change it the first time they sign in.'}
            </p>
            {err && <div className="muted" style={{ color: 'var(--red, #C0392B)' }}>{err}</div>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={sendInvite} disabled={inviting}>{inviting ? 'Working…' : (invite.mode === 'invite' ? 'Send invite' : 'Create user')}</button>
              <button className="btn ghost" onClick={() => setInvite(null)} disabled={inviting}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {assignFor && (
        <div className="modal-overlay" onClick={() => setAssignFor(null)}>
          <div className="modal" style={{ width: 'min(480px, 94vw)', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Assign POs — {assignFor.full_name || assignFor.email}</h2>
            <p className="muted" style={{ fontSize: 13 }}>This customer will only be able to view reports for the ticked POs. (The customer dashboard itself arrives in the next update.)</p>
            {assignBusy && !allPos.length ? <p className="muted">Loading…</p> : (
              allPos.length === 0 ? <p className="muted">No POs exist yet.</p> :
              allPos.map(p => (
                <label key={p.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 20, height: 20 }} checked={checked.has(p.id)}
                    onChange={e => { const n = new Set(checked); if (e.target.checked) n.add(p.id); else n.delete(p.id); setChecked(n) }} />
                  <span style={{ fontWeight: 700 }}>{p.po_no}</span>
                  {p.customer_name && <span className="muted" style={{ fontSize: 13 }}>{p.customer_name}</span>}
                </label>
              ))
            )}
            {err && <div className="muted" style={{ color: 'var(--fail, #C0392B)', marginTop: 8 }}>{err}</div>}
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn" disabled={assignBusy} onClick={saveAssign}>{assignBusy ? 'Saving…' : 'Save assignments'}</button>
              <button className="btn ghost" disabled={assignBusy} onClick={() => setAssignFor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {createdCreds && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(460px, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>User created ✓</h2>
            <p className="muted" style={{ fontSize: 13 }}>Share these sign-in details securely. This is the only time the password is shown — it cannot be retrieved later. They must change it on first sign-in.</p>
            <label className="fld"><span>Email</span>
              <input className="txt" readOnly value={createdCreds.email} onFocus={e => e.target.select()} /></label>
            <label className="fld"><span>Temporary password</span>
              <div className="row" style={{ gap: 8 }}>
                <input className="txt" readOnly style={{ flex: 1, fontWeight: 700, letterSpacing: 1 }} value={createdCreds.password} onFocus={e => e.target.select()} />
                <button className="btn ghost" style={{ minHeight: 40, padding: '4px 12px' }}
                  onClick={async () => { try { await navigator.clipboard.writeText(`${createdCreds.email}\n${createdCreds.password}`); flash('Copied to clipboard.') } catch { /* select manually */ } }}>📋 Copy</button>
              </div></label>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setCreatedCreds(null)}>Done — I've shared it</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

```


---

## 9e. Supabase migrations (SQL)

### `supabase/04_migration.sql`

```sql
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

```

### `supabase/05_migration.sql`

```sql
-- Migration 05
-- Add wheel weight and TPMS columns to skus; add media_type to photos

alter table skus add column if not exists wheel_weight_kg numeric;
alter table skus add column if not exists wheel_weight_tol_kg numeric not null default 0.4;
alter table skus add column if not exists tpms_sensor_mm text not null default '';
alter table skus add column if not exists na_defaults jsonb not null default '{}';

alter table photos add column if not exists media_type text not null default 'photo';
alter table photos add column if not exists reassigned_from jsonb;

insert into skus (part_no,model,size,diameter_in,pcd,bolt_circle_mm,offset_txt,offset_mm,
  cb_mm,lug_hole_mm,counter_bore_mm,seat_thickness_mm,lug_seat_type,finish,max_load_lbs,
  upc_code,fitment,wheel_weight_kg,wheel_weight_tol_kg,tpms_sensor_mm) values
('TI17RM85513920778SB','TITAN','17x8.5',17,'5x139.7',139.7,'+20',20.0,77.8,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445381','RAM',11.711,0.4,'20×17.5×11.5×3.5'),
('TI17FL85613525871SB','TITAN','17x8.5',17,'6x135',135.0,'+25',25.0,87.1,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445398','FORD / LINC',11.711,0.4,'20×17.5×11.5×3.5'),
('TI17UN856139201061SB','TITAN','17x8.5',17,'6x139.7',139.7,'+20',20.0,106.2,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445404','UNI',11.711,0.4,'20×17.5×11.5×3.5'),
('TI18RM85513920778SB','TITAN','18x8.5',18,'5x139.7',139.7,'+20',20.0,77.8,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445411','RAM',11.781,0.4,'20×17.5×11.5×3.5'),
('TI18FL85613525871SB','TITAN','18x8.5',18,'6x135',135.0,'+25',25.0,87.1,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445428','FORD / LINC',11.781,0.4,'20×17.5×11.5×3.5'),
('TI18UN856139201061SB','TITAN','18x8.5',18,'6x139.7',139.7,'+20',20.0,106.2,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445435','UNI',11.781,0.4,'20×17.5×11.5×3.5'),
('TI18UN858165181213SB','TITAN','18x8.5',18,'8x165.1',165.1,'+18',18.0,121.5,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',4000,'627949445442','UNI',11.781,0.4,'20×17.5×11.5×3.5'),
('TI18FL858170181249SB','TITAN','18x8.5',18,'8x170',170.0,'+18',18.0,125.0,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',4000,'627949445459','FORD / LINC',11.781,0.4,'20×17.5×11.5×3.5'),
('TI18GM858180181241SB','TITAN','18x8.5',18,'8x180',180.0,'+18',18.0,124.2,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',4000,'627949445466','GM',11.781,0.4,'20×17.5×11.5×3.5'),
('TI20RM85513920778SB','TITAN','20x8.5',20,'5x139.7',139.7,'+20',20.0,77.8,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445473','RAM',14.558,0.4,'20×17.5×11.5×3.5'),
('TI20UN85613235745SB','TITAN','20x8.5',20,'6x132',132.0,'+35',35.0,74.5,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445480','UNI',14.558,0.4,'20×17.5×11.5×3.5'),
('TI20FL85613525871SB','TITAN','20x8.5',20,'6x135',135.0,'+25',25.0,87.1,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445497','FORD / LINC',14.558,0.4,'20×17.5×11.5×3.5'),
('TI20UN856139201061SB','TITAN','20x8.5',20,'6x139.7',139.7,'+20',20.0,106.2,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445503','UNI',14.558,0.4,'20×17.5×11.5×3.5'),
('TI20UN858165181213SB','TITAN','20x8.5',20,'8x165.1',165.1,'+18',18.0,121.5,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',4000,'627949445510','UNI',14.558,0.4,'20×17.5×11.5×3.5'),
('TI20FL858170181249SB','TITAN','20x8.5',20,'8x170',170.0,'+18',18.0,125.0,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',4000,'627949445527','FORD / LINC',14.558,0.4,'20×17.5×11.5×3.5'),
('TI20GM858180181241SB','TITAN','20x8.5',20,'8x180',180.0,'+18',18.0,124.2,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',4000,'627949445534','GM',14.558,0.4,'20×17.5×11.5×3.5'),
('TI22FL90613525871SB','TITAN','22x9.0',22,'6x135',135.0,'+25',25.0,87.1,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445541','FORD / LINC',17.127,0.4,'20×17.5×11.5×3.5'),
('TI22UN906139251061SB','TITAN','22x9.0',22,'6x139.7',139.7,'+25',25.0,106.2,16.0,29.0,9.5,'AM: SPLINE','SATIN BLACK',3300,'627949445558','UNI',17.127,0.4,'20×17.5×11.5×3.5'),
('TI17TY85613930951SB','TITAN','17x8.5',17,'6x139.7',139.7,'+30',30.0,95.1,19.0,34.0,14.5,'OEM: TOYOTA FLAT WASHER','SATIN BLACK',3300,'627949445565','TOY',11.711,0.4,'20×17.5×11.5×3.5'),
('TI18TY855150301101SB','TITAN','18x8.5',18,'5x150',150.0,'+30',30.0,110.2,23.5,38.0,24.0,'OEM: TOYOTA FLAT WASHER','SATIN BLACK',3300,'627949445572','TOY',11.781,0.4,'20×17.5×11.5×3.5'),
('TI18TY85613930951SB','TITAN','18x8.5',18,'6x139.7',139.7,'+30',30.0,95.1,19.0,34.0,14.5,'OEM: TOYOTA FLAT WASHER','SATIN BLACK',3300,'627949445589','TOY',11.781,0.4,'20×17.5×11.5×3.5'),
('TI20TY855150301101SB','TITAN','20x8.5',20,'5x150',150.0,'+30',30.0,110.2,23.5,38.0,24.0,'OEM: TOYOTA FLAT WASHER','SATIN BLACK',3300,'627949445596','TOY',14.558,0.4,'20×17.5×11.5×3.5'),
('TI20TY85613930951SB','TITAN','20x8.5',20,'6x139.7',139.7,'+30',30.0,95.1,19.0,34.0,14.5,'OEM: TOYOTA FLAT WASHER','SATIN BLACK',3300,'627949445602','TOY',14.558,0.4,'20×17.5×11.5×3.5'),
('PU17HA75511440641GM','PURSUIT','17x7.5',17,'5x114.3',114.3,'+40',40.0,64.1,15.0,33.0,9.5,'OEM: ACURA / HONDA','SATIN GUNMETAL',1720,'627949445008','HONDA / ACURA',9.42,0.4,'20×17.5×11.5×3.5'),
('PU17TL75511435601GM','PURSUIT','17x7.5',17,'5x114.3',114.3,'+35',35.0,60.1,15.0,34.0,9.5,'AM: CONE SEAT (60°)','SATIN GUNMETAL',1720,'627949445015','TOYOTA / LEXUS',9.42,0.4,'20×17.5×11.5×3.5'),
('PU17GM75512035671GM','PURSUIT','17x7.5',17,'5x120',120.0,'+35',35.0,67.1,15.0,34.0,9.5,'OEM: GMC','SATIN GUNMETAL',1720,'627949445022','GM',9.42,0.4,'20×17.5×11.5×3.5'),
('PU17VA75511235666GM','PURSUIT','17x7.5',17,'5x112',112.0,'+35',35.0,66.6,15.0,33.0,9.5,'OEM: VW / AUDI','SATIN GUNMETAL',1720,'627949445039','VW / AUDI',9.42,0.4,'20×17.5×11.5×3.5'),
('PU17KH75511440671GM','PURSUIT','17x7.5',17,'5x114.3',114.3,'+40',40.0,67.1,15.0,34.0,9.5,'OEM: KIA / HYUNDAI','SATIN GUNMETAL',1720,'627949445046','HYUNDAI / KIA',9.42,0.4,'20×17.5×11.5×3.5'),
('PU17DG75512735716GM','PURSUIT','17x7.5',17,'5x127',127.0,'+35',35.0,71.6,15.0,34.0,9.5,'OEM: DODGE','SATIN GUNMETAL',1720,'627949445053','DODGE',9.42,0.4,'20×17.5×11.5×3.5'),
('PU18HA80511440641GM','PURSUIT','18x8.0',18,'5x114.3',114.3,'+40',40.0,64.1,15.0,33.0,9.5,'OEM: ACURA / HONDA','SATIN GUNMETAL',1850,'627949445060','HONDA / ACURA',10.235,0.4,'20×17.5×11.5×3.5'),
('PU18TL80511435601GM','PURSUIT','18x8.0',18,'5x114.3',114.3,'+35',35.0,60.1,15.0,34.0,9.5,'AM: CONE SEAT (60°)','SATIN GUNMETAL',1850,'627949445077','TOYOTA / LEXUS',10.235,0.4,'20×17.5×11.5×3.5'),
('PU18GM80511540703GM','PURSUIT','18x8.0',18,'5x115',115.0,'+40',40.0,70.3,15.0,34.0,9.5,'OEM: GMC','SATIN GUNMETAL',1850,'627949445084','GM',10.235,0.4,'20×17.5×11.5×3.5'),
('PU18GM80512035671GM','PURSUIT','18x8.0',18,'5x120',120.0,'+35',35.0,67.1,15.0,34.0,9.5,'OEM: GMC','SATIN GUNMETAL',1850,'627949445091','GM',10.235,0.4,'20×17.5×11.5×3.5'),
('PU18DG80512735716GM','PURSUIT','18x8.0',18,'5x127',127.0,'+35',35.0,71.6,15.0,34.0,9.5,'OEM: DODGE','SATIN GUNMETAL',1850,'627949445107','DODGE',10.235,0.4,'20×17.5×11.5×3.5'),
('PU18FD80510840634GM','PURSUIT','18x8.0',18,'5x108',108.0,'+40',40.0,63.4,15.0,34.0,9.5,'OEM: FORD','SATIN GUNMETAL',1850,'627949445114','FORD',10.235,0.4,'20×17.5×11.5×3.5'),
('PU18BM85511235666GM','PURSUIT','18x8.5',18,'5x112',112.0,'+35',35.0,66.6,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',2200,'627949445121','BMW',10.764,0.4,'20×17.5×11.5×3.5'),
('PU18VA85511235666GM','PURSUIT','18x8.5',18,'5x112',112.0,'+35',35.0,66.6,15.0,33.0,9.5,'OEM: VW / AUDI','SATIN GUNMETAL',2200,'627949445138','VW / AUDI',10.764,0.4,'20×17.5×11.5×3.5'),
('PU18KH80511440671GM','PURSUIT','18x8.0',18,'5x114.3',114.3,'+40',40.0,67.1,15.0,34.0,9.5,'OEM: KIA / HYUNDAI','SATIN GUNMETAL',1850,'627949445145','HYUNDAI / KIA',10.235,0.4,'20×17.5×11.5×3.5'),
('PU18BM85512035741GM','PURSUIT','18x8.5',18,'5x120',120.0,'+35',35.0,74.1,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',2200,'627949445152','BMW',10.764,0.4,'20×17.5×11.5×3.5'),
('PU19GM85512035671GM','PURSUIT','19x8.5',19,'5x120',120.0,'+35',35.0,67.1,15.0,34.0,9.5,'OEM: GMC','SATIN GUNMETAL',1850,'627949445169','GM',12.035,0.4,'20×17.5×11.5×3.5'),
('PU19DG85512735716GM','PURSUIT','19x8.5',19,'5x127',127.0,'+35',35.0,71.6,15.0,34.0,9.5,'OEM: DODGE','SATIN GUNMETAL',1850,'627949445176','DODGE',12.035,0.4,'20×17.5×11.5×3.5'),
('PU19KH85511440671GM','PURSUIT','19x8.5',19,'5x114.3',114.3,'+40',40.0,67.1,15.0,34.0,9.5,'OEM: KIA / HYUNDAI','SATIN GUNMETAL',1850,'627949445183','HYUNDAI / KIA',12.035,0.4,'20×17.5×11.5×3.5'),
('PU19TL85511435601GM','PURSUIT','19x8.5',19,'5x114.3',114.3,'+35',35.0,60.1,15.0,34.0,9.5,'AM: CONE SEAT (60°)','SATIN GUNMETAL',1850,'627949445190','TOYOTA / LEXUS',12.035,0.4,'20×17.5×11.5×3.5'),
('PU19BM85511235666GM','PURSUIT','19x8.5',19,'5x112',112.0,'+35',35.0,66.6,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',1850,'627949445206','BMW',12.035,0.4,'20×17.5×11.5×3.5'),
('PU19BM85512035741GM','PURSUIT','19x8.5',19,'5x120',120.0,'+35',35.0,74.1,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',1850,'627949445213','BMW',12.035,0.4,'20×17.5×11.5×3.5'),
('PU19VA85511235666GM','PURSUIT','19x8.5',19,'5x112',112.0,'+35',35.0,66.6,15.0,33.0,9.5,'OEM: VW / AUDI','SATIN GUNMETAL',1850,'627949445220','VW / AUDI',12.035,0.4,'20×17.5×11.5×3.5'),
('PU20TL85511435601GM','PURSUIT','20x8.5',20,'5x114.3',114.3,'+35',35.0,60.1,15.0,34.0,9.5,'AM: CONE SEAT (60°)','SATIN GUNMETAL',1850,'627949445237','TOYOTA / LEXUS',13.316,0.4,'20×17.5×11.5×3.5'),
('PU20HA85511440641GM','PURSUIT','20x8.5',20,'5x114.3',114.3,'+40',40.0,64.1,15.0,33.0,9.5,'OEM: ACURA / HONDA','SATIN GUNMETAL',1850,'627949445244','HONDA / ACURA',13.316,0.4,'20×17.5×11.5×3.5'),
('PU20GM85512035671GM','PURSUIT','20x8.5',20,'5x120',120.0,'+35',35.0,67.1,15.0,34.0,9.5,'OEM: GMC','SATIN GUNMETAL',1850,'627949445251','GM',13.316,0.4,'20×17.5×11.5×3.5'),
('PU20DG85512735716GM','PURSUIT','20x8.5',20,'5x127',127.0,'+35',35.0,71.6,15.0,34.0,9.5,'OEM: DODGE','SATIN GUNMETAL',1850,'627949445268','DODGE',13.316,0.4,'20×17.5×11.5×3.5'),
('PU20FD85510840634GM','PURSUIT','20x8.5',20,'5x108',108.0,'+40',40.0,63.4,15.0,34.0,9.5,'OEM: FORD','SATIN GUNMETAL',1850,'627949445275','FORD',13.316,0.4,'20×17.5×11.5×3.5'),
('PU20VA90511235666GM','PURSUIT','20x9.0',20,'5x112',112.0,'+35',35.0,66.6,15.0,33.0,9.5,'OEM: VW / AUDI','SATIN GUNMETAL',2200,'627949445282','VW / AUDI',13.87,0.4,'20×17.5×11.5×3.5'),
('PU20BM90511220666GM','PURSUIT','20x9.0',20,'5x112',112.0,'+20',20.0,66.6,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',2200,'627949445299','BMW',13.87,0.4,'20×17.5×11.5×3.5'),
('PU20KH85511440671GM','PURSUIT','20x8.5',20,'5x114.3',114.3,'+40',40.0,67.1,15.0,34.0,9.5,'OEM: KIA / HYUNDAI','SATIN GUNMETAL',1850,'627949445305','HYUNDAI / KIA',13.316,0.4,'20×17.5×11.5×3.5'),
('PU20BM90512035741GM','PURSUIT','20x9.0',20,'5x120',120.0,'+35',35.0,74.1,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',2200,'627949445312','BMW',13.87,0.4,'20×17.5×11.5×3.5'),
('PU21BM90511220666GM','PURSUIT','21x9.0',21,'5x112',112.0,'+20',20.0,66.6,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',2200,'627949445329','BMW',13.87,0.4,'20×17.5×11.5×3.5'),
('PU21KH90511440671GM','PURSUIT','21x9.0',21,'5x114.3',114.3,'+40',40.0,67.1,15.0,34.0,9.5,'OEM: KIA / HYUNDAI','SATIN GUNMETAL',2200,'627949445336','HYUNDAI / KIA',13.87,0.4,'20×17.5×11.5×3.5'),
('PU21BM90512035741GM','PURSUIT','21x9.0',21,'5x120',120.0,'+35',35.0,74.1,15.0,33.0,9.5,'OEM: BMW','SATIN GUNMETAL',2200,'627949445343','BMW',13.87,0.4,'20×17.5×11.5×3.5'),
('PU17GM75612035671GM','PURSUIT','17x7.5',17,'6x120',120.0,'+35',35.0,67.1,16.0,34.0,9.5,'OEM: GM','SATIN GUNMETAL',1720,'627949445350','GM',9.42,0.4,'20×17.5×11.5×3.5'),
('PU18GM80612035671GM','PURSUIT','18x8.0',18,'6x120',120.0,'+35',35.0,67.1,16.0,34.0,9.5,'OEM: GM','SATIN GUNMETAL',1850,'627949445367','GM',10.235,0.4,'20×17.5×11.5×3.5'),
('PU20GM85612035671GM','PURSUIT','20x8.5',20,'6x120',120.0,'+35',35.0,67.1,16.0,34.0,9.5,'OEM: GM','SATIN GUNMETAL',1850,'627949445374','GM',13.316,0.4,'20×17.5×11.5×3.5')
on conflict (part_no) do update set
model=excluded.model,size=excluded.size,diameter_in=excluded.diameter_in,pcd=excluded.pcd,bolt_circle_mm=excluded.bolt_circle_mm,offset_txt=excluded.offset_txt,offset_mm=excluded.offset_mm,cb_mm=excluded.cb_mm,lug_hole_mm=excluded.lug_hole_mm,counter_bore_mm=excluded.counter_bore_mm,seat_thickness_mm=excluded.seat_thickness_mm,lug_seat_type=excluded.lug_seat_type,finish=excluded.finish,max_load_lbs=excluded.max_load_lbs,upc_code=excluded.upc_code,fitment=excluded.fitment,wheel_weight_kg=excluded.wheel_weight_kg,wheel_weight_tol_kg=excluded.wheel_weight_tol_kg,tpms_sensor_mm=excluded.tpms_sensor_mm;


```

### `supabase/06_migration.sql`

```sql
-- ============================================================
-- Migration 06 — run in Supabase SQL Editor
-- Fix: reassigning / copying a photo silently does nothing.
-- Cause: the photos table has no UPDATE policy, so RLS lets the
-- query "succeed" but it affects 0 rows (same class of bug that
-- migration 04 fixed for inspections).
-- Fix: add permissive insert / update / delete policies on photos
-- scoped to the owning inspection's inspector, or any approver.
-- Safe to re-run (drop ... if exists first); permissive policies
-- are OR'd with any existing ones, so this never tightens access.
-- "Success. No rows returned" = it worked.
-- ============================================================

alter table photos enable row level security;

drop policy if exists "photos_insert_owner" on photos;
create policy "photos_insert_owner" on photos for insert
  with check (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ));

drop policy if exists "photos_update_owner" on photos;
create policy "photos_update_owner" on photos for update
  using (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ))
  with check (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ));

drop policy if exists "photos_delete_owner" on photos;
create policy "photos_delete_owner" on photos for delete
  using (exists (
    select 1 from inspections i
    where i.id = photos.inspection_id
      and (i.inspector_id = auth.uid() or is_approver())
  ));

```

### `supabase/07_migration.sql`

```sql
-- ============================================================
-- Migration 07 — run in Supabase SQL Editor
-- Batch 4.1: Container Loading records (PO-scoped, separate from
-- per-SKU wheel inspections). Pallet packing + container loading
-- live here, tied to PO + Container No + Seal No.
-- "Success. No rows returned" = it worked. Safe to re-run.
-- ============================================================

create table if not exists container_loadings (
  id uuid primary key default gen_random_uuid(),
  po_no text not null default '',
  container_no text not null default '',
  seal_no text not null default '',
  status text not null default 'in_progress',     -- in_progress / loaded / hold
  data jsonb not null default '{}'::jsonb,         -- { pallet_count, pallets:{n:{contents:[{part_no,qty}], checks:{}}}, container_checks:{} }
  summary jsonb not null default '{}'::jsonb,      -- { disposition, corrective_action }
  inspector_id uuid not null default auth.uid(),
  reviewed_by uuid,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_note text not null default '',
  insp_status text not null default 'draft',       -- draft / submitted / approved / rejected
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table container_loadings enable row level security;

drop policy if exists "cl_select" on container_loadings;
create policy "cl_select" on container_loadings for select
  using (inspector_id = auth.uid() or is_approver());

drop policy if exists "cl_insert" on container_loadings;
create policy "cl_insert" on container_loadings for insert
  with check (inspector_id = auth.uid() or is_approver());

drop policy if exists "cl_update_inspector" on container_loadings;
create policy "cl_update_inspector" on container_loadings for update
  using (inspector_id = auth.uid()) with check (inspector_id = auth.uid());

drop policy if exists "cl_update_approver" on container_loadings;
create policy "cl_update_approver" on container_loadings for update
  using (is_approver()) with check (is_approver());

drop policy if exists "cl_delete" on container_loadings;
create policy "cl_delete" on container_loadings for delete
  using ((inspector_id = auth.uid() and insp_status in ('draft','rejected')) or is_approver());

-- Photos may attach to a container loading instead of an inspection
alter table photos add column if not exists container_loading_id uuid references container_loadings(id) on delete cascade;
alter table photos alter column inspection_id drop not null;

-- Extend photo RLS to cover container-loading photos (inspection OR container owner / approver)
drop policy if exists "photos_insert_owner" on photos;
create policy "photos_insert_owner" on photos for insert
  with check (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

drop policy if exists "photos_update_owner" on photos;
create policy "photos_update_owner" on photos for update
  using (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  )
  with check (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

drop policy if exists "photos_delete_owner" on photos;
create policy "photos_delete_owner" on photos for delete
  using (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

```

### `supabase/08_migration.sql`

```sql
-- ============================================================
-- Migration 08 — run in Supabase SQL Editor
-- Fix: "new row violates row-level security policy for table photos"
-- when adding a Container Loading photo. Migration 07 added the column
-- but its policy section didn't apply. This re-applies ONLY the RLS
-- policies, cleanly and idempotently. Run the WHOLE thing.
-- "Success. No rows returned" = done.
-- ============================================================

-- Make sure the linkage column exists and inspection_id is optional
alter table photos add column if not exists container_loading_id uuid references container_loadings(id) on delete cascade;
alter table photos alter column inspection_id drop not null;

-- container_loadings policies (in case 07 didn't finish them)
alter table container_loadings enable row level security;

drop policy if exists "cl_select" on container_loadings;
create policy "cl_select" on container_loadings for select
  using (inspector_id = auth.uid() or is_approver());

drop policy if exists "cl_insert" on container_loadings;
create policy "cl_insert" on container_loadings for insert
  with check (inspector_id = auth.uid() or is_approver());

drop policy if exists "cl_update_inspector" on container_loadings;
create policy "cl_update_inspector" on container_loadings for update
  using (inspector_id = auth.uid()) with check (inspector_id = auth.uid());

drop policy if exists "cl_update_approver" on container_loadings;
create policy "cl_update_approver" on container_loadings for update
  using (is_approver()) with check (is_approver());

drop policy if exists "cl_delete" on container_loadings;
create policy "cl_delete" on container_loadings for delete
  using ((inspector_id = auth.uid() and insp_status in ('draft','rejected')) or is_approver());

-- photos policies — allow insert/update/delete when the photo belongs to an
-- inspection OR a container loading the user owns (or the user is an approver)
drop policy if exists "photos_insert_owner" on photos;
create policy "photos_insert_owner" on photos for insert
  with check (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

drop policy if exists "photos_update_owner" on photos;
create policy "photos_update_owner" on photos for update
  using (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  )
  with check (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

drop policy if exists "photos_delete_owner" on photos;
create policy "photos_delete_owner" on photos for delete
  using (
    (inspection_id is not null and exists (select 1 from inspections i where i.id = photos.inspection_id and (i.inspector_id = auth.uid() or is_approver())))
    or (container_loading_id is not null and exists (select 1 from container_loadings c where c.id = photos.container_loading_id and (c.inspector_id = auth.uid() or is_approver())))
  );

```

### `supabase/09_migration.sql`

```sql
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

```

### `supabase/10_migration.sql`

```sql
-- ============================================================
-- Migration 10 — run in Supabase SQL Editor
-- Adds Brand Name and Factory to the SKU record.
-- "Success. No rows returned" = done. Safe to re-run.
-- ============================================================

alter table skus add column if not exists brand_name text not null default '';
alter table skus add column if not exists factory text not null default '';

```

### `supabase/11_migration.sql`

```sql
-- ============================================================
-- Migration 11 — run in Supabase SQL Editor
-- Audit trail for approver amendments to inspection reports.
-- "Success. No rows returned" = done. Safe to re-run.
-- ============================================================

alter table inspections add column if not exists amended_at timestamptz;
alter table inspections add column if not exists amended_by uuid;
alter table inspections add column if not exists amend_log jsonb not null default '[]'::jsonb;

```

### `supabase/12_migration.sql`

```sql
-- ============================================================
-- Migration 12 — run in Supabase SQL Editor
-- Optional custom logo per inspection report (else default NITRA).
-- "Success. No rows returned" = done. Safe to re-run.
-- ============================================================

alter table inspections add column if not exists report_logo_path text;

```

### `supabase/13_migration.sql`

```sql
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

```

### `supabase/14_migration.sql`

```sql
-- Migration 14: a small shared library of custom (user-added) final dispositions.
-- The approver can type a one-off disposition on a report and optionally tick
-- "save for future use", which inserts a row here so it appears in the dropdown
-- for every future report. cls is the colour/severity bucket: pass | hold | reject | pending.

create table if not exists custom_dispositions (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  cls         text not null default 'hold',
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- avoid duplicate labels (case-insensitive)
create unique index if not exists custom_dispositions_label_uniq
  on custom_dispositions (lower(label));

alter table custom_dispositions enable row level security;

-- Any authenticated user may read the library and add to it; the approver curates it.
drop policy if exists custom_disp_read on custom_dispositions;
create policy custom_disp_read on custom_dispositions
  for select to authenticated using (true);

drop policy if exists custom_disp_insert on custom_dispositions;
create policy custom_disp_insert on custom_dispositions
  for insert to authenticated with check (true);

drop policy if exists custom_disp_delete on custom_dispositions;
create policy custom_disp_delete on custom_dispositions
  for delete to authenticated using (true);

```

### `supabase/15_migration.sql`

```sql
-- Migration 15: the consolidated PO report caches its container translations under a
-- key like 'po:<PO number>' (not an inspection uuid). Widen the cache key column to
-- text so those rows are accepted and the public PO report isn't re-translated on every
-- view. Existing uuid values cast to text cleanly.

alter table report_translations alter column inspection_id type text;

```

### `supabase/16_migration.sql`

```sql
-- Migration 16: per-container report logo (same idea as inspections.report_logo_path).
-- Used by the container loading interactive report and PDF.
alter table container_loadings add column if not exists report_logo_path text;

```

### `supabase/17_migration.sql`

```sql
-- Migration 17: PO master data (Phase 1 of the PO-centered rebuild).
-- Creates the `pos` (purchase orders) and `po_items` (ordered part numbers +
-- quantities) tables, and BACKFILLS a pos row for every PO number that already
-- exists on inspections or container loadings.
--
-- SAFETY: this migration only CREATES tables and INSERTS rows. It does not
-- modify or delete anything in inspections, container_loadings, photos, or any
-- other existing table. All existing reports and inspection data are untouched.

create table if not exists pos (
  id            uuid primary key default gen_random_uuid(),
  po_no         text not null,
  customer_name text,
  po_date       date,
  destination   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists pos_po_no_uniq on pos (po_no);

create table if not exists po_items (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references pos(id) on delete cascade,
  part_no      text not null,
  qty_ordered  integer not null default 0,
  created_at   timestamptz not null default now()
);

create unique index if not exists po_items_po_part_uniq on po_items (po_id, part_no);

alter table pos enable row level security;
alter table po_items enable row level security;

-- Everyone signed in can read PO master data (inspectors need it for
-- validation and autofill). Only the approver/admin role can write it.
-- The role check accepts BOTH 'approver' and 'admin' so the Phase 2 role
-- rename will not break these policies.

drop policy if exists pos_read on pos;
create policy pos_read on pos
  for select to authenticated using (true);

drop policy if exists pos_write on pos;
create policy pos_write on pos
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists pos_update on pos;
create policy pos_update on pos
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists pos_delete on pos;
create policy pos_delete on pos
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists po_items_read on po_items;
create policy po_items_read on po_items
  for select to authenticated using (true);

drop policy if exists po_items_write on po_items;
create policy po_items_write on po_items
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists po_items_update on po_items;
create policy po_items_update on po_items
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

drop policy if exists po_items_delete on po_items;
create policy po_items_delete on po_items
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('approver','admin')));

-- ---- BACKFILL: one pos row per existing PO number (inserts only) ----
insert into pos (po_no)
select distinct po_no from inspections
where po_no is not null and btrim(po_no) <> ''
on conflict (po_no) do nothing;

insert into pos (po_no)
select distinct po_no from container_loadings
where po_no is not null and btrim(po_no) <> ''
on conflict (po_no) do nothing;

```

### `supabase/18_migration.sql`

```sql
-- Migration 18: Phase 2 — role rename (approver -> admin) + customer PO access.
--
-- SAFETY: updates ONLY the role column value on profiles; creates one new
-- table. No inspection, report, PO, or photo data is touched.

-- 1) Drop any CHECK constraints on profiles (in case one pins role values),
--    then rename the role value.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'profiles'::regclass and contype = 'c'
  loop
    execute format('alter table profiles drop constraint %I', r.conname);
  end loop;
end $$;

update profiles set role = 'admin' where role = 'approver';

-- 2) Customer PO access: which customer user may view which PO.
create table if not exists po_access (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  po_id       uuid not null references pos(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create unique index if not exists po_access_uniq on po_access (customer_id, po_id);

alter table po_access enable row level security;

-- Admins manage assignments; a customer can read their own (needed for the
-- Phase 3 dashboard). Policies accept 'approver' too so ordering never bites.
drop policy if exists po_access_read on po_access;
create policy po_access_read on po_access
  for select to authenticated
  using (
    customer_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','approver'))
  );

drop policy if exists po_access_insert on po_access;
create policy po_access_insert on po_access
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','approver')));

drop policy if exists po_access_delete on po_access;
create policy po_access_delete on po_access
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','approver')));

```

### `supabase/19_migration.sql`

```sql
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

-- Conditional: these tables exist in the repo's migration files but were
-- never applied to the live DB (discovered during Phase 3 deploy).
do $$
begin
  if to_regclass('public.custom_dispositions') is not null then
    execute 'drop policy if exists custom_disp_no_customer on custom_dispositions';
    execute 'create policy custom_disp_no_customer on custom_dispositions
             as restrictive for select to authenticated using ( not is_customer() )';
  end if;
  if to_regclass('public.report_translations') is not null then
    execute 'drop policy if exists report_tr_no_customer on report_translations';
    execute 'create policy report_tr_no_customer on report_translations
             as restrictive for select to authenticated using ( not is_customer() )';
  end if;
end $$;

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

```

### `supabase/21_migration.sql`

```sql
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

```

### `supabase/22_migration.sql`

```sql
-- Migration 22: B6 Stage 2 — sync foundation, part A.
-- Server-authoritative updated_at on inspections + container_loadings.
--
-- WHY: today the app stamps updated_at from the CLIENT clock
-- (new Date().toISOString()). An offline device's clock cannot be trusted to
-- decide "which copy is newer" at sync time. This migration makes the DATABASE
-- stamp updated_at with ITS OWN clock on every insert/update, so updated_at
-- becomes a trustworthy "server last-touched" marker. That is the foundation
-- the later conflict screen uses to compare "server last online update" vs the
-- device's offline-edit time, and to flag (never silently overwrite).
--
-- SAFETY: CREATE-only (one function + two triggers). No RLS change, no table
-- creation, no data change, nothing dropped except its own trigger before
-- re-create. The function is plain (NOT security definer) — it only sets a
-- column on the row being written, so it needs no elevated privilege. Tables
-- are to_regclass-guarded so this is a no-op on any table not present live.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.inspections') is not null then
    execute 'drop trigger if exists set_updated_at_trg on public.inspections';
    execute 'create trigger set_updated_at_trg before insert or update on public.inspections for each row execute function public.set_updated_at()';
  end if;
  if to_regclass('public.container_loadings') is not null then
    execute 'drop trigger if exists set_updated_at_trg on public.container_loadings';
    execute 'create trigger set_updated_at_trg before insert or update on public.container_loadings for each row execute function public.set_updated_at()';
  end if;
end $$;

```


---

## 9f. Supabase edge functions (Deno)

### `supabase/functions/container-report/index.ts`

```ts
// Supabase Edge Function: container-report
// Public JSON for the container loading interactive report (src/pages/ContainerReportPage.tsx).
// Deploy with --no-verify-jwt.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const LABELS: Record<string, { en: string; zh: string }> = {
  container_no_photo: { en: 'Container number', zh: '集装箱号' },
  seal_no_photo: { en: 'Seal number', zh: '封条号' },
  pallet_label: { en: 'Pallet label', zh: '托盘标签' },
  pl_grouped: { en: 'Wheels stacked & grouped by part no.', zh: '按产品编号分类堆叠' },
  pl_wood: { en: 'Fumigation-free solid-wood pallet', zh: '免熏蒸实木托盘' },
  pl_height: { en: 'Height ≤254 cm, 3-inch fork gap', zh: '高≤254cm，留3英寸叉车位' },
  pl_straps: { en: '4 straps tight', zh: '4根打包带捆扎牢固' },
  pl_wrap: { en: 'Wrap ≥3 layers, ≥0.35 mm, tight', zh: '缠绕≥3层，≥0.35mm，紧实' },
  pl_label4: { en: 'Pallet label on all 4 sides', zh: '四面贴托盘标签' },
  pl_photo: { en: 'Photo of each pallet taken', zh: '每托盘拍照' },
  cc_exterior: { en: 'Container Condition: Exterior', zh: '集装箱状况：外部' },
  cc_interior: { en: 'Container Condition: Interior', zh: '集装箱状况：内部' },
  cl_empty: { en: 'Container Loading: Empty', zh: '装柜：空柜' },
  cl_half: { en: 'Container Loading: Half Full', zh: '装柜：半满' },
  cl_full: { en: 'Container Loading: Full', zh: '装柜：满柜' },
  cl_by_size: { en: 'Wheels loaded by size & part number', zh: '按尺寸与产品编号装载' },
  cl_box_labels: { en: 'Box labels & hand-holes facing container door', zh: '箱标签与提手孔朝向柜门' },
  cl_spares: { en: 'Spare boxes & caps at front', zh: '备用箱与盖置于柜门口' },
  cl_net: { en: 'Protective net after loading', zh: '装载后防护网' },
}
const PHOTO_ORDER = ['container_no_photo', 'seal_no_photo', 'cc_exterior', 'cc_interior', 'cl_empty', 'cl_half', 'cl_full', 'cl_by_size', 'cl_box_labels', 'cl_spares', 'cl_net', 'pallet_label']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id') || ''
    const lang = (url.searchParams.get('lang') || 'en').toLowerCase()
    if (!id) return json({ ok: false, error: 'Missing id' }, 400)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: cl, error } = await supa.from('container_loadings').select('*').eq('id', id).single()
    if (error || !cl) return json({ ok: false, error: error?.message || 'Not found' }, 404)

    const ids = [cl.inspector_id, cl.reviewed_by].filter(Boolean)
    const { data: profs } = ids.length ? await supa.from('profiles').select('id,full_name').in('id', ids) : { data: [] as any[] }
    const nameOf = (pid: string) => { const p = (profs || []).find((x: any) => x.id === pid); return p?.full_name || '' }

    const d = cl.data || {}
    const type = d.loading_type || 'pallet'

    const { data: photoRows } = await supa.from('photos').select('*').eq('container_loading_id', id)
    const signed = async (p: string) => (await supa.storage.from('qc-photos').createSignedUrl(p, 60 * 60 * 6)).data?.signedUrl || null

    // loaded contents → aggregate qty by part no, enrich with SKU details
    const qtyByPart: Record<string, number> = {}
    const offPoParts = new Set<string>()
    const addQty = (pn: string, q: any, offPo?: boolean) => { if (!pn) return; qtyByPart[pn] = (qtyByPart[pn] || 0) + (Number(q) || 0); if (offPo) offPoParts.add(pn) }
    if (type === 'pallet') {
      for (const pd of Object.values(d.pallets || {})) for (const c of ((pd as any).contents || [])) addQty(c.part_no, c.qty, c.off_po)
    } else {
      for (const c of (d.non_pallet_contents || [])) addQty(c.part_no, c.qty, c.off_po)
    }
    const partNos = Object.keys(qtyByPart)
    const norm = (x: string) => (x || '').trim().toUpperCase()
    const parseEt = (pn: string) => { const m = pn.match(/\bET\s*(\d+)/i); return m ? m[1] : '' }
    const { data: skuRows } = partNos.length
      ? await supa.from('skus').select('part_no,model,size,pcd,cb_mm,offset_txt,finish')
      : { data: [] as any[] }
    const byPart: Record<string, any> = {}
    const byModel: Record<string, any> = {}
    for (const s of (skuRows || [])) {
      byPart[norm(s.part_no)] = s
      if (s.model && !byModel[norm(s.model)]) byModel[norm(s.model)] = s
    }
    const contents = partNos.sort().map((pn) => {
      const exact = byPart[norm(pn)]
      if (exact) return { part_no: pn, model: exact.model || '', size: exact.size || '', pcd: exact.pcd || '', cb: exact.cb_mm ?? '', et: exact.offset_txt || '', color: exact.finish || '', qty: qtyByPart[pn], off_po: offPoParts.has(pn) || undefined }
      // fall back to the base model (first token) so physical specs still fill in even
      // when this specific finish variant isn't registered in the SKU master
      const token = pn.split(/\s+/)[0]
      const m = byModel[norm(token)]
      if (m) return { part_no: pn, model: m.model || token, size: m.size || '', pcd: m.pcd || '', cb: m.cb_mm ?? '', et: parseEt(pn) || m.offset_txt || '', color: '', qty: qtyByPart[pn], off_po: offPoParts.has(pn) || undefined }
      return { part_no: pn, model: '', size: '', pcd: '', cb: '', et: parseEt(pn), color: '', qty: qtyByPart[pn], off_po: offPoParts.has(pn) || undefined }
    })

    // per-pallet packing checks
    const pallets: any[] = []
    if (type === 'pallet') {
      const cnt = d.pallet_count || 0
      for (let n = 1; n <= cnt; n++) {
        const pd = (d.pallets || {})[n] || { checks: {}, contents: [] }
        const checks = Object.entries(pd.checks || {}).map(([k, v]) => ({ key: k, value: v }))
        pallets.push({ n, checks, failCount: checks.filter((c: any) => c.value === 'F').length })
      }
    }

    // photo groups by item_key
    const byKey: Record<string, any[]> = {}
    for (const p of (photoRows || [])) { (byKey[p.item_key] = byKey[p.item_key] || []).push(p) }
    const groupKeys = Object.keys(byKey).sort((a, b) => (PHOTO_ORDER.indexOf(a) + 1 || 99) - (PHOTO_ORDER.indexOf(b) + 1 || 99))
    const photoGroups = await Promise.all(groupKeys.map(async (k) => ({
      key: k,
      labelEn: LABELS[k]?.en || k.replace(/_/g, ' '),
      labelZh: LABELS[k]?.zh || k.replace(/_/g, ' '),
      photos: await Promise.all(byKey[k].map(async (p: any) => ({
        url: await signed(p.storage_path), isPass: !!p.is_pass_photo, mediaType: p.media_type || 'photo',
        comment: p.comment || '', pieceNo: p.piece_no || 0,
      }))),
    })))

    const logoUrl = cl.report_logo_path ? await signed(cl.report_logo_path) : null

    // ---- translation ----
    let translationNote: string | null = null
    const labelLang = (k: string) => lang === 'zh' ? (LABELS[k]?.zh || k) : (LABELS[k]?.en || k)
    let resolveLabel = labelLang
    let txComment = (s: string) => s
    if (lang === 'de' || lang === 'zh') {
      const strings = new Set<string>()
      if (lang === 'de') for (const g of photoGroups) strings.add(g.labelEn)
      if (lang === 'de') for (const pl of pallets) for (const c of pl.checks) strings.add(LABELS[c.key]?.en || c.key)
      for (const g of photoGroups) for (const p of g.photos) if (p.comment) strings.add(p.comment)
      const list = [...strings].filter(Boolean)
      if (list.length) {
        const { map, error: terr } = await translateBatch(list, lang, 'cl:' + id, supa)
        if (terr) translationNote = terr
        const tr = (s: string) => (s && map[s]) ? map[s] : s
        if (lang === 'de') resolveLabel = (k: string) => tr(LABELS[k]?.en || k)
        txComment = tr
      }
    }

    const outGroups = photoGroups.map((g) => ({
      key: g.key, label: lang === 'zh' ? g.labelZh : resolveLabel(g.key),
      photos: g.photos.map((p) => ({ ...p, comment: txComment(p.comment) })),
    }))
    const outPallets = pallets.map((pl) => ({
      ...pl, checks: pl.checks.map((c: any) => ({ label: resolveLabel(c.key), value: c.value })),
    }))

    return json({
      ok: true, lang, translationNote, logoUrl,
      container: {
        po_no: cl.po_no || '', container_no: cl.container_no || '', seal_no: cl.seal_no || '',
        status: cl.status || '', insp_status: cl.insp_status || '',
        submitted_at: cl.submitted_at || null, reviewed_at: cl.reviewed_at || null,
        loading_type: type, pallet_count: d.pallet_count || 0,
        date_loaded: d.date_loaded || '', etd: d.etd || '', eta: d.eta || '',
        bl_no: d.bl_no || '', dest_port: d.dest_port || '', dep_port: d.dep_port || '',
        inspectorName: nameOf(cl.inspector_id), reviewerName: cl.reviewed_by ? nameOf(cl.reviewed_by) : '',
      },
      contents, pallets: outPallets, photoGroups: outGroups,
    })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
}
async function translateBatch(list: string[], lang: string, cacheId: string, supa: any): Promise<{ map: Record<string, string>; error: string | null }> {
  if (!list.length) return { map: {}, error: null }
  const source_hash = hashStrings(list)
  try {
    const { data: cached } = await supa.from('report_translations').select('content_hash, payload').eq('inspection_id', cacheId).eq('lang', lang).maybeSingle()
    if (cached && cached.content_hash === source_hash && cached.payload && Object.keys(cached.payload).length) return { map: cached.payload, error: null }
  } catch (_) { /* best effort */ }
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return { map: {}, error: 'no_key' }
  const obj: Record<string, string> = {}
  list.forEach((s, i) => { obj[String(i)] = s })
  const langName = lang === 'de' ? 'German' : 'Simplified Chinese'
  const system = `You are a professional translator for automotive alloy-wheel manufacturing, packing and shipping documents. Translate the VALUE of each entry in the given JSON object from English into ${langName}, using correct industry terminology. Do NOT translate part numbers, SKU codes, container numbers, seal numbers, BL numbers, port names, numeric measurements or units. Preserve numbers exactly. Return ONLY a valid JSON object with the same keys and translated values — no markdown, no code fences.`
  let parsed: Record<string, string> = {}
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system, messages: [{ role: 'user', content: JSON.stringify(obj) }] }),
    })
    if (!resp.ok) return { map: {}, error: 'api_' + resp.status }
    const j = await resp.json()
    let text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
    parsed = JSON.parse(text)
  } catch (_) { return { map: {}, error: 'translate_failed' } }
  const map: Record<string, string> = {}
  list.forEach((s, i) => { const t = parsed[String(i)]; if (typeof t === 'string' && t.trim()) map[s] = t })
  try { await supa.from('report_translations').upsert({ inspection_id: cacheId, lang, content_hash: source_hash, payload: map, updated_at: new Date().toISOString() }) } catch (_) { /* best effort */ }
  return { map, error: null }
}
function hashStrings(arr: string[]): string {
  const s = arr.join('\u0001'); let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return String(h)
}

```

### `supabase/functions/interactive-report/index.ts`

```ts
// Supabase Edge Function: interactive-report
//
// Returns the inspection report as JSON. Deliberately does NOT return an
// HTML page: Supabase forces any HTML-shaped Edge Function response into
// Content-Type: text/plain with a locked-down sandboxed CSP, to stop the
// shared *.supabase.co domain being used to host arbitrary live webpages.
// That cannot be overridden from function code. The real report page is
// rendered by the NITRA app itself (src/pages/ReportPage.tsx) on its own
// domain, which simply calls this function for the data.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const pieceLabel = (pieceNo: unknown) => {
  const n = Number(pieceNo)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 0) return 'Additional'
  return `Piece ${n}`
}

const LABELS: Record<string, string> = {
  area_a: 'Area A — Front / design',
  area_b: 'Area B — Window',
  area_c: 'Area C — Rim well outside',
  area_c1: 'Area C1 — Rim well inside',
  area_d: 'Area D — Rim horn inside',
  area_e: 'Area E — Valve hole',
  axial_bot: 'Axial bottom',
  axial_top: 'Axial top',
  bal_b: 'Balance B (g)',
  bal_bc: 'Balance B+C (g)',
  bal_c: 'Balance C (g)',
  batch_laser: 'Batch no. / laser engraving',
  bolt_cone_paint: 'Bolt hole / cone free of paint',
  box_label: 'Box label + UPC',
  bx_design: 'Box design matches sample',
  bx_label: 'Box label format & size',
  bx_proddate: 'Production date below UPC',
  bx_stick: 'Stick-on label square, no slant',
  bx_upc: 'UPC-A scans',
  cap_color: 'Cap Color vs Wheel Color',
  cap_finish: 'Cap surface finish',
  cap_fitment: 'Cap fitment',
  cb: 'Center bore CB',
  coating_machined: 'Machined-area coating',
  coating_total: 'Total coating thickness',
  container_door: 'Container door (# legible)',
  container_empty: 'Container empty + damage',
  container_full: 'Container full',
  container_half: 'Container half full',
  container_seal: 'Seal # (legible)',
  counter_bore: 'Counter bore',
  ct_labels_doors: 'Box labels + hand-holes face doors',
  ct_net: 'Net/rope before closing doors',
  ct_no_loose: 'No loose wheels',
  ct_photo_before: 'Container damage + empty photographed',
  ct_spares_front: 'Spare boxes/caps at front',
  hat_marks: 'No hat marks',
  laser_format: 'Laser engraving format',
  logo: 'Logo',
  lug_hole: 'Lug hole',
  lug_seat_type: 'Lug seat type',
  mark_cb: 'Back marking — CB',
  mark_et: 'Back marking — ET',
  mark_nitra: 'Back marking — NITRA brand',
  mark_pcd: 'Back marking — PCD',
  mark_sae: 'Back marking — SAE J2530',
  mark_size: 'Back marking — SIZE',
  offset: 'Offset ET',
  orange_peel: 'Smooth surface, no orange peel',
  packing_inside: 'Packing layers inside box',
  pallet_full: 'Each pallet w/ labels',
  pk_bag: 'Step 4 — plastic bag',
  pk_cap: 'Step 1 — cap on wheel',
  pk_cloth: 'Step 2 — face cloth cover',
  pk_foam: 'Foam/cling on gloss black',
  pk_fullface: 'Full-face cap taped at box bottom',
  pk_hoop: 'Step 3 — plastic hoop',
  pk_sideboard: 'Side boards each side',
  pk_toppad: 'Step 5 — protective top pad',
  pl_grouped: 'Wheels stacked & grouped by part no.',
  pl_height: 'Height ≤254 cm, 3-inch fork gap',
  pl_label4: 'Pallet label on all 4 sides',
  pl_photo: 'Photo of each pallet taken',
  pl_straps: '4 straps tight',
  pl_wood: 'Fumigation-free solid-wood pallet',
  pl_wrap: 'Wrap ≥3 layers, ≥0.35 mm, tight',
  radial_bot: 'Radial bottom',
  radial_top: 'Radial top',
  rear_bore_paint: 'Rear centre bore + mounting face paint-free',
  seat_thick: 'Seat thickness',
  tpms_hole: 'TPMS Dimension',
  wheel_back: 'Wheel back + markings',
  wheel_front: 'Wheel front face',
  wheel_weight: 'Wheel weight',
  required_shots: 'Required Photos',
}
const labelOf = (key: unknown) => LABELS[String(key)] || String(key ?? '').replace(/_/g, ' ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  try {
    const url = new URL(req.url)
    const inspectionId = url.searchParams.get('id') || url.searchParams.get('inspection_id')
    if (!inspectionId) return json({ ok: false, error: 'Missing inspection id' }, 400)

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: insp, error: inspErr } = await supa.from('inspections').select('*').eq('id', inspectionId).single()
    if (inspErr || !insp) return json({ ok: false, error: 'Inspection not found' }, 404)

    const [{ data: sku }, { data: defectsRaw }, { data: photosRaw }] = await Promise.all([
      supa.from('skus').select('*').eq('part_no', insp.part_no).maybeSingle(),
      supa.from('defects').select('*').eq('inspection_id', inspectionId).order('created_at'),
      supa.from('photos').select('*').eq('inspection_id', inspectionId).order('created_at'),
    ])
    const defects = defectsRaw || []
    const photos = photosRaw || []

    const ids = [insp.inspector_id, insp.reviewed_by].filter(Boolean)
    const names: Record<string, string> = {}
    if (ids.length) {
      const { data: profs } = await supa.from('profiles').select('id, full_name').in('id', ids)
      for (const p of profs || []) names[p.id] = p.full_name
    }

    const storagePaths = [...new Set(photos.map((p: any) => p.storage_path).filter(Boolean))]
    const mediaUrls: Record<string, string> = {}
    if (storagePaths.length) {
      const { data: signed } = await supa.storage.from('qc-photos').createSignedUrls(storagePaths, 60 * 60 * 24 * 7)
      for (const item of signed || []) if (item.path && item.signedUrl) mediaUrls[item.path] = item.signedUrl
    }

    const firstPhotoForDefect = (d: any) => photos.find((p: any) => p.defect_id === d.id)
    const sortedDefects = [...defects].sort((a: any, b: any) => {
      const pa = String(a.item_label || labelOf(a.item_key) || '')
      const pb = String(b.item_label || labelOf(b.item_key) || '')
      return pa.localeCompare(pb) || Number(a.piece_no || 0) - Number(b.piece_no || 0)
    })

    // ---- Inspection Outcome (one row per inspected parameter) ----
    const fdata = insp.form_data || {}
    const baseV: Record<string, string> = fdata.results || {}
    const baseT: Record<string, string> = fdata.meas_results || {}
    const extraV: Record<string, string[]> = fdata.extra_results || {}
    const extraT: Record<string, string[]> = fdata.meas_extra_results || {}
    const hundred: Record<string, Record<string, string>> = fdata.hundred_pct || {}

    const scanBase = (map: Record<string, string>, key: string) => {
      let checked = 0; const fails: number[] = []
      for (const [k, v] of Object.entries(map)) {
        if (k.split(':')[0] !== key) continue
        if (v === 'P' || v === 'F') { checked++; if (v === 'F') fails.push(Number(k.split(':')[1])) }
      }
      return { checked, fails }
    }
    const scanArr = (arr: string[] | undefined) => {
      let checked = 0; const failIdx: number[] = []
      ;(arr || []).forEach((v, i) => { if (v === 'P' || v === 'F') { checked++; if (v === 'F') failIdx.push(i + 1) } })
      return { checked, failIdx }
    }

    const keySet = new Set<string>()
    for (const k of Object.keys(baseV)) keySet.add(k.split(':')[0])
    for (const k of Object.keys(baseT)) keySet.add(k.split(':')[0])
    for (const k of Object.keys(extraV)) keySet.add(k)
    for (const k of Object.keys(extraT)) keySet.add(k)
    for (const k of Object.keys(hundred)) keySet.add(k)

    const rank = (o: string) => (o === '100% Inspection' ? 0 : o.startsWith('Additional') ? 1 : 2)
    const liveFails = new Set<string>()
    const outcomes = [...keySet].map((key) => {
      const bV = scanBase(baseV, key), bT = scanBase(baseT, key)
      const baseFails = [...bV.fails, ...bT.fails]
      const ex = scanArr(extraV[key] || extraT[key])
      // Mirror the rule engine: base sample is the gate. 0 base fails = clean
      // (extras AND any old 100% data are ignored). 100% only when the base has
      // >=2 fails, or exactly 1 base fail plus a failed extra-sample piece.
      const triggers100 = baseFails.length >= 2 || (baseFails.length >= 1 && ex.failIdx.length >= 1)
      // Per piece: 100% fills pieces in first (only if triggered), then the base
      // verdict OVERRIDES — base is the first authority and is never overturned.
      const mergedV: Record<number, string> = {}
      if (triggers100) { for (const [pc, v] of Object.entries(hundred[key] || {})) { if (v === 'P' || v === 'F') mergedV[Number(pc)] = v } }
      for (const [k, v] of Object.entries(baseV)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
      for (const [k, v] of Object.entries(baseT)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) mergedV[Number(k.split(':')[1])] = v }
      const failPieces = Object.entries(mergedV).filter(([, v]) => v === 'F').map(([pc]) => Number(pc)).sort((a, b) => a - b)
      const checked = Object.keys(mergedV).length
      const fail = failPieces.length
      const dedup = failPieces.map((n) => `#${n}`)
      for (const pc of failPieces) liveFails.add(`${key}:${pc}`)
      let outcome: string
      if (baseFails.length === 0) outcome = 'Pass'
      else if (triggers100) outcome = '100% Inspection'
      else if (ex.checked > 0) outcome = 'Additional Inspection — Pass'
      else outcome = 'Additional Inspection Required'
      return {
        parameter: labelOf(key),
        checked,
        pass: checked - fail,
        fail,
        defectPieces: dedup.length ? dedup.join(', ') : '—',
        outcome,
      }
    }).filter((o) => o.checked > 0)
      .sort((a, b) => rank(a.outcome) - rank(b.outcome) || a.parameter.localeCompare(b.parameter))

    // Only defects that correspond to a CURRENTLY-failing piece (filters out
    // orphaned rows left over from amended-away fails / old 100% data), one per piece.
    const seenDefect = new Set<string>()
    const defectRows = sortedDefects
      .filter((d: any) => liveFails.has(`${d.item_key}:${Number(d.piece_no)}`))
      .filter((d: any) => { const k = `${d.item_key}:${Number(d.piece_no)}`; if (seenDefect.has(k)) return false; seenDefect.add(k); return true })
      .map((d: any) => {
        const p = firstPhotoForDefect(d)
        return {
          parameter: d.item_label || labelOf(d.item_key) || '—',
          pieceLabel: pieceLabel(d.piece_no),
          mediaUrl: p ? mediaUrls[p.storage_path] || null : null,
          mediaType: p?.media_type || null,
        }
      })
    const defectCount = liveFails.size

    // Photo appendix groups. A photo's Pass/Fail follows the CURRENT verdict of its
    // piece (so amended F→P / P→F is reflected without deleting anything). Photos with
    // no piece (required shots, appendix) keep their saved flag.
    const photoPass = (p: any, key: string) => (p.piece_no ? !liveFails.has(`${key}:${Number(p.piece_no)}`) : !!p.is_pass_photo)
    const photosByParam = new Map<string, any[]>()
    for (const p of photos) {
      const key = p.item_key || p.checklist_key || 'required_shots'
      if (!photosByParam.has(key)) photosByParam.set(key, [])
      photosByParam.get(key)!.push(p)
    }
    const photoGroups = [...photosByParam.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a: any, b: any) => {
        const passSort = Number(photoPass(b, key)) - Number(photoPass(a, key))
        if (passSort !== 0) return passSort
        return Number(a.piece_no || 0) - Number(b.piece_no || 0)
      })
      return {
        key,
        label: key === 'appendix' ? 'Appendix' : labelOf(key),
        photos: sorted.map((p: any) => ({
          isPass: photoPass(p, key),
          pieceLabel: p.piece_no ? pieceLabel(p.piece_no) : 'Photo',
          mediaUrl: mediaUrls[p.storage_path] || null,
          mediaType: p.media_type || 'photo',
          comment: p.comment || '',
        })),
      }
    })

    const lang = (url.searchParams.get('lang') || 'en').toLowerCase()
    const viewPo = url.searchParams.get('po')  // shared inspections: render under the viewing PO, not the primary
    let correctiveAction = insp.summary?.corrective_action || insp.summary?.remarks || ''
    let dispositionCustom = insp.summary?.disposition_custom || ''
    let translationNote: string | null = null

    if (lang === 'de' || lang === 'zh') {
      const strings = new Set<string>()
      for (const o of outcomes) if (o.parameter) strings.add(o.parameter)
      for (const d of defectRows) { if (d.parameter) strings.add(d.parameter); if (d.pieceLabel) strings.add(d.pieceLabel) }
      for (const g of photoGroups) {
        if (g.label) strings.add(g.label)
        for (const p of g.photos) { if (p.comment) strings.add(p.comment); if (p.pieceLabel) strings.add(p.pieceLabel) }
      }
      if (correctiveAction) strings.add(correctiveAction)
      if (dispositionCustom) strings.add(dispositionCustom)
      const list = [...strings].filter((s) => s && s !== '—')
      const { map: tx, error } = await translateBatch(list, lang, inspectionId, supa)
      if (error) translationNote = error
      const tr = (s: string) => (s && s !== '—' && tx[s]) ? tx[s] : s
      for (const o of outcomes) o.parameter = tr(o.parameter)
      for (const d of defectRows) { d.parameter = tr(d.parameter); d.pieceLabel = tr(d.pieceLabel) }
      for (const g of photoGroups) {
        g.label = tr(g.label)
        for (const p of g.photos) { p.comment = tr(p.comment); p.pieceLabel = tr(p.pieceLabel) }
      }
      correctiveAction = tr(correctiveAction)
      dispositionCustom = tr(dispositionCustom)
    }

    let logoUrl: string | null = null
    if (insp.report_logo_path) {
      const { data: lu } = await supa.storage.from('qc-photos').createSignedUrl(insp.report_logo_path, 60 * 60 * 6)
      logoUrl = lu?.signedUrl || null
    }

    return json({
      ok: true,
      lang,
      translationNote,
      logoUrl,
      insp: {
        part_no: insp.part_no,
        po_no: viewPo || insp.po_no,
        batch: insp.batch,
        lot_size: insp.lot_size,
        app_sample: insp.app_sample,
        fun_sample: insp.fun_sample,
        submitted_at: insp.submitted_at,
        reviewed_at: insp.reviewed_at,
        disposition: insp.summary?.disposition || null,
        disposition_custom: dispositionCustom || null,
        disposition_cls: insp.summary?.disposition_cls || null,
        remarks: insp.summary?.remarks || '',
        corrective_action: correctiveAction,
      },
      sku: sku ? { model: sku.model, size: sku.size, pcd: sku.pcd, offset_txt: sku.offset_txt, cb_mm: sku.cb_mm, finish: sku.finish } : null,
      inspectorName: names[insp.inspector_id] || '—',
      reviewerName: insp.reviewed_by ? (names[insp.reviewed_by] || '—') : '—',
      defects: defectRows,
      defectCount,
      photoGroups,
      outcomes,
    })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

// Translate a batch of English strings into the target language with Claude, caching
// the result per (inspection, language). Only re-calls Claude when the set of source
// strings changes (hash mismatch), so a public report view never triggers a fresh
// translation once it has been generated once.
async function translateBatch(
  list: string[], lang: string, inspectionId: string, supa: any,
): Promise<{ map: Record<string, string>; error: string | null }> {
  if (!list.length) return { map: {}, error: null }
  const source_hash = hashStrings(list)
  try {
    const { data: cached } = await supa.from('report_translations')
      .select('content_hash, payload').eq('inspection_id', inspectionId).eq('lang', lang).maybeSingle()
    if (cached && cached.content_hash === source_hash && cached.payload && Object.keys(cached.payload).length) {
      return { map: cached.payload as Record<string, string>, error: null }
    }
  } catch (_) { /* cache read best-effort */ }

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return { map: {}, error: 'no_key' }

  const obj: Record<string, string> = {}
  list.forEach((s, i) => { obj[String(i)] = s })
  const langName = lang === 'de' ? 'German' : 'Simplified Chinese'
  const system = `You are a professional translator for automotive alloy-wheel manufacturing and quality-control documents. Translate the VALUE of each entry in the given JSON object from English into ${langName}, using correct industry terminology. Do NOT translate or alter: part numbers, SKU codes, numeric measurements, units (mm, g, kg, cm), or piece references such as "#3". Preserve all numbers exactly. Some values may contain simple HTML tags (<b>, <i>, <u>, <p>, <ul>, <ol>, <li>, <br>, <span>); keep every tag exactly where it is and translate ONLY the human-readable text between the tags. Return ONLY a valid JSON object with exactly the same keys and the translated values — no markdown, no code fences, no extra commentary.`

  let parsed: Record<string, string> = {}
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 8000, system,
        messages: [{ role: 'user', content: JSON.stringify(obj) }],
      }),
    })
    if (!resp.ok) return { map: {}, error: 'api_' + resp.status }
    const j = await resp.json()
    let text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
    parsed = JSON.parse(text)
  } catch (_) {
    return { map: {}, error: 'translate_failed' }
  }

  const map: Record<string, string> = {}
  list.forEach((s, i) => { const t = parsed[String(i)]; if (typeof t === 'string' && t.trim()) map[s] = t })
  try {
    await supa.from('report_translations').upsert({
      inspection_id: inspectionId, lang, content_hash: source_hash, payload: map, updated_at: new Date().toISOString(),
    })
  } catch (_) { /* cache write best-effort */ }
  return { map, error: null }
}

function hashStrings(arr: string[]): string {
  const s = arr.join('\u0001')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

```

### `supabase/functions/manage-users/index.ts`

```ts
// Supabase Edge Function: manage-users
// Approver-only account management for the NITRA QC app.
//
// SECURITY MODEL
// - Deployed WITH jwt verification (no --no-verify-jwt). Supabase's gateway first
//   proves the caller has *a* valid logged-in session.
// - This function then independently re-checks that the caller is an APPROVER by
//   resolving caller JWT -> user id -> profiles.role using the service role.
//   The role is NEVER trusted from the client body.
// - The service-role key lives only in this function's env, never in the browser.
//
// ACTIONS (POST body { action, ... })
//   list                         -> all users merged: id, email, full_name, role, active
//   invite { full_name, email, role }  -> create auth user + profile, email a branded
//                                         "set password" link via Resend
//   set_role { user_id, role }   -> update profiles.role
//   deactivate { user_id }       -> ban the user (reversible)
//   reactivate { user_id }       -> lift the ban
import { createClient } from 'jsr:@supabase/supabase-js@2'

type Role = 'inspector' | 'admin' | 'customer'
const BAN_FOREVER = '876000h' // ~100 years; reversible via reactivate

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1) Resolve and verify the caller from their JWT (server-side, not the body).
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ ok: false, error: 'Not signed in.' }, 401)

    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt)
    if (callerErr || !caller?.user) return json({ ok: false, error: 'Invalid session.' }, 401)
    const callerId = caller.user.id

    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', callerId).single()
    // Accept both 'admin' (current) and 'approver' (pre-rename) so this
    // function keeps working regardless of SQL/deploy ordering.
    if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'approver') {
      return json({ ok: false, error: 'Admin access required.' }, 403)
    }

    // 2) Dispatch the requested action.
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'list') {
      const users = await listAllAuthUsers(admin)
      const { data: profiles } = await admin.from('profiles').select('id, full_name, role')
      const pMap = new Map((profiles || []).map((p: any) => [p.id, p]))
      const rows = users.map((u) => {
        const p = pMap.get(u.id) as any
        const banned = u.banned_until ? new Date(u.banned_until).getTime() > Date.now() : false
        return {
          id: u.id,
          email: u.email || '',
          full_name: p?.full_name || '',
          role: (p?.role as Role) || 'inspector',
          active: !banned,
          is_self: u.id === callerId,
        }
      })
      // Stable, readable order: admins, then inspectors, then customers, then by name.
      const rank = (r: string) => r === 'admin' ? 0 : r === 'inspector' ? 1 : 2
      rows.sort((a, b) =>
        (rank(a.role) - rank(b.role)) ||
        (a.full_name || a.email).localeCompare(b.full_name || b.email))
      return json({ ok: true, users: rows })
    }

    if (action === 'invite') {
      const full_name = String(body.full_name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const role = body.role as Role
      if (!full_name) return json({ ok: false, error: 'Full name is required.' }, 400)
      if (!/.+@.+\..+/.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400)
      if (!['inspector', 'admin', 'customer'].includes(role)) return json({ ok: false, error: 'Role must be admin, inspector, or customer.' }, 400)

      // Reject duplicates up front (clear error beats a silent no-op).
      const existing = await findUserByEmail(admin, email)
      if (existing) return json({ ok: false, error: `A user with ${email} already exists.` }, 409)

      const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')

      // generateLink(type:'invite') creates the auth user AND returns the action
      // link WITHOUT sending Supabase's own email — so we can send a branded one.
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: { full_name }, redirectTo: appUrl },
      })
      if (linkErr || !linkData?.user || !linkData?.properties?.action_link) {
        return json({ ok: false, error: `Could not create invite: ${linkErr?.message || 'unknown error'}` }, 500)
      }
      const newUserId = linkData.user.id
      const actionLink = linkData.properties.action_link

      // Create the profile now, with the chosen name + role, so authority is
      // correct from the start instead of waiting for first sign-in.
      const { error: pErr } = await admin.from('profiles').upsert({ id: newUserId, full_name, role })
      if (pErr) {
        return json({ ok: false, error: `User created but profile failed: ${pErr.message}` }, 500)
      }

      // Branded invite email via Resend.
      const sent = await sendInviteEmail(email, full_name, role, actionLink)
      if (!sent.ok) {
        return json({ ok: true, warning: `User created, but the invite email failed to send: ${sent.error}. You can re-send by removing and re-inviting, or share the set-password link manually.`, user_id: newUserId }, 200)
      }
      return json({ ok: true, user_id: newUserId, email })
    }

    if (action === 'create_with_password') {
      // Admin creates the account directly with a temporary password. The
      // user is forced to choose their own password on first sign-in
      // (user_metadata.must_reset gates the app until they do).
      const full_name = String(body.full_name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const role = body.role as Role
      const password = String(body.password || '')
      if (!full_name) return json({ ok: false, error: 'Full name is required.' }, 400)
      if (!/.+@.+\..+/.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400)
      if (!['inspector', 'admin', 'customer'].includes(role)) return json({ ok: false, error: 'Role must be admin, inspector, or customer.' }, 400)
      if (password.length < 8) return json({ ok: false, error: 'Temporary password must be at least 8 characters.' }, 400)

      const existing = await findUserByEmail(admin, email)
      if (existing) return json({ ok: false, error: `A user with ${email} already exists.` }, 409)

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name, must_reset: true },
      })
      if (cErr || !created?.user) return json({ ok: false, error: `Could not create user: ${cErr?.message || 'unknown error'}` }, 500)

      const { error: pErr } = await admin.from('profiles').upsert({ id: created.user.id, full_name, role })
      if (pErr) return json({ ok: false, error: `User created but profile failed: ${pErr.message}` }, 500)
      return json({ ok: true, user_id: created.user.id, email })
    }

    if (action === 'set_role') {
      const user_id = String(body.user_id || '')
      const role = body.role as Role
      if (!['inspector', 'admin', 'customer'].includes(role)) return json({ ok: false, error: 'Role must be admin, inspector, or customer.' }, 400)
      if (!user_id) return json({ ok: false, error: 'Missing user_id.' }, 400)
      // Guard: an admin cannot demote themselves (prevents locking out all admins by accident).
      if (user_id === callerId && role !== 'admin') {
        return json({ ok: false, error: 'You cannot change your own role away from admin.' }, 400)
      }
      const { error } = await admin.from('profiles').update({ role }).eq('id', user_id)
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true })
    }

    if (action === 'deactivate' || action === 'reactivate') {
      const user_id = String(body.user_id || '')
      if (!user_id) return json({ ok: false, error: 'Missing user_id.' }, 400)
      if (action === 'deactivate' && user_id === callerId) {
        return json({ ok: false, error: 'You cannot deactivate your own account.' }, 400)
      }
      const { error } = await admin.auth.admin.updateUserById(user_id, {
        ban_duration: action === 'deactivate' ? BAN_FOREVER : 'none',
      })
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ ok: false, error: `Unknown action: ${action || '(none)'}` }, 400)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// --- helpers ---------------------------------------------------------------

async function listAllAuthUsers(admin: ReturnType<typeof createClient>) {
  const all: any[] = []
  let page = 1
  // Page through in case the team ever grows past one page.
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    all.push(...data.users)
    if (data.users.length < 200) break
    page++
    if (page > 25) break // hard safety stop
  }
  return all
}

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  const users = await listAllAuthUsers(admin)
  return users.find((u) => (u.email || '').toLowerCase() === email) || null
}

async function sendInviteEmail(email: string, fullName: string, role: Role, actionLink: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }
  const roleLabel = role === 'admin' ? 'Admin' : role === 'customer' ? 'Customer' : 'Inspector'
  const html = inviteHtml(fullName, roleLabel, actionLink)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('INVITE_FROM_EMAIL') || 'NITRA QC <kyong@nitrawheels.com>',
        to: [email],
        subject: 'You\u2019ve been invited to the NITRA QC app',
        html,
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status} ${t}`.trim() }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

function inviteHtml(fullName: string, roleLabel: string, actionLink: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:560px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">QC Inspection App</div>
</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px;border-radius:0 0 10px 10px">
  <p style="margin-top:0">Hi ${esc(fullName)},</p>
  <p>You\u2019ve been added to the NITRA QC inspection app as <b>${esc(roleLabel)}</b>. Click below to set your password and sign in.</p>
  <p style="text-align:center;margin:26px 0"><a href="${esc(actionLink)}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;display:inline-block">Set my password</a></p>
  <p style="font-size:12px;color:#5A6878">If the button does not work, copy and paste this link into your browser:<br><a href="${esc(actionLink)}">${esc(actionLink)}</a></p>
  <p style="font-size:12px;color:#5A6878">This link can only be used once and expires for security. If you didn\u2019t expect this invite, you can ignore this email.</p>
</div></body></html>`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

```

### `supabase/functions/ocr-label/index.ts`

```ts
// Supabase Edge Function: ocr-label
// Reads a pallet-label photo from the qc-photos bucket and extracts structured
// fields with Claude vision. STAFF ONLY (admin/approver/inspector) — deployed
// WITH jwt verification (no --no-verify-jwt).
//
// Input  (POST): { path: string }   — storage path inside qc-photos
// Output: { ok, fields: { part_no, qty, pallet_no, container_no, model, size, finish }, raw_text }
// The client always shows the fields for human confirmation before saving.
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Caller must be signed-in staff.
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ ok: false, error: 'Not signed in.' }, 401)
    const { data: caller } = await admin.auth.getUser(jwt)
    if (!caller?.user) return json({ ok: false, error: 'Invalid session.' }, 401)
    const { data: prof } = await admin.from('profiles').select('role').eq('id', caller.user.id).single()
    if (!prof || !['admin', 'approver', 'inspector'].includes(prof.role)) {
      return json({ ok: false, error: 'Staff access required.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const path = String(body.path || '')
    if (!path) return json({ ok: false, error: 'Missing photo path.' }, 400)

    // Download the photo server-side (service role bypasses RLS).
    const dl = await admin.storage.from('qc-photos').download(path)
    if (dl.error || !dl.data) return json({ ok: false, error: `Could not read photo: ${dl.error?.message || 'not found'}` }, 404)
    const buf = new Uint8Array(await dl.data.arrayBuffer())
    if (buf.length > 9_500_000) return json({ ok: false, error: 'Photo too large for OCR (max ~9 MB). Retake at lower resolution.' }, 400)
    let b64 = ''
    const CHUNK = 32768
    for (let i = 0; i < buf.length; i += CHUNK) b64 += String.fromCharCode(...buf.subarray(i, i + CHUNK))
    b64 = btoa(b64)
    const mediaType = path.toLowerCase().endsWith('.png') ? 'image/png' : path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg'

    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) return json({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }, 500)

    const system = `You read photos of NITRA alloy-wheel pallet labels taken on a factory floor (angles, glare, shrink wrap are common). The label follows a fixed template with fields like: SKU / PART NUMBER, MODEL, SIZE/GRANDEUR, BOLT PATTERN, OFFSET, HUB, FINISH/FINI, a barcode, QTY PER PALLET (often handwritten), PALLET NO. and CONTAINER NO. (often handwritten).
Respond ONLY with a JSON object, no markdown fences, no commentary:
{"part_no": string|null, "qty": number|null, "pallet_no": string|null, "container_no": string|null, "model": string|null, "size": string|null, "finish": string|null, "raw_text": string}
Rules: part_no is the full SKU (e.g. PU18KH80511440671GM-01 — strip a trailing "-01" style pallet suffix into pallet_no if present and return the base SKU in part_no). qty is QTY PER PALLET as a number. Use null for anything unreadable — never guess. raw_text is all legible text on the label.`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 1500, system,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: 'Extract the label fields as specified.' },
          ],
        }],
      }),
    })
    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      return json({ ok: false, error: `Vision request failed (${resp.status}). ${t.slice(0, 200)}` }, 502)
    }
    const data = await resp.json()
    const text = (data.content || []).map((c: any) => c.type === 'text' ? c.text : '').join('').trim()
    let fields: any = null
    try { fields = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, '')) } catch { /* fall through */ }
    if (!fields || typeof fields !== 'object') {
      return json({ ok: false, error: 'Could not read the label. Retake the photo (fill the frame, avoid glare) or enter values manually.', raw: text.slice(0, 400) }, 422)
    }
    const qty = Number(fields.qty)
    return json({
      ok: true,
      fields: {
        part_no: fields.part_no ? String(fields.part_no).trim() : null,
        qty: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : null,
        pallet_no: fields.pallet_no ? String(fields.pallet_no).trim() : null,
        container_no: fields.container_no ? String(fields.container_no).trim() : null,
        model: fields.model ? String(fields.model).trim() : null,
        size: fields.size ? String(fields.size).trim() : null,
        finish: fields.finish ? String(fields.finish).trim() : null,
      },
      raw_text: String(fields.raw_text || '').slice(0, 2000),
    })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...cors(), 'Content-Type': 'application/json' } })
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

```

### `supabase/functions/po-report/index.ts`

```ts
// Supabase Edge Function: po-report
//
// Aggregates a whole PO into one JSON for the consolidated report page:
//  - every wheel inspection's full report (reusing the interactive-report function,
//    so the per-SKU data + translation stay identical to the single report), and
//  - every container loading's summary (built here, with its dynamic text translated).
// Public (deploy with --no-verify-jwt). The page is src/pages/PoReportPage.tsx.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const PALLET_LABELS: Record<string, string> = {
  pl_wrap: 'Stretch-wrapped', pl_corner: 'Corner protectors', pl_strap: 'Strapped',
  pl_label4: 'Pallet label on all 4 sides', pallet_full: 'Each pallet w/ labels',
  pl_stack: 'Stacking within limit', pl_shrink: 'Shrink film intact',
}
const labelOf = (k: string) => PALLET_LABELS[k] || k.replace(/_/g, ' ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const url = new URL(req.url)
    const po = url.searchParams.get('po') || ''
    const lang = (url.searchParams.get('lang') || 'en').toLowerCase()
    if (!po) return json({ ok: false, error: 'Missing po' }, 400)

    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const supa = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: links } = await supa.from('inspection_pos').select('inspection_id').eq('po_no', po)
    const inspIds = (links || []).map((l: any) => l.inspection_id)
    const [{ data: insps }, { data: conts }] = await Promise.all([
      inspIds.length
        ? supa.from('inspections').select('id,part_no,status,updated_at,report_logo_path').in('id', inspIds).order('part_no')
        : Promise.resolve({ data: [] }),
      supa.from('container_loadings').select('*').eq('po_no', po).order('container_no'),
    ])

    // ---- SKU sections: reuse interactive-report per inspection ----
    const skus = await Promise.all((insps || []).map(async (r: any) => {
      try {
        const resp = await fetch(`${supaUrl}/functions/v1/interactive-report?id=${encodeURIComponent(r.id)}&lang=${lang}&po=${encodeURIComponent(po)}`)
        const data = await resp.json()
        if (data && data.ok) return { id: r.id, status: r.status, ...data }
      } catch (_) { /* fall through */ }
      return { id: r.id, status: r.status, ok: false, insp: { part_no: r.part_no } }
    }))

    // ---- Container sections ----
    const contIds = (conts || []).map((c: any) => c.id)
    const { data: contPhotosRaw } = contIds.length
      ? await supa.from('photos').select('*').in('container_loading_id', contIds)
      : { data: [] as any[] }
    const contPhotos = contPhotosRaw || []

    const signed = async (path: string) => {
      const { data } = await supa.storage.from('qc-photos').createSignedUrl(path, 60 * 60 * 6)
      return data?.signedUrl || null
    }

    const containers = await Promise.all((conts || []).map(async (c: any) => {
      const d = c.data || {}
      const type = d.loading_type || 'pallet'
      // contents
      const contents: string[] = []
      if (type === 'pallet') {
        for (const [n, pd] of Object.entries(d.pallets || {})) {
          for (const ct of ((pd as any).contents || [])) if (ct.part_no) contents.push(`Pallet ${n}: ${ct.part_no}${ct.off_po ? ' ⚠NOT ON PO' : ''} × ${ct.qty}`)
        }
      } else {
        for (const ct of (d.non_pallet_contents || [])) if (ct.part_no) contents.push(`${ct.part_no}${ct.off_po ? ' ⚠NOT ON PO' : ''} × ${ct.qty}`)
      }
      // pallet checks roll-up
      let checkPass = 0, checkFail = 0
      const failedChecks: string[] = []
      for (const pd of Object.values(d.pallets || {})) {
        for (const [k, v] of Object.entries((pd as any).checks || {})) {
          if (v === 'P') checkPass++
          else if (v === 'F') { checkFail++; if (!failedChecks.includes(labelOf(k))) failedChecks.push(labelOf(k)) }
        }
      }
      // photos
      const mine = contPhotos.filter((p: any) => p.container_loading_id === c.id)
      const photos = await Promise.all(mine.map(async (p: any) => ({
        url: await signed(p.storage_path),
        isPass: !!p.is_pass_photo, mediaType: p.media_type || 'photo', comment: p.comment || '',
      })))
      return {
        id: c.id, container_no: c.container_no || '', seal_no: c.seal_no || '',
        status: c.status || '', insp_status: c.insp_status || '',
        loading_type: type, pallet_count: d.pallet_count ?? 0,
        bl_no: d.bl_no || '', etd: d.etd || '', eta: d.eta || '', dest_port: d.dest_port || '', dep_port: d.dep_port || '', date_loaded: d.date_loaded || '',
        contents, checkPass, checkFail, failedChecks,
        disposition: c.summary?.disposition || null,
        disposition_custom: c.summary?.disposition_custom || null,
        disposition_cls: c.summary?.disposition_cls || null,
        corrective_action: c.summary?.corrective_action || '',
        photos,
      }
    }))

    // ---- translate container dynamic text (SKU text already translated upstream) ----
    let translationNote: string | null = null
    if (lang === 'de' || lang === 'zh') {
      const strings = new Set<string>()
      for (const c of containers) {
        if (c.disposition_custom) strings.add(c.disposition_custom)
        if (c.corrective_action) strings.add(c.corrective_action)
        for (const f of c.failedChecks) strings.add(f)
        for (const p of c.photos) if (p.comment) strings.add(p.comment)
      }
      const list = [...strings].filter(Boolean)
      if (list.length) {
        const { map, error } = await translateBatch(list, lang, 'po:' + po, supa)
        if (error) translationNote = error
        const tr = (s: string) => (s && map[s]) ? map[s] : s
        for (const c of containers) {
          if (c.disposition_custom) c.disposition_custom = tr(c.disposition_custom)
          if (c.corrective_action) c.corrective_action = tr(c.corrective_action)
          c.failedChecks = c.failedChecks.map(tr)
          for (const p of c.photos) if (p.comment) p.comment = tr(p.comment)
        }
      }
    }

    // ---- Consolidated report logo: AUTO-PICK ----
    // The old rule took the logo of the first wheel inspection (by part number)
    // that had one set — so a single AVO-branded inspection sorting first would
    // brand the whole consolidated report AVO. Instead we take a vote across
    // EVERY inspection and container in this PO:
    //   - an uploaded logo counts as a vote for that logo FILE PATH
    //   - NO uploaded logo counts as a vote for the default NITRA logo
    // The most common wins; a tie stays on the NITRA default. This means a
    // single stray AVO upload can't outvote a PO that is otherwise NITRA.
    // We tally report_logo_path (stable), not the per-report signed URLs (each of
    // which is unique even when two reports share the same underlying logo file).
    const DEFAULT = '__nitra_default__'
    const logoCounts = new Map<string, number>()
    const vote = (raw: unknown) => {
      const p = String(raw || '').trim() || DEFAULT
      logoCounts.set(p, (logoCounts.get(p) || 0) + 1)
    }
    for (const r of (insps || [])) vote(r?.report_logo_path)
    for (const c of (conts || [])) vote(c?.report_logo_path)

    let bestKey: string = DEFAULT
    let bestCount = -1
    let tied = false
    for (const [k, n] of logoCounts) {
      if (n > bestCount) { bestKey = k; bestCount = n; tied = false }
      else if (n === bestCount) { tied = true }
    }
    // Only an outright winner that is a real uploaded logo overrides the default.
    const chosenPath = (!tied && bestKey !== DEFAULT) ? bestKey : null
    const logoUrl = chosenPath ? await signed(chosenPath) : null
    return json({ ok: true, po, lang, translationNote, logoUrl, skus, containers })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

// Same translation+cache approach as interactive-report, keyed by an arbitrary id
// (here 'po:<PO>') so container text is only translated once per PO + language.
async function translateBatch(
  list: string[], lang: string, cacheId: string, supa: any,
): Promise<{ map: Record<string, string>; error: string | null }> {
  if (!list.length) return { map: {}, error: null }
  const source_hash = hashStrings(list)
  try {
    const { data: cached } = await supa.from('report_translations')
      .select('content_hash, payload').eq('inspection_id', cacheId).eq('lang', lang).maybeSingle()
    if (cached && cached.content_hash === source_hash && cached.payload && Object.keys(cached.payload).length) {
      return { map: cached.payload as Record<string, string>, error: null }
    }
  } catch (_) { /* best-effort */ }

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return { map: {}, error: 'no_key' }
  const obj: Record<string, string> = {}
  list.forEach((s, i) => { obj[String(i)] = s })
  const langName = lang === 'de' ? 'German' : 'Simplified Chinese'
  const system = `You are a professional translator for automotive alloy-wheel manufacturing and quality-control documents. Translate the VALUE of each entry in the given JSON object from English into ${langName}, using correct industry terminology. Do NOT translate or alter: part numbers, SKU codes, numeric measurements, units (mm, g, kg, cm), or piece references such as "#3". Preserve all numbers exactly. Some values may contain simple HTML tags (<b>, <i>, <u>, <p>, <ul>, <ol>, <li>, <br>, <span>); keep every tag exactly where it is and translate ONLY the human-readable text between the tags. Return ONLY a valid JSON object with exactly the same keys and the translated values — no markdown, no code fences, no extra commentary.`
  let parsed: Record<string, string> = {}
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, system, messages: [{ role: 'user', content: JSON.stringify(obj) }] }),
    })
    if (!resp.ok) return { map: {}, error: 'api_' + resp.status }
    const j = await resp.json()
    let text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
    text = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
    parsed = JSON.parse(text)
  } catch (_) {
    return { map: {}, error: 'translate_failed' }
  }
  const map: Record<string, string> = {}
  list.forEach((s, i) => { const t = parsed[String(i)]; if (typeof t === 'string' && t.trim()) map[s] = t })
  try {
    await supa.from('report_translations').upsert({
      inspection_id: cacheId, lang, content_hash: source_hash, payload: map, updated_at: new Date().toISOString(),
    })
  } catch (_) { /* best-effort */ }
  return { map, error: null }
}
function hashStrings(arr: string[]): string {
  const s = arr.join('\u0001')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return String(h)
}

```

### `supabase/functions/send-container-report/index.ts`

```ts
// Supabase Edge Function: send-container-report
// Emails a self-contained Container Loading report (details, contents,
// pallet packing summary, and clickable photo evidence) via Resend.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string))
const normEmails = (items: unknown): string[] => {
  if (!items) return []
  const arr = Array.isArray(items) ? items : String(items).split(',')
  return [...new Set(arr.map(v => String(v).trim()).filter(v => /.+@.+\..+/.test(v)))]
}

const CONTAINER_PHOTO_LABELS: Record<string, string> = {
  cc_exterior: 'Container Condition: Exterior', cc_interior: 'Container Condition: Interior',
  cl_empty: 'Container Loading: Empty', cl_half: 'Container Loading: Half Full', cl_full: 'Container Loading: Full',
  cl_by_size: 'Wheels loaded by size & part number', cl_box_labels: 'Box labels & hand-holes facing container door',
  cl_spares: 'Spare boxes & caps at front', cl_net: 'Protective net after loading',
}
const CONTAINER_PHOTO_ORDER = ['cc_exterior','cc_interior','cl_empty','cl_half','cl_full','cl_by_size','cl_box_labels','cl_spares','cl_net']
const PACKING_LABELS: Record<string, string> = {
  pl_grouped: 'Wheels stacked & grouped by part no.', pl_wood: 'Fumigation-free solid-wood pallet',
  pl_height: 'Height ≤254 cm, 3-inch fork gap', pl_straps: '4 straps tight', pl_wrap: 'Wrap ≥3 layers, ≥0.35 mm, tight',
  pl_label4: 'Pallet label on all 4 sides', pl_photo: 'Photo of each pallet taken',
}
const PACKING_ORDER = ['pl_grouped','pl_wood','pl_height','pl_straps','pl_wrap','pl_label4','pl_photo']
const STATUS_LABEL: Record<string, string> = { in_progress: 'IN PROGRESS', loaded: 'LOADED', hold: 'HOLD' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const { container_loading_id, emails: requestedEmails } = await req.json()
    if (!container_loading_id) return json({ ok: false, error: 'Missing container_loading_id' }, 400)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: cl } = await supa.from('container_loadings').select('*').eq('id', container_loading_id).single()
    if (!cl) return json({ ok: false, error: 'Container loading not found' }, 404)

    const [{ data: photos }, { data: inspector }, { data: reviewer }, { data: dist }] = await Promise.all([
      supa.from('photos').select('storage_path,media_type,item_key,piece_no').eq('container_loading_id', container_loading_id).order('created_at'),
      supa.from('profiles').select('full_name').eq('id', cl.inspector_id).maybeSingle(),
      cl.reviewed_by ? supa.from('profiles').select('full_name').eq('id', cl.reviewed_by).maybeSingle() : Promise.resolve({ data: null } as any),
      supa.from('settings').select('value').eq('key', 'distribution').maybeSingle(),
    ])

    const ph = (photos || []) as { storage_path: string; media_type: string; item_key: string; piece_no: number }[]
    const paths = [...new Set(ph.map(p => p.storage_path))]
    const urlMap: Record<string, string> = {}
    if (paths.length) {
      const { data: signed } = await supa.storage.from('qc-photos').createSignedUrls(paths, 60 * 60 * 24 * 7)
      for (const s of signed || []) if (s.path && s.signedUrl) urlMap[s.path] = s.signedUrl
    }
    const photosFor = (key: string, piece: number) => ph.filter(p => p.item_key === key && p.piece_no === piece)
    const linkList = (items: { storage_path: string; media_type: string }[]) =>
      items.length
        ? items.map((p, i) => `<a href="${esc(urlMap[p.storage_path] || '#')}" style="color:#1F3A5F;font-weight:600;margin-right:10px">${p.media_type === 'video' ? '🎥' : '📷'} ${i + 1}</a>`).join('')
        : '<span style="color:#C0392B">— none —</span>'

    const data = cl.data || {}
    const loadingType = data.loading_type || 'pallet'
    const palletCount = data.pallet_count || 0

    // totals
    const totals: Record<string, number> = {}
    if (loadingType === 'pallet') {
      for (let n = 1; n <= palletCount; n++) for (const c of (data.pallets?.[n]?.contents || [])) if (c.part_no) totals[c.part_no] = (totals[c.part_no] || 0) + (Number(c.qty) || 0)
    } else {
      for (const c of (data.non_pallet_contents || [])) if (c.part_no) totals[c.part_no] = (totals[c.part_no] || 0) + (Number(c.qty) || 0)
    }
    const totalsRow = Object.keys(totals).length ? Object.entries(totals).map(([p, q]) => `${esc(p)} × ${q}`).join(' · ') : '—'

    // contents section
    let contentsHtml = ''
    if (loadingType === 'pallet') {
      for (let n = 1; n <= palletCount; n++) {
        const pd = data.pallets?.[n] || { contents: [], checks: {} }
        const items = (pd.contents || []).filter((c: { part_no: string }) => c.part_no)
        const fails = PACKING_ORDER.filter(k => pd.checks?.[k] === 'F').map(k => PACKING_LABELS[k])
        contentsHtml += `<div style="border:1px solid #D5DBE4;border-radius:8px;padding:12px;margin:8px 0">
          <div style="font-weight:700;color:#1F3A5F">Pallet ${n}</div>
          <div style="font-size:13px;margin:4px 0">Contents: ${items.length ? items.map((c: { part_no: string; qty: number }) => `${esc(c.part_no)} × ${esc(c.qty)}`).join(', ') : '—'}</div>
          <div style="font-size:13px;margin:4px 0">Label photo: ${linkList(photosFor('pallet_label', n))}</div>
          <div style="font-size:13px;margin:4px 0">Packing: ${fails.length ? `<span style="color:#C0392B;font-weight:600">${fails.length} fail(s): ${esc(fails.join(', '))}</span>` : '<span style="color:#1F8A4C;font-weight:600">all OK / N/A</span>'}</div>
        </div>`
      }
    } else {
      const items = (data.non_pallet_contents || []).filter((c: { part_no: string }) => c.part_no)
      contentsHtml = `<div style="font-size:14px">${items.length ? items.map((c: { part_no: string; qty: number }) => `${esc(c.part_no)} × ${esc(c.qty)}`).join('<br>') : '—'}</div>`
    }

    const inspPhotoHtml = CONTAINER_PHOTO_ORDER.map(k =>
      `<tr><td style="padding:6px 0;color:#5A6878;width:55%">${esc(CONTAINER_PHOTO_LABELS[k])}</td><td>${linkList(photosFor(k, 0))}</td></tr>`).join('')

    const distributionEmails = normEmails(dist?.value?.emails)
    const directEmails = normEmails(requestedEmails)
    const emails = directEmails.length ? directEmails : distributionEmails
    if (!emails.includes('kyong@nitrawheels.com')) emails.push('kyong@nitrawheels.com')
    if (!emails.length) return json({ ok: false, error: 'No recipient emails provided' }, 400)

    const statusTxt = STATUS_LABEL[cl.status] || cl.status || '—'
    const signedOff = cl.insp_status === 'approved'
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:720px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">Container Loading Report</div>
</div>
<div style="background:${signedOff ? '#E3F3EA' : '#FFF6E5'};border:1px solid ${signedOff ? '#1F8A4C' : '#C99A00'};padding:12px 24px;font-weight:700;font-size:16px;color:${signedOff ? '#1F8A4C' : '#9A7400'}">${esc(statusTxt)}${signedOff ? ' · APPROVED' : ''}</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px">
  <p style="text-align:center;margin:0 0 18px"><a href="${(Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')}/container-report/${cl.id}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:13px 22px;border-radius:8px;font-weight:700;display:inline-block">Open Interactive Report (EN / DE / 中文)</a></p>
  <h3 style="color:#1F3A5F;margin:0 0 10px">Shipping &amp; Container Details</h3>
  <table style="width:100%;border-collapse:collapse;margin:0 0 8px;font-size:14px">
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5;width:18%">PO No.</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5;width:32%">${esc(cl.po_no || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5;width:18%">Container No.</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5;width:32%">${esc(cl.container_no || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Seal No.</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(cl.seal_no || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">BL Number</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.bl_no || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Loading Type</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${loadingType === 'pallet' ? 'Palletised' : 'Non-palletised'}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Date Loaded</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.date_loaded || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Est. Port Departure</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.etd || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Est. Port Arrival</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.eta || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Departure Port</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.dep_port || '—')}</td><td style="padding:7px 8px;color:#5A6878;border-bottom:1px solid #EEF1F5">Destination Port</td><td style="padding:7px 8px;font-weight:600;border-bottom:1px solid #EEF1F5">${esc(data.dest_port || '—')}</td></tr>
    <tr><td style="padding:7px 8px;color:#5A6878">Inspector</td><td style="padding:7px 8px;font-weight:600">${esc(inspector?.full_name || '—')}</td><td style="padding:7px 8px;color:#5A6878">Approved By</td><td style="padding:7px 8px;font-weight:600">${esc(reviewer?.full_name || '—')}</td></tr>
  </table>
  ${cl.summary?.corrective_action ? `<div style="background:#FBE9E7;border:1px solid #C0392B;border-radius:6px;padding:10px 12px;margin-top:14px;font-size:13px"><b>Notes:</b> ${esc(cl.summary.corrective_action)}</div>` : ''}
</div>
<div style="background:#F7F9FB;border:1px solid #D5DBE4;border-top:none;padding:12px 24px;border-radius:0 0 10px 10px">
  <p style="color:#5A6878;font-size:11px;margin:0">CONFIDENTIAL — PROPERTY OF NITRA · Photo links are private and expire after 7 days.</p>
</div></body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('REPORT_FROM_EMAIL') || 'NITRA QC <qc@nitrawheels.com>',
        to: emails,
        subject: `Container Loading — ${cl.container_no || '(no container)'} · PO ${cl.po_no || '—'} · ${statusTxt}`,
        html,
      }),
    })
    const result = await res.json().catch(() => ({}))
    return json({ ok: res.ok, emails, result }, res.ok ? 200 : 500)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

```

### `supabase/functions/send-po-report/index.ts`

```ts
// Supabase Edge Function: send-po-report
// Emails a link to the consolidated PO report (overview + every SKU & container).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string))
const normEmails = (items: unknown): string[] => {
  if (!items) return []
  const arr = Array.isArray(items) ? items : String(items).split(',')
  return [...new Set(arr.map(v => String(v).trim()).filter(v => /.+@.+\..+/.test(v)))]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  try {
    const { po, emails: requestedEmails } = await req.json()
    if (!po) return json({ ok: false, error: 'Missing po' }, 400)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const [{ data: insps }, { data: conts }, { data: dist }] = await Promise.all([
      supa.from('inspections').select('id,part_no,status').eq('po_no', po),
      supa.from('container_loadings').select('id,container_no,insp_status').eq('po_no', po),
      supa.from('settings').select('value').eq('key', 'distribution').maybeSingle(),
    ])
    const skuCount = (insps || []).length
    const contCount = (conts || []).length

    const emails = (normEmails(requestedEmails).length ? normEmails(requestedEmails) : normEmails(dist?.value?.emails))
    if (!emails.includes('kyong@nitrawheels.com')) emails.push('kyong@nitrawheels.com')
    if (!emails.length) return json({ ok: false, error: 'No recipient emails provided' }, 400)

    const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')
    const reportUrl = `${appUrl}/po-report/${encodeURIComponent(po)}`

    const rows = (insps || []).map((r: any) => `<tr><td style="padding:5px 0;color:#5A6878">${esc(r.part_no)}</td><td style="text-align:right">${esc(r.status)}</td></tr>`).join('')
    const crows = (conts || []).map((c: any) => `<tr><td style="padding:5px 0;color:#5A6878">${esc(c.container_no || '(no container no.)')}</td><td style="text-align:right">${esc(c.insp_status)}</td></tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:720px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">Consolidated PO Report</div>
</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px">
  <p style="margin-top:0">The consolidated QC report for <b>PO ${esc(po)}</b> is ready. It contains an overview plus every wheel inspection and container loading in this PO, with clickable photo/video evidence and an EN / DE / 中文 language toggle.</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0">
    <tr><td style="padding:6px 0;color:#5A6878;width:60%">Wheel inspections</td><td style="font-weight:600;text-align:right">${skuCount}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Container loadings</td><td style="font-weight:600;text-align:right">${contCount}</td></tr>
  </table>
  ${rows ? `<div style="font-size:12px;color:#5A6878;margin:6px 0 2px">SKUs</div><table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>` : ''}
  ${crows ? `<div style="font-size:12px;color:#5A6878;margin:10px 0 2px">Containers</div><table style="width:100%;border-collapse:collapse;font-size:13px">${crows}</table>` : ''}
  <p style="text-align:center;margin:26px 0"><a href="${esc(reportUrl)}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;display:inline-block">Open Consolidated PO Report</a></p>
  <p style="font-size:12px;color:#5A6878">If the button does not work, copy and paste this link into your browser:<br><a href="${esc(reportUrl)}">${esc(reportUrl)}</a></p>
</div>
<div style="background:#F7F9FB;border:1px solid #D5DBE4;border-top:none;padding:12px 24px;border-radius:0 0 10px 10px">
  <p style="color:#5A6878;font-size:11px;margin:0">CONFIDENTIAL — PROPERTY OF NITRA</p>
</div></body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('REPORT_FROM_EMAIL') || 'NITRA QC <qc@nitrawheels.com>',
        to: emails,
        subject: `Consolidated QC Report — PO ${po} · ${skuCount} SKU(s) · ${contCount} container(s)`,
        html,
      }),
    })
    const result = await res.json().catch(() => ({}))
    return json({ ok: res.ok, emails, report_url: reportUrl, result }, res.ok ? 200 : 500)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

```

### `supabase/functions/send-report/index.ts`

```ts
// Supabase Edge Function: send-report
// Sends a concise email with a secure live interactive report link.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] as string))
const normEmails = (items: unknown): string[] => {
  if (!items) return []
  const arr = Array.isArray(items) ? items : String(items).split(',')
  return [...new Set(arr.map(v => String(v).trim()).filter(v => /.+@.+\..+/.test(v)))]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  try {
    const { inspection_id, emails: requestedEmails } = await req.json()
    if (!inspection_id) return json({ ok: false, error: 'Missing inspection_id' }, 400)

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: insp } = await supa.from('inspections').select('*').eq('id', inspection_id).single()
    if (!insp) return json({ ok: false, error: 'Inspection not found' }, 404)

    const [{ data: sku }, { data: defects }, { data: inspector }, { data: reviewer }, { data: dist }] = await Promise.all([
      supa.from('skus').select('*').eq('part_no', insp.part_no).maybeSingle(),
      supa.from('defects').select('*').eq('inspection_id', inspection_id),
      supa.from('profiles').select('full_name').eq('id', insp.inspector_id).maybeSingle(),
      insp.reviewed_by ? supa.from('profiles').select('full_name').eq('id', insp.reviewed_by).maybeSingle() : Promise.resolve({ data: null } as any),
      supa.from('settings').select('value').eq('key', 'distribution').maybeSingle(),
    ])

    const distributionEmails = normEmails(dist?.value?.emails)
    const directEmails = normEmails(requestedEmails)
    const emails = directEmails.length ? directEmails : distributionEmails
    if (!emails.includes('kyong@nitrawheels.com')) emails.push('kyong@nitrawheels.com')
    if (!emails.length) return json({ ok: false, error: 'No recipient emails provided' }, 400)

    const dispositionLabel: Record<string, string> = {
      approved_loading: 'APPROVED FOR LOADING',
      hold_rework: 'HOLD FOR REWORK & REINSPECTION',
      conditional_loading: 'CONDITIONAL LOADING — FAILED PIECES EXCLUDED',
      conditional_rework: 'CONDITIONAL LOADING — REWORK REJECTED PIECES & LOAD',
      pending_customer: 'PENDING CUSTOMER APPROVAL',
    }
    const dispCode = insp.summary?.disposition || ''
    const isCustom = dispCode === 'custom'
    const disposition = isCustom
      ? (insp.summary?.disposition_custom || 'PENDING DISPOSITION')
      : (dispositionLabel[dispCode] || 'PENDING DISPOSITION')
    const dispCls = isCustom ? (insp.summary?.disposition_cls || 'pending')
      : dispCode === 'approved_loading' ? 'pass'
      : dispositionLabel[dispCode] ? 'hold'
      : 'pending'
    const dispBg = dispCls === 'pass' ? '#E3F3EA' : dispCls === 'reject' ? '#FBE9E7' : dispCls === 'pending' ? '#EEF1F5' : '#FBF3E2'
    const dispBorder = dispCls === 'pass' ? '#1F8A4C' : dispCls === 'reject' ? '#C0392B' : dispCls === 'pending' ? '#9FB0C0' : '#B7791F'
    const dispColor = dispCls === 'pass' ? '#1F8A4C' : dispCls === 'reject' ? '#C0392B' : dispCls === 'pending' ? '#5A6878' : '#8A5A0E'
    const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://nitra-qc-app.vercel.app').replace(/\/$/, '')
    const reportUrl = `${appUrl}/report/${encodeURIComponent(inspection_id)}`

    // Count CURRENTLY-failing pieces (matches the report), not raw defect rows —
    // the defects table can hold orphaned rows from amended-away fails / old 100% data.
    const fd = insp.form_data || {}
    const baseV: Record<string, string> = fd.results || {}
    const baseT: Record<string, string> = fd.meas_results || {}
    const extraV: Record<string, string[]> = fd.extra_results || {}
    const extraT: Record<string, string[]> = fd.meas_extra_results || {}
    const hundred: Record<string, Record<string, string>> = fd.hundred_pct || {}
    const keys = new Set<string>()
    for (const k of Object.keys(baseV)) keys.add(k.split(':')[0])
    for (const k of Object.keys(baseT)) keys.add(k.split(':')[0])
    for (const k of Object.keys(hundred)) keys.add(k)
    let defectCount = 0
    for (const key of keys) {
      let baseFailN = 0
      for (const [k, v] of Object.entries(baseV)) if (k.split(':')[0] === key && v === 'F') baseFailN++
      for (const [k, v] of Object.entries(baseT)) if (k.split(':')[0] === key && v === 'F') baseFailN++
      const exFail = (extraV[key] || extraT[key] || []).some((v: string) => v === 'F')
      const triggers100 = baseFailN >= 2 || (baseFailN >= 1 && exFail)
      const merged: Record<number, string> = {}
      if (triggers100) for (const [pc, v] of Object.entries(hundred[key] || {})) { if (v === 'P' || v === 'F') merged[Number(pc)] = v }
      for (const [k, v] of Object.entries(baseV)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) merged[Number(k.split(':')[1])] = v }
      for (const [k, v] of Object.entries(baseT)) { if (k.split(':')[0] === key && (v === 'P' || v === 'F')) merged[Number(k.split(':')[1])] = v }
      defectCount += Object.values(merged).filter((v) => v === 'F').length
    }
    void defects
    let logoHtml = '<div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:1px">NITRA</div>'
    if (insp.report_logo_path) {
      const { data: lu } = await supa.storage.from('qc-photos').createSignedUrl(insp.report_logo_path, 60 * 60 * 24 * 7)
      if (lu?.signedUrl) logoHtml = `<img src="${lu.signedUrl}" alt="logo" style="max-height:46px;max-width:240px;display:block" />`
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#18222E;max-width:720px;margin:0 auto;padding:20px;background:#F4F7FA">
<div style="background:#1F3A5F;padding:20px 24px;border-radius:10px 10px 0 0">
  ${logoHtml}
  <div style="color:#9FB6D4;font-size:14px;margin-top:4px">QC Interactive Report</div>
</div>
<div style="background:${dispBg};border:1px solid ${dispBorder};padding:12px 24px;font-weight:700;font-size:16px;color:${dispColor}">${esc(disposition)}</div>
<div style="background:#fff;border:1px solid #D5DBE4;border-top:none;padding:22px 24px">
  <p style="margin-top:0">A NITRA QC inspection report is ready for review. Click the button below to open the live interactive report with clickable photo/video evidence.</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0 20px">
    <tr><td style="padding:6px 0;color:#5A6878;width:38%">Part No.</td><td style="font-weight:600">${esc(insp.part_no)}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Model / Size</td><td>${esc(sku?.model||'—')} ${esc(sku?.size||'')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">PO No.</td><td>${esc(insp.po_no||'—')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Batch</td><td>${esc(insp.batch||'—')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Lot size</td><td>${esc(insp.lot_size)} pcs</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Defects logged</td><td style="font-weight:600;color:${defectCount>0?'#C0392B':'#1F8A4C'}">${defectCount}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Inspector</td><td>${esc(inspector?.full_name||'—')}</td></tr>
    <tr><td style="padding:6px 0;color:#5A6878">Approved by</td><td>${esc(reviewer?.full_name||'—')}</td></tr>
  </table>
  <p style="text-align:center;margin:26px 0"><a href="${esc(reportUrl)}" style="background:#1F3A5F;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;display:inline-block">View Full Interactive Report</a></p>
  <p style="font-size:12px;color:#5A6878">If the button does not work, copy and paste this link into your browser:<br><a href="${esc(reportUrl)}">${esc(reportUrl)}</a></p>
</div>
<div style="background:#F7F9FB;border:1px solid #D5DBE4;border-top:none;padding:12px 24px;border-radius:0 0 10px 10px">
  <p style="color:#5A6878;font-size:11px;margin:0">CONFIDENTIAL — PROPERTY OF NITRA</p>
</div></body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('REPORT_FROM_EMAIL') || 'NITRA QC <qc@nitrawheels.com>',
        to: emails,
        subject: `QC Interactive Report — ${insp.part_no} · ${disposition} · PO ${insp.po_no || '—'}`,
        html,
      }),
    })
    const result = await res.json().catch(() => ({}))
    return json({ ok: res.ok, emails, report_url: reportUrl, result }, res.ok ? 200 : 500)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

```


---

## 9g. Recent change logs (v81–v86 — the offline work). Earlier CHANGES_v7..v80 exist in the repo root but are omitted here to keep this file focused on current work.

### `CHANGES_v81.md`

```markdown
# v81 — B6 Stage 2, batch 2: connectivity awareness

First frontend slice of Stage 2. The app now *knows and shows* whether the
device is actually reachable to the server. Nothing about inspecting or saving
changes yet — this is the foundation the write-queue / offline-creation batches
build on.

## What's new
- **`src/lib/connectivity.ts`** — a `useOnline()` hook + `pingReachable()`.
  - Treats `navigator.onLine === false` as an immediate "offline" signal, but
    confirms the *positive* case with a lightweight reachability ping to the
    Supabase GoTrue health endpoint. This catches warehouse Wi-Fi that is
    "connected" but has no working internet (captive portal / dead uplink).
  - Ping uses `mode:'no-cors'` (we only care that the round-trip completes,
    not the body) with a 5s timeout and a cache-buster; re-checks every 30s,
    on the browser online/offline events, and when the tab becomes visible.
  - Never throws; safe against setState-after-unmount.
- **Header pill** — a small bilingual status badge in the top bar:
  **Online / 在线** (green) or **Offline / 离线** (grey). Always visible.
  - i18n keys `online` / `offline` added.
  - `.netpill` styles added to `index.css`.

## DB (already deployed separately)
- **Migration 22** (`supabase/22_migration.sql`) — server-authoritative
  `updated_at` trigger on `inspections` + `container_loadings`. Included here
  for repo history; it was run in the SQL Editor in the previous batch.

## Not in this batch (coming next)
- Write queue (retry-safe, idempotent sync)
- Offline creation of inspections (client-minted UUIDs)
- Reference-data caching
- Conflict / merge screen

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test (on the iPad, after Pipeline A + reinstall)
- Put the iPad in airplane mode → the header pill flips to **Offline / 离线**.
- Turn it back on → within a few seconds it flips to **Online / 在线**.
- Switch the app language → the pill reads 在线 / 离线.

```

### `CHANGES_v82.md`

```markdown
# v82 — two live-use bug fixes

## Bug 1 — Add Ordered Item: searchable part-number dropdown
The "Add Ordered Item" form (PoInfo) used a plain text box. It now uses the same
searchable **PartPicker** dropdown as the container flow — type to narrow to the
closest part number from the SKU master.
- New `allowFreeText` prop on `PartPicker`: suggestions appear as you type, but a
  part number that isn't in the SKU master yet is still allowed (typed text
  propagates live). Existing PartPicker usages (container flow) are unchanged —
  the prop defaults off.

## Bug 2 — Offline "All Pass / All Fail" no longer crashes the screen
Previously, tapping All Pass/All Fail (or any save) while offline threw the raw
error *"Save failed: TypeError: Load failed"*, and the follow-up reload — which
also failed offline — replaced the working inspection with a full-page
"could not load" error, stranding the user.

Root cause: save/reload treated an offline network failure like a fatal
server/not-found error. Fix (defensive hardening in `Inspection.tsx`):
- `isNetworkErr()` distinguishes an offline/network failure from a real error.
- A failed **reload** while offline now keeps the working screen (and the user's
  optimistic edits) instead of the dead-end error page. A full successful load
  arms this (`loadedOnceRef`).
- A failed **save** while offline shows a calm banner —
  *"You're offline — changes are saved on this device and will sync when the
  connection is back."* — instead of the scary alert. Real (non-network) errors
  still alert.
- Submitting while offline shows a clear "reconnect to submit" message.
- The Stage 1 local-draft safety net (v77) already snapshots the work on-device,
  so nothing is lost.

### Scope note (honest)
v82 stops the crash and preserves offline work **on the device**. It does NOT yet
auto-push offline edits to the server, and it does NOT resolve the two-user
shared-SKU clash (online All Pass vs offline All Fail). Those are the next
batches: the **write queue** (real sync) and the **conflict layer** (flag for
review, never overwrite).

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0
- (Pre-existing lint errors under other rules remain, untouched.)

## Test
- **Bug 1:** PO page → Add Ordered Item → start typing a part number → the
  dropdown narrows the SKU list; you can also type a brand-new part number.
- **Bug 2:** open a wheel inspection while online, then go offline (airplane
  mode) → tap All Pass / All Fail → the taps stay on screen, a calm offline
  banner appears, and you are NOT thrown to an error page. Back online, the next
  save goes through.

```

### `CHANGES_v83.md`

```markdown
# v83 — B6 Stage 2, batch 3: offline read foundation (part 1)

The "read side" of offline: stay logged in with no signal, and keep working
reference data on the phone. This is the foundation the write-queue and
offline-creation batches sit on.

## What's new

### 1. Fixed the false offline logout
Previously, going offline and navigating could bounce a logged-in inspector to
the Login screen. Root cause: the app re-fetched your profile on navigation;
offline that fetch returned nothing, and the code misread "couldn't load
profile" as "no user."
- The signed-in profile is now cached (`nitra_profile`).
- If the profile fetch fails while offline/network-down, the app keeps the
  cached profile instead of logging you out.
- Only a genuine sign-out (`SIGNED_OUT` event) actually logs you out — a
  transient null session (e.g. a failed token refresh offline) no longer does.

### 2. Reference-data cache (`src/lib/refCache.ts`)
A fail-safe key/value cache in IndexedDB (separate DB from the Stage 1 drafts),
with a read-through pattern: refresh from the server when online, fall back to
the on-device copy when offline.

### 3. SKU master + sampling settings cached
- **New Inspection** form and the **PartPicker** dropdown now cache the full
  active SKU list and the sampling settings, so offline the part-number list and
  sample-size calculation still work. The whole SKU master is cached (at your
  scale — hundreds to a few thousand — this is ~1–3 MB, trivial for IndexedDB),
  so offline you can pick ANY part whether or not a PO exists.

## Scope note (honest)
- This is **part 1** of the read foundation. **PO-page offline caching**
  (the PO detail + ordered items) is deliberately held for the next batch (v84),
  so that change can be tested in isolation on the admin-heavy PO screens.
- Reads are cached; offline **saving/sync** is still the later write-queue batch.
- A device must have been online at least once (to populate the cache) for the
  offline reads to have anything to show. If the phone is offline long enough
  that the login token fully expires, a reconnect may still be needed to re-auth.

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test
1. Log in online, open **New Inspection** once (so the SKU list caches).
2. Switch to airplane mode.
3. Navigate around → you stay **logged in** (no bounce to Login).
4. Open **New Inspection** → the part-number list still shows, and picking a
   part still shows sample sizes.

```

### `CHANGES_v84.md`

```markdown
# v84 — fix: Add Ordered Item part-number dropdown was clipped

## Bug
On the PO page, "Add Ordered Item" showed no part-number list even online. The
v82 fix (wiring the searchable PartPicker into that form) was correct, but the
dropdown was being **clipped by the modal**: `.modal` has `overflow-y: auto`, and
the picker's dropdown drops *below* the input, so inside that short popup the
list was cut off to nothing.

## Fix (PoInfo add-item modal only)
- The add-item modal now uses `overflow: visible` so the dropdown can paint past
  the modal edge.
- The part-number field is given its own stacking context so the dropdown paints
  cleanly over the quantity field beneath it.
- No other modal is touched.

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test (online)
- PO page → Add Ordered Item → tap the Part Number field → the SKU list should
  now appear; typing narrows it; you can also type a brand-new part number.

## Note
This is a focused online bug fix. The **PO-page offline caching** (the "PO page
empty offline" symptom) is the next batch — now **v85**.

```

### `CHANGES_v85.md`

```markdown
# v85 — fix: SKU list now caches proactively (offline New Inspection)

## Problem found in v83 testing
The New Inspection part-number list was still empty offline. Root cause: v83
cached the SKU list *lazily* — only if you had opened the New Inspection screen
while online first. The normal flow (login → PO → airplane → Add SKU) never
opened that screen online, so its cache was never filled.

## Fix
`warmRefCache()` in `refCache.ts`, called from `App.tsx` whenever you are
**logged in and online**. It proactively downloads and stores:
- the full SKU master (for the New Inspection form),
- the 4-column SKU subset (for the PartPicker dropdown),
- the sampling settings.

So the SKU list is on the phone no matter which screen you open first, and it
refreshes every time you're online (and again the moment connectivity returns).

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test
1. Log in **online** (just being logged in and online warms the cache — you no
   longer need to open New Inspection first).
2. Open a PO while you still have signal, then switch to **airplane mode**.
3. Tap **Add SKU** → New Inspection → the part-number list should now show and be
   searchable, and picking a part + entering a lot size still calculates the
   Appearance / Functional sample sizes.

## Still expected offline (next batch, v86)
- The **PO list and PO detail pages are still empty** when you navigate to them
  fresh while offline. That's the PO-page caching batch (v86).
- Saving/starting an inspection offline still won't sync — that's the write-queue
  batch after v86.

## Deploy
Pipeline A only (no Supabase SQL, no PowerShell). Extract → commit + push →
Vercel → delete + reinstall the PWA on the phone.

```

### `CHANGES_v86.md`

```markdown
# v86 — B6 Stage 2: offline inspection creation + auto-sync (write side)

You can now **start and fill in a wheel inspection while offline**, and it uploads
itself when you're back online.

## What's new
- **Start Inspection works offline.** `NewInspection` mints the inspection's id on
  the device (client-minted UUID — inserts cleanly on sync, verified against the
  live INSERT RLS), saves it on the phone, and opens it. You fill it in exactly
  like normal (v82 hardening handles the offline edits).
- **The inspection screen loads an offline-created inspection** from the phone when
  the server doesn't have it yet, resolving the SKU from the offline cache.
- **A "⏳ Not synced yet" banner** marks an inspection that only exists on the phone.
- **Auto-sync on reconnect.** When connectivity returns, the inspection (and its
  results) uploads and its defect rows are rebuilt from the recorded Fails
  (base + extra pieces), then it becomes a normal live inspection. The open screen
  syncs itself (capturing in-flight edits); the app also syncs any offline-created
  inspections in the background.
- **New module** `src/lib/offlineSync.ts` (pending store + queue + sync).

## Data-integrity hardening (from an adversarial review)
- Sync is **scoped to the logged-in inspector** (a foreign device-shared pending
  row is never mis-uploaded / RLS-rejected).
- The open inspection syncs itself and the batch sync **skips it** — no two-writer
  race; while pending, saves go to the local copy, not a doomed server write.
- **Extra-piece** Fails are included in the rebuilt defect list.
- **Start is blocked until sampling settings are available** (no 0-sample
  inspections) — connect once so they cache, then offline start works.

## No Supabase / PowerShell
Pipeline A only. No migration (migration 22 + the existing INSERT RLS already
support client-minted ids). Extract → commit + push → Vercel → delete + reinstall
the PWA.

## Test
1. Log in **online** (warms the SKU + settings cache). Open a PO while online.
2. Switch to **airplane mode**.
3. **Add SKU** → pick a part + lot size → **Start Inspection** → it opens with the
   **⏳ Not synced yet** banner.
4. Record some Pass/Fail results (they stay; no crash).
5. Turn airplane mode **off**. Within a few seconds the banner clears — the
   inspection is now on the server with its results, appears in the PO / lists, and
   any Fails have defect rows.

## Still NOT covered (next batches — expected)
- **Offline photos/videos** — taking photos offline is the next stage (Stage 3).
- **Two-user shared-SKU clash** (online Pass vs offline Fail) — the conflict batch.
- **Offline container-loading creation** — quick follow-up after the wheel flow.
- An offline-created inspection **isn't listed on other screens until it syncs**
  (reach it right after creating it; after reconnect it appears normally).
- **Submitting for approval** needs a connection — reconnect and let it sync (the
  banner clears) first.

```
