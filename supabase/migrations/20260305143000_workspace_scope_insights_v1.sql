-- Fix insights scope to include shared workspace data (not uploader-only).
-- Uses public.can_access_workspace_member_data(user_id) for all insight sources.

CREATE OR REPLACE FUNCTION public.get_track_insights_list_v1(
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL,
  filters_json JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
  track_key TEXT,
  identity_mode TEXT,
  track_title TEXT,
  artist_name TEXT,
  isrc TEXT,
  net_revenue NUMERIC,
  gross_revenue NUMERIC,
  quantity NUMERIC,
  net_per_unit NUMERIC,
  trend_3m_pct NUMERIC,
  top_territory TEXT,
  top_platform TEXT,
  failed_line_count BIGINT,
  open_critical_task_count BIGINT,
  revenue_component NUMERIC,
  growth_component NUMERIC,
  leakage_component NUMERIC,
  quality_risk_component NUMERIC,
  opportunity_score NUMERIC,
  quality_flag TEXT
) AS $$
DECLARE
  v_from DATE := COALESCE(from_date, (CURRENT_DATE - INTERVAL '12 months')::date);
  v_to DATE := COALESCE(to_date, CURRENT_DATE);
  v_search TEXT := NULLIF(trim(COALESCE(filters_json ->> 'search', '')), '');
  v_cmo TEXT := NULLIF(trim(COALESCE(filters_json ->> 'cmo', '')), '');
  v_territory TEXT := NULLIF(trim(COALESCE(filters_json ->> 'territory', '')), '');
  v_platform TEXT := NULLIF(trim(COALESCE(filters_json ->> 'platform', '')), '');
  v_usage_type TEXT := NULLIF(trim(COALESCE(filters_json ->> 'usage_type', '')), '');
