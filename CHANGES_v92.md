# v92 — offline restore of server inspections (fixes the "Could not load" crash)

---

## Three follow-up bugs found in device testing and fixed (v92B)

The first cut of v92 restored the inspection but introduced/exposed three bugs.
Two shared one root cause.

**Bugs 1 & 3 — a Fail reverted to NA after taking a photo, and a spurious
"Unsaved changes found on this device" prompt appeared.** Root cause: the new
offline-restore branch re-read the *cached* inspection row on **every** `load()`
call, and unlike the pending-inspection path it had **no `loadedOnceRef` guard**.
So: you press F (held in memory + `localDraft`) → taking a photo fires a trailing
`load()` → it re-restored the cached row (which predates your F, since the cache
only updates on an ONLINE load) → your F was clobbered → the `localDraft`-vs-cache
mismatch then popped the restore prompt. **Fix:** the offline-restore branch now
carries the same `loadedOnceRef` early-return guard as the pending path — after
the first load this mount, `load()` keeps the live optimistic state instead of
re-restoring. And on the legitimate first offline remount, offline edits from
`localDraft` are **applied silently** (offline, the device copy is authoritative —
there's no server version to conflict with) instead of prompting, which is what
confused you.

**Bug 2 — "delete failed" when deleting an offline (not-yet-uploaded) photo.**
A queued photo lives only in the local media queue, not on the server, so the
server `delete()` hit 0 rows and reported failure. **Fix:** `deletePhoto` now
detects a queued photo and removes it locally (blob + row) via new
`deleteQueuedPhoto()`, refreshing the grid.

---

Fixes a crash found in v91 device testing: navigating **away from an inspection
and back while offline** dead-ended on a red *"Could not load inspection /
TypeError: Load failed"* card.

## The bug (pre-existing, NOT a v91 regression)
When you navigate away and back, React Router fully remounts the screen. On that
fresh mount `Inspection.load()` fetches the inspection from the server; offline
that fails. It then checks the pending store (offline-*created* inspections) — but
a **server** inspection isn't there, so it fell straight to the hard error. The
`loadedOnceRef` guard that keeps the screen alive offline only works within a
single visit; a remount resets it.

The code path was identical before v91 — it was simply never exercised, because
earlier offline testing used offline-*created* (pending) inspections, which DO
restore from the pending store.

### Why it matters even for "always start offsite" inspectors
The killer is the **flaky-warehouse cycle**: an inspector creates an inspection
offline (pending). The warehouse wifi flickers on for a moment → it syncs to the
server and is **removed from the pending store**. Wifi drops → they navigate back
into it → now it's a server inspection with no pending copy → crash. Given this
app's premise is "connected but no working uplink" wifi, that cycle is likely.

## The fix — full restore from a cached copy
- On every **successful online load**, the inspection's full row + its defects are
  cached to IndexedDB (`insp_full:<uid>:<id>`, namespaced per user like the PO
  cache — inspection data is RLS-scoped per inspector, and IndexedDB survives
  sign-out).
- On an offline remount, when the server fetch fails and it isn't a pending
  inspection, `load()` restores from that cache instead of erroring: the row, the
  SKU (already offline-cached), the defects, and — via the existing `localDraft`
  restore prompt — any fresher offline edits. Offline-taken photos still appear
  through the v91 media-queue effect.
- No cache yet + offline (an inspection literally never opened on this device):
  falls back to a **calm bilingual message** ("reconnect once to open it — after
  that it works offline"), never the red crash.

## Scope note
Server photos taken *online* before going offline don't display offline — their
images aren't on the device and signed URLs need network. That's inherent, not a
regression; offline-*taken* photos show fine. On reconnect everything repopulates.

## No Supabase migration
Client-side only.

## Build gate
- `npx tsc -b --force` (full, not incremental) — clean
- `npx vite build` — OK (956ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, identical to baseline. (One `set-state-in-effect` false positive
  appeared when `load()`'s async body grew — every setState in it runs after an
  await, so there's no cascading render; suppressed with a targeted
  `eslint-disable-line` and a comment explaining why, matching house style.)

## Test (Pipeline A → **confirm Vercel shows your commit as Ready** → delete + reinstall the PWA)
1. **Online:** open a PO, start an inspection, record a couple of Pass/Fail, take
   a photo. (This is the load that seeds the cache.)
2. Airplane mode ON.
3. From the inspection, tap **Back** to the PO, then tap back **into the
   inspection**. It should reopen with your results and photos — an offline
   banner, **not** the red "Could not load" card. *This is the v92 fix.*
4. Make an offline edit (mark another parameter), navigate away and back again →
   the "Unsaved changes found on this device — Restore?" prompt should offer your
   offline edit back.
5. Reconnect → the inspection syncs and behaves normally.
6. **Flaky-wifi simulation (the real scenario):** create an inspection offline →
   briefly turn wifi ON until the ⏳ badge clears (it synced) → turn wifi OFF →
   navigate back into it. Before v92 this crashed; now it restores.

## Stage 2 / 3 status
- Stage 1, 2 — done and device-verified
- Stage 3 (offline photos, wheel inspections) — done (v91), + this restore fix
- Remaining: offline **container-loading** creation (+ photos, reusing
  `offlineMedia.ts`), then **Stage 4 conflict/merge**
