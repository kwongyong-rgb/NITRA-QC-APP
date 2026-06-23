# NITRA QC App — v42 (approver: full edit + amend authority on SKU reports)

## Approver can now edit everything, any status
On any wheel inspection (draft / submitted / approved / rejected) the approver can
edit all results — Visual / Technical / 100% P/F/NA, measured values, defects,
disposition, corrective action — plus photo reassign / copy / delete. (The
inspector's own editing is unchanged: draft or rejected, on their own reports.)

## Status controls (approver, in the report header)
- Submitted → "↩ Return to inspector" (sets it back to draft so the inspector can
  amend again — your "recede").
- Approved → "↩ Re-open to draft" (send back for re-work) and "📧 Re-send report".
- "✎ Amend details (approver)" dialog now covers PO, Part No (type-ahead from SKUs),
  Batch, Lot size, App sample, Fun sample.

## Approved reports stay approved when amended (option c)
Editing an approved report keeps it Approved and adds a visible
"✎ Amended by <name> · <date>" line in the header, with a "history" toggle showing
the change log (who / when / what). Amend events are recorded for results, header
changes, status changes and photo operations.

## Re-send prompt
After amending an already-approved report via the dialog, you're asked whether to
re-send the updated report to the distribution list. (A re-send button is also on
every approved report.) Note: an already-emailed report link reads live data, so
the customer sees amendments when they re-open it regardless.

The audit trail is internal (in-app); the customer report does not print "amended by".

Changed: pages/Inspection.tsx; new supabase/11_migration.sql.

## Deploy
1. Supabase SQL Editor: run 11_migration.sql
2. Vercel: replace files, commit, push.
(No edge-function change.)

## Verified
- tsc -b: 0 errors.
