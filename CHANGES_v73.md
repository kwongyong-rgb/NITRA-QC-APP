# v73 — B2 (inspection stepper) + B3 (admin shell)

## B2 — Inspection stepper
- The inspection tab bar is now an ordered stepper with live completion
  states per step: ✓ complete (green) / ● partial (amber) / ○ not started.
  Steps numbered 1..5: Visual, Technical, Photos, Inspection Report, and 100%
  Inspection (⛔, shown only when triggered — treated as "partial" until its
  trigger is resolved). Visual/Technical completion is computed across ALL
  sample pieces, so ✓ genuinely means "this step is finished", pairing with
  the QW-2 sticky bar's per-piece detail. Tap any step to jump — wizard for
  new users, tabs for power users.

## B3 — Admin shell
- **Left sidebar** (admin, screens ≥900px): Dashboard · POs · Approvals
  (with a live awaiting-approval badge) · Users · SKUs · Reference · Settings.
  Top-bar buttons hide when the sidebar shows; the burger-menu top nav remains
  on narrower screens, and inspector/customer layouts are untouched.
- **Admin Dashboard** (/dashboard): "Awaiting your approval" card (direct
  links into each submitted item, amber-framed when non-empty), PO count card
  (links to the list), work-in-progress count, "Recently approved" (last 5),
  and quick actions (New PO / Add user / Manage SKUs).

## Fixed during build
- A wrapper mis-insertion briefly broke the public report routes in App.tsx
  (Python replace-all hit two blocks); caught by tsc before packaging and
  corrected — public report pages verified building cleanly.

## Deploy
- App only: push -> Vercel -> reinstall PWA. No SQL. No edge functions.
