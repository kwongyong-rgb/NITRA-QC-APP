# NITRA QC App — v23 (100% prefill fix + Batch 2: Photos tab)

## 100% Inspection prefill
When a parameter triggers 100% inspection, the pieces that already failed the
initial check are now PRE-MARKED as F and LOCKED (🔒) in the 100% grid — no need
to re-inspect them. They count toward Checked/Fails. (Display-only: they are not
written into the 100% data, so the report's pass/fail math stays correct — no
double counting.)

## Batch 2 — Photos tab reworked
- The gallery is now split into two sections: "✓ Approved Inspection Photos" and
  "✗ Failed Inspection Photos", each grouped by inspection parameter.
- A top toggle (All / Approved / Failed) so you don't scroll through everything.
- Each photo/video keeps the ↻ Reassign action (move to another parameter) and
  gains a NEW ⧉ Copy action — attach the SAME image to several parameters at once
  (e.g. one back-of-wheel shot for every back-marking check). The original stays
  put; copies are linked to the same stored image.
- Required-shot checklist photos are unchanged (still in their own section above).

Changed: pages/Inspection.tsx, components/HundredPctCheck.tsx,
components/PhotoModal.tsx. No edge-function, i18n, or schema changes.

## Deploy — Vercel ONLY
Replace files, commit, push, wait Ready. (No Supabase redeploy needed.)

## Verified
- tsc -b: 0 errors.

## Next
Batch 3: Pallet Packing (per-pallet grid). Then Batch 4 (PO hub + Container
Loading + consolidated report), Batch 5 (amend + version history), then phone
piece-by-piece.
