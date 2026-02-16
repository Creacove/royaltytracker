-- Fix: unconditionally drop ALL check constraints on cmo_reports.status
-- regardless of their auto-generated name, then re-add the correct one.
-- This handles the case where the original constraint name was different from
-- what the publisher_grade_data_foundation migration assumed.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'cmo_reports'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.cmo_reports DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Re-add the single correct constraint for the extended status model.
ALTER TABLE public.cmo_reports
ADD CONSTRAINT cmo_reports_status_check
CHECK (
  status IN (
    'pending',
    'processing',
    'completed',
    'completed_passed',
    'completed_with_warnings',
    'needs_review',
    'failed'
  )
);
