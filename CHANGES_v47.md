# NITRA QC App — v47 (base sample is the absolute gate, matching the rule engine)

## Root cause
The rule engine (lib/rules.ts) treats the base sample as the gate: if the base has
0 failures the parameter is "clean" and BOTH the extra-sample results and any old
100% data are ignored. The report's outcome math didn't replicate that gate — it let
a leftover extra-sample fail (from Area D's original inspection, before it was
amended to all-pass) keep triggering "100% Inspection", which dragged in the stale
9–20 fail data. That's why Area D still showed 8 pass / 12 fail even though pieces
1–8 are all Pass.

## Fix
Outcome math now mirrors the engine exactly:
- 0 base fails  → Pass (extras and any old 100% data ignored).
- >=2 base fails → 100% Inspection.
- exactly 1 base fail + a failed extra piece → 100% Inspection.
- 1 base fail, extras pending/clean → Additional Inspection.
The base verdict still wins per piece (from v45/46). Applied to interactive-report
and lib/outcome.ts.

Result: Area D (base all-pass) → Checked 8 / Pass 8 / Fail 0 / Pass, and it drops out
of the findings. Rear centre bore (2 base fails) keeps its 100% behaviour.

No migration. Orphaned extra/100% data is now correctly ignored whenever the base
sample has no fails.

## Deploy (BOTH — the in-app tab is Vercel, the public report is the function)
1. Vercel: replace files, commit, push (fixes the in-app Inspection Report tab).
2. supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. Hard-refresh (or InPrivate) to confirm.

## Verified
- tsc -b: 0 errors. interactive-report: esbuild clean.
