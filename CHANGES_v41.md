# NITRA QC App — v41 (approver can amend existing SKU reports)

The approver now has an amend path on any wheel inspection report, regardless of
status (including approved) — without unlocking the recorded pass/fail results.

## What the approver can do
- "✎ Amend PO / Part No. (approver)" button in the report header opens a dialog to:
  1. Fix the PO number (re-files the report under the correct PO on Home / the hub).
  2. Re-assign the part number — pick from the SKU list (type-ahead). The part must
     exist as a SKU; the report then shows that SKU's specs/targets. Recorded
     results and photos are kept.
- Photos tab: the per-photo ↻ Reassign, ⧉ Copy and 🗑 Delete controls are now
  available to the approver too (previously inspector-only on drafts), so pictures
  can be re-assigned to the correct parameters.

Recorded P/F marks, measured values and the 100% tab are NOT opened up — only PO,
part number and photo assignment, as requested. Amending does not change the
approval status.

Changed: pages/Inspection.tsx only.

## Deploy
Vercel only: replace files, commit, push. (No migration; report functions unchanged.)

## Verified
- tsc -b: 0 errors.

## Note
"Re-assign pictures" here means moving a photo to the correct parameter within the
same report (the existing ↻ Reassign). If you also need to move photos BETWEEN
different reports, that's a separate feature — tell me and I'll add it.
