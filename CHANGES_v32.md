# NITRA QC App — v32 (Batch 4.3: container sign-off + email; PO delete)

## Container approver sign-off
- On a submitted container loading, the approver sees a Review note + Approve /
  Reject (in the container page AND in the Approvals queue).
- Approve → status becomes Approved and a Container Loading report email is sent
  automatically (same audience as SKU: saved distribution list + kyong@). Reject →
  sent back to the inspector with the note shown at the top of the form.

## Container report email (new edge function send-container-report)
Self-contained HTML report: PO / container no / seal no (with photo links), loading
type, auto-totalled contents, every Container Loading Inspection Photo as a clickable
link, and a per-pallet packing summary (contents, label photo, pass/fail). Photo
links are private signed URLs that expire after 7 days.
- Inspector or approver can re-send any time via "📧 Email container report" on an
  approved container, or "Email Container Report" in Approvals.

## Approvals queue
Now has two sections: wheel inspections and container loadings awaiting sign-off.

## Delete an entire PO  (+ confirmations everywhere)
- Approver gets a 🗑 on each PO row (Home) and a "Delete entire PO" button in the PO
  hub. It deletes every wheel inspection and container loading under that PO
  (photos cascade), after a clear confirmation listing the counts.
- Every delete — PO, SKU inspection, container loading — now asks for confirmation.

## "(No PO)"
That group is just records with a blank PO number (your earlier container tests).
You can open it and delete them individually, or delete the whole group.

Changed: pages/ContainerLoading.tsx, pages/Approvals.tsx, pages/Home.tsx,
pages/PoHub.tsx, App.tsx; new function supabase/functions/send-container-report.

## Deploy
1. Vercel: replace files, commit, push.
2. Supabase function (PowerShell in repo folder, KEEP JWT):
   supabase functions deploy send-container-report --project-ref nzzktgstpifevaqyapyw
   (No migration. send-report / interactive-report unchanged.)
3. Reinstall the PWA.

## Verified
- tsc -b: 0 errors. Edge function: esbuild clean.

## Note
Approving a container auto-emails the distribution list (customer), mirroring SKU.
Tell me if you'd rather approval NOT auto-send and keep email manual-only.

## Next
4.4 consolidated PO report (Overview + navigation across SKUs and containers).
