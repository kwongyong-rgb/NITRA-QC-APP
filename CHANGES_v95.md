# v95 — TEMPORARY diagnostic: why offline photos aren't uploading

After v94, offline photos stayed queued (⏳ counter stuck at 2) after reconnecting.
The sync code looks correct — `syncPendingMedia` leaves a row queued (`continue`)
only when its upload or insert **errors** — so something is erroring silently, and
there's no console on the phone to see it.

This batch adds a **temporary diagnostic** to surface the exact failure, exactly
like the v88 cache diagnostic that pinpointed that issue in one round trip:
- `syncPendingMedia` now records the last upload/insert error
  (`getLastMediaSyncError()`).
- A thin dark-red line appears under the header **only** while media is stuck,
  showing e.g. `2 media waiting · last sync error: insert: <message>`.

**No behaviour change** to the sync itself — this only reports. It will be removed
once the cause is found and fixed.

## Build gate
- `npx tsc -b --force` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, baseline

## What to do
1. Commit **V95**, push, confirm Vercel Ready, delete + reinstall the PWA.
2. Reproduce: online inspection → airplane mode → mark a Fail + take a photo →
   reconnect.
3. If the ⏳ counter stays, a **red line appears under the header**. Screenshot it
   or type out the "last sync error: …" text. That text names the exact cause.
