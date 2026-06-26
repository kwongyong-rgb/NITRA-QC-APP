# NITRA QC App — v14b (small but essential add-on to v14)

## Fix: cold visits to /report/<id> returned Vercel 404
A single-page app needs Vercel to be told "for any unknown path, serve the app
and let React Router handle it." Without that, a fresh browser visit to a deep
link like /report/<id> makes Vercel look for a real file at that path, not find
one, and return its own 404 before the app ever loads.

Added: vercel.json with an SPA rewrite that routes all paths to /index.html.
This also makes any deep link (e.g. /inspection/<id> opened cold) robust.

ONLY vercel.json was added. No code changed. After pushing to Vercel, the
/report/<id> link will load the app and render the report.

NOTE: No need to redeploy the Supabase functions again for this change —
this is a Vercel-only fix. Just replace files, commit, push, wait for Ready.
