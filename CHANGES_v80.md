# v80 — Shared SKU inspections (frontend)

Builds on migration 20's inspection_pos junction. One wheel inspection can now
cover multiple POs; per-PO quantities stay in each PO's ordered items.

## Needs before deploy
- **Run migration 21** (auto-link trigger + idempotent re-backfill) — inline in chat.
- **Pipeline B deploy** two edge functions: `po-report` and `interactive-report`
  (both `--no-verify-jwt`).
- **Pipeline A** for the app.

## What shipped
- `src/lib/inspectionPos.ts` — junction helpers (link/list/eligible/attach/detach,
  and delete-with-orphan-cleanup).
- **Two assignment entry points:**
  - `AttachInspectionModal` — "🔗 Attach inspection" on the PO page: pull an
    approved inspection of a SKU this PO ordered (toggle to show off-PO SKUs).
  - `SharedPosCard` — "Shared with POs" on the inspection page: add/remove POs.
- **Off-PO override:** attaching a SKU not on a PO's order sets the `off_po` flag
  and shows the ⚠ NOT ON PO badge (matching the existing container-loading pattern).
- **Junction-aware reads:** PO page inspection list, PO status strip (Inspection
  stage), and the consolidated PO report all read through the junction, so shared
  inspections appear under every PO they cover.
- **Junction-aware delete:** removing an inspection from a PO — or deleting a whole
  PO — detaches the link and deletes the inspection only if it's orphaned (no other
  PO). Shared inspections survive.
- **Privacy wall in reports:** the consolidated report renders each inspection under
  the viewing PO; `interactive-report` now takes a `po` param so a shared inspection
  never shows another customer's PO number. (RLS from migration 20 already blocks
  the data; this closes the display.)
- `MyWork` unchanged (filters by inspector, not PO).

## Build gate
- `tsc -b` clean; `vite build` OK; `rules-of-hooks`: 0.
