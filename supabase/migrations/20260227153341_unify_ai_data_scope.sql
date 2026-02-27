-- Unify AI data scope with charts
-- Update track_assistant_scope_v2 to include all non-failed reports.

CREATE OR REPLACE VIEW public.track_assistant_scope_v2 AS
SELECT
  rt.id AS transaction_id,
  rt.user_id,
  rt.report_id,
  rt.source_row_id,
  public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
  COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date,
  COALESCE(NULLIF(trim(rt.track_title), ''), 'Unknown Track') AS track_title,
  COALESCE(NULLIF(trim(rt.artist_name), ''), 'Unknown Artist') AS artist_name,
  NULLIF(regexp_replace(upper(COALESCE(rt.isrc, '')), '[^A-Z0-9]', '', 'g'), '') AS isrc,
  NULLIF(regexp_replace(upper(COALESCE(rt.iswc, '')), '[^A-Z0-9]', '', 'g'), '') AS iswc,
  COALESCE(NULLIF(trim(rt.territory), ''), 'Unknown') AS territory,
  COALESCE(NULLIF(trim(rt.platform), ''), 'Unknown') AS platform,
  COALESCE(NULLIF(trim(rt.usage_type), ''), 'Unknown') AS usage_type,
  COALESCE(rt.quantity, 0)::numeric(20, 6) AS quantity,
  COALESCE(rt.gross_revenue, 0)::numeric(20, 6) AS gross_revenue,
  COALESCE(rt.commission, 0)::numeric(20, 6) AS commission,
  COALESCE(rt.net_revenue, 0)::numeric(20, 6) AS net_revenue,
  COALESCE(NULLIF(trim(rt.validation_status), ''), 'pending') AS validation_status,
  rt.mapping_confidence,
  COALESCE(rt.validation_blockers, '[]'::jsonb) AS validation_blockers,
  COALESCE(NULLIF(trim(rt.currency), ''), 'USD') AS currency,
  rt.period_start,
  rt.period_end,
  COALESCE(rt.custom_properties, '{}'::jsonb) AS custom_properties
FROM public.royalty_transactions rt
INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
WHERE cr.status <> 'failed';
