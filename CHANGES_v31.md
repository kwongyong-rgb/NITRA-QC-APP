# NITRA QC App — v31 (Batch 4.2: PO hub + Home → PO list)

The app is now organised around the PO, as agreed.

## Home is now a PO list
- Home shows one row per PO, each with a count of wheel inspections and container
  loadings, newest first. Tap a PO to open its hub.
- "＋ New PO" asks for a PO number and opens its (empty) hub.
- Legacy items with no PO appear under "(No PO)".

## PO hub  (/po/:poNo)
- Header with the PO and its counts.
- "Wheel inspections" — lists the SKU inspections for this PO; "＋ Add SKU" opens a
  new inspection with the PO pre-filled and locked.
- "Container loadings" — lists the containers for this PO; "＋ Add container" creates
  one already tied to this PO.
- Delete (🗑) on each item (approver always; inspector on their own drafts).
- "Consolidated PO report" button is a placeholder — that's the next step (4.3/4.4).

## SKU inspection
- The Pallet tab has been removed from the wheel inspection. Pallet packing now lives
  entirely in the Container Loading record (where it's done physically). Existing
  pallet data is untouched in the database; it's just no longer shown there.

## Other
- The temporary "＋ Container (beta)" header link is gone — containers are created
  from inside a PO hub now.

Changed: pages/Home.tsx, pages/PoHub.tsx (new), pages/Inspection.tsx (pallet tab
removed), pages/NewInspection.tsx (preset PO), pages/ContainerLoading.tsx (preset PO),
App.tsx (route + link). No migration, no edge-function change.

## Deploy
Vercel only: replace files, commit, push. Then reinstall the PWA.

## Verified
- tsc -b: 0 errors.

## Next
4.3 approver sign-off + email for a container · 4.4 consolidated PO report.
