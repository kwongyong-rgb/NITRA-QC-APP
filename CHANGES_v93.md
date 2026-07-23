# v93 — fix the spurious "Unsaved changes" prompt + make it informative

## Bug: the prompt appeared on inspections done entirely ONLINE
The "Unsaved changes found on this device" prompt fired even when nothing had been
done offline. Root cause: Postgres stores `form_data` (and `summary`, `pallet_data`)
as **JSONB, which reorders object keys** on every round-trip. The device's saved
copy keeps keys in the order they were created; the server returns them in JSONB's
order. The comparison used `JSON.stringify`, which is **order-sensitive**, so two
byte-for-byte-identical inspections looked "different" and popped the prompt.
(Toggling a result off also leaves an `undefined`, another stringify mismatch.)

**Fix:** compare **canonically** — a `stableStringify` that recursively sorts keys
and drops `undefined`. Identical data now compares equal, the leftover device draft
is cleared, and the prompt no longer appears for all-online work. It now shows only
when the device copy and the server genuinely differ.

## Improvement: the prompt now says WHAT differs and WHEN it was saved
Per the request, when the prompt does legitimately appear it now shows:
- **When the device copy was saved** (timestamp from the local draft).
- **A plain-English list of the differences**, e.g.:
  - `Marks — this device: 12 (2 fails) · server: 10 (1 fail)`
  - `Disposition — this device: Approved for loading · server: (none)`
  - `Remarks / corrective action differ`
  - `Pallet packing differs`

So the inspector can tell which copy is the right one instead of guessing.

The buttons are also clearer: **"Restore device copy"** vs **"Keep server copy"**
(was "Restore" / "Discard", which didn't say which side won). These labels are
shared with the container-loading restore prompt, which benefits too.

## Not in this batch — a separate issue you also spotted (see below)
You noted that after doing an offline photo test on a SKU, that SKU didn't appear
on the PO page offline — only a SKU inspected online did. That's a **different**
gap: an inspection created ONLINE and then worked on OFFLINE isn't in the PO-page
cache if the cache was last written before it existed, and offline the PO page
can't refresh. Offline-*created* inspections don't have this problem — they show
via the pending-store merge (v90). This is proposed as its own fix (v94); it does
not affect the offline-first workflow your inspectors actually use.

## No Supabase migration
Client-side only.

## Build gate
- `npx tsc -b --force` (full) — clean
- `npx vite build` — OK (798ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, identical to baseline

## Test (Pipeline A → confirm Vercel Ready → delete + reinstall the PWA)
1. **Online**, create a new SKU inspection, mark several results, add a
   disposition, take a photo. Navigate away and back a few times.
   → **No "Unsaved changes" prompt should appear.** (This is the fix.)
2. To see the improved prompt deliberately: mark a result **offline** (so it can't
   reach the server), then reconnect and reopen the inspection. The prompt should
   now show the save time and a "What's different" list. Pick "Restore device copy"
   to keep your offline mark, or "Keep server copy" to drop it.
