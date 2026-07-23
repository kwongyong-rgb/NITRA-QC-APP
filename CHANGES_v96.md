# v96 — fix offline photos uploading empty ("No content provided")

The v95 diagnostic pinpointed it: `upload: No content provided`. Offline photos
were reaching the upload **empty (0 bytes)**, so Supabase rejected them and they
stuck in the queue (the ⏳ counter never cleared).

## Root cause (iOS)
A photo/video straight from `<input capture>` is a **File that references a
temporary file on disk**, not the bytes themselves. We stored that File in
IndexedDB and read it back at sync time — but by then iOS had cleared the temp
file, so the blob came back empty. Structured-clone semantics for disk-backed
Files are unreliable on iOS Safari.

## Fix
`saveLocalMedia` now reads the file's bytes into memory **at capture time** (while
the file is still valid) and stores an in-memory Blob of those bytes. IndexedDB
then holds the actual image, not a reference iOS can invalidate.
- If the read yields 0 bytes, the capture is rejected up front with the existing
  "could not save — storage may be full" message, rather than queuing an empty
  shell.

## Self-heal for already-stuck photos
Your 2 currently-stuck photos were captured under the old code, so their bytes are
already gone — they can't be recovered. `syncPendingMedia` now detects an
empty/missing blob and **drops it from the queue** (with a diagnostic note) instead
of retrying forever, so the ⏳ counter clears itself. Those 2 shots need to be
**re-taken**; any photo taken after this deploy will upload correctly.

## Diagnostic kept for one more cycle
The v95 header diagnostic line is intentionally left in so you can confirm the fix:
after this deploy, new offline photos should sync with **no red error line**. Once
you confirm, I'll remove the diagnostic in a cleanup batch.

## Build gate
- `npx tsc -b --force` — clean
- `npx vite build` — OK (684ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, baseline

## Test (Pipeline A → confirm Vercel Ready → delete + reinstall the PWA)
1. Open the app **online** once (this lets the old 2 stuck photos self-drop, and
   the ⏳ counter should clear on its own within ~15s).
2. Open an inspection, **airplane mode ON**.
3. Mark a **Fail** → take a photo. Mark a **Pass** → take a photo. Take a **video**
   too if you like.
4. The ⏳ counter rises; the thumbnails show on the Photos tab.
5. **Reconnect.** Within ~15s the ⏳ counter should drop to 0 and **no red error
   line** should appear.
6. Reopen the inspection → the photos are there (now from the server), each once,
   the Fail photo under its defect. Open one full-size to confirm the image is real.
