# v84 — fix: Add Ordered Item part-number dropdown was clipped

## Bug
On the PO page, "Add Ordered Item" showed no part-number list even online. The
v82 fix (wiring the searchable PartPicker into that form) was correct, but the
dropdown was being **clipped by the modal**: `.modal` has `overflow-y: auto`, and
the picker's dropdown drops *below* the input, so inside that short popup the
list was cut off to nothing.

## Fix (PoInfo add-item modal only)
- The add-item modal now uses `overflow: visible` so the dropdown can paint past
  the modal edge.
- The part-number field is given its own stacking context so the dropdown paints
  cleanly over the quantity field beneath it.
- No other modal is touched.

## Build gate
- `npx tsc -b` — clean
- `npx vite build` — OK
- `npx eslint src | grep -c rules-of-hooks` — 0

## Test (online)
- PO page → Add Ordered Item → tap the Part Number field → the SKU list should
  now appear; typing narrows it; you can also type a brand-new part number.

## Note
This is a focused online bug fix. The **PO-page offline caching** (the "PO page
empty offline" symptom) is the next batch — now **v85**.
