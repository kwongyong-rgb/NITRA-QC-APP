# NITRA QC App — v50 (photos follow verdict changes + photo Appendix)

## 1. Photos now follow a P↔F verdict change (never deleted)
- In-app: when you change a piece's result in the Visual/Technical tab, any photos
  attached to that piece are re-flagged Pass/Fail to match — the photo stays, only its
  classification updates.
- Customer report: each photo's Pass/Fail is computed from the piece's CURRENT verdict
  (so amended F→P / P→F is reflected even for 100% and approver amendments), without
  deleting anything.

## 2. Appendix photos (extra shots not tied to a parameter)
- Photos tab: a new "Appendix — Additional Photos" section at the bottom (below the
  Wheel Balance parameter group) with an Add Photo/Video button. Extra shots that don't
  belong to any inspection parameter go here.
- Report: appendix photos appear in their own "Appendix — Additional Photos" section,
  separate from the per-parameter Approved/Failed galleries.

Changed: pages/Inspection.tsx, pages/ReportPage.tsx,
supabase/functions/interactive-report.

## Deploy (Vercel + both functions — the v49 email fixes are also in this build)
1. Vercel: replace files, commit, push.
2. supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
4. Hard-refresh / InPrivate to confirm.

## Verified
- tsc -b: 0 errors. interactive-report: esbuild clean.

## Note
The in-app "Inspection Report" preview groups appendix photos under "Other"; the
customer-facing interactive report shows the dedicated Appendix section. Tell me if
you want the in-app preview to match exactly.
