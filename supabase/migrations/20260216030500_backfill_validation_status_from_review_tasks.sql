-- One-time backfill: align transaction validation_status with unresolved review tasks.
-- Rule:
-- - failed: row still has at least one open/in_progress critical task
-- - passed: otherwise

DO $$
DECLARE has_source_row_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'royalty_transactions'
      AND column_name = 'source_row_id'
  ) INTO has_source_row_id;

  IF has_source_row_id THEN
    UPDATE public.royalty_transactions rt
    SET validation_status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.review_tasks t
        WHERE t.report_id = rt.report_id
          AND t.status IN ('open', 'in_progress')
          AND t.severity = 'critical'
          AND (
            t.source_row_id = rt.source_row_id
            OR (t.payload ->> 'transaction_id') = rt.id::text
            OR (t.payload ->> 'transactionId') = rt.id::text
            OR (t.payload ->> 'royalty_transaction_id') = rt.id::text
          )
      ) THEN 'failed'
      ELSE 'passed'
    END;
  ELSE
    UPDATE public.royalty_transactions rt
    SET validation_status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.review_tasks t
        WHERE t.report_id = rt.report_id
          AND t.status IN ('open', 'in_progress')
          AND t.severity = 'critical'
          AND (
            (t.payload ->> 'transaction_id') = rt.id::text
            OR (t.payload ->> 'transactionId') = rt.id::text
            OR (t.payload ->> 'royalty_transaction_id') = rt.id::text
          )
      ) THEN 'failed'
      ELSE 'passed'
    END;
  END IF;
END $$;

