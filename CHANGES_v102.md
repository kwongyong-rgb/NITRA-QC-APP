# v102 — deleting an inspection now discards its queued offline photos

## The bug (reported from the field)
An inspector did an offline inspection, then deleted it (SKU `TI17TY85613930951SB`).
Its 9 offline photos were still in the upload queue. Deleting the inspection
removed their parent row, so every sync attempt failed —
`upload: new row violates row-level security policy` — and the ⏳ counter stuck at
9 forever, on an unrelated PO. The photos were orphans that could never attach to
anything.

## Fix — two layers

**1. Discard on delete (the root cause).** New
`discardQueuedMediaForInspection(id)` in `offlineMedia.ts`, called from `PoHub`'s
delete-inspection and delete-PO paths. When an inspection is deleted, its
not-yet-uploaded photos go with it, so they never outlive it.

**2. Orphan cleanup on sync (the backstop + the cure for the already-stuck 9).**
`syncPendingMedia` now, before uploading, checks each queued photo's parent
inspection. Parent alive on the server → keep. Parent in the pending store (an
offline-created inspection not uploaded yet) → keep. Parent gone from both →
deleted → discard the photo. This clears photos orphaned by ANY delete path
(including the 9 already stuck, and admin whole-PO deletes from Home), and it's
what will unstick Kwong's counter on the next online sync after deploy.

**Safety:** the orphan check only discards when the server lookup SUCCEEDS. If the
network is flaky/offline, the lookup is skipped and nothing is discarded — a bad
connection can never wrongly delete a valid queued photo.

## Answering the question directly
Yes — the 9 waiting photos were from the deleted SKU `TI17TY85613930951SB`. They
were never going to sync (their inspection was gone). The current SKU's photos had
already uploaded correctly; only the orphans were stuck. Nothing of value was lost.

## Build gate
- `npx tsc -b --force` — clean · `npx vite build` — OK (847ms)
- rules-of-hooks — **0** · lint total 71 (below the 75 baseline — the v101 refactor
  removed a few tolerated `no-useless-assignment` errors; nothing added)
- No circular import (`offlineSync` does not import `offlineMedia`).

## No Supabase migration
Client-side only.

## Test (commit V102 → push → Vercel Ready → delete + reinstall PWA)
1. **First, the cure:** open the app online. Within ~15s the stuck **⏳ 9 should
   clear on its own** and the red line disappear (orphan cleanup runs on sync).
2. **The fix going forward:** create a SKU inspection → take a photo OFFLINE (⏳
   counts up) → while still offline, delete that inspection from the PO page →
   the ⏳ count should drop by that photo immediately.
3. Reconnect → counter stays clean, no red line.
4. Regression: a normal offline inspection you DON'T delete still syncs its photos
   fine on reconnect.
