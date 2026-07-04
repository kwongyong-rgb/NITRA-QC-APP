# v70 — QW-1: Quick wins, part 1 (UX review batch A)

## New / changed
- **EmailModal** replaces every window.prompt() for report emailing (6 sites:
  Approvals ×2, ContainerLoading, Inspection, PoHub, PoReportPage). Saved
  distribution list appears as pre-selected one-tap chips, recently used
  addresses (per device) as extra chips, free typing still works. "Leave blank
  = saved list" behaviour preserved where the send function supports it.
- **Continue where you left off** card on Home: newest draft/rejected
  inspection or container loading started by the signed-in user, one tap back in.
- **Customer dashboard**: card layout on narrow screens (no more sideways
  table scrolling on phones) + "Copy link" button (EN/DE/FR) for sharing the
  public report URL.
- **Photo upload retry**: 3 attempts with backoff on weak WiFi, and an honest
  failure message instead of a silent drop.
- **Wording pass** (consistency ruling: "Decision" everywhere):
  FINAL DISPOSITION → FINAL DECISION / 最终决定 / 决定待定 (reports),
  Defect Log → Inspection Outcome / 检验结果记录 (PDF),
  Consolidated report "Disposition" column → "Decision/决定",
  Customer dashboard "Final Disposition" → "Final Decision",
  Reference Photos → Reference Library / 参考资料库.
- **Removed** the vestigial "100% inspection trigger (0.10)" Settings field
  (the rule engine never read it).

## Deploy
- App only: push -> Vercel -> reinstall PWA. No SQL. No edge functions.

## Pending (QW-2, next batch)
- Sticky progress/submit bars + "next unanswered" on Inspection & ContainerLoading
- off_po flags rendered on reports (touches report edge functions)
- QC Standard doc V2.1: Disposition→Decision to match the app (separate doc task)
