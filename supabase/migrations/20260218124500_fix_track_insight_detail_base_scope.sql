-- Fix get_track_insight_detail_v1 CTE scope bug.
-- Previous implementation referenced `base` across multiple standalone SELECTs,
-- which caused: relation "base" does not exist.

CREATE OR REPLACE FUNCTION public.get_track_insight_detail_v1(
  p_track_key TEXT,
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL,
  filters_json JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB AS $$
DECLARE
  v_from DATE := COALESCE(from_date, (CURRENT_DATE - INTERVAL '12 months')::date);
  v_to DATE := COALESCE(to_date, CURRENT_DATE);
  v_summary JSONB;
  v_monthly JSONB;
  v_territory JSONB;
  v_platform JSONB;
  v_matrix JSONB;
  v_usage_mix JSONB;
  v_high_usage_low_payout JSONB;
  v_quality JSONB;
  v_extractor_coverage JSONB;
  v_config_mix JSONB;
  v_provenance JSONB;
BEGIN
  WITH base AS (
    SELECT
      rt.id AS transaction_id,
      rt.source_row_id,
      rt.report_id,
      rt.user_id,
      public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
      COALESCE(NULLIF(trim(rt.track_title), ''), 'Unknown Track') AS track_title,
      COALESCE(NULLIF(trim(rt.artist_name), ''), 'Unknown Artist') AS artist_name,
      NULLIF(regexp_replace(upper(COALESCE(rt.isrc, '')), '[^A-Z0-9]', '', 'g'), '') AS isrc,
      COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
      COALESCE(rt.gross_revenue, 0)::numeric AS gross_revenue,
      COALESCE(rt.commission, 0)::numeric AS commission,
      COALESCE(rt.quantity, 0)::numeric AS quantity,
      COALESCE(NULLIF(trim(rt.territory), ''), 'Unknown') AS territory,
      COALESCE(NULLIF(trim(rt.platform), ''), 'Unknown') AS platform,
      COALESCE(NULLIF(trim(rt.usage_type), ''), 'Unknown') AS usage_type,
      COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date,
      rt.validation_status,
      COALESCE(
        rt.mapping_confidence,
        CASE
          WHEN rt.ocr_confidence IS NULL THEN NULL
          WHEN rt.ocr_confidence <= 1 THEN rt.ocr_confidence * 100
          ELSE rt.ocr_confidence
        END
      ) AS confidence
    FROM public.royalty_transactions rt
    INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
    WHERE
      rt.user_id = auth.uid()
      AND cr.status <> 'failed'
      AND public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) = p_track_key
      AND COALESCE(rt.period_end, rt.period_start, rt.created_at::date) BETWEEN v_from AND v_to
  ),
  summary_data AS (
    SELECT jsonb_build_object(
      'track_key', p_track_key,
      'track_title', max(track_title),
      'artist_name', max(artist_name),
      'isrc', max(isrc),
      'net_revenue', sum(net_revenue),
      'gross_revenue', sum(gross_revenue),
      'commission', sum(commission),
      'quantity', sum(quantity),
      'net_per_unit', CASE WHEN sum(quantity) > 0 THEN sum(net_revenue) / sum(quantity) ELSE 0 END,
      'effective_commission_rate', CASE WHEN sum(gross_revenue) > 0 THEN (sum(commission) / sum(gross_revenue)) * 100 ELSE 0 END,
      'avg_confidence', avg(confidence),
      'line_count', count(*),
      'failed_line_count', count(*) FILTER (WHERE validation_status = 'failed')
    ) AS value
    FROM base
  ),
  monthly_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.month_start), '[]'::jsonb) AS value
    FROM (
      SELECT
        date_trunc('month', event_date)::date AS month_start,
        sum(net_revenue)::numeric(20, 6) AS net_revenue,
        sum(quantity)::numeric(20, 6) AS quantity,
        sum(gross_revenue)::numeric(20, 6) AS gross_revenue
      FROM base
      GROUP BY date_trunc('month', event_date)::date
    ) x
  ),
  territory_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb) AS value
    FROM (
      SELECT territory, sum(net_revenue)::numeric(20, 6) AS net_revenue, sum(quantity)::numeric(20, 6) AS quantity
      FROM base
      GROUP BY territory
      ORDER BY net_revenue DESC
      LIMIT 12
    ) x
  ),
  platform_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb) AS value
    FROM (
      SELECT platform, sum(net_revenue)::numeric(20, 6) AS net_revenue, sum(quantity)::numeric(20, 6) AS quantity
      FROM base
      GROUP BY platform
      ORDER BY net_revenue DESC
      LIMIT 12
    ) x
  ),
  matrix_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        territory,
        platform,
        sum(net_revenue)::numeric(20, 6) AS net_revenue,
        sum(quantity)::numeric(20, 6) AS quantity,
        CASE WHEN sum(quantity) > 0 THEN (sum(net_revenue) / sum(quantity)) ELSE 0 END::numeric(20, 6) AS net_per_unit
      FROM base
      GROUP BY territory, platform
      ORDER BY net_revenue DESC
      LIMIT 30
    ) x
  ),
  usage_mix_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb) AS value
    FROM (
      SELECT usage_type, sum(net_revenue)::numeric(20, 6) AS net_revenue, sum(quantity)::numeric(20, 6) AS quantity
      FROM base
      GROUP BY usage_type
      ORDER BY net_revenue DESC
      LIMIT 12
    ) x
  ),
  high_usage_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.usage_share DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        territory,
        sum(quantity)::numeric(20, 6) AS quantity,
        sum(net_revenue)::numeric(20, 6) AS net_revenue,
        CASE
          WHEN sum(sum(quantity)) OVER () = 0 THEN 0
          ELSE (sum(quantity) / NULLIF(sum(sum(quantity)) OVER (), 0))
        END::numeric(20, 6) AS usage_share,
        CASE
          WHEN sum(sum(net_revenue)) OVER () = 0 THEN 0
          ELSE (sum(net_revenue) / NULLIF(sum(sum(net_revenue)) OVER (), 0))
        END::numeric(20, 6) AS payout_share
      FROM base
      GROUP BY territory
    ) x
    WHERE x.usage_share >= 0.15 AND x.payout_share <= 0.05
    LIMIT 12
  ),
  quality_data AS (
    WITH task_counts AS (
      SELECT
        source_row_id,
        count(DISTINCT id) FILTER (WHERE status IN ('open', 'in_progress')) AS open_task_count,
        count(DISTINCT id) FILTER (WHERE status IN ('open', 'in_progress') AND severity = 'critical') AS open_critical_task_count
      FROM public.review_tasks
      GROUP BY source_row_id
    ),
    val_counts AS (
      SELECT
        ve.transaction_id,
        count(*) FILTER (WHERE ve.severity = 'critical') AS critical,
        count(*) FILTER (WHERE ve.severity = 'warning') AS warning,
        count(*) FILTER (WHERE ve.severity = 'info') AS info
      FROM public.validation_errors ve
      GROUP BY ve.transaction_id
    )
    SELECT jsonb_build_object(
      'failed_line_count', count(*) FILTER (WHERE b.validation_status = 'failed'),
      'open_task_count', sum(COALESCE(tc.open_task_count, 0)),
      'open_critical_task_count', sum(COALESCE(tc.open_critical_task_count, 0)),
      'validation_critical_count', sum(COALESCE(vc.critical, 0)),
      'validation_warning_count', sum(COALESCE(vc.warning, 0)),
      'validation_info_count', sum(COALESCE(vc.info, 0)),
      'avg_confidence', avg(b.confidence)
    ) AS value
    FROM base b
    LEFT JOIN task_counts tc ON tc.source_row_id = b.source_row_id
    LEFT JOIN val_counts vc ON vc.transaction_id = b.transaction_id
  ),
  extractor_coverage_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.coverage_pct DESC), '[]'::jsonb) AS value
    FROM (
      SELECT field_name, populated_rows, total_rows, coverage_pct
      FROM public.track_extractor_coverage_v1
      WHERE user_id = auth.uid() AND track_key = p_track_key
      ORDER BY coverage_pct DESC, field_name ASC
    ) x
  ),
  config_mix_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.row_count DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        COALESCE(NULLIF(trim(COALESCE(di.config_type, di.usage_type)), ''), 'Unknown') AS config_type,
        count(*)::BIGINT AS row_count
      FROM public.document_ai_report_items di
      INNER JOIN public.cmo_reports cr ON cr.id = di.report_id
      WHERE
        di.user_id = auth.uid()
        AND cr.status <> 'failed'
        AND public.track_insights_key(di.isrc, di.track_title, di.track_artist) = p_track_key
      GROUP BY COALESCE(NULLIF(trim(COALESCE(di.config_type, di.usage_type)), ''), 'Unknown')
      ORDER BY row_count DESC
      LIMIT 12
    ) x
  ),
  provenance_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.event_date DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        b.event_date,
        b.territory,
        b.platform,
        b.net_revenue,
        b.quantity,
        b.source_row_id,
        b.report_id,
        cr.file_name,
        cr.cmo_name,
        rt.source_page,
        rt.source_row
      FROM base b
      INNER JOIN public.royalty_transactions rt ON rt.id = b.transaction_id
      INNER JOIN public.cmo_reports cr ON cr.id = b.report_id
      ORDER BY b.event_date DESC
      LIMIT 50
    ) x
  )
  SELECT
    summary_data.value,
    monthly_data.value,
    territory_data.value,
    platform_data.value,
    matrix_data.value,
    usage_mix_data.value,
    high_usage_data.value,
    quality_data.value,
    extractor_coverage_data.value,
    config_mix_data.value,
    provenance_data.value
  INTO
    v_summary,
    v_monthly,
    v_territory,
    v_platform,
    v_matrix,
    v_usage_mix,
    v_high_usage_low_payout,
    v_quality,
    v_extractor_coverage,
    v_config_mix,
    v_provenance
  FROM
    summary_data,
    monthly_data,
    territory_data,
    platform_data,
    matrix_data,
    usage_mix_data,
    high_usage_data,
    quality_data,
    extractor_coverage_data,
    config_mix_data,
    provenance_data;

  RETURN jsonb_build_object(
    'summary', COALESCE(v_summary, '{}'::jsonb),
    'monthly_trend', COALESCE(v_monthly, '[]'::jsonb),
    'territory_mix', COALESCE(v_territory, '[]'::jsonb),
    'platform_mix', COALESCE(v_platform, '[]'::jsonb),
    'territory_platform_matrix', COALESCE(v_matrix, '[]'::jsonb),
    'usage_mix', COALESCE(v_usage_mix, '[]'::jsonb),
    'high_usage_low_payout', COALESCE(v_high_usage_low_payout, '[]'::jsonb),
    'quality', COALESCE(v_quality, '{}'::jsonb),
    'extractor_coverage', COALESCE(v_extractor_coverage, '[]'::jsonb),
    'config_mix', COALESCE(v_config_mix, '[]'::jsonb),
    'provenance', COALESCE(v_provenance, '[]'::jsonb),
    'query_meta', jsonb_build_object(
      'from_date', v_from,
      'to_date', v_to,
      'track_key', p_track_key
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
