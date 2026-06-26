# NITRA QC App — v53 (fix: photo deleted when changing Fail→Pass)

## Bug
Changing a piece Fail→Pass removed its defect, and the photo was linked to that defect
with a database cascade-delete — so the photo was deleted along with the defect.
(v52 only re-flagged photos AFTER removal, so it couldn't help — the photo was already
gone.)

## Fix
removeDefect now DETACHES the photos first (clears defect_id and sets them to pass),
THEN deletes the defect. With the link cleared, the cascade can't touch the photos —
they survive and convert to pass photos. Combined with the v52 flag sync, a piece going
Fail→Pass keeps its photo and moves it to the Pass side; Pass→Fail re-flags to Fail.
Nothing is ever deleted on a verdict change.

Changed: pages/Inspection.tsx only.

## Deploy
Vercel only: replace files, commit, push, hard-refresh.

## Note
Photos already lost on earlier Fail→Pass changes can't be recovered (they were deleted
in the database). This prevents it going forward.

## Verified
- tsc -b: 0 errors.
