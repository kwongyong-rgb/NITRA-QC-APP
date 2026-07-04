# v65 — Consolidated PO report logo auto-pick + Team page typo fix

## Consolidated PO report logo (auto-pick)
`supabase/functions/po-report/index.ts`

Old behaviour: the consolidated report used the logo of the *first* wheel
inspection (by part number) that had one set. A single AVO-branded inspection
sorting first therefore branded the whole consolidated report AVO.

New behaviour — a vote across EVERY inspection and container in the PO:
- an uploaded logo = a vote for that logo file (report_logo_path)
- no uploaded logo = a vote for the default NITRA logo
- most common wins; a tie stays on the NITRA default.

So a lone stray AVO upload can no longer outvote an otherwise-NITRA PO. The vote
counts stable file paths, not the per-report signed URLs (which are unique even
for the same logo file).

Still to come (next batch): a manual override on the staff PO page so an approver
can force a specific logo when the auto-pick guesses wrong.

## Team page typo fix
`src/pages/TeamPage.tsx`, `src/pages/SetPassword.tsx`

Apostrophes / dashes / ellipses / the modal close "✕" were written as \uXXXX
escape codes inside on-screen text, where they don't decode — so the page showed
`they\u2019re` etc. Replaced all with the literal characters.

## Deploy
- App (front-end): push to GitHub -> Vercel.
- Edge function (separate, PUBLIC page function -> keep --no-verify-jwt):
  `supabase functions deploy po-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt`
- No SQL migrations.
