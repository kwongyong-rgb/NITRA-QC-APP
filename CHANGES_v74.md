# v74 — B4: PO command center

## What shipped
**PO status strip** (`PoStatusStrip` + shared `lib/poStatus.ts`) at the top of
the PO page: four stages, left to right —

    Items ▸ Inspection ▸ Loading ▸ Loaded

plus a de-emphasised, dashed "Shipping — separate app" cap marking where this QC
app's job ends and the (separate, to-be-merged) shipping app takes over. Stages
are a list, not hard-coded boxes, so appending shipping stages later is small.

A stage is `done` only when its records are **approved** (not merely submitted):
- **Items** — order list entered (>=1 `po_items` row).
- **Inspection** — every wheel inspection for the PO is approved.
- **Loading** — every container-loading inspection for the PO is approved.
- **Loaded** — every ordered piece is covered by **approved** container loadings
  (Remaining = 0); shows `loaded/ordered`. Multi-container POs stay "partial"
  until the last approved loading lands.

**Customer access card** (`CustomerAccessCard`), admin-only: grant/revoke which
customer accounts may view this PO. Writes the existing `po_access` table (same
one the Users page uses, keyed by PO). Customer list via the `manage-users`
`list` action (includes email + active). Immediate single-row insert/delete.

## Fix vs the scaffolded draft
The draft's **Loaded** stage summed loaded qty across ALL container loadings
regardless of approval, and flagged approved-vs-all as an open question. That
question was answered in discussion: approved = loaded. Corrected `computeStages`
to count **approved loadings only**, so Loaded can't complete before the loading
inspection is signed off.

## Scope / safety
- **No migrations. No edge-function deploys.** App-only (Pipeline A).
- `PoInfo` shares `sumLoadedByPart`; its Ordered/Loaded/Remaining **table** is
  unchanged (still counts all recorded loadings — see below).
- Files: `src/lib/poStatus.ts` (new), `src/components/PoStatusStrip.tsx` (new),
  `src/components/CustomerAccessCard.tsx` (new), `src/pages/PoHub.tsx`,
  `src/pages/PoInfo.tsx`, `src/index.css`.

## Open question (flagged)
Strip **Loaded** = approved-only; PoInfo **table** = all recorded loadings. They
agree except while a loading is recorded-but-unapproved. Want the table to also
count approved-only (fully consistent)? One-line change in `PoInfo` — say so.

## Build gate
- `tsc -b` clean; `vite build` OK (dist + PWA generated).
- `rules-of-hooks`: 0 across src.
- Remaining lint (`set-state-in-effect`, `no-explicit-any`) = pre-existing
  codebase-wide pattern (present in untouched v73 pages); not in the Vercel
  build script.
