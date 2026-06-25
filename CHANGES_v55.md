# NITRA QC App — v55 (report language toggle: English / German / 中文)

This build is cumulative — it contains everything from v53 (photo-keep-on-Fail→Pass)
and v54 (header redesign, criteria reformat, logo cut-out) PLUS the new language toggle.
Deploying v55 is all you need.

## What's new in v55
A language switch (EN · DE · 中文) on the interactive report header. It translates the
WHOLE report, including the dynamic text you asked about:
- Fixed wording (labels, headings, table, criteria, disposition, photo banners,
  outcome labels, footer) → built-in trilingual dictionary, instant.
- Dynamic text (inspection findings, corrective action / disposition paragraph,
  parameter names, photo comments, piece labels) → translated by Claude inside the
  interactive-report edge function, then CACHED per report + language so a public
  viewer never triggers a fresh translation once it's been generated once.

The English view is unchanged and makes no API calls. Translation only happens when
DE or 中文 is selected.

## ⚠️ This build needs 4 deploy steps (one is new)

### A. Run migration 13 (SQL Editor)
Paste supabase/13_migration.sql → Run. Creates the translation cache table.

### B. Add your Anthropic API key as a Supabase secret  ← NEW, required for DE/中文
This is a key from console.anthropic.com (Settings → API Keys), with credit on it.
It is separate from your Claude chat subscription. In PowerShell, in the repo folder:

    supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx --project-ref nzzktgstpifevaqyapyw

(If the key is missing the toggle still works, but DE/中文 show an amber notice and keep
the original text for the dynamic fields.)

### C. Redeploy the interactive-report edge function (it now does the translating)
    supabase functions deploy interactive-report --project-ref nzzktgstpifevaqyapyw --no-verify-jwt

### D. Push to Vercel (ReportPage toggle + all the v53/v54 UI changes)
Replace files, commit, push, wait green, hard-refresh the report.

## Notes
- Cost: one Claude call per (report, language), cached. Re-amending a report changes
  its content hash and re-translates once on next view.
- Photo/section grouping headers, disposition wording, and outcome labels are
  translated from the built-in dictionary (deterministic), so they're always correct.
- Part numbers, sizes, measurements and piece refs (#3) are kept untranslated.

## Verified
- tsc -b: 0 errors. interactive-report esbuild: 0 errors.
