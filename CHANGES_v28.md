# NITRA QC App — v28 (Batch 4.1: Container Loading form + data model)

First piece of Batch 4. A Container Loading is now its own PO-scoped record,
separate from the per-SKU wheel inspection.

## What's in it
- New `container_loadings` table (PO no, container no, seal no, status, data,
  disposition, approval fields) + RLS, and photos can now attach to a container
  loading (migration 07).
- New Container Loading form:
  - PO number, Container number, Seal number, Status (In progress / Loaded / Hold).
  - Pallet Packing, pallet-by-pallet (1–22). Each pallet card has:
      • Pallet label photo (required prompt)
      • Contents: Part no. + Quantity rows (pick from your SKUs or free-type; add
        as many part numbers as a pallet holds)
      • Packing checks (P / F / NA + camera per check)
  - Container's loaded contents auto-total across pallets (rolled up by part no.).
  - Container Loading checks (container condition/empty, labels face doors, no
    loose wheels, spares at front, net/rope) with P/F/NA + camera.
  - Corrective action / notes + Submit for approval.
- Reachable for testing via the "＋ Container (beta)" link in the top menu.

## Deploy
1. Supabase SQL Editor: run `07_migration.sql`  ← creates the table + photo link
2. Vercel: replace files, commit, push.
(No edge-function change this step.)

## Verified
- tsc -b: 0 errors.

## Coming next in Batch 4
4.2 PO hub + Home→PO list (and the Pallet tab leaves the SKU inspection) ·
4.3 approver sign-off + email for containers · 4.4 consolidated PO report.
