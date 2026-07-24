# v100 — offline actions are instant + the "disappearing photos" mystery solved

## The disappearing photos: NOT data loss — a display refresh bug (SOLVED)

Kwong ran the diagnostic SQL against production. **All 7 photos were in the
database**, spanning both the online and offline runs (01:59–02:07), including the
video. Nothing was ever lost. That evidence turned a scary unknown into a precise,
one-line cause — worth the round trip.

**Cause:** when the inspection screen loads while offline it deliberately runs
`setServerPhotos([])`, because server-hosted images can't be displayed without a
network. But `load()`'s dependencies don't include `online`, so **it never re-runs
when connectivity returns** — the blank Photos tab persisted until the user
navigated away and back. Exactly matching the report: *"it only shows after I go
back to online mode and refresh the page."*

**Fix:** a reconnect effect on the inspection screen. On the offline → online
transition it (1) pushes anything edited while offline, then (2) re-loads from the
server so photos and defects come back on their own. This also completes the v99
banner fix, which pushed the edits but never re-fetched.

---

# Also in v100 — offline actions are instant (removed the doomed network calls)

Reported: saving the FIRST photo offline took about a minute before the popup
closed; the second was much quicker.

## Cause — network timeouts, not storage
Offline, a Supabase call does **not** fail fast. It hangs until the OS gives up on
the connection — up to ~a minute for the first attempt. Once iOS marks the host
unreachable, later calls fail almost immediately. That is exactly the "first one
slow, second one quick" pattern, and it's the giveaway that this was a timeout,
not a save problem.

`MediaCapture` already skipped the network when offline (which is why *taking* the
photo was fast) — but the **Save** handlers and several other paths did not, so
they sat waiting on calls that could never succeed.

## Fixed — skip calls we know will fail
All guarded with `isOffline()` (`navigator.onLine === false` = definitely offline,
so skipping is definitely correct — the documented safe use of that signal):

| Path | Was |
|---|---|
| `DefectModal.save()` | 1 doomed defect query before queueing the photo |
| `PassPhotoModal.save()` | 1 doomed photos insert |
| `Inspection.ensureDefect` / `removeDefect` | doomed on every Fail/un-Fail tap |
| `Inspection.saveFd` | doomed inspection update on every result change |
| `setResult`'s photo verdict sync | doomed photos update |
| **`Inspection.load()`** | **2 doomed reads (inspection + SKU) — and `load()` runs after EVERY action** |

The last one mattered most: every mark and every photo triggers a reload, so the
whole screen felt frozen offline. The offline paths (pending store → cached copy →
cached SKU) are unchanged — we now go straight there instead of arriving a minute
late via a timeout.

**Nothing about the online path changed.** These guards only trigger when the
device is definitely offline; online, every call runs exactly as before.

## Build gate
- `npx tsc -b --force` — clean · `npx vite build` — OK (648ms)
- rules-of-hooks — **0** · lint total 75, identical to baseline

## Test (commit V100 → push → Vercel Ready → delete + reinstall PWA)
1. **ONLINE first (regression check):** inspection → Fail → photo → Save → count
   updates, photo in Photos tab. Must still work.
2. **Airplane mode.** Mark a Fail → **the tap should register instantly**.
3. Take a photo → Save → **the popup should close in about a second, not a minute**
   — including the FIRST one.
4. Take a second photo → same speed.
5. Reconnect → counter clears, offline banner clears, photos upload.
