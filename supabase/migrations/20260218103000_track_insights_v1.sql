-- Track Insights V1 foundations: canonical track identity, aggregation views,
-- list/detail RPCs, assistant prompt RPC, and supporting indexes.

CREATE OR REPLACE FUNCTION public.track_insights_key(
  p_isrc TEXT,
  p_track_title TEXT,
  p_artist_name TEXT
) RETURNS TEXT AS $$
DECLARE
  v_isrc TEXT;
  v_title TEXT;
  v_artist TEXT;
BEGIN
  v_isrc := NULLIF(regexp_replace(upper(COALESCE(p_isrc, '')), '[^A-Z0-9]', '', 'g'), '');
  IF v_isrc IS NOT NULL THEN
    RETURN 'isrc:' || v_isrc;
  END IF;

  v_title := COALESCE(NULLIF(lower(trim(p_track_title)), ''), 'unknown track');
  v_artist := COALESCE(NULLIF(lower(trim(p_artist_name)), ''), 'unknown artist');
  RETURN 'fallback:' || md5(v_title || '|' || v_artist);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE VIEW public.track_identity_v1 AS
WITH base AS (
  SELECT
    rt.user_id,
    rt.id AS transaction_id,
    public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
    NULLIF(regexp_replace(upper(COALESCE(rt.isrc, '')), '[^A-Z0-9]', '', 'g'), '') AS normalized_isrc,
    NULLIF(trim(rt.track_title), '') AS track_title,
    NULLIF(trim(rt.artist_name), '') AS artist_name,
    rt.created_at
  FROM public.royalty_transactions rt
  INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
  WHERE cr.status <> 'failed'
)
SELECT
  user_id,
  track_key,
  CASE WHEN left(track_key, 5) = 'isrc:' THEN 'isrc' ELSE 'fallback' END AS identity_mode,
  max(normalized_isrc) AS isrc,
  COALESCE(max(track_title), 'Unknown Track') AS display_track_title,
  COALESCE(max(artist_name), 'Unknown Artist') AS display_artist_name,
  count(*)::BIGINT AS line_count,
  min(created_at) AS first_seen_at,
  max(created_at) AS last_seen_at
FROM base
GROUP BY user_id, track_key;

CREATE OR REPLACE VIEW public.track_metrics_monthly_v1 AS
WITH base AS (
  SELECT
    rt.user_id,
    public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
    date_trunc(
      'month',
      COALESCE(rt.period_end::timestamp, rt.period_start::timestamp, rt.created_at)
    )::date AS month_start,
    COALESCE(rt.gross_revenue, 0)::numeric AS gross_revenue,
    COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
    COALESCE(rt.commission, 0)::numeric AS commission,
    COALESCE(rt.quantity, 0)::numeric AS quantity
  FROM public.royalty_transactions rt
  INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
  WHERE cr.status <> 'failed'
)
SELECT
  user_id,
  track_key,
  month_start,
  sum(gross_revenue)::numeric(20, 6) AS gross_revenue,
  sum(net_revenue)::numeric(20, 6) AS net_revenue,
  sum(commission)::numeric(20, 6) AS commission,
  sum(quantity)::numeric(20, 6) AS quantity,
  count(*)::BIGINT AS line_count
FROM base
GROUP BY user_id, track_key, month_start;

CREATE OR REPLACE VIEW public.track_distribution_v1 AS
WITH base AS (
  SELECT
    rt.user_id,
    public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
    COALESCE(NULLIF(trim(rt.territory), ''), 'Unknown') AS territory,
    COALESCE(NULLIF(trim(rt.platform), ''), 'Unknown') AS platform,
    COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
    COALESCE(rt.gross_revenue, 0)::numeric AS gross_revenue,
    COALESCE(rt.quantity, 0)::numeric AS quantity
  FROM public.royalty_transactions rt
  INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
  WHERE cr.status <> 'failed'
)
SELECT
  user_id,
  track_key,
  territory,
  platform,
  sum(net_revenue)::numeric(20, 6) AS net_revenue,
  sum(gross_revenue)::numeric(20, 6) AS gross_revenue,
  sum(quantity)::numeric(20, 6) AS quantity,
  count(*)::BIGINT AS line_count
