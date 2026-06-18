# NITRA QC App — v14 (replaces the interactive-report approach in v11-v13)

## Root cause found (not a code bug — a platform restriction)
Supabase forces ANY HTML-shaped Edge Function response into
Content-Type: text/plain with Content-Security-Policy: default-src 'none'; sandbox,
regardless of what headers the function code sets. This is intentional: it stops
the shared *.supabase.co domain being used to host arbitrary live, scriptable
webpages (a phishing/security risk for the platform). Confirmed directly from the
browser's Network tab Response Headers. No function-code header fix can override
this — v13's attempt could never have worked.

## The fix: separate "data" from "page"
- supabase/functions/interactive-report/index.ts — REWRITTEN. No longer returns
  an HTML page. Returns the same report data (summary, defects, signed photo/video
  URLs, photo groups) as plain JSON. JSON responses from Edge Functions are exactly
  what the platform expects and are not subject to the HTML lockdown above.
- src/pages/ReportPage.tsx — NEW. A real page in the NITRA app itself, served from
  nitra-qc-app.vercel.app (a domain you fully control, with no such restriction).
  Fetches the JSON from interactive-report and renders the full report — header,
  disposition banner, summary, defect log, photo appendix — with a working
  click-to-zoom / video-playback lightbox using normal React state.
- src/App.tsx — the route /report/:id now bypasses the login wall entirely (so
  recipients who were never logged into the app can open it), and renders only
  ReportPage, with no app topbar.
- supabase/functions/send-report/index.ts — the emailed "View Full Interactive
  Report" link now points at https://nitra-qc-app.vercel.app/report/<id> instead
  of the raw Supabase function URL.

## Deploy (both Vercel AND Supabase needed this time)
1. Replace files in the repo folder as usual, commit, push (Vercel redeploys the
   app with the new /report route).
2. Redeploy BOTH functions:
   supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
   supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
3. No new secrets needed — PUBLIC_APP_URL was already set previously.

## Verified
- Front-end strict type check (tsc, project config): 0 errors.
- Both edge functions transpile cleanly.
