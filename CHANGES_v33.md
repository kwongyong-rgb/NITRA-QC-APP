# NITRA QC App — v33

Change: approving a container loading no longer sends any email automatically
(in the container page and in the Approvals queue). Approve just sets the status
to Approved. The customer/distribution email is sent only when you tap
"📧 Email container report" (on the container) or "Email Container Report"
(in Approvals).

Changed: pages/ContainerLoading.tsx, pages/Approvals.tsx.

## Deploy
Vercel only: replace files, commit, push. (No migration, no function redeploy —
send-container-report is unchanged and still used by the manual email buttons.)

## Verified
- tsc -b: 0 errors.
