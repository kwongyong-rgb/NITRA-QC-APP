# NITRA QC App — v20 (Phone support, Part 1 of 2: responsive shell)

Layout/navigation only — NO inspection logic changed, so the iPad experience is
unchanged. This is the foundation for Part 2 (the piece-by-piece phone
inspection mode).

What changes on a phone-width screen (≤768–820px):
- The header's button row (Approvals / SKUs / Settings / Reference / language /
  Sign out) collapses into a ☰ hamburger menu. On iPad/desktop it stays inline.
- The inspection tabs become a fixed BOTTOM navigation bar with icons
  (Visual / Technical / Photos / Pallet / Report / 100%), thumb-reachable.
  On iPad/desktop they remain the pill tabs at the top.
- Tighter page padding on phones.
(The app already had large 48–52px touch targets and stacking forms, so those
were already phone-friendly.)

Changed: src/App.tsx, src/index.css, src/pages/Inspection.tsx (tab strip only).

## Deploy — Vercel ONLY (no Supabase changes)
1. Replace files with v20, commit, push, wait Ready.

## Verified
- tsc -b (exact Vercel build gate): 0 errors.

## Next: Part 2
The piece-by-piece inspection flow (one wheel at a time) for phone-width screens,
shown only on phones; iPad keeps the current grid untouched.
