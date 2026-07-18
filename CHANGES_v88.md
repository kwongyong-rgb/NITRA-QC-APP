# v88 — fix the iOS `navigator.onLine` bug + temporary offline-cache diagnostic

Follow-up to v87, driven by live testing on an **iPhone**: the PO list opened
offline (pill correctly said Offline / 离线, login survived, app booted from the
service worker) but **no POs were displayed**, and the empty card showed the
ONLINE message.

## Bug 1 — CONFIRMED AND FIXED: `navigator.onLine` lies on iOS PWAs

The empty state used `isOffline()` (i.e. `navigator.onLine === false`). In an iOS
**standalone PWA in airplane mode, `navigator.onLine` still reports `true`** — so
the check said "online" and rendered "No POs yet. Tap ＋ New PO to start."

This directly violated a rule written into CLAUDE.md §7 in the previous batch:
*"`isOffline()` is for BLOCKING WRITES ONLY — never for deciding what to render."*
v87 then used it for rendering in exactly one place. Fixed.

**All user-facing connectivity decisions now use the ping-confirmed `useOnline()`
hook** — the same source as the header pill, which was correct throughout:
- `Home` — empty-state message, create-PO guard, delete-PO guard
- `PoHub` — add container, delete PO / inspection / container guards
- `PoInfo` — save info, add/update/remove item, Excel import guards

`isOffline()` survives in exactly ONE place: the lazy PO-create guard in
`poStatus.getOrCreatePoId()` and `PoInfo.load`, which is non-component code with
no hook available. That's acceptable — a false "online" there just means the
insert is attempted and fails with a network error, creating nothing.

**Side effect worth knowing:** on iOS this bug also meant the offline write guards
never fired, so v87 test step 6 (＋ New PO offline → friendly message) would have
shown a raw error instead. That's fixed by the same change.

## Bug 2 — NOT YET FOUND: the cache read came back empty

The PO list cache read returned nothing even though it should have been written
while online. The read sits in the `catch` branch and runs regardless of what
`isOffline()` reports, so bug 1 does not explain it.

Rather than guess, this batch makes the cache layer **observable**. It was
designed to swallow every error (fail-safe by intent), which also made an empty
cache impossible to diagnose on a phone with no developer console.

### What's now visible
- **`cacheSet` returns whether the write landed** (was `void`, silently swallowed).
- **`getLastWrite()`** — key + OK/FAILED + time of the most recent write.
- **`getLastWarm()`** — whether `warmPoCache` ran, how many POs it cached, and if
  it bailed, exactly why (`skipped: navigator.onLine=false`, `query error: …`,
  `PO list write FAILED`, `threw: …`).
- **`cacheAllKeys()`** — every key in the store. This is the one that catches a
  key MISMATCH (written under one user id, read under another) at a glance.
- **`cacheAvailable()`** — is IndexedDB usable in this context at all.
- **Temporary diagnostic card** on the PO list (staff only, A–H lines).

### Also removed one candidate outright
`Home.load` now **awaits** the cache write instead of fire-and-forget, so "the
write hadn't finished before airplane mode" is no longer possible.

## Note on the diagnostic card's audience
Proposed as admin-only; shipped as **all staff (admin + inspector)** so the same
card is visible if testing from an inspector account. Customers never see it.

**This card is temporary scaffolding — remove it once the cause is found.**

## No Supabase migration
Client-side only.

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK (built in 822ms)
- `npx eslint src | grep -c rules-of-hooks` — **0**
- Lint total 75, identical to baseline — no new tolerated errors.

## Test
Deploy (Pipeline A) → **delete the PWA from the iPhone home screen and REINSTALL**.
1. Open **online**, log in, land on the PO list. Note diagnostic lines E/F/G.
2. Airplane mode. Pill → Offline / 离线.
3. Force-close, reopen. Read lines **A–H** aloud/screenshot — they say precisely
   which of the four candidate causes it is.
4. Also confirm the empty card (if still empty) now shows the OFFLINE wording, not
   "No POs yet" — that alone proves bug 1 is fixed.
