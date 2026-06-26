# NITRA QC App — v54 (header redesign, criteria reformat, logo cut-out)

## 1. Report header redesign
Logo + "QC Interactive Report" title on the navy bar (viewed-time tucked top-right),
and the disposition is now a full-width verdict STRIP below the bar — coloured accent
border, status dot, full wording with room to breathe, and a "FINAL DISPOSITION" tag
on the right. Fixes the cramped/misaligned top-right badge.

## 2. Inspection Evaluation Criteria reformatted
Replaced the wall of text with two clean rule cards (Visual / Technical), each a small
table: Sample size · 1 piece fails · same defect again · 2+ fail in initial sample,
with the 100% triggers highlighted. Much easier to scan.

## 3. Logo "cut out background"
New approver button "🪄 Logo · cut out background". On upload it samples the image
corners, makes that background colour transparent, and uploads a PNG — so the logo's
lettering blends onto the navy header instead of sitting in a coloured box. The plain
"Set report logo" button still uploads the image as-is.

Changed: pages/ReportPage.tsx, pages/Inspection.tsx.

## Deploy
Vercel only: replace files, commit, push, hard-refresh.
(No edge-function change in this build.)

## Verified
- tsc -b: 0 errors.

## Note
Background cut-out works best on logos with a solid, even background (like the AVO
navy). Logos with gradients or a background colour that also appears in the lettering
may need manual editing instead.
