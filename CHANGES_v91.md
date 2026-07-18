# v91 — B6 Stage 3: offline photos & videos

---

## Three bugs found in on-device testing and fixed before release

The first cut queued photos correctly (the ⏳ tally proved it) but they were
**invisible on screen** and **never uploaded**. Root causes:

**1 & 2. Offline photos didn't appear** — not on the per-parameter 📷 button
count, not in the Photos tab. `Inspection.load()` has THREE early returns on the
offline paths (pending inspection already loaded; network failure with a prior
successful load; SKU resolve failure). The pending-photo merge had been written at
the END of `load()`, so offline it was never reached — the exact paths it existed
to serve.
**Fix:** server photos and queued photos are now separate state, merged for
display via `useMemo`, with the queue read by its **own effect** keyed on
`[id, mediaTick, online]`. Display no longer depends on `load()` completing.
A new `afterPhotoChange()` bumps `mediaTick` wherever a photo is added or
changed, since `load()` alone cannot refresh the queue.

**3. The ⏳ chip never cleared after reconnecting.** The batch inspection sync
deliberately **skips the currently-open inspection** (its own screen syncs it, to
avoid a two-writer race). So on reconnect `syncPendingMedia` ran while the parent
inspection row was still absent, every photo insert failed, and nothing ever
retried — the files stayed queued indefinitely.
**Fix, two parts:** (a) the 15s tally poll now also **retries the media sync**
while online, and (b) the Inspection screen kicks a media sync the moment its own
`syncOnePending` succeeds, so it doesn't wait up to 15 seconds.

**Lesson for future batches:** in `Inspection.tsx`, anything that must work
offline cannot live at the tail of `load()`. Check the early returns first.

---

Photos taken offline are now **kept on the device and uploaded automatically when
you reconnect**. Previously they were lost: `MediaCapture` retried the upload 3×
then alerted *"the photo is still on your device"* — which wasn't true in any
recoverable sense.

This matters because a QC inspection is photo-backed by definition. Offline
inspections (v86) could record Pass/Fail but not a single photo, so the report
that came out the other end was half a form.

## How it works — the v86 trick, reused
The storage path is **client-minted before the upload** (`crypto.randomUUID() +
'.jpg'`). So offline we mint the path, stash the file under it locally, and queue
a `photos` row that already points at that final path. On reconnect the blob
uploads to exactly that path and the row inserts. Nothing to reconcile — the same
reasoning that made client-minted inspection UUIDs work.

## New module `src/lib/offlineMedia.ts`
Its own IndexedDB database (`nitra-qc-media`) so it can never fight the three
existing stores over schema versions. Two object stores:
- **`blobs`** — the captured file, keyed by its future storage path
- **`rows`** — the queued `photos` table row

Key exports: `saveLocalMedia`, `savePendingPhotoRow`, `mediaUrlFor`,
`getPendingPhotosFor`, `pendingMediaStats`, `syncPendingMedia`, `currentUserId`.

## Behaviour
- **Capture offline** → file saved locally, thumbnail shows immediately from the
  local blob, marked as any other photo on the screen.
- **Capture online** → completely unchanged. Local storage is only ever a
  FALLBACK after a real network failure, so the online path behaves as before.
- **Upload failure while "online"** (dead uplink, captive portal, weak signal) →
  now also falls back to local storage instead of losing the photo.
- **Reconnect** → `App.tsx` runs `syncPendingInspections` **then**
  `syncPendingMedia`. The order is deliberate: a photo row whose parent
  inspection isn't on the server yet can't insert. If it still fails, it stays
  queued and retries rather than being dropped.
- **Running tally** — an amber ⏳ chip next to the connectivity pill shows how
  many files are waiting; long-press/hover shows the total MB. Polled every 15s
  (capture happens deep inside modals; polling beat threading a callback through
  every photo path).

## Two decisions you made
- **Video offline: allowed, with a size warning.** Capturing a video offline
  prompts with its size ("This video is 148.2 MB… save it anyway?") so the
  inspector can judge whether it's worth the space. Photos save silently.
- **Originals kept, no downscaling.** Your appearance standard judges paint spots
  at ≤0.8 mm and scratches at ≤5 mm; compressing offline photos would make them
  measurably worse than online ones — inconsistent evidence inside one report.
  The tally chip is the mitigation instead.

## Defect linkage — the subtle one
Online, a Fail photo is linked to its defect row via `defect_id`. Offline the
defect row doesn't exist yet (`offlineSync.rebuildDefects` recreates it at sync
time), so the photo is queued **without** `defect_id`, and `syncPendingMedia`
links it afterwards by matching `item_key` + `piece_no` — the same pair the
online flow keys on. If linking fails the photo is still saved; only the PDF's
"photo next to this defect row" nicety is affected.

## Storage safety
`saveLocalMedia` returns whether the write landed. If the device is out of space
the inspector is told immediately (*"Could not save this file on the device —
storage may be full"*) rather than discovering it at sync time.

## Scope — deliberately NOT included
Reference library (`Camera.tsx`), report-logo uploads, `CopyModal`, and
**container-loading photos** stay online-only. Container work is the next batch
and will reuse this media layer wholesale.

## No Supabase migration
Client-side only. No schema change: queued rows insert into the existing `photos`
table with the same columns the app already writes.

## Build gate
- `npx tsc -b --force` (full, not incremental) — clean
- `npx vite build` — OK (789ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, identical to baseline (two `no-useless-assignment` errors I
  introduced were fixed, not tolerated)

## Test (Pipeline A → **confirm Vercel shows your commit as Ready** → delete + reinstall the PWA)
1. **Online first**, log in, open a PO, start an inspection, take one photo →
   confirm the normal online path still works exactly as before. **No ⏳ chip.**
2. Airplane mode ON. Pill → Offline.
3. In the inspection, mark a parameter **Fail** → **Log Defect** → take a photo →
   Save. The thumbnail should appear immediately.
4. The **⏳ 1** chip appears in the header next to the Offline pill.
5. Mark another parameter **Pass** → take a pass photo. Chip → **⏳ 2**.
6. Go to the **Photos** tab — both photos are visible and open full-size.
7. Navigate away (back to the PO) and return → the photos are still there.
8. **Video test:** try a video offline → it should warn you with its size and let
   you cancel or accept.
9. **Reconnect.** Within ~15s the ⏳ chip disappears as the files upload.
10. Reload the inspection → the photos are still there (now served from storage,
    not the device), each appearing **once**, and the Fail photo sits under its
    defect in the report.

## Stage 2 / 3 status after this batch
- Stage 1 (local draft safety net) — done
- Stage 2 (connectivity, ref cache, offline inspection creation + sync, PO-page
  caching, pending items in lists) — **done and device-verified**
- Stage 3 (offline photos/videos) — **this batch**, for wheel inspections
- Remaining: offline **container-loading** creation (+ its photos, reusing this
  layer), then **Stage 4 conflict/merge**
