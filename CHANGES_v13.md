# NITRA QC App — v13 (on top of v12)

Fix: interactive-report page was rendering as raw HTML source text in the
browser instead of a formatted page (no styling, no images, no clickable
photos) — even though the public-access (no-verify-jwt) fix from v11/v12 was
working correctly (no 401 error).

Root cause: the Content-Type header was set via a plain object merge, which
in some edge-runtime deploy paths (e.g. the CLI's no-Docker remote bundling
mode) can fail to propagate correctly to the browser.

Fix: supabase/functions/interactive-report/index.ts now builds response
headers explicitly via the standard Headers() API and adds
Cache-Control: no-store, which is the more robust/standard way to guarantee
Content-Type reaches the browser intact.

ONLY this one file changed. send-report and the front-end app are untouched
— no GitHub/Vercel redeploy is required this time, only:
  supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
