# NITRA QC App — v46 (100% data follows the live trigger, not stale data)

## The bug
A parameter was treated as "100% inspection" whenever ANY 100% data existed for it
(h.checked > 0). So after you amended Area D's base sample to all-pass — which means
it no longer needs a 100% inspection — the report still counted the earlier 100%
data (pieces 9–20, 12 fails) and showed 8 pass / 12 fail.

## The rule (from the rule engine)
A parameter requires 100% only when the base sample has >=2 failures, or an
extra-sample piece fails. That, and only that, should drive the report.

## The fix
Outcome math now computes `triggers100 = baseFails >= 2 || anyExtraFail`. The stored
100% data is counted ONLY when the parameter currently triggers 100%. If the base is
later amended so it no longer qualifies, the earlier 100% data is ignored and the
parameter reverts to its base result. The "100% Inspection" label is likewise driven
by the live trigger, not by leftover data.

Result: Area D (base now all pass) → Checked 8 / Pass 8 / Fail 0 / Pass, and it no
longer appears under "100% inspection required". Rear centre bore (2 base fails)
keeps its 100% behaviour. Applied to interactive-report + lib/outcome.ts.

No migration. The old 100% marks remain stored but are ignored while the trigger is
off (so the change is reversible if base fails are reintroduced). If you'd prefer the
stale 100% data to be permanently cleared when a parameter stops triggering, that's a
small follow-up — tell me.

## Deploy
1. Vercel: replace files, commit, push.
2. Redeploy the report function:
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. Reinstall PWA / hard-refresh the report link.

## Verified
- tsc -b: 0 errors. interactive-report: esbuild clean.
