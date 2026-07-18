# v89 — remove the diagnostic scaffolding + correct the v88 misdiagnosis

Housekeeping batch after **v87 was verified working on a real device** (iPhone).
No behaviour change to the offline feature itself.

## v87 is CONFIRMED WORKING on-device
Once the Vercel deploy was fixed (v88's `.gitignore` fix), the full v87 flow was
tested on an iPhone and passed end to end:
- PO list survives airplane mode + a full force-close/reopen, with the amber
  "showing data saved on this device at …" banner
- PO detail (info, ordered items, status strip) renders from cache, one banner
- **Add SKU → Start Inspection works offline** — the path that was unreachable
  before v87, which was the entire point of the batch
- `＋ New PO` offline shows the friendly message, not a raw error
- On reconnect the banners clear, the list refreshes, and the offline-created
  inspection syncs

Device diagnostic at the time: `IndexedDB usable: YES`, `entry found: YES — 11
POs`, `last warm: OK · 11 POs`, `37 keys in cache`.

## 1. Removed the temporary diagnostic
The v88 diagnostic card on the PO list is gone, along with its supporting
exports (`cacheAllKeys`, `cacheAvailable`, `getLastWrite`, `getLastWarm`, and the
`lastWrite`/`lastWarm` module state and `note()` bookkeeping in `warmPoCache`).
It was explicitly shipped as scaffolding; it did its job in one round trip.

**Kept**, because they earn their place independently:
- `cacheSet` still returns whether the write landed (it previously swallowed
  failures silently). `warmPoCache` uses it to skip the per-PO fan-out if the
  list write is rejected.
- `Home.load` still **awaits** the cache write rather than fire-and-forget.
- `cacheGetWithMeta` — the "saved at" timestamp behind the offline banner.

## 2. ⚠️ Corrected a wrong root cause recorded in v88
v88 stated as fact — in both `CHANGES_v88.md` and CLAUDE.md §7 — that iOS
standalone PWAs report `navigator.onLine === true` in airplane mode, and called it
"proven on a real device". **It was not.** The device reading was:

```
A. ping says: OFFLINE · navigator.onLine: false
```

They **agreed**. The symptom that prompted the theory (the PO list showing the
ONLINE empty-state message) was entirely explained by the phone running OLD code,
because the Vercel deploy had silently failed. The old build has no offline branch
in that empty state at all, so it could only ever show the online wording.

Both documents now carry the correction. The code change v88 made (user-facing
connectivity checks use the ping-confirmed `useOnline()` hook instead of
`isOffline()`) was **kept** — it is correct on its own merits, because it catches
"connected to Wi-Fi with a dead uplink", which `navigator.onLine` cannot detect.
But it is no longer justified by a platform bug that was never observed.

**Process lesson, now in CLAUDE.md §0:** a failed Vercel build leaves the previous
deployment serving, so the app looks fine while the device runs old code. Confirm
the *deployed commit hash* before interpreting any device test. Two test cycles
were spent chasing a bug that did not exist.

## No Supabase migration
Client-side only.

## Build gate
- `npx tsc -b --force` (full, not incremental) — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total unchanged from baseline

## Test
Deploy (Pipeline A) → **confirm Vercel shows your new commit as Ready** → delete
the PWA from the phone and reinstall.

Light regression check only — no new behaviour:
1. Online: PO list loads, and the amber diagnostic card is **gone**.
2. Airplane mode → force-close → reopen: POs still listed with the offline banner.
3. Open a PO → Add SKU → Start Inspection still works offline.