FROM base
GROUP BY user_id, track_key, territory, platform;

CREATE OR REPLACE VIEW public.track_usage_mix_v1 AS
WITH base AS (
  SELECT
    rt.user_id,
    public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
    COALESCE(NULLIF(trim(rt.usage_type), ''), 'Unknown') AS usage_type,
    COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
    COALESCE(rt.quantity, 0)::numeric AS quantity
  FROM public.royalty_transactions rt
  INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
  WHERE cr.status <> 'failed'
)
SELECT
  user_id,
  track_key,
  usage_type,
  sum(net_revenue)::numeric(20, 6) AS net_revenue,
  sum(quantity)::numeric(20, 6) AS quantity,
  count(*)::BIGINT AS line_count
FROM base
GROUP BY user_id, track_key, usage_type;

CREATE OR REPLACE VIEW public.track_quality_v1 AS
WITH tx AS (
  SELECT
    rt.user_id,
    rt.id AS transaction_id,
    rt.source_row_id,
    public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
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
  WHERE cr.status <> 'failed'
),
validation AS (
  SELECT
    ve.transaction_id,
    count(*) FILTER (WHERE ve.severity = 'critical') AS validation_critical_count,
    count(*) FILTER (WHERE ve.severity = 'warning') AS validation_warning_count,
    count(*) FILTER (WHERE ve.severity = 'info') AS validation_info_count
  FROM public.validation_errors ve
  GROUP BY ve.transaction_id
),
tasks AS (
  SELECT
    rt.source_row_id,
    count(DISTINCT rt.id) FILTER (WHERE rt.status IN ('open', 'in_progress')) AS open_task_count,
    count(DISTINCT rt.id) FILTER (WHERE rt.status IN ('open', 'in_progress') AND rt.severity = 'critical') AS open_critical_task_count
  FROM public.review_tasks rt
  GROUP BY rt.source_row_id
)
SELECT
  tx.user_id,
  tx.track_key,
  count(*)::BIGINT AS line_count,
  count(*) FILTER (WHERE tx.validation_status = 'failed')::BIGINT AS failed_line_count,
  count(*) FILTER (WHERE tx.validation_status = 'warning')::BIGINT AS warning_line_count,
  sum(COALESCE(validation.validation_critical_count, 0))::BIGINT AS validation_critical_count,
  sum(COALESCE(validation.validation_warning_count, 0))::BIGINT AS validation_warning_count,
  sum(COALESCE(validation.validation_info_count, 0))::BIGINT AS validation_info_count,
  sum(COALESCE(tasks.open_task_count, 0))::BIGINT AS open_task_count,
  sum(COALESCE(tasks.open_critical_task_count, 0))::BIGINT AS open_critical_task_count,
  avg(tx.confidence)::numeric(12, 4) AS avg_confidence
FROM tx
LEFT JOIN validation ON validation.transaction_id = tx.transaction_id
LEFT JOIN tasks ON tasks.source_row_id = tx.source_row_id
GROUP BY tx.user_id, tx.track_key;

