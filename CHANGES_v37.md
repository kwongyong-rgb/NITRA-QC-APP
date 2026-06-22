# NITRA QC App — v37 (SKU add/edit as a popup)

- Editing a SKU (✎) and adding a new SKU (+ Add SKU) now open a centred popup
  window instead of a form below the list. Edit fields, click Save (or ✕ / Cancel /
  tap outside to dismiss). The list updates after saving.
- Save now warns if Part No. is empty and surfaces any save error.

Changed: pages/Skus.tsx only.

## Deploy
Vercel only: replace files, commit, push.

## Verified
- tsc -b: 0 errors.
