# NITRA QC App — v36 (SKU: Brand Name + Factory)

Adds two fields to every SKU: Brand Name and Factory.

- Database: new columns brand_name, factory (migration 10).
- SKU editor: "Brand Name" and "Factory" inputs.
- SKU list: Brand and Factory columns shown.
- Excel import: recognises headers "Brand Name" / "Brand" and
  "Factory" / "Factory Name" / "Plant". Add those columns to your file and they
  import automatically (existing files without them still work; the fields stay blank).

Changed: lib/standard.ts (Sku type), pages/Skus.tsx; new supabase/10_migration.sql.

## Deploy
1. Supabase SQL Editor: run 10_migration.sql
2. Vercel: replace files, commit, push.

## Verified
- tsc -b: 0 errors.
