# v103 — edit lot size on an existing inspection

Requested: an inspector realised a lot size was entered wrong
(`PU17TL75511435601GM`) and needs to correct it.

## What's new
An **✎ Edit lot size** button next to the lot size in the inspection header. It
opens a small dialog: type the corrected lot size, see the recalculated sample
sizes, save.

- Changing the lot size **recalculates the appearance and functional sample
  sizes** from the sampling standard (`sampleSizes()`), exactly as New Inspection
  does — so the piece counts, the additional-inspection caps (v101) and the 100%
  logic all stay correct for the new lot.
- Combined with v101's lot caps: correcting a lot of 20 down to 10 immediately
  makes the extra-piece requirement 2, not 4, etc.

## Who can edit (matches the request exactly)
The button uses the existing `editable` rule:
- **Not submitted** (draft or rejected): the inspector who owns it — OR an admin.
- **Submitted or approved**: **admin only** (via the same amend privilege), and
  the change is written to the amendment audit log.

## Notes / limits
- **Online required.** A lot-size change writes three columns (lot + both sample
  sizes) and the offline pending/draft stores don't carry those, so this is
  gated online with a clear message. A lot-size correction is a review-time
  action done with a connection; offline support can be added later if needed.
- The admin "Amend details" modal still exists and can set the sample sizes
  manually; this new control is the quick, standard-driven path for everyone.

## Build gate
- `npx tsc -b --force` — clean · `npx vite build` — OK (669ms)
- rules-of-hooks — **0** · lint total 71 (unchanged)

## Test (commit V103 → push → Vercel Ready → delete + reinstall PWA)
1. **As inspector, on a draft:** open the inspection → ✎ Edit lot size → change
   10 → 12 → preview shows the new App/Fun → Save → header updates.
2. Confirm the sampling behaves for the new lot (e.g. lot 12, fail #6 → asks for
   4 additional; lot 10 → asks for 2).
3. **As admin, on a submitted inspection:** the ✎ button is present; edit works
   and appears in the amendment history.
4. **As inspector, on a submitted inspection:** the ✎ button is NOT shown.
5. Offline: the button shows but tapping Save gives the "needs a connection"
   message (expected).

---

## Next batch (photo change "B", approved, built separately on purpose)
Background upload + light compression (~1.2 MB) + auto-delete-after-upload for
inspection photos. Building it alone so this high-blast-radius path (the one that
broke in v97) is tested in isolation. Auto-delete already happens today once a
queued photo uploads — the local copy is removed in the same step.
