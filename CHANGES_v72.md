# v72 — Hotfix + B1: Inspector shell

## Fixed (hotfix)
- **Container loading page crash** (React error #310): the QW-1 email-modal
  state hooks were placed after the page's early "Loading…" returns, breaking
  React's hook-order rules the moment the page rendered with data. Hooks moved
  above the guards. All touched pages now pass the react-hooks lint rule
  (added to the pre-ship checks going forward).

## New (B1 — inspector shell)
- **Bottom tab bar for inspectors**: POs · My Work · Reference, thumb-height,
  active-tab indicator, safe-area aware. Hidden on inspection/container work
  screens so it never stacks with the sticky action bars. Admin and customer
  layouts unchanged (admin shell is B3).
- **My Work page** (`/mywork`): the inspector's open items in priority order —
  "Returned to you" first (amber card, with the admin's return note inline),
  then "In progress" drafts. Self-serve model: no assignment concept, per
  decision.

## Deploy
- App only: push -> Vercel -> reinstall PWA. No SQL. No edge functions.
