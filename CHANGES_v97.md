# v97 — actually fix offline photos uploading empty ("No content provided")

v96 tried to fix this but the ⏳ counter stayed stuck with the same
`upload: No content provided`. v96 was on the right track (materialize the bytes at
save) but had two gaps, both fixed here.

## Gap 1 — the capture timing (the real root cause)
`MediaCapture`'s file inputs did `upload(f, 'photo'); e.currentTarget.value = ''`
— the upload was **not awaited**, so the input was cleared **synchronously, before**
`saveLocalMedia` had read the file's bytes. On iOS, clearing the input releases the
camera's temporary file, so `arrayBuffer()` then read **empty**. v96's
materialize-on-save was reading an already-invalidated file.

**Fix:** the inputs now `await upload(...)` **before** clearing the input, so the
bytes are fully read while the file is still valid. (Captured the input ref first,
since `e.currentTarget` is null after an await.)

## Gap 2 — the stuck old photos weren't self-healing
v96 dropped a queued photo only if its blob `.size` was 0. But an invalidated iOS
File reference reports a **non-zero `.size`** (stale metadata) while its content is
gone — so the 2 already-stuck photos slipped through and kept failing forever.

**Fix:** `syncPendingMedia` now drops a photo when the **upload itself** fails with
"No content provided" / empty-body — that error unambiguously means the bytes are
gone. Other upload errors (transient network) still leave it queued to retry.

## Your 2 stuck photos
They were captured before this fix; their bytes are unrecoverable. On the next
online sync they'll now be **dropped automatically** (the counter clears), and you
re-take them. Photos taken **after** this deploy capture their bytes correctly and
upload fine.

## Build gate
- `npx tsc -b --force` — clean
- `npx vite build` — OK (674ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, baseline

## Test (Pipeline A → confirm Vercel Ready → delete + reinstall the PWA)
1. Open the app **online** once → within ~15s the stuck ⏳ 2 should **clear itself**
   and the red error line should disappear.
2. Open an inspection → **airplane mode ON**.
3. Mark a **Fail** → take a photo. Mark a **Pass** → take a photo.
4. Counter rises; thumbnails show in the Photos tab.
5. **Reconnect** → within ~15s the counter drops to **0**, **no red line**.
6. Reopen the inspection → open a photo full-size → it's a **real image**, not blank.

The v95 diagnostic line stays for this one test so you can confirm a clean run.
Once you confirm, I'll remove it.
