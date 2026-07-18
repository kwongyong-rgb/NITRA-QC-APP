# v90 — offline-created inspections now appear in the lists

Closes the last hole in the offline READ side. Until now an inspection created
offline existed **only in the `nitra-qc-pending` IndexedDB store** and appeared in
**no list at all** until it synced — so an inspector who started one offline and
navigated away had no route back to it. It looked like the work had vanished.

v87 did not fix this and was never going to: the PO cache holds what the **server**
had, and a pending inspection is by definition not on the server yet.

## What's new

Pending inspections are merged into the three screens where you'd look for them,
each with an amber **⏳ NOT SYNCED** badge and the line *"saved on this device,
not uploaded yet"*:

- **My Work** — appears under "In progress" alongside normal drafts.
- **PO page (PoHub)** — appears in that PO's wheel-inspection list.
- **PO list (Home)** — the PO row shows *"⏳ 1 NOT SYNCED"*, and a PO that exists
  **only** because you started an inspection for it offline now appears at all.

New helper `getPendingForUser(userId)` in `offlineSync.ts`.

## Three correctness decisions

**1. Scoped to the signed-in inspector.** Same rule as `syncPendingInspections`:
on a shared device you must never see (or upload) another user's offline work.

**2. Deduped by id against server rows.** In the moment after a sync the row
exists on the server *and* may still be in the pending store — without dedupe it
would appear twice. Offline there is nothing to dedupe against (nothing is
synced), so an empty id set is passed deliberately.

**3. Pending work is never written to the cache.** The cache holds server truth;
pending items are merged in at display time only. Otherwise a synced inspection
could be resurrected from a stale cache entry.

## Two footguns closed along the way

- **Deleting a pending inspection** from the PO page would have hit the server,
  affected 0 rows (it isn't there), appeared to succeed, and then the item would
  reappear from IndexedDB. The delete button is now hidden for pending items;
  they become deletable once synced.
- **Deleting a whole PO** that still has un-uploaded inspections would have wiped
  the server side while the device copy survived and re-synced later, resurrecting
  a PO you meant to delete. Now blocked with a plain-English message.

## No Supabase migration
Client-side only.

## Build gate
- `npx tsc -b --force` (full, not incremental) — clean
- `npx vite build` — OK (583ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, identical to baseline

## Test (Pipeline A → **confirm Vercel shows your commit as Ready** → delete + reinstall the PWA)
1. Online: open the app. The v88 diagnostic card should be **gone** (that's v89).
2. Airplane mode ON.
3. Open a PO → **Add SKU** → part + lot size → **Start Inspection**. Record a few
   Pass/Fail results.
4. **The v90 test — navigate AWAY** (back to the PO, then back to the PO list).
5. **My Work** → the offline inspection is listed with ⏳ NOT SYNCED.
6. **The PO page** → it's in the wheel-inspection list with ⏳ NOT SYNCED.
7. **PO list** → that PO shows "⏳ 1 NOT SYNCED".
   *Before v90, steps 5–7 showed nothing and the inspection was unreachable.*
8. Tap it from any of those lists → it reopens with your results intact.
9. Reconnect. Within a few seconds the ⏳ badges clear and it becomes a normal
   draft — appearing exactly once, not twice.

## Still to do in Stage 2
- **Offline container-loading creation** (v86 did wheel inspections only).
- **Submit for approval still needs a connection.**
- Then Stage 3 (offline photos), Stage 4 (two-user conflict/merge).