CREATE OR REPLACE VIEW public.track_extractor_coverage_v1 AS
WITH base_items AS (
  SELECT
    di.user_id,
    public.track_insights_key(di.isrc, di.track_title, di.track_artist) AS track_key,
    di.report_item,
    di.amount_in_original_currency,
    di.amount_in_reporting_currency,
    di.channel,
    di.config_type,
    di.country,
    di.exchange_rate,
    di.isrc,
    di.label,
    di.master_commission,
    di.original_currency,
    di.quantity,
    di.release_artist,
    di.release_title,
    di.release_upc,
    di.report_date,
    di.reporting_currency,
    di.royalty_revenue,
    di.sales_end,
    di.sales_start,
    di.track_artist,
    di.track_title,
    di.unit
  FROM public.document_ai_report_items di
  INNER JOIN public.cmo_reports cr ON cr.id = di.report_id
  WHERE cr.status <> 'failed'
),
flattened AS (
  SELECT
    b.user_id,
    b.track_key,
    f.field_name,
    f.field_value
  FROM base_items b
  CROSS JOIN LATERAL (
    VALUES
      ('report_item', b.report_item),
      ('amount_in_original_currency', b.amount_in_original_currency),
      ('amount_in_reporting_currency', b.amount_in_reporting_currency),
      ('channel', b.channel),
      ('config_type', b.config_type),
      ('country', b.country),
      ('exchange_rate', b.exchange_rate),
      ('isrc', b.isrc),
      ('label', b.label),
      ('master_commission', b.master_commission),
      ('original_currency', b.original_currency),
      ('quantity', b.quantity),
      ('release_artist', b.release_artist),
      ('release_title', b.release_title),
      ('release_upc', b.release_upc),
      ('report_date', b.report_date),
      ('reporting_currency', b.reporting_currency),
      ('royalty_revenue', b.royalty_revenue),
      ('sales_end', b.sales_end),
      ('sales_start', b.sales_start),
      ('track_artist', b.track_artist),
      ('track_title', b.track_title),
      ('unit', b.unit)
  ) AS f(field_name, field_value)
)
SELECT
  user_id,
  track_key,
  field_name,
  count(*)::BIGINT AS total_rows,
  count(*) FILTER (WHERE NULLIF(trim(COALESCE(field_value, '')), '') IS NOT NULL)::BIGINT AS populated_rows,
  (
    CASE WHEN count(*) = 0 THEN 0
    ELSE (
      count(*) FILTER (WHERE NULLIF(trim(COALESCE(field_value, '')), '') IS NOT NULL)::numeric
      / count(*)::numeric
    ) * 100 END
  )::numeric(12, 4) AS coverage_pct
FROM flattened
GROUP BY user_id, track_key, field_name;

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
      rt.user_id = auth.uid()
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