BEGIN
  RETURN QUERY
  WITH scoped AS (
    SELECT
      rt.id AS transaction_id,
      rt.user_id,
      rt.report_id,
      public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
      CASE
        WHEN NULLIF(regexp_replace(upper(COALESCE(rt.isrc, '')), '[^A-Z0-9]', '', 'g'), '') IS NOT NULL THEN 'isrc'
        ELSE 'fallback'
      END AS identity_mode,
      NULLIF(regexp_replace(upper(COALESCE(rt.isrc, '')), '[^A-Z0-9]', '', 'g'), '') AS isrc,
      COALESCE(NULLIF(trim(rt.track_title), ''), 'Unknown Track') AS track_title,
      COALESCE(NULLIF(trim(rt.artist_name), ''), 'Unknown Artist') AS artist_name,
      COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
      COALESCE(rt.gross_revenue, 0)::numeric AS gross_revenue,
      COALESCE(rt.quantity, 0)::numeric AS quantity,
      COALESCE(NULLIF(trim(rt.territory), ''), 'Unknown') AS territory,
      COALESCE(NULLIF(trim(rt.platform), ''), 'Unknown') AS platform,
      COALESCE(NULLIF(trim(rt.usage_type), ''), 'Unknown') AS usage_type,
      COALESCE(rt.mapping_confidence,
        CASE
          WHEN rt.ocr_confidence IS NULL THEN NULL
          WHEN rt.ocr_confidence <= 1 THEN rt.ocr_confidence * 100
          ELSE rt.ocr_confidence
        END
      ) AS confidence,
      rt.validation_status,
      rt.source_row_id,
      COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date,
      cr.cmo_name
    FROM public.royalty_transactions rt
    INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
    WHERE
      public.can_access_workspace_member_data(rt.user_id)
      AND cr.status <> 'failed'
      AND COALESCE(rt.period_end, rt.period_start, rt.created_at::date) BETWEEN v_from AND v_to
      AND (
        v_cmo IS NULL OR v_cmo = '' OR v_cmo = 'all' OR cr.cmo_name = v_cmo
      )
      AND (
        v_territory IS NULL OR v_territory = '' OR v_territory = 'all' OR rt.territory = v_territory
      )
      AND (
        v_platform IS NULL OR v_platform = '' OR v_platform = 'all' OR rt.platform = v_platform
      )
      AND (
        v_usage_type IS NULL OR v_usage_type = '' OR v_usage_type = 'all' OR rt.usage_type = v_usage_type
      )
      AND (
        v_search IS NULL
        OR lower(COALESCE(rt.track_title, '')) LIKE '%' || lower(v_search) || '%'
        OR lower(COALESCE(rt.artist_name, '')) LIKE '%' || lower(v_search) || '%'
        OR lower(COALESCE(rt.isrc, '')) LIKE '%' || lower(v_search) || '%'
        OR lower(COALESCE(rt.custom_properties::text, '')) LIKE '%' || lower(v_search) || '%'
      )
  ),
  task_counts AS (
    SELECT
      source_row_id,
      count(DISTINCT id) FILTER (WHERE status IN ('open', 'in_progress') AND severity = 'critical') AS open_critical_task_count
    FROM public.review_tasks
    GROUP BY source_row_id
  ),
  per_track AS (
    SELECT
      s.track_key,
      max(s.identity_mode) AS identity_mode,
      max(s.track_title) AS track_title,
      max(s.artist_name) AS artist_name,
      max(s.isrc) AS isrc,
      sum(s.net_revenue)::numeric AS net_revenue,
      sum(s.gross_revenue)::numeric AS gross_revenue,
      sum(s.quantity)::numeric AS quantity,
      count(*)::BIGINT AS line_count,
      count(*) FILTER (WHERE s.validation_status = 'failed')::BIGINT AS failed_line_count,
      sum(COALESCE(tc.open_critical_task_count, 0))::BIGINT AS open_critical_task_count,
      avg(s.confidence)::numeric AS avg_confidence
    FROM scoped s
    LEFT JOIN task_counts tc ON tc.source_row_id = s.source_row_id
    GROUP BY s.track_key
  ),
  period_windows AS (
    SELECT
      s.track_key,
      sum(s.net_revenue) FILTER (
        WHERE s.event_date >= (v_to - INTERVAL '90 day')::date
      )::numeric AS recent_net,
      sum(s.net_revenue) FILTER (
        WHERE s.event_date < (v_to - INTERVAL '90 day')::date
          AND s.event_date >= (v_to - INTERVAL '180 day')::date
      )::numeric AS prior_net
    FROM scoped s
    GROUP BY s.track_key
  ),
  territory_ranks AS (
    SELECT
      s.track_key,
      s.territory,
      sum(s.net_revenue)::numeric AS territory_net,
      row_number() OVER (
        PARTITION BY s.track_key
        ORDER BY sum(s.net_revenue) DESC, s.territory ASC
      ) AS rn
    FROM scoped s
    GROUP BY s.track_key, s.territory
  ),
  platform_ranks AS (
    SELECT
      s.track_key,
      s.platform,
      sum(s.net_revenue)::numeric AS platform_net,
      row_number() OVER (
        PARTITION BY s.track_key
        ORDER BY sum(s.net_revenue) DESC, s.platform ASC
      ) AS rn
    FROM scoped s
    GROUP BY s.track_key, s.platform
  ),
  usage_payout AS (
    SELECT
      s.track_key,
      s.territory,
      sum(s.quantity)::numeric AS usage_qty,
      sum(s.net_revenue)::numeric AS payout
    FROM scoped s
    GROUP BY s.track_key, s.territory
  ),
  usage_with_shares AS (
    SELECT
      up.track_key,
      up.territory,
      up.usage_qty,
      up.payout,
      CASE
        WHEN sum(up.usage_qty) OVER (PARTITION BY up.track_key) = 0 THEN 0
        ELSE up.usage_qty / NULLIF(sum(up.usage_qty) OVER (PARTITION BY up.track_key), 0)
      END AS usage_share,
      CASE
        WHEN sum(up.payout) OVER (PARTITION BY up.track_key) = 0 THEN 0
        ELSE up.payout / NULLIF(sum(up.payout) OVER (PARTITION BY up.track_key), 0)
      END AS payout_share
    FROM usage_payout up
  ),
  leakage AS (
    SELECT
      uw.track_key,
      COALESCE(max(
        GREATEST(
          0,
          uw.usage_share - uw.payout_share
        )
      ), 0)::numeric AS leakage_signal
    FROM usage_with_shares uw
    GROUP BY uw.track_key
  ),
  joined AS (
    SELECT
      pt.track_key,
      pt.identity_mode,
      pt.track_title,
      pt.artist_name,
      pt.isrc,
      pt.net_revenue,
      pt.gross_revenue,
      pt.quantity,
      CASE WHEN pt.quantity > 0 THEN pt.net_revenue / pt.quantity ELSE 0 END::numeric AS net_per_unit,
      CASE
        WHEN COALESCE(pw.prior_net, 0) = 0 AND COALESCE(pw.recent_net, 0) > 0 THEN 100
        WHEN COALESCE(pw.prior_net, 0) = 0 THEN 0
        ELSE ((COALESCE(pw.recent_net, 0) - pw.prior_net) / NULLIF(abs(pw.prior_net), 0)) * 100
      END::numeric AS trend_3m_pct,
      tr.territory AS top_territory,
      pr.platform AS top_platform,
      pt.failed_line_count,
      pt.open_critical_task_count,
      COALESCE(l.leakage_signal, 0)::numeric AS leakage_signal,
      CASE
        WHEN pt.line_count = 0 THEN 0
        ELSE (
          (pt.failed_line_count::numeric / pt.line_count::numeric)
          + CASE WHEN pt.avg_confidence IS NULL THEN 0 ELSE GREATEST(0, (80 - pt.avg_confidence) / 100) END
        )
      END::numeric AS quality_risk_signal
    FROM per_track pt
    LEFT JOIN period_windows pw ON pw.track_key = pt.track_key
    LEFT JOIN territory_ranks tr ON tr.track_key = pt.track_key AND tr.rn = 1
    LEFT JOIN platform_ranks pr ON pr.track_key = pt.track_key AND pr.rn = 1
    LEFT JOIN leakage l ON l.track_key = pt.track_key
  ),
  scored AS (
    SELECT
      j.*,
      COALESCE(percent_rank() OVER (ORDER BY j.net_revenue), 0)::numeric AS revenue_component,
      COALESCE(percent_rank() OVER (ORDER BY j.trend_3m_pct), 0)::numeric AS growth_component,
      COALESCE(percent_rank() OVER (ORDER BY j.leakage_signal), 0)::numeric AS leakage_component,
      COALESCE(percent_rank() OVER (ORDER BY j.quality_risk_signal), 0)::numeric AS quality_risk_component
    FROM joined j
  )
  SELECT
    s.track_key,
    s.identity_mode,
    s.track_title,
    s.artist_name,
    s.isrc,
    round(s.net_revenue, 6) AS net_revenue,
    round(s.gross_revenue, 6) AS gross_revenue,
    round(s.quantity, 6) AS quantity,
    round(s.net_per_unit, 6) AS net_per_unit,
    round(s.trend_3m_pct, 4) AS trend_3m_pct,
    COALESCE(s.top_territory, 'Unknown') AS top_territory,
    COALESCE(s.top_platform, 'Unknown') AS top_platform,
    s.failed_line_count,
    s.open_critical_task_count,
    round(s.revenue_component, 6) AS revenue_component,
    round(s.growth_component, 6) AS growth_component,
    round(s.leakage_component, 6) AS leakage_component,
    round(s.quality_risk_component, 6) AS quality_risk_component,
    round(
      (
        (s.revenue_component * 0.40)
        + (s.growth_component * 0.25)
        + (s.leakage_component * 0.20)
        + (s.quality_risk_component * 0.15)
      ) * 100,
      2
    ) AS opportunity_score,
    CASE
      WHEN s.failed_line_count > 0 OR s.open_critical_task_count > 0 THEN 'high'
      WHEN s.quality_risk_component >= 0.60 THEN 'medium'
      ELSE 'low'
    END AS quality_flag
  FROM scored s
  ORDER BY opportunity_score DESC, net_revenue DESC;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

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
      public.can_access_workspace_member_data(rt.user_id)
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
      WHERE public.can_access_workspace_member_data(user_id) AND track_key = p_track_key
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
        public.can_access_workspace_member_data(di.user_id)
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

