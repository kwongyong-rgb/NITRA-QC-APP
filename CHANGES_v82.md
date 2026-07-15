# v82 — two live-use bug fixes

## Bug 1 — Add Ordered Item: searchable part-number dropdown
The "Add Ordered Item" form (PoInfo) used a plain text box. It now uses the same
searchable **PartPicker** dropdown as the container flow — type to narrow to the
closest part number from the SKU master.
- New `allowFreeText` prop on `PartPicker`: suggestions appear as you type, but a
  part number that isn't in the SKU master yet is still allowed (typed text
  propagates live). Existing PartPicker usages (container flow) are unchanged —
  the prop defaults off.

## Bug 2 — Offline "All Pass / All Fail" no longer crashes the screen
Previously, tapping All Pass/All Fail (or any save) while offline threw the raw
error *"Save failed: TypeError: Load failed"*, and the follow-up reload — which
also failed offline — replaced the working inspection with a full-page
"could not load" error, stranding the user.

Root cause: save/reload treated an offline network failure like a fatal
server/not-found error. Fix (defensive hardening in `Inspection.tsx`):
- `isNetworkErr()` distinguishes an offline/network failure from a real error.
- A failed **reload** while offline now keeps the working screen (and the user's
  optimistic edits) instead of the dead-end error page. A full successful load
  arms this (`loadedOnceRef`).
- A failed **save** while offline shows a calm banner —
  *"You're offline — changes are saved on this device and will sync when the
  connection is back."* — instead of the scary alert. Real (non-network) errors
  still alert.
- Submitting while offline shows a clear "reconnect to submit" message.
- The Stage 1 local-draft safety net (v77) already snapshots the work on-device,
  so nothing is lost.

### Scope note (honest)
v82 stops the crash and preserves offline work **on the device**. It does NOT yet
auto-push offline edits to the server, and it does NOT resolve the two-user
shared-SKU clash (online All Pass vs offline All Fail). Those are the next
batches: the **write queue** (real sync) and the **conflict layer** (flag for
review, never overwrite).

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0
- (Pre-existing lint errors under other rules remain, untouched.)

## Test
- **Bug 1:** PO page → Add Ordered Item → start typing a part number → the
  dropdown narrows the SKU list; you can also type a brand-new part number.
- **Bug 2:** open a wheel inspection while online, then go offline (airplane
  mode) → tap All Pass / All Fail → the taps stay on screen, a calm offline
  banner appears, and you are NOT thrown to an error page. Back online, the next
  save goes through.
