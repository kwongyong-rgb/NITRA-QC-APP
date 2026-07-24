# v98 — revert the v97 change that broke ONLINE photo capture + fix the stale ⏳ counter

Two bugs reported after v97. Both root causes found by review — and one of them was
v97 itself.

## Bug 2 (the serious one): online photos stopped being recorded — FIXED by revert

**v97's `onChange` change was a misdiagnosis, and it broke the online path.**

v97 made the camera inputs `await upload(...)` before clearing the input, on the
theory that clearing the input releases iOS's camera temp file before the photo's
bytes are read. **That theory is disproven by the app's own history:** the online
upload has ALWAYS read the File *after* the input was cleared (fire-and-forget +
immediate `value=''`) and worked reliably from day one through v96 — verified on
device in the v91B, v93, v94 and v96 test rounds. If clearing the input killed the
file, online uploads would never have worked either.

The correlation is equally decisive the other way: online capture worked v91→v96,
broke at exactly v97, and v97's only capture-path change was that handler.

**Fix:** both handlers reverted to the proven synchronous fire-and-forget shape,
with a comment forbidding an await there. The online path is now byte-identical
to the code that passed four rounds of device testing.

The REAL empty-blob fixes are unaffected and stay:
- v96: `saveLocalMedia` materializes the photo's bytes (`arrayBuffer()`) into an
  in-memory Blob before storing — the actual cause was storing the raw File
  reference in IndexedDB.
- v97's self-heal: an upload failing "No content provided" (bytes unrecoverably
  gone, pre-v96 queue entries) is dropped instead of retrying forever.

## Bug 1: ⏳ counter needed a logout/login to clear — FIXED

`App.tsx`'s reconnect effect only refreshed the tally when the sync reported
`uploads > 0`. But **discarding** an unrecoverable photo clears the queue without
counting as an upload — so after your 2 dead photos were dropped, the chip kept
showing 2. Worse, the 15-second poll's sync can collide with the reconnect sync
(an in-flight guard makes the second call a no-op), letting the stale reading
persist across polls. Logging out/in forced a clean pass, which is exactly what
you observed. The tally is now refreshed **unconditionally** after every sync.

## Sweep (requested: find the bugs before testing)
Verified in the current tree:
1. Both camera `onChange` handlers are synchronous fire-and-forget (no `async`
   remains in any capture path, including `Camera.tsx`).
2. `saveLocalMedia` materializes bytes at save; rejects a 0-byte read up front.
3. `syncPendingMedia` drops "No content provided" items; other errors stay queued.
4. Online capture path is identical to the v91–v96 code that passed device
   testing; offline storage is reached ONLY after a real upload failure.
5. Full gate: `tsc -b --force` clean · vite build OK · rules-of-hooks 0 · lint 75
   (baseline).

## Process rule going forward (added to CLAUDE.md)
The online path is FROZEN: any offline work must be strictly fallback-after-
failure, and every future photo-path batch gets tested **online first** before any
offline scenario. v97 violated that and it cost us; it won't happen again.

## Test — ONLINE FIRST, this is the one that matters
1. Commit **V98**, push, confirm Vercel **Ready**, delete + reinstall the PWA.
2. **ONLINE:** open an inspection → mark a Fail → take a photo → the preview shows
   in the modal → Save → the 📷 count updates and the photo is in the Photos tab.
   Take a pass photo too. **This must all work before touching airplane mode.**
3. Still online: any leftover stuck counter should clear within ~15s of opening
   the app (no logout needed).
4. Then offline: airplane mode → Fail + photo, Pass + photo → thumbnails show,
   ⏳ counts up.
5. Reconnect → counter drops to 0 within ~15s, no red line, photos open full-size
   as real images.
