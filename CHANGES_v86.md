# v86 — B6 Stage 2: offline inspection creation + auto-sync (write side)

You can now **start and fill in a wheel inspection while offline**, and it uploads
itself when you're back online.

## What's new
- **Start Inspection works offline.** `NewInspection` mints the inspection's id on
  the device (client-minted UUID — inserts cleanly on sync, verified against the
  live INSERT RLS), saves it on the phone, and opens it. You fill it in exactly
  like normal (v82 hardening handles the offline edits).
- **The inspection screen loads an offline-created inspection** from the phone when
  the server doesn't have it yet, resolving the SKU from the offline cache.
- **A "⏳ Not synced yet" banner** marks an inspection that only exists on the phone.
- **Auto-sync on reconnect.** When connectivity returns, the inspection (and its
  results) uploads and its defect rows are rebuilt from the recorded Fails
  (base + extra pieces), then it becomes a normal live inspection. The open screen
  syncs itself (capturing in-flight edits); the app also syncs any offline-created
  inspections in the background.
- **New module** `src/lib/offlineSync.ts` (pending store + queue + sync).

## Data-integrity hardening (from an adversarial review)
- Sync is **scoped to the logged-in inspector** (a foreign device-shared pending
  row is never mis-uploaded / RLS-rejected).
- The open inspection syncs itself and the batch sync **skips it** — no two-writer
  race; while pending, saves go to the local copy, not a doomed server write.
- **Extra-piece** Fails are included in the rebuilt defect list.
- **Start is blocked until sampling settings are available** (no 0-sample
  inspections) — connect once so they cache, then offline start works.

## No Supabase / PowerShell
Pipeline A only. No migration (migration 22 + the existing INSERT RLS already
support client-minted ids). Extract → commit + push → Vercel → delete + reinstall
the PWA.

## Test
1. Log in **online** (warms the SKU + settings cache). Open a PO while online.
2. Switch to **airplane mode**.
3. **Add SKU** → pick a part + lot size → **Start Inspection** → it opens with the
   **⏳ Not synced yet** banner.
4. Record some Pass/Fail results (they stay; no crash).
5. Turn airplane mode **off**. Within a few seconds the banner clears — the
   inspection is now on the server with its results, appears in the PO / lists, and
   any Fails have defect rows.

## Still NOT covered (next batches — expected)
- **Offline photos/videos** — taking photos offline is the next stage (Stage 3).
- **Two-user shared-SKU clash** (online Pass vs offline Fail) — the conflict batch.
- **Offline container-loading creation** — quick follow-up after the wheel flow.
- An offline-created inspection **isn't listed on other screens until it syncs**
  (reach it right after creating it; after reconnect it appears normally).
- **Submitting for approval** needs a connection — reconnect and let it sync (the
  banner clears) first.
