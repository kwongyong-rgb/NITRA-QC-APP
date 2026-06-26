# NITRA QC App — v19

1. Defect Pieces column now shows ONLY real piece numbers (e.g. #3, #5) — no
   "Extra N". The fact that an additional inspection happened is reflected in the
   Outcome column ("Additional Inspection — Pass" or "100% Inspection").
   Extra-sample pieces no longer count toward Checked/Pass/Fail; they drive the
   Outcome only, so Pass + Fail = Checked and the listed pieces match Fail.
2. Pass numbers are green, Fail numbers are red (in both the app Summary tab and
   the interactive report).
3. The in-app tab "Summary" is renamed to "Inspection Report".
4. The Photo / Video Appendix now also appears in the Inspection Report tab,
   grouped by Required Shots + parameter, pass photos before fail, with proper
   labels and click-to-zoom / video playback — matching the interactive report.
   (Photo captions use "Piece N" / "Additional" / "Required photo" — no "Extra".)

Changed: src/lib/outcome.ts, src/pages/Inspection.tsx, src/pages/ReportPage.tsx,
src/lib/i18n.tsx, supabase/functions/interactive-report/index.ts.

## Deploy
1. Vercel: replace files with v19, commit, push, wait Ready.
2. Supabase: redeploy ONLY interactive-report (its data output changed):
     supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   send-report did NOT change — no need to redeploy it.

## Verified
- tsc -b (exact Vercel build gate): 0 errors.
- Edge functions transpile clean.
