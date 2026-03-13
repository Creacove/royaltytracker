-- Harden usage metering function against PL/pgSQL variable/column name conflicts.
-- This addresses runtime errors like:
--   column reference "company_id" is ambiguous

CREATE OR REPLACE FUNCTION public.record_workspace_usage_from_report(
  p_report_id UUID
)
RETURNS TABLE (
  company_id UUID,
  statement_increment INTEGER,
  rows_increment BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_report public.cmo_reports%ROWTYPE;
  v_company_id UUID;
  v_statement_increment INTEGER := 0;
  v_rows_increment BIGINT := 0;
  v_current_rows BIGINT := 0;
  v_period_start DATE := date_trunc('month', now())::date;
BEGIN
  IF p_report_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_report
  FROM public.cmo_reports
  WHERE id = p_report_id
  LIMIT 1
  FOR UPDATE;

  IF v_report.id IS NULL THEN
    RETURN;
  END IF;

  IF v_report.status NOT IN ('completed_passed', 'completed_with_warnings', 'needs_review') THEN
    RETURN;
  END IF;

  SELECT m.company_id
  INTO v_company_id
  FROM public.company_memberships AS m
  WHERE m.user_id = v_report.user_id
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF v_report.billing_usage_statement_metered_at IS NULL THEN
    v_statement_increment := 1;
  END IF;

  v_current_rows := coalesce(v_report.transaction_count, 0);
  v_rows_increment := GREATEST(v_current_rows - coalesce(v_report.billing_usage_rows_metered, 0), 0);

  IF v_statement_increment > 0 OR v_rows_increment > 0 THEN
    INSERT INTO public.workspace_usage_monthly (
      company_id,
      period_start_month,
      statement_count,
      normalized_rows_count,
      created_at,
      updated_at
    )
    VALUES (
      v_company_id,
      v_period_start,
      v_statement_increment,
      v_rows_increment,
      now(),
      now()
    )
    ON CONFLICT (company_id, period_start_month) DO UPDATE
      SET statement_count = public.workspace_usage_monthly.statement_count + EXCLUDED.statement_count,
          normalized_rows_count = public.workspace_usage_monthly.normalized_rows_count + EXCLUDED.normalized_rows_count,
          updated_at = now();
  END IF;

  UPDATE public.cmo_reports
  SET billing_usage_statement_metered_at = coalesce(billing_usage_statement_metered_at, now()),
      billing_usage_rows_metered = GREATEST(coalesce(billing_usage_rows_metered, 0), v_current_rows),
      updated_at = now()
  WHERE id = v_report.id;

  RETURN QUERY
  SELECT
    v_company_id,
    v_statement_increment,
    v_rows_increment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_workspace_usage_from_report(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workspace_usage_from_report(UUID) TO service_role;

