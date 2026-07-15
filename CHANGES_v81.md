# v81 — B6 Stage 2, batch 2: connectivity awareness

First frontend slice of Stage 2. The app now *knows and shows* whether the
device is actually reachable to the server. Nothing about inspecting or saving
changes yet — this is the foundation the write-queue / offline-creation batches
build on.

## What's new
- **`src/lib/connectivity.ts`** — a `useOnline()` hook + `pingReachable()`.
  - Treats `navigator.onLine === false` as an immediate "offline" signal, but
    confirms the *positive* case with a lightweight reachability ping to the
    Supabase GoTrue health endpoint. This catches warehouse Wi-Fi that is
    "connected" but has no working internet (captive portal / dead uplink).
  - Ping uses `mode:'no-cors'` (we only care that the round-trip completes,
    not the body) with a 5s timeout and a cache-buster; re-checks every 30s,
    on the browser online/offline events, and when the tab becomes visible.
  - Never throws; safe against setState-after-unmount.
- **Header pill** — a small bilingual status badge in the top bar:
  **Online / 在线** (green) or **Offline / 离线** (grey). Always visible.
  - i18n keys `online` / `offline` added.
  - `.netpill` styles added to `index.css`.

## DB (already deployed separately)
- **Migration 22** (`supabase/22_migration.sql`) — server-authoritative
  `updated_at` trigger on `inspections` + `container_loadings`. Included here
  for repo history; it was run in the SQL Editor in the previous batch.

## Not in this batch (coming next)
- Write queue (retry-safe, idempotent sync)
- Offline creation of inspections (client-minted UUIDs)
- Reference-data caching
- Conflict / merge screen

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test (on the iPad, after Pipeline A + reinstall)
- Put the iPad in airplane mode → the header pill flips to **Offline / 离线**.
- Turn it back on → within a few seconds it flips to **Online / 在线**.
- Switch the app language → the pill reads 在线 / 离线.
