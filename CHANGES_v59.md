# NITRA QC App — v59 (Container report buttons: match wheel report layout)

Consistency pass on the Container Loading page so the report controls mirror the wheel
Inspection Report tab.

## Change
- The container report actions now live in their own "Container Loading Report" card,
  laid out exactly like the wheel report:
  - Header row: title on the left, then "View Interactive Report" + "PDF Report" (ghost)
    + "Email Interactive Report" (solid) on the right — same button sizing as the wheel
    Inspection Report tab.
  - Logo controls below (approver only): 🖼 Set/Change report logo · 🪄 Logo cut-out
    background · Reset logo — same ghost-button styling as the wheel approver toolbar.
- The submit + approver sign-off workflow is now its own "Submit & Sign-off" card,
  separate from the report actions (matching how the wheel keeps workflow and report
  output apart).

## Files
- src/pages/ContainerLoading.tsx

## Deploy
Vercel only (replace files, commit, push, hard-refresh). No migration, no edge function.
If you have NOT yet deployed v58, deploy that first (it has migration 16 + the
container-report / send-container-report functions this layout depends on).

## Verified
- tsc -b: 0 errors.
