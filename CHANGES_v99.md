# v99 — reconnect fixes + faster online detection + evidence for the missing photos

From Kwong's structured test report on v98. Online capture is confirmed working
again (scenario 1, step 1) — the v98 revert did its job.

## Fixed in this batch

### 1. Offline banner stayed after reconnecting (scenario 1, step 3)
Reconnecting while sitting on an open SERVER inspection cleared the ⏳ counter but
left the "You're offline — changes are saved on this device…" banner. Nothing
re-ran on the connectivity flip for a server inspection. Now, when connectivity
returns with unsaved offline edits on screen, the app **pushes the on-screen state
to the server and clears the banner**.

**Why no Restore/Discard prompt here (question answered):** while the page has
stayed open, the on-screen copy IS the newest truth — it started from the server
row and accumulated only this user's edits. Asking would mean choosing between the
thing you're looking at and an older copy of it. The prompt exists for the other
case: a FRESH open that finds a mismatched leftover, where the app can't know
which copy you want. (Two DIFFERENT USERS editing the same inspection is Stage 4 —
conflict/merge — still to come and unchanged by this.)

### 2. New PO invisible in the offline PO list (the reported bug, part 1)
The PO-list cache is written when the list screen loads online. Creating a PO
navigates immediately INTO it — so the list cache predated the PO, and offline the
new PO was missing (and its inspection unreachable). Now the PO page folds its own
PO into the list cache on every online load.

### 3. Online pill slow to return (the toggle question)
Partly wifi/OS (iOS takes seconds to re-route after wifi returns), but partly
ours: re-verification ran every **30s**, browser online events are unreliable in
iOS PWAs, and SPA navigation triggers no check at all — so the stale pill could
sit for up to 30s, which reads as broken. Recheck is now every **10s** plus a
re-verify on window focus. (Navigating pages still doesn't check — the pill lives
above the pages — but the worst case is now ~10s.)

### 4. Photo discards are no longer silent
The red diagnostic line hid the moment the queue count hit 0 — so if sync
DISCARDED an unrecoverable photo, the evidence vanished with it. A discard notice
now stays visible after the queue empties. This matters for investigating part 2
of the bug (below).

## NOT fixed here — the disappearing photos (bug, part 2): evidence first
"Photos taken both online and offline are all gone" after reconnect+refresh has
several possible explanations with DIFFERENT fixes (rows never inserted; rows
inserted then not displayed; photos silently discarded by the self-heal because
they were captured during a flaky 'online' window and queued with dead bytes).
Guessing has cost us cycles before (v97). The SQL below settles what's in the
database; the answer decides the fix.

## Expected, not a bug (scenario 1, step 2)
Photos taken ONLINE aren't viewable while OFFLINE: their images live on the
server and the signed URLs need network (v92 scope note). Offline-taken photos
show because their bytes are on the device. Everything shows again on reconnect.

## Build gate
- `npx tsc -b --force` — clean · `npx vite build` — OK (869ms)
- rules-of-hooks — **0** · lint total 75, baseline

## Test (commit V99 → push → Vercel Ready → delete + reinstall PWA)
1. **ONLINE:** photo capture still works (regression check).
2. Open an inspection online → airplane mode → mark results, take photos →
   reconnect WITHOUT leaving the page → within ~15s: counter clears AND the
   offline banner clears.
3. Create a NEW PO online → add SKU → start inspection → airplane mode → back to
   the PO list → **the new PO is listed**.
4. Toggle wifi off/on while on any page → the pill should flip within ~10–15s.
5. Re-run the disappearing-photos scenario; if photos vanish again, check for a
   red "discarded" line under the header and screenshot it, then run the SQL.
