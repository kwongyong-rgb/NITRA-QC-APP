# v83 — B6 Stage 2, batch 3: offline read foundation (part 1)

The "read side" of offline: stay logged in with no signal, and keep working
reference data on the phone. This is the foundation the write-queue and
offline-creation batches sit on.

## What's new

### 1. Fixed the false offline logout
Previously, going offline and navigating could bounce a logged-in inspector to
the Login screen. Root cause: the app re-fetched your profile on navigation;
offline that fetch returned nothing, and the code misread "couldn't load
profile" as "no user."
- The signed-in profile is now cached (`nitra_profile`).
- If the profile fetch fails while offline/network-down, the app keeps the
  cached profile instead of logging you out.
- Only a genuine sign-out (`SIGNED_OUT` event) actually logs you out — a
  transient null session (e.g. a failed token refresh offline) no longer does.

### 2. Reference-data cache (`src/lib/refCache.ts`)
A fail-safe key/value cache in IndexedDB (separate DB from the Stage 1 drafts),
with a read-through pattern: refresh from the server when online, fall back to
the on-device copy when offline.

### 3. SKU master + sampling settings cached
- **New Inspection** form and the **PartPicker** dropdown now cache the full
  active SKU list and the sampling settings, so offline the part-number list and
  sample-size calculation still work. The whole SKU master is cached (at your
  scale — hundreds to a few thousand — this is ~1–3 MB, trivial for IndexedDB),
  so offline you can pick ANY part whether or not a PO exists.

## Scope note (honest)
- This is **part 1** of the read foundation. **PO-page offline caching**
  (the PO detail + ordered items) is deliberately held for the next batch (v84),
  so that change can be tested in isolation on the admin-heavy PO screens.
- Reads are cached; offline **saving/sync** is still the later write-queue batch.
- A device must have been online at least once (to populate the cache) for the
  offline reads to have anything to show. If the phone is offline long enough
  that the login token fully expires, a reconnect may still be needed to re-auth.

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test
1. Log in online, open **New Inspection** once (so the SKU list caches).
2. Switch to airplane mode.
3. Navigate around → you stay **logged in** (no bounce to Login).
4. Open **New Inspection** → the part-number list still shows, and picking a
   part still shows sample sizes.
