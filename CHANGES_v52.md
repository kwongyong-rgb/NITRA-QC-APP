# NITRA QC App — v52 (fix: photo flag not updating on Fail→Pass)

## Bug
v50 tried to re-flag a piece's photos when its verdict changed, but the update
filtered on a "tab" column that doesn't exist on the photos table, so the query
silently failed and the photo stayed marked Fail after changing to Pass.

## Fix
The photo sync now filters by inspection + item_key + piece_no only (item_key already
identifies the parameter uniquely). Changing a piece Fail→Pass (or Pass→Fail) in the
Visual/Technical tab now re-flags its photos accordingly — the photo is kept, only its
Pass/Fail classification updates. Errors are logged instead of failing silently.

Changed: pages/Inspection.tsx only.

## Deploy
Vercel only: replace files, commit, push, hard-refresh.
(Photos changed before this fix update as soon as you re-toggle the piece; and the
customer report already recomputes Pass/Fail from the live verdict regardless.)

## Verified
- tsc -b: 0 errors.
