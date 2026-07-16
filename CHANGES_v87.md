# v87 — B6 Stage 2: PO-page offline caching (finishes the offline READ side)

The PO list and PO detail pages now survive going offline. This is what makes the
v86 offline-inspection flow actually **reachable** onsite: previously an inspector
who arrived with no signal got a blank PO list, couldn't open a PO, and so could
never reach **Add SKU → Start Inspection**. The offline creation path existed but
had no door into it.

This is also the first batch built in **Claude Code** (direct repo edits) rather
than shipped as a full-codebase zip. See CLAUDE.md §0 "Workflow history".

## What's new

### 1. PO list + PO detail work offline
`Home`, `PoHub`, `PoInfo` and `PoStatusStrip` now use the **read-through** pattern
already established by `refCache` (v83/v85): try the live fetch → cache it on
success → fall back to the on-device copy when the fetch fails.

### 2. Stale data is never passed off as live
`cacheGetWithMeta()` returns the `savedAt` timestamp the cache already stored
(`cacheGet` just discarded it). When a PO screen renders from cache it shows an
offline banner with the exact save time. **PoHub owns the ONE banner for the whole
PO page** — `PoInfo` and `PoStatusStrip` fall back silently, so the user sees a
single clear notice instead of three stacked ones.

### 3. Proactive bulk warming (`warmPoCache`)
Called from `App.tsx` on the same `[online, profile]` trigger as `warmRefCache`.
Five bulk queries (`pos`, `inspections`, `container_loadings`, `po_items`,
`inspection_pos`) fan out to populate the PO list cache **and every PO's detail
cache** in one pass.

This deliberately repeats the **v85 lesson**: lazy per-screen caching (v83) failed
because users never opened the screen online first. Warming only the PO *list*
would hit the identical trap — an inspector would still find an empty PO *detail*
page onsite. Do not regress this to lazy-only.

### 4. Cache is namespaced per user (privacy)
**This is a real fix, not a precaution.** Unlike SKUs/settings (identical for
everyone), PO data is scoped per user by RLS — an inspector only sees their own
inspections and container loadings. IndexedDB survives sign-out, so on a **shared
iPad** an un-namespaced cache would have shown user A's POs to user B. Keys are
`po_list:<uid>`, `po_hub:<uid>:<po>`, etc. A different user gets a cache **miss**
rather than someone else's data — it fails closed.

### 5. TWO lazy PO-create paths guarded (not one)
CLAUDE.md §8 only flagged `PoInfo`'s. There is a second: `getOrCreatePoId()` in
`poStatus.ts`, called by **`PoStatusStrip`** (renders on every admin PO-page view)
and `CustomerAccessCard`. Both are now guarded.

Why it matters: offline, the "does this PO exist?" read returns nothing — not
because the PO is missing, but because there's no network. Without the guard,
merely **opening** a PO page offline would try to insert a phantom `pos` row.

New shared helper `isOffline()` in `connectivity.ts`. It uses `navigator.onLine
=== false`, which is correct **specifically for blocking a write**: that signal is
unreliable for the positive case (hence `pingReachable`), but its negative is
trustworthy, so it cannot produce a false negative. The remaining case (onLine
true, dead uplink) is harmless — the write just fails with a network error and
nothing is created.

### 6. Online-only writes now say so plainly
PO setup is online-only by design (§5 scope). Create/delete PO, add/edit/remove
ordered items, Excel import, add container, and delete inspection/container now
show a clear bilingual "you're offline" message instead of failing with a raw
network error. `delPO` offline was especially bad before: it failed on the first
delete and alerted a raw error, and a cached list may be stale anyway.

## Bug this fixes on the way through
`PoInfo.load` called `setRow(null)` and cleared items whenever the query came back
empty — so going offline actively **wiped** the PO info and ordered items off the
screen. The cache fallback now intercepts before that.

## No Supabase migration
Reads and client-side caching only. Nothing to paste into the SQL Editor.

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK (built in 641ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, **identical to the pre-change baseline** (measured by stashing the
  changes and re-running): no new tolerated errors introduced.

## Test (Pipeline A → **delete the PWA from the home screen and REINSTALL it**)
1. Open the app **online** and log in. Land on the PO list. That's the whole warm —
   no need to visit each PO.
2. Airplane mode. Header pill flips to **Offline / 离线**.
3. **Force-close and reopen the app** (the real scenario: arriving onsite with no
   signal). The PO list shows, with an offline banner and a "saved at" time.
   *Before v87 this page was blank.*
4. Tap a PO. Info, ordered items and the status strip all render from cache.
   *Before v87 this was blank too.*
5. **The point of the batch:** from that offline PO page → **Add SKU** → pick a
   part → lot size → **Start Inspection**. Opens with the ⏳ Not synced yet banner;
   Pass/Fail recording works.
6. Still offline, tap **＋ New PO** (as admin) → clean "needs a connection"
   message, not a raw error.
7. Reconnect. Banners clear, list refreshes live, the step-5 inspection syncs and
   appears in the PO normally.
8. Back online, confirm **no blank/phantom PO rows** appeared in the list.
9. (Shared-device check) Sign out, sign in as a different inspector while offline →
   you should see **no** POs, not the previous user's.

## Still NOT covered (unchanged by v87 — do not assume the PO page looking healthy means these are done)
- **Offline-created inspections don't appear in the PO list until they sync.** The
  cache holds what the server had; a pending inspection isn't on the server yet.
  Fixing this means merging the `nitra-qc-pending` store into these views — its own
  batch.
- **Offline container-loading creation** — still not built (v86 did wheel
  inspections only). `addContainer` now blocks cleanly offline instead of erroring.
- **Submit for approval** still needs a connection.
- **Offline photos/videos** — Stage 3, not started.
- **Two-user shared-SKU conflict** — Stage 4, not started.
