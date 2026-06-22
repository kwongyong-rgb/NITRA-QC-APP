# NITRA QC App — v38 (safer SKU import: merge + confirm + undo)

Answers the three concerns about uploading an updated file:

## 1. Updates existing SKUs without wiping data (merge)
Existing part numbers are matched exactly. On a match, ONLY the columns present in
your file are written — everything else on that SKU is kept. So a file with just
Part No. + Brand Name + Factory adds those two fields and leaves size/PCD/ET/etc.
untouched. (Previously it overwrote the whole row, blanking missing columns.)

## 2. Confirm before it writes
Import now shows a preview: "X existing will be updated · Y new will be added",
with the lists of part numbers in each bucket, and a reminder that exact part-number
matching matters (spaces vs dashes). Nothing is written until you click
"Confirm import". This also makes a spaces/dashes mismatch obvious — if you expected
updates but see them all under "new", the part numbers don't match.

## 3. Undo the last import
After importing, an "↶ Undo last import" button appears. It restores every updated
SKU to its pre-import values and removes any SKUs the import added. The backup is
saved on the device, so the button is still there after a refresh — until you import
again or undo.

Changed: pages/Skus.tsx only.

## Deploy
Vercel only: replace files, commit, push.

## Verified
- tsc -b: 0 errors.

## Note
Undo backup is stored per-device (browser local storage). It covers the most recent
import. If you need multi-step history or a server-side backup, that's a larger add.
