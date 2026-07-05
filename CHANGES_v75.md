# v75 — B4 strip revisions

Feedback applied to the PO command-center strip (from B4/v74):

- **Removed the "Loaded" stage.** An approved container-loading inspection
  already means those pieces are loaded, so Loading is the terminal QC stage.
  This also retires the approved-vs-all "loaded" counting question — the strip
  now measures loading directly.
- **Per-stage counts** under each header so progress is explicit:
  - PO Ordered Items — `{n} SKUs`
  - Inspection — `{approved SKUs}/{ordered SKUs} SKUs` (e.g. "In progress · 5/6 SKUs")
  - Loading — `{approved-loaded pcs}/{ordered pcs} pcs` (e.g. "✓ 600/600 pcs")
- **"Shipping" cap renamed to "Shipped."** Still the de-emphasised dashed cap
  marking the separate shipping app's territory.
- **"Items" renamed to "PO Ordered Items"** for clarity.

## Scope / deploy
- App-only. **No migrations, no edge-function deploys.** Pipeline A: extract →
  GitHub Desktop commit+push → Vercel → reinstall PWA.
- Files touched: `src/lib/poStatus.ts` (3 stages + counts; `sumLoadedByPart`
  and `getOrCreatePoId` unchanged), `src/components/PoStatusStrip.tsx`,
  `src/index.css` (strip typography).
- `PoInfo` and its Ordered/Loaded/Remaining table are unchanged.

## Build gate
- `tsc -b` clean; `vite build` OK; `rules-of-hooks`: 0 across src.