CREATE OR REPLACE FUNCTION public.get_track_assistant_schema_v2(
  p_track_key TEXT,
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_from DATE := COALESCE(from_date, (CURRENT_DATE - INTERVAL '12 months')::date);
  v_to DATE := COALESCE(to_date, CURRENT_DATE);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_track_key IS NULL OR trim(p_track_key) = '' THEN
    RAISE EXCEPTION 'p_track_key is required.';
  END IF;

  IF v_from > v_to THEN
    RAISE EXCEPTION 'from_date cannot be after to_date.';
  END IF;

  RETURN (
    WITH scoped AS (
      SELECT *
      FROM public.track_assistant_scope_v2
      WHERE
        public.can_access_workspace_member_data(user_id)
        AND track_key = p_track_key
        AND event_date BETWEEN v_from AND v_to
    ),
    canonical_field_defs AS (
      SELECT * FROM (
        VALUES
          ('track_title', 'text'),
          ('artist_name', 'text'),
          ('isrc', 'text'),
          ('iswc', 'text'),
          ('territory', 'text'),
          ('platform', 'text'),
          ('usage_type', 'text'),
          ('quantity', 'number'),
          ('gross_revenue', 'number'),
          ('commission', 'number'),
          ('net_revenue', 'number'),
          ('currency', 'text'),
          ('period_start', 'date'),
          ('period_end', 'date'),
          ('event_date', 'date')
      ) AS t(field_key, inferred_type)
    ),
    canonical_samples AS (
      SELECT
        kv.field_key,
        kv.field_value
      FROM scoped s
      CROSS JOIN LATERAL (
        VALUES
          ('track_title', NULLIF(trim(s.track_title), '')),
          ('artist_name', NULLIF(trim(s.artist_name), '')),
          ('isrc', NULLIF(trim(COALESCE(s.isrc, '')), '')),
          ('iswc', NULLIF(trim(COALESCE(s.iswc, '')), '')),
          ('territory', NULLIF(trim(s.territory), '')),
          ('platform', NULLIF(trim(s.platform), '')),
          ('usage_type', NULLIF(trim(s.usage_type), '')),
          ('quantity', CASE WHEN s.quantity IS NULL THEN NULL ELSE s.quantity::text END),
          ('gross_revenue', CASE WHEN s.gross_revenue IS NULL THEN NULL ELSE s.gross_revenue::text END),
          ('commission', CASE WHEN s.commission IS NULL THEN NULL ELSE s.commission::text END),
          ('net_revenue', CASE WHEN s.net_revenue IS NULL THEN NULL ELSE s.net_revenue::text END),
          ('currency', NULLIF(trim(s.currency), '')),
          ('period_start', CASE WHEN s.period_start IS NULL THEN NULL ELSE s.period_start::text END),
          ('period_end', CASE WHEN s.period_end IS NULL THEN NULL ELSE s.period_end::text END),
          ('event_date', CASE WHEN s.event_date IS NULL THEN NULL ELSE s.event_date::text END)
      ) AS kv(field_key, field_value)
      WHERE kv.field_value IS NOT NULL
    ),
    canonical_coverage AS (
      SELECT
        field_key,
        count(*)::INTEGER AS populated_rows
      FROM canonical_samples
      GROUP BY field_key
    ),
    canonical_ranked_samples AS (
      SELECT
        d.field_key,
        d.field_value,
        row_number() OVER (PARTITION BY d.field_key ORDER BY d.field_value ASC) AS rn
      FROM (
        SELECT DISTINCT field_key, field_value
        FROM canonical_samples
      ) d
    ),
    canonical_meta AS (
      SELECT
        d.field_key,
        d.inferred_type,
        CASE
          WHEN (SELECT count(*) FROM scoped) = 0 THEN 0
          ELSE ROUND((COALESCE(c.populated_rows, 0)::numeric / (SELECT count(*)::numeric FROM scoped)) * 100, 2)
        END AS coverage_pct,
        COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(r.field_value) ORDER BY r.field_value ASC)
            FROM canonical_ranked_samples r
            WHERE r.field_key = d.field_key AND r.rn <= 3
          ),
          '[]'::jsonb
        ) AS sample_values
      FROM canonical_field_defs d
      LEFT JOIN canonical_coverage c ON c.field_key = d.field_key
    ),
    custom_kv AS (
      SELECT
        NULLIF(trim(kv.key), '') AS field_key,
        NULLIF(trim(kv.value), '') AS field_value
      FROM scoped s
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(s.custom_properties, '{}'::jsonb)) kv
      WHERE NULLIF(trim(kv.key), '') IS NOT NULL
    ),
    custom_coverage AS (
      SELECT
        field_key,
        count(*)::INTEGER AS populated_rows,
        bool_or(field_value ~ '^-?\d+(\.\d+)?$') AS has_numeric,
        bool_or(field_value ~ '^\d{4}-\d{2}-\d{2}$') AS has_date
      FROM custom_kv
      GROUP BY field_key
    ),
    custom_ranked_samples AS (
      SELECT
        d.field_key,
        d.field_value,
        row_number() OVER (PARTITION BY d.field_key ORDER BY d.field_value ASC) AS rn
      FROM (
        SELECT DISTINCT field_key, field_value
        FROM custom_kv
        WHERE field_value IS NOT NULL
      ) d
    ),
    custom_meta AS (
      SELECT
        c.field_key,
        CASE
          WHEN c.has_numeric THEN 'number'
          WHEN c.has_date THEN 'date'
          ELSE 'text'
        END AS inferred_type,
        CASE
          WHEN (SELECT count(*) FROM scoped) = 0 THEN 0
          ELSE ROUND((c.populated_rows::numeric / (SELECT count(*)::numeric FROM scoped)) * 100, 2)
        END AS coverage_pct,
        COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(r.field_value) ORDER BY r.field_value ASC)
            FROM custom_ranked_samples r
            WHERE r.field_key = c.field_key AND r.rn <= 3
          ),
          '[]'::jsonb
        ) AS sample_values
      FROM custom_coverage c
    )
    SELECT jsonb_build_object(
      'track_key', p_track_key,
      'from_date', v_from,
      'to_date', v_to,
      'total_rows', (SELECT count(*) FROM scoped),
      'canonical_columns',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'field_key', m.field_key,
              'inferred_type', m.inferred_type,
              'coverage_pct', m.coverage_pct,
              'sample_values', m.sample_values
            )
            ORDER BY m.field_key
          )
          FROM canonical_meta m
        ),
        '[]'::jsonb
      ),
      'custom_columns',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'field_key', m.field_key,
              'inferred_type', m.inferred_type,
              'coverage_pct', m.coverage_pct,
              'sample_values', m.sample_values
            )
            ORDER BY m.field_key
          )
          FROM custom_meta m
        ),
        '[]'::jsonb
      )
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE OR REPLACE FUNCTION public.run_track_chat_sql_v2(
  p_track_key TEXT,
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL,
  p_sql TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_from DATE := COALESCE(from_date, (CURRENT_DATE - INTERVAL '12 months')::date);
  v_to DATE := COALESCE(to_date, CURRENT_DATE);
  v_sql TEXT := trim(COALESCE(p_sql, ''));
  v_sql_lower TEXT := lower(v_sql);
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_duration_ms INTEGER := 0;
  v_rows JSONB := '[]'::jsonb;
  v_columns JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
  v_exec_sql TEXT;
  v_ref TEXT;
  v_relation_refs TEXT[] := ARRAY[]::TEXT[];
  v_cte_names TEXT[] := ARRAY[]::TEXT[];
  v_allowed_relations CONSTANT TEXT[] := ARRAY['scoped_core', 'scoped_custom', 'scoped_columns', 'schema_json'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_track_key IS NULL OR trim(p_track_key) = '' THEN
    RAISE EXCEPTION 'p_track_key is required.';
  END IF;

  IF v_sql = '' THEN
    RAISE EXCEPTION 'p_sql is required.';
  END IF;

  IF v_from > v_to THEN
    RAISE EXCEPTION 'from_date cannot be after to_date.';
  END IF;

  IF v_sql_lower !~ '^\s*(select|with)\s+' THEN
    RAISE EXCEPTION 'Only SELECT/WITH queries are allowed.';
  END IF;

  IF position(';' IN v_sql) > 0 THEN
    RAISE EXCEPTION 'Semicolons are not allowed.';
  END IF;

  IF v_sql ~ '(--|/\*|\*/)' THEN
    RAISE EXCEPTION 'SQL comments are not allowed.';
  END IF;

  IF v_sql ~ '"' THEN
    RAISE EXCEPTION 'Quoted identifiers are not allowed.';
  END IF;

  IF v_sql_lower ~ '\y(insert|update|delete|drop|alter|create|grant|revoke|copy|call|do|truncate)\y' THEN
    RAISE EXCEPTION 'Disallowed SQL keyword detected.';
  END IF;

  IF v_sql ~* '\y(from|join)\s+[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\y' THEN
    RAISE EXCEPTION 'Schema-qualified relation references are not allowed.';
  END IF;

  FOR v_ref IN
    SELECT lower((m)[1])
    FROM regexp_matches(v_sql, '(?is)(?:with|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(', 'g') AS m
  LOOP
    IF array_position(v_cte_names, v_ref) IS NULL THEN
      v_cte_names := array_append(v_cte_names, v_ref);
    END IF;
  END LOOP;

  FOR v_ref IN
    SELECT lower((m)[1])
    FROM regexp_matches(v_sql, '(?is)\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b', 'g') AS m
  LOOP
    IF array_position(v_relation_refs, v_ref) IS NULL THEN
      v_relation_refs := array_append(v_relation_refs, v_ref);
    END IF;
  END LOOP;

  FOREACH v_ref IN ARRAY v_relation_refs
  LOOP
    IF array_position(v_allowed_relations, v_ref) IS NULL
       AND array_position(v_cte_names, v_ref) IS NULL THEN
      RAISE EXCEPTION 'Query references relation "%" outside allowed scoped datasets.', v_ref;
    END IF;
  END LOOP;

  PERFORM set_config('statement_timeout', '4000', true);
  PERFORM set_config('search_path', 'pg_temp', true);

  v_exec_sql := format($q$
    WITH scoped_core AS (
      SELECT
        transaction_id,
        track_key,
        event_date,
        track_title,
        artist_name,
        isrc,
        iswc,
        territory,
        platform,
        usage_type,
        quantity,
        gross_revenue,
        commission,
        net_revenue,
        validation_status,
        mapping_confidence,
        validation_blockers,
        currency,
        period_start,
        period_end,
        report_id,
        source_row_id,
        custom_properties
      FROM public.track_assistant_scope_v2
      WHERE
        public.can_access_workspace_member_data(user_id)
        AND track_key = %L
        AND event_date BETWEEN %L::date AND %L::date
    ),
    scoped_custom AS (
      SELECT
        sc.track_key,
        sc.event_date,
        sc.report_id,
        sc.source_row_id,
        kv.key AS custom_key,
        kv.value AS custom_value
      FROM scoped_core sc
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(sc.custom_properties, '{}'::jsonb)) kv
    ),
    schema_json AS (
      SELECT public.get_track_assistant_schema_v2(%L, %L::date, %L::date) AS payload
    ),
    scoped_columns AS (
      SELECT
        lower(trim(col ->> 'field_key')) AS field_key,
        col ->> 'inferred_type' AS inferred_type,
        col -> 'sample_values' AS sample_values
      FROM schema_json sj
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(sj.payload -> 'canonical_columns', '[]'::jsonb)
        ||
        COALESCE(sj.payload -> 'custom_columns', '[]'::jsonb)
      ) col
      WHERE NULLIF(trim(col ->> 'field_key'), '') IS NOT NULL
    ),
    user_query AS (
      %s
    ),
    limited_rows AS (
      SELECT * FROM user_query LIMIT 200
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(limited_rows)), '[]'::jsonb)
    FROM limited_rows
  $q$, p_track_key, v_from, v_to, p_track_key, v_from, v_to, v_sql);

  EXECUTE v_exec_sql INTO v_rows;

  v_row_count := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_row_count > 0 THEN
    SELECT COALESCE(jsonb_agg(k.key ORDER BY k.key), '[]'::jsonb)
    INTO v_columns
    FROM jsonb_object_keys(v_rows -> 0) AS k(key);
  END IF;

  v_duration_ms := GREATEST(
    0,
    ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at)) * 1000)::INTEGER
  );

  RETURN jsonb_build_object(
    'columns', v_columns,
    'rows', v_rows,
    'row_count', v_row_count,
    'duration_ms', v_duration_ms,
    'query_provenance', jsonb_build_array(
      'track_assistant_scope_v2',
      'royalty_transactions.custom_properties'
    ),
    'applied_scope', jsonb_build_object(
      'track_key', p_track_key,
      'from_date', v_from,
      'to_date', v_to,
      'row_limit', 200,
      'timeout_ms', 4000
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;