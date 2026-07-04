# v71 — QW-2: Quick wins, part 2

## New
- **Sticky action bar — Inspection** (draft/rejected, own inspection): shows
  current tab progress ("Visual · Piece 2: 14/23" + pieces complete), a
  "Next ↓" jump to the first unanswered item (auto-advances to the next
  incomplete piece when the current one is done), and an always-visible
  Submit. Bottom padding added so content never hides behind the bar.
- **Sticky action bar — Container loading** (draft/rejected, editable): shows
  current pallet check progress + pallets complete, "Next ↓" jump to the first
  unanswered packing check (auto-advances to the next incomplete pallet), and
  Submit.
- **Off-PO flags on reports** (completes the Phase 4 loop): parts recorded
  against a PO they aren't listed on now show a ⚠ NOT ON PO badge
  (EN/DE/中文) on the public container report page, the container PDF, and as
  a marker in the consolidated PO report contents.

## Deploy
- PowerShell (both PUBLIC report functions — keep --no-verify-jwt):
  supabase functions deploy container-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
  supabase functions deploy po-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt
- App: push -> Vercel -> reinstall PWA.
- No SQL.
