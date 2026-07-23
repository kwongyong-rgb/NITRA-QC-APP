# v94 — online-created inspections stay visible on their PO page offline

## The gap
An inspection created **online** and then worked on **offline** could vanish from
its PO page while offline — leaving no way to navigate back into it. Root cause:
the PO page's offline cache (`po_hub:<uid>:<po>`) is written when the PO page loads
online or during a warm. If you create a SKU inspection and go offline **before**
that PO page was next cached, the cache predates the inspection, and offline the PO
page can't refresh — so the SKU wasn't listed.

Offline-*created* inspections never had this problem (they show via the pending
store merge, v90). This only bit the "start online, continue offline" flow — which
v92 explicitly supports (the flaky-warehouse cycle), so it was worth closing.

## The fix
When the Inspection screen loads a server inspection **online** — the same moment
v92 caches its full row — it now also folds the inspection into its PO-page cache
(`cachePoHubInsp`): upsert by id, preserving the rest of the cached list. Since
creating an inspection online navigates straight into it (an online load), the PO
cache learns about it immediately. Offline, the PO page then lists it and you can
open it (v92 restores it from the full-row cache).

If no PO-page cache exists yet, a minimal one is seeded; the next online PO-page
load or warm overwrites it with the complete picture. Container loadings for that
PO are preserved, not clobbered.

## Scope
Wheel inspections only. Offline container-loading creation is still a future batch;
its PO-page visibility will come with it.

## No Supabase migration
Client-side only.

## Build gate
- `npx tsc -b --force` (full) — clean
- `npx vite build` — OK (737ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, identical to baseline

## Test (Pipeline A → confirm Vercel Ready → delete + reinstall the PWA)
This reproduces the exact case you hit:
1. **Online:** open a PO → Add SKU → start an inspection → mark a couple results,
   take a photo. (Opening it online is what seeds the PO-page cache.)
2. Airplane mode ON.
3. Tap **Back** to the PO page → the SKU you just inspected should be **listed**.
   *Before v94 it was missing.*
4. Tap into it → it opens with your results and photo (v92 restore).
5. Reconnect → everything syncs normally.

## Combined v93 + v94 test
- v93: all-online inspection, navigate away/back → **no** "Unsaved changes" prompt.
- v93: the prompt, when it does appear (a real offline edit), shows the save time
  and a "What's different" list, with "Restore device copy" / "Keep server copy".
- v94: online-created SKU stays visible on its PO page after going offline.
