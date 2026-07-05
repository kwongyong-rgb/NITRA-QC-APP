# v77 — B6 Stage 1: offline safety net

First slice of offline mode. **Pure insurance, additive — online behavior is
unchanged.** It removes most of the "I lost my inspection" risk before any of
the harder sync work.

## What it does
- On every change to the open **wheel inspection** or **container loading**, the
  working content (`form_data` / `summary` / `pallet_data`, and the container's
  `data` / container_no / seal_no / status / summary) is mirrored to **IndexedDB
  on this device**, alongside the normal Supabase write.
- On reopening an inspection, if this device holds content the server doesn't
  (e.g. a save failed while offline, the tab closed, or the app crashed), a
  banner offers **"Restore"** or **"Discard."** Restore loads the recovered
  content and best-effort pushes it to the server.
- The local snapshot is cleared once the content matches the server, or on
  successful submit.

## Safety design
- New `src/lib/localDraft.ts` — a tiny IndexedDB store where **every operation is
  wrapped and fails to a no-op.** If IndexedDB is unavailable or errors, the
  layer silently does nothing and the app behaves exactly as before. The safety
  net can never break the live inspection.
- The pending draft is captured **in memory before** the screen sets state, so
  the snapshot-on-change effect can't clobber it before the restore prompt — no
  race.
- Restore **never silently overwrites**: it prompts, and applying it is the
  user's choice (consistent with the Stage 4 conflict rule).

## Scope / deploy
- **No migrations. No edge-function deploys. App-only (Pipeline A).**
- Files: `src/lib/localDraft.ts` (new), `src/pages/Inspection.tsx`,
  `src/pages/ContainerLoading.tsx`, `src/lib/i18n.tsx` (restore prompt strings).
- Uses the browser's IndexedDB — no new dependency.

## What this is NOT yet (later stages)
- Editing offline still *shows errors* on save today — Stage 2 adds the write
  queue + offline creation (client UUIDs) + reference-data caching so the app
  works fully offline.
- Photos taken offline — Stage 3.
- Multi-device sync conflicts — Stage 4 (flag for review).

## Build gate
- `tsc -b` clean; `vite build` OK; `rules-of-hooks`: 0 across src.
- Remaining lint = the pre-existing `set-state-in-effect` / `no-explicit-any`
  pattern shared with the rest of the app; not in the Vercel build script.
