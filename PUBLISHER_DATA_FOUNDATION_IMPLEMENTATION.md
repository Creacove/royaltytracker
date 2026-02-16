# Publisher Data Foundation Implementation (MVP)

## Implemented in this repo

1. Database migration: `supabase/migrations/20260213231500_publisher_grade_data_foundation.sql`
- Added new tables: `ingestion_files`, `source_rows`, `source_fields`, `review_tasks`, `normalization_rules`.
- Extended `cmo_reports` with file hash, source format, statement metadata, pipeline version, and quality gate status.
- Extended `royalty_transactions` with source lineage, dual-currency fields, mapping confidence, and validation blockers.
- Expanded report status model to include `completed_passed`, `completed_with_warnings`, `needs_review`.

2. Hardened extraction pipeline: `supabase/functions/process-report/index.ts`
- Removed custom-extractor validation bypass (all modes now validated).
- Removed hardcoded `USD`; now derives original/reporting currencies from source data.
- Added ingestion hash + idempotency duplicate gate.
- Added deterministic parser guards for numeric/date anomalies.
- Added provenance persistence (`source_rows`, `source_fields`) before canonical publish.
- Added quality gate logic (`passed`, `needs_review`, `failed`) and non-hallucination blockers.
- Added review-task generation for blockers/low-confidence rows.

3. New edge-function endpoints
- `create-ingestion-file`
- `run-extraction`
- `run-normalization`
- `run-validation`
- `submit-review-resolution`
- `publish-canonical-rows`
- `reprocess-file`

4. UI updates
- Multi-file upload for `pdf/csv/xlsx/xls` in `src/pages/Reports.tsx`.
- New Data Quality Queue page: `src/pages/DataQualityQueue.tsx`.
- Added route and sidebar navigation for queue.
- Added new status badges for quality-gated states.

## Local verification performed

1. Frontend TS check: `npx tsc --noEmit` (passed).
2. Edge function syntax transpile check across all functions (passed).

Note:
- `npm run build` is blocked in this environment by a process spawn permission (`spawn EPERM`), so full Vite build was not runnable here.
- `deno` binary is not installed in this environment, so `deno check` was not available.

## Deploy sequence

1. Apply DB migration
```bash
supabase db push
```

2. Deploy functions
```bash
supabase functions deploy process-report
supabase functions deploy create-ingestion-file
supabase functions deploy run-extraction
supabase functions deploy run-normalization
supabase functions deploy run-validation
supabase functions deploy submit-review-resolution
supabase functions deploy publish-canonical-rows
supabase functions deploy reprocess-file
```

3. Smoke tests
- Upload a mixed batch: one PDF + one CSV.
- Verify `ingestion_files` created with hash and source format.
- Verify `source_rows`/`source_fields` populated.
- Confirm `cmo_reports.status` is quality-gated (not unconditional `completed`).
- Confirm blocker rows appear in `review_tasks`.
