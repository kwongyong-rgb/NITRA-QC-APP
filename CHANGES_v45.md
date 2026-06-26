# NITRA QC App — v45 (Visual/base result is the first authority)

## What was wrong
1. The 100% tab only pre-filled the FAILED base pieces. The base-PASSED pieces
   (1,3,5,6,7,8) weren't shown there at all.
2. The report let a 100% entry override the base verdict per piece. A stray/stale
   100% mark of "P" on piece 2 flipped its base FAIL back to pass, so "Bolt hole /
   cone free of paint" showed Pass 7 / Fail 1 (#4) instead of Pass 6 / Fail 2 (#2,#4).

## The principle (per your note)
The Visual/Technical sample result is the FIRST authority and feeds both the report
and the 100% tab. The 100% inspection only ADDS on top — it can never overturn a
base verdict.

## Changes
- 100% tab (HundredPctCheck): every piece already inspected on the sample is now
  pre-filled with its real P/F result and LOCKED (not just the fails). Only the
  remaining, un-inspected pieces are tappable. The "Checked" counter now includes
  the locked sample pieces (e.g. 8/20 instead of 2/20).
- Report + Summary outcome math (interactive-report + lib/outcome.ts): per piece, the
  100% set fills pieces in first, then the base verdict OVERRIDES it — so a base fail
  can never be flipped to pass by a stray 100% mark. Counted once per piece.

Result for the example SKU: Bolt hole / cone free of paint → Checked 8 / Pass 6 /
Fail 2 / #2, #4. The 100% tab shows pieces 1–8 locked with their true verdict.

No migration; no data shape change. Stale 100% marks on base pieces are now ignored
everywhere (display shows the locked base verdict; counts use the base verdict).

## Deploy
1. Vercel: replace files, commit, push (updates the 100% tab + in-app Summary).
2. Redeploy the report function:
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. Reinstall the PWA / hard-refresh the report link.

## Verified
- tsc -b: 0 errors. interactive-report: esbuild clean.
