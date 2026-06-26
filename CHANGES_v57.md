# NITRA QC App — v57 (Container Loading page changes — batch part 1/3)

This is the first of three parts for the container + consolidated-report batch. It only
changes the Container Loading inspection PAGE. The two bigger pieces — the Container
Loading INTERACTIVE REPORT (with PDF / email / logo controls) and the consolidated-report
rework — are the next two builds, because the consolidated report's "click Container #"
link must point at the container report, which doesn't exist yet.

## Changes (Container Loading page)
- Removed the "Disposition" box (the corrective-action / disposition notes field). The
  submit + approver sign-off + email controls stay, now under a "Submit & Report" card.
- New "Shipping Details" card with six fields: Date Loaded, BL Number, Estimated Port
  Departure Date, Estimated Port Arrival Date, Departure Port, Destination Port. (Stored
  in the loading's data — no migration needed.)
- Loading-type section headers renamed: "SKUs Loaded: Pallet Loading" /
  "SKUs Loaded: Non-Pallet Loading".

## Files
- src/pages/ContainerLoading.tsx

## Deploy
Vercel only: replace files, commit, push, hard-refresh. (No migration, no edge function.)

## Verified
- tsc -b: 0 errors.
