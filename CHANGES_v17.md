# NITRA QC App — v17 (build fix for v16)

## What broke
v16 failed the Vercel build (tsc -b) with:
  src/pages/Inspection.tsx(269,53): TS2345 — FormData (PFNA-typed) not
  assignable to computeOutcomes' loosely-typed (string) parameter.
My earlier verification used a looser tsc invocation that didn't surface it;
this is now verified with `tsc -b`, the exact command Vercel runs.

## Fix
src/lib/outcome.ts — computeOutcomes() now takes `unknown` and narrows
internally, so the app's precise PFNA-typed form_data passes cleanly while the
logic is unchanged. One file changed vs v16.

## Deploy
1. Vercel: replace files with v17, commit, push, wait Ready (this is the
   build that was failing — it will now succeed).
2. Supabase — redeploy BOTH functions from the v17 files to be certain the
   outcome data + the new email link are live (safe to re-run):
     supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
     supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
3. Send a NEW report email and open that one.

## Verified
- `tsc -b` (exact Vercel build gate): 0 errors.
- Both edge functions transpile clean.
