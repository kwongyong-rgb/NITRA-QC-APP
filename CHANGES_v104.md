# v104 — photos: instant save, background upload, ~1.2 MB compression (option B)

Approved as "B". Two problems solved together:
- Slow signal made you wait for each photo to upload before you could save and
  move on.
- Saving before the upload finished didn't record the photo — the 📷 +1 wouldn't
  appear.

## What changed (inspection photos)
Inspection photo capture now works the way the offline path already did, all the
time:
1. **Compress** the photo to ~1.2 MB (≈2000 px long edge, quality auto-tuned).
   Videos are never compressed. Fail-safe: any compression error → original file,
   so a photo is never lost or degraded unexpectedly.
2. **Save to the device and queue it** — no inline upload. You tap Save and move to
   the next parameter **instantly**.
3. The photo shows **immediately** on the Photos tab and the 📷 count, because it
   comes from the local queue, not from a finished upload. This is the direct fix
   for "save too early and the +1 doesn't show."
4. A **background upload** starts right away (a sync is kicked on save) and, on
   success, **deletes the local copy** — so nothing accumulates on the phone.

Net: ~60–70% smaller files AND you never wait, on any connection.

## Deliberate scope
- **Inspection photos only.** `DefectModal`, `PassPhotoModal` and the appendix use
  a new `deferUpload` flag on `MediaCapture` and always queue + kick the sync.
- **Container-loading photos are unchanged** in behaviour (still upload inline —
  they're online-only) but now also get the ~1.2 MB compression.
- Reference-library and report-logo uploads untouched.

## ⚠️ This IS a change to the online photo path (normally frozen since v97)
The inline online `photos` insert is replaced by queue + background upload for
inspection photos. That's the whole point of the feature, but it means the online
path is genuinely different now — hence: **test the online case first.** The
capture handlers stay the proven synchronous fire-and-forget shape (v98); only
what happens *after* capture changed.

## Fidelity note
~2000 px / ~1.2 MB is a deliberate middle ground: the appearance standard judges
0.8 mm paint spots, and this keeps defects readable while cutting size. It is NOT
compressed to under 1 MB (that risked the defect fidelity you built the app to
protect). Your 1-second-video workaround was actually lower quality than this.

## Build gate
- `npx tsc -b --force` — clean · `npx vite build` — OK (649ms)
- rules-of-hooks — **0** · lint total 71 (unchanged)

## Test — ONLINE FIRST
1. **ONLINE, good signal:** inspection → Fail → take photo (brief "processing" as
   it compresses) → **Save closes instantly** → 📷 shows **+1 immediately** →
   move to next parameter. Repeat fast, several photos, without waiting.
2. The ⏳ counter briefly rises then clears as they upload in the background.
3. Photos tab → all present; open one full-size → real image, visibly smaller file
   but defects clearly visible.
4. **ONLINE, throttle your connection (or weak signal):** same as #1 — you should
   STILL save and move on instantly; uploads just take longer in the background.
5. Reopen the inspection after uploads finish → photos load from the server, each
   once, Fail photo under its defect.
6. **Offline:** unchanged from before — capture, save instantly, ⏳ counts up,
   syncs on reconnect.
7. Container loading: take a container photo → still works (now compressed).
