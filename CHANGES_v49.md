# NITRA QC App — v49 (disposition colours, defect count fix, report redesign)

## 1. Disposition colours
Approved for Loading = GREEN. Every other final disposition (Hold for Rework,
Conditional Loading, Conditional Rework, Pending Customer) = AMBER. An unchosen /
legacy disposition = neutral GREY "PENDING DISPOSITION". Applied to the report page,
the emailed report banner, and the PDF.

## 2. "Defects logged: 44" fixed
The email counted raw rows in the defects table, which accumulates orphaned rows
(every F across base, the old Area-D 100% with 12 fails, re-toggles, amendments —
never cleaned up). It now counts CURRENTLY-failing pieces using the same merge/trigger
logic as the outcome table — so this report reads 2, matching the 2 real fails.
The interactive report's defect list is also filtered to currently-failing pieces
(one per piece) so stale entries no longer appear.

## 3. Report header + presentation
- Client logo now sits on a white "plate" so it always reads cleanly (light or dark),
  sized consistently, with the title beside it. Same treatment in the email header.
- The disposition is now a clear status badge (coloured dot + full wording) in the
  header, with a thin accent strip in the verdict colour beneath the header.
- The raw "conditional_rework" you saw was the pre-v48 report page being cached; with
  this Vercel build it shows the full label.

Changed: pages/ReportPage.tsx, lib/report.ts, supabase/functions/send-report,
supabase/functions/interactive-report.

## Deploy (Vercel + BOTH functions this round)
1. Vercel: replace files, commit, push.
2. supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
3. supabase functions deploy send-report --project-ref nzzktgstpifevaqyapyw
4. Hard-refresh / InPrivate to confirm.

## Verified
- tsc -b: 0 errors. Both functions: esbuild clean.

## Note
The photo appendix still groups by each photo's saved pass/fail flag; if a piece was
later amended from F to P, an old failed photo could still appear there. You didn't
flag it, so I left it — tell me if you want failed photos filtered the same way.
