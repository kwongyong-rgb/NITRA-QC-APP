# v68 — Phase 3: Customer dashboard + data lockdown

## New
- **Customer dashboard** (`CustomerHome.tsx`): assigned POs with PO date,
  destination, SKU count, inspection status, final disposition, and a button
  to the public consolidated report. Trilingual EN / DE / Canadian French
  (persisted per device). Customers see this instead of the staff app.
- **Migration 19 — customer lockdown** (restrictive-policy strategy, so
  pre-existing policies keep working untouched):
  - `is_staff()` / `is_customer()` / `customer_can_see_po*()` helper functions
  - pos + po_items scoped: staff see all, customers see assigned POs only
  - customers may read APPROVED inspections/loadings of assigned POs only
  - customers hard-blocked from skus, settings, defects, photos,
    custom_dispositions, report_translations, and the qc-photos bucket
  - customers cannot insert/update/delete inspections or loadings
    (per-command restrictive policies)

## Notes
- No edge-function deploys in this phase.
- The public consolidated report page itself is unchanged (same page you
  email today).
