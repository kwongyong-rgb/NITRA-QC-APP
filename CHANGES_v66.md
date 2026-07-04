# v66 — Phase 1: PO master data (PO-centered rebuild)

## New
- **`pos` + `po_items` tables** (migration `supabase/17_migration.sql`):
  PO master record (customer name, PO date, destination) and the ordered
  part-number/quantity list. BACKFILLS a pos row for every PO number already on
  inspections or container loadings. The migration only creates tables and
  inserts rows — no existing inspection/report data is modified or deleted.
  Write access is restricted by RLS to the approver role (policies already
  accept 'admin' too, so the Phase 2 rename won't break them).
- **PO creation form** (Home, approver): PO number, customer, PO date,
  destination — replaces the bare "enter PO number" prompt. Inspectors keep the
  quick prompt (they can't edit master data). POs created ahead of any
  inspection now appear in the Home list, annotated with customer → destination.
- **PO information card** (PO page): shows customer / date / destination;
  approver can edit. A pos row is lazily created when an approver opens an old
  PO that predates Phase 1.
- **Ordered items card** (PO page): part numbers with Ordered / Loaded /
  Remaining quantities. Loaded is computed from confirmed container-loading
  contents for the PO; over-shipment shows a red warning. Approver can add,
  edit, and remove items inline.
- **Excel item upload** (approver): flexible header matching (Part No / Part
  Number / SKU …, Qty / Quantity …), tolerant of files without headers, always
  goes through an editable review screen before anything is saved. Upserts by
  part number (re-upload updates quantities).

## Behaviour notes
- "Delete entire PO" (approver) now also removes the PO master row and its
  item list, in addition to the inspections/loadings it already removed.
- No edge-function changes in this phase. No breaking changes to inspector flows.

## Deploy
1. SQL: Dashboard → SQL Editor → paste `supabase/17_migration.sql` → Run
   ("Success. No rows returned" = OK).
2. App: push to GitHub → Vercel → reinstall PWA on iPad.
   (No `supabase functions deploy` needed this time.)
