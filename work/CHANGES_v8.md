# NITRA QC App — v8 (bug fixes on v7)

## Fix 1 — New Inspection "No matches" dropdown stuck open
- src/pages/NewInspection.tsx
  - The SKU search no longer filters against the full selected label, so picking a
    SKU never shows "No matches".
  - Added click-outside handling to close the dropdown reliably.

## Fix 2 — "Start Inspection" did nothing / blank
- src/pages/NewInspection.tsx — start() now shows the actual database error in an
  alert instead of failing silently, and only navigates on success.
- src/pages/Inspection.tsx — if the inspection or its SKU can't be loaded, the page
  now shows the reason instead of hanging on "Loading…".

## Safety net (new)
- src/components/ErrorBoundary.tsx — any render crash now shows a readable error
  message (screenshot-able) instead of a blank white screen.
- src/App.tsx — routes wrapped in the ErrorBoundary.

## Verified
- tsc (strict project config) passes with 0 errors.
