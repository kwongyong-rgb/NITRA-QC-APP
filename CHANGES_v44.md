# NITRA QC App — v44 (fix: 100% inspection outcome double-counting)

## The bug
Per-parameter Checked/Pass/Fail on the report (and in-app Summary) summed the base
sample and the 100% set:
    checked = base.checked + hundred.checked
    fail    = base.fails  + hundred.fails
A piece that failed in the base sample AND was also present in the 100% set (your
locked fails) was therefore counted twice. Example (SKU MCRF1-11018, "Rear centre
bore … paint-free"): base 8 checked / 2 fail, the 2 locked fails also in the 100%
set → report showed 10 checked / 4 fail instead of 8 / 2.

## The fix
Outcomes are now computed by merging per PIECE NUMBER: base verdicts first, then the
100% verdict overrides for the same piece. Checked = unique inspected pieces; Fail =
unique failed pieces. So:
- Locked base-fails count once.
- Unchecking 100% pieces drops them from the count (reflects your amendment).
- A parameter with base 8 (2 fail) and no remaining 100% marks now reads 8 / 6 / 2.

Applied identically to supabase/functions/interactive-report/index.ts (report page +
email) and src/lib/outcome.ts (in-app Summary tab) so both always match.

No data shape change; no migration. The outcome LABEL logic (100% Inspection /
Additional / Pass) is unchanged.

## Deploy
1. Vercel: replace files, commit, push (updates the in-app Summary).
2. Redeploy the report function (PowerShell in repo folder):
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. Hard-refresh / reopen the /report link (clear cache) to re-pull.

## Verified
- tsc -b: 0 errors. interactive-report: esbuild clean.
- Re-check both SKUs after deploy; the counts should now reflect only inspected pieces.