CREATE OR REPLACE FUNCTION public.run_track_assistant_prompt_v1(
  p_track_key TEXT,
  p_prompt_id TEXT,
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL,
  filters_json JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB AS $$
DECLARE
  v_from DATE := COALESCE(from_date, (CURRENT_DATE - INTERVAL '12 months')::date);
  v_to DATE := COALESCE(to_date, CURRENT_DATE);
  v_result JSONB := '{}'::jsonb;
BEGIN
  IF p_prompt_id = 'growth_fastest' THEN
    SELECT jsonb_build_object(
      'prompt_id', p_prompt_id,
      'title', 'Fastest Growth Areas',
      'summary', 'Territories with strongest recent 90-day net growth.',
      'rows', COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.growth_pct DESC), '[]'::jsonb),
      'query_provenance', jsonb_build_array('royalty_transactions', 'cmo_reports')
    )
    INTO v_result
    FROM (
      WITH scoped AS (
        SELECT
          COALESCE(NULLIF(trim(rt.territory), ''), 'Unknown') AS territory,
          COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
          COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date
        FROM public.royalty_transactions rt
        INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
        WHERE
          rt.user_id = auth.uid()
          AND cr.status <> 'failed'
          AND public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) = p_track_key
          AND COALESCE(rt.period_end, rt.period_start, rt.created_at::date) BETWEEN v_from AND v_to
      )
      SELECT
        territory,
        sum(net_revenue) FILTER (WHERE event_date >= (v_to - INTERVAL '90 day')::date) AS recent_net,
        sum(net_revenue) FILTER (
          WHERE event_date < (v_to - INTERVAL '90 day')::date
            AND event_date >= (v_to - INTERVAL '180 day')::date
        ) AS prior_net,
        CASE
          WHEN COALESCE(sum(net_revenue) FILTER (
            WHERE event_date < (v_to - INTERVAL '90 day')::date
              AND event_date >= (v_to - INTERVAL '180 day')::date
          ), 0) = 0 THEN 100
          ELSE (
            (
              COALESCE(sum(net_revenue) FILTER (WHERE event_date >= (v_to - INTERVAL '90 day')::date), 0)
              -
              COALESCE(sum(net_revenue) FILTER (
                WHERE event_date < (v_to - INTERVAL '90 day')::date
                  AND event_date >= (v_to - INTERVAL '180 day')::date
              ), 0)
            )
            / NULLIF(abs(COALESCE(sum(net_revenue) FILTER (
              WHERE event_date < (v_to - INTERVAL '90 day')::date
                AND event_date >= (v_to - INTERVAL '180 day')::date
            ), 0)), 0)
          ) * 100
        END AS growth_pct
      FROM scoped
      GROUP BY territory
      ORDER BY growth_pct DESC
      LIMIT 8
    ) x;

  ELSIF p_prompt_id = 'usage_high_payout_low' THEN
    SELECT jsonb_build_object(
      'prompt_id', p_prompt_id,
      'title', 'High Usage, Low Payout Areas',
      'summary', 'Territories where usage share is high but payout share is low.',
      'rows', COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.usage_share DESC), '[]'::jsonb),
      'query_provenance', jsonb_build_array('track_distribution_v1')
    )
    INTO v_result
    FROM (
      WITH grouped AS (
        SELECT
          territory,
          sum(quantity)::numeric AS quantity,
          sum(net_revenue)::numeric AS net_revenue
        FROM public.track_distribution_v1
        WHERE user_id = auth.uid() AND track_key = p_track_key
        GROUP BY territory
      ),
      scored AS (
        SELECT
          g.territory,
          g.quantity,
          g.net_revenue,
          CASE WHEN sum(g.quantity) OVER () = 0 THEN 0 ELSE g.quantity / NULLIF(sum(g.quantity) OVER (), 0) END::numeric(20, 6) AS usage_share,
          CASE WHEN sum(g.net_revenue) OVER () = 0 THEN 0 ELSE g.net_revenue / NULLIF(sum(g.net_revenue) OVER (), 0) END::numeric(20, 6) AS payout_share
        FROM grouped g
      )
      SELECT *
      FROM scored
      WHERE usage_share >= 0.15 AND payout_share <= 0.05
      ORDER BY usage_share DESC
      LIMIT 8
    ) x;

  ELSIF p_prompt_id = 'change_last_90d' THEN
    SELECT jsonb_build_object(
      'prompt_id', p_prompt_id,
      'title', 'Last 90 Days Change',
      'summary', 'Recent window compared to the prior 90-day window.',
      'metrics', row_to_json(x),
      'query_provenance', jsonb_build_array('royalty_transactions', 'cmo_reports')
    )
    INTO v_result
    FROM (
      WITH scoped AS (
        SELECT
          COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
          COALESCE(rt.quantity, 0)::numeric AS quantity,
          COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date
        FROM public.royalty_transactions rt
        INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
        WHERE
          rt.user_id = auth.uid()
          AND cr.status <> 'failed'
          AND public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) = p_track_key
          AND COALESCE(rt.period_end, rt.period_start, rt.created_at::date) BETWEEN (v_to - INTERVAL '180 day')::date AND v_to
      )
      SELECT
        sum(net_revenue) FILTER (WHERE event_date >= (v_to - INTERVAL '90 day')::date) AS recent_net,
        sum(net_revenue) FILTER (
          WHERE event_date < (v_to - INTERVAL '90 day')::date
            AND event_date >= (v_to - INTERVAL '180 day')::date
        ) AS prior_net,
        sum(quantity) FILTER (WHERE event_date >= (v_to - INTERVAL '90 day')::date) AS recent_qty,
        sum(quantity) FILTER (
          WHERE event_date < (v_to - INTERVAL '90 day')::date
            AND event_date >= (v_to - INTERVAL '180 day')::date
        ) AS prior_qty
      FROM scoped
    ) x;

  ELSIF p_prompt_id = 'quality_risks' THEN
    SELECT jsonb_build_object(
      'prompt_id', p_prompt_id,
      'title', 'Quality Risk Overview',
      'summary', 'Validation failures, critical tasks, and confidence profile for this track.',
      'metrics', jsonb_build_object(
        'failed_line_count', q.failed_line_count,
        'open_task_count', q.open_task_count,
        'open_critical_task_count', q.open_critical_task_count,
        'validation_critical_count', q.validation_critical_count,
        'validation_warning_count', q.validation_warning_count,
        'validation_info_count', q.validation_info_count,
        'avg_confidence', q.avg_confidence
      ),
      'query_provenance', jsonb_build_array('track_quality_v1', 'validation_errors', 'review_tasks')
    )
    INTO v_result
    FROM public.track_quality_v1 q
    WHERE q.user_id = auth.uid() AND q.track_key = p_track_key;

  ELSE
    RETURN jsonb_build_object(
      'error', 'Unsupported prompt_id',
      'supported_prompt_ids', jsonb_build_array(
        'growth_fastest',
        'usage_high_payout_low',
        'change_last_90d',
        'quality_risks'
      )
    );
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'query_meta',
    jsonb_build_object(
      'track_key', p_track_key,
      'from_date', v_from,
      'to_date', v_to,
      'prompt_id', p_prompt_id
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE INDEX IF NOT EXISTS idx_royalty_transactions_user_report_period
ON public.royalty_transactions (user_id, report_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_royalty_transactions_user_isrc
ON public.royalty_transactions (user_id, isrc);

CREATE INDEX IF NOT EXISTS idx_royalty_transactions_track_fallback_expr
ON public.royalty_transactions (
  md5(
    COALESCE(NULLIF(lower(trim(track_title)), ''), 'unknown track')
    || '|'
    || COALESCE(NULLIF(lower(trim(artist_name)), ''), 'unknown artist')
  )
);

CREATE INDEX IF NOT EXISTS idx_validation_errors_transaction_report
ON public.validation_errors (transaction_id, report_id);

CREATE INDEX IF NOT EXISTS idx_review_tasks_source_report_status_severity
ON public.review_tasks (source_row_id, report_id, status, severity);

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
      COALESCE(rt.mapping_confidence,
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
  )
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
    )
  INTO v_summary
  FROM base;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.month_start), '[]'::jsonb)
  INTO v_monthly
  FROM (
    SELECT
      date_trunc('month', event_date)::date AS month_start,
      sum(net_revenue)::numeric(20, 6) AS net_revenue,
      sum(quantity)::numeric(20, 6) AS quantity,
      sum(gross_revenue)::numeric(20, 6) AS gross_revenue
    FROM base
    GROUP BY date_trunc('month', event_date)::date
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb)
  INTO v_territory
  FROM (
    SELECT
      territory,
      sum(net_revenue)::numeric(20, 6) AS net_revenue,
      sum(quantity)::numeric(20, 6) AS quantity
    FROM base
    GROUP BY territory
    ORDER BY net_revenue DESC
    LIMIT 12
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb)
  INTO v_platform
  FROM (
    SELECT
      platform,
      sum(net_revenue)::numeric(20, 6) AS net_revenue,
      sum(quantity)::numeric(20, 6) AS quantity
    FROM base
    GROUP BY platform
    ORDER BY net_revenue DESC
    LIMIT 12
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb)
  INTO v_matrix
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
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb)
  INTO v_usage_mix
  FROM (
    SELECT
      usage_type,
      sum(net_revenue)::numeric(20, 6) AS net_revenue,
      sum(quantity)::numeric(20, 6) AS quantity
    FROM base
    GROUP BY usage_type
    ORDER BY net_revenue DESC
    LIMIT 12
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.usage_share DESC), '[]'::jsonb)
  INTO v_high_usage_low_payout
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
  LIMIT 12;

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
    )
  INTO v_quality
  FROM base b
  LEFT JOIN task_counts tc ON tc.source_row_id = b.source_row_id
  LEFT JOIN val_counts vc ON vc.transaction_id = b.transaction_id;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.coverage_pct DESC), '[]'::jsonb)
  INTO v_extractor_coverage
  FROM (
    SELECT
      field_name,
      populated_rows,
      total_rows,
      coverage_pct
    FROM public.track_extractor_coverage_v1
    WHERE user_id = auth.uid() AND track_key = p_track_key
    ORDER BY coverage_pct DESC, field_name ASC
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.row_count DESC), '[]'::jsonb)
  INTO v_config_mix
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
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.event_date DESC), '[]'::jsonb)
  INTO v_provenance
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
  ) x;

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
