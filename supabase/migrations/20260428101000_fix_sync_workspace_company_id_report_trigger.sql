-- Fix upload inserts failing in sync_workspace_company_id().
-- cmo_reports rows do not have report_id, so keep the cmo_reports path separate
-- before reading report-scoped fields used by child ingestion/processing tables.

CREATE OR REPLACE FUNCTION public.sync_workspace_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'cmo_reports' THEN
    IF NEW.user_id IS NOT NULL THEN
      v_company_id := public.resolve_user_active_company_id(NEW.user_id);
    END IF;
  ELSIF TG_TABLE_NAME IN (
    'ingestion_files',
    'source_rows',
    'source_fields',
    'review_tasks',
    'royalty_transactions'
  ) THEN
    IF NEW.report_id IS NOT NULL THEN
      SELECT r.company_id
      INTO v_company_id
      FROM public.cmo_reports AS r
      WHERE r.id = NEW.report_id;
    END IF;

    IF v_company_id IS NULL AND NEW.user_id IS NOT NULL THEN
      v_company_id := public.resolve_user_active_company_id(NEW.user_id);
    END IF;
  ELSE
    RAISE EXCEPTION 'sync_workspace_company_id is not configured for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  NEW.company_id := v_company_id;
  RETURN NEW;
END;
$$;
