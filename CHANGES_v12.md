# NITRA QC App — v12 (on top of v11)

Interactive report (supabase/functions/interactive-report) polish:
- Photo/Video Appendix now sorts PASS photos before FAIL (matches the PDF).
- Appendix group headers and captions now show proper labels
  (e.g. "Area C — Rim well outside", "TPMS Inspection — dimension matches SKU")
  instead of raw keys like "area c" / "tpms hole".
- Defect Log parameter falls back to the proper label when needed.

No other code changed. Front-end type check: passes. Edge functions: transpile clean.

DEPLOY REMINDER: interactive-report MUST be deployed public (JWT off);
send-report stays JWT-protected. See deploy steps.
