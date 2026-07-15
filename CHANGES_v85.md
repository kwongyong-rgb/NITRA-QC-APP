# v85 — fix: SKU list now caches proactively (offline New Inspection)

## Problem found in v83 testing
The New Inspection part-number list was still empty offline. Root cause: v83
cached the SKU list *lazily* — only if you had opened the New Inspection screen
while online first. The normal flow (login → PO → airplane → Add SKU) never
opened that screen online, so its cache was never filled.

## Fix
`warmRefCache()` in `refCache.ts`, called from `App.tsx` whenever you are
**logged in and online**. It proactively downloads and stores:
- the full SKU master (for the New Inspection form),
- the 4-column SKU subset (for the PartPicker dropdown),
- the sampling settings.

So the SKU list is on the phone no matter which screen you open first, and it
refreshes every time you're online (and again the moment connectivity returns).

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test
1. Log in **online** (just being logged in and online warms the cache — you no
   longer need to open New Inspection first).
2. Open a PO while you still have signal, then switch to **airplane mode**.
3. Tap **Add SKU** → New Inspection → the part-number list should now show and be
   searchable, and picking a part + entering a lot size still calculates the
   Appearance / Functional sample sizes.

## Still expected offline (next batch, v86)
- The **PO list and PO detail pages are still empty** when you navigate to them
  fresh while offline. That's the PO-page caching batch (v86).
- Saving/starting an inspection offline still won't sync — that's the write-queue
  batch after v86.

## Deploy
Pipeline A only (no Supabase SQL, no PowerShell). Extract → commit + push →
Vercel → delete + reinstall the PWA on the phone.
