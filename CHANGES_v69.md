# v69 — Phase 4: Loading workflow

## New
- **PartPicker** (`src/components/PartPicker.tsx`): mobile-first searchable
  part-number selector (searches part no / model / size / finish, big touch
  targets). Used for pallet AND non-pallet contents. When the PO has an
  ordered-items list, PO parts sort first with an "ON PO" badge; picking an
  off-PO part warns "not listed on the selected PO — continue anyway?" and the
  content row is flagged (off_po) for reporting.
- **AI pallet-label scan**: new `ocr-label` edge function (staff-only, Claude
  vision, prompt tuned to the NITRA pallet-label template). Taking a label
  photo auto-triggers a scan; a "Scan label with AI" button re-scans the most
  recent label photo. Extracted part number / qty / pallet no open in an
  editable review with warnings (part not on PO; quantity exceeding ordered vs
  already-recorded in this container; unreadable fields). Confirm appends to
  the pallet contents and stores a label_scan record (raw OCR text, confirmed
  values, timestamp, inspector) in the pallet data — nothing is auto-saved.
- **Temp-password UX**: replaced the one-shot popup with a persistent
  "User created" modal showing email + password with a copy button.

## Fixed
- `19_migration.sql` in the repo updated to the corrected (conditional)
  version that actually ran in production.

## Deploy
- PowerShell: `supabase functions deploy ocr-label --project-ref nzzktgstpifevaqyapyw`
  (KEEP jwt — staff-only function)
- App: push -> Vercel -> reinstall PWA.
- No SQL this phase (pallet scan data lives in the existing JSON column).
