CREATE OR REPLACE FUNCTION public.get_artist_snapshot_v1(
  p_artist_key TEXT,
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_from DATE := COALESCE(from_date, (CURRENT_DATE - INTERVAL '12 months')::date);
  v_to DATE := COALESCE(to_date, CURRENT_DATE);
  v_summary JSONB;
  v_monthly JSONB;
  v_territory JSONB;
  v_platform JSONB;
  v_usage_mix JSONB;
  v_top_tracks JSONB;
BEGIN
  WITH base AS (
    SELECT
      rt.id AS transaction_id,
      public.artist_insights_key(rt.artist_name) AS artist_key,
      public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
      COALESCE(NULLIF(trim(rt.artist_name), ''), 'Unknown Artist') AS artist_name,
      COALESCE(NULLIF(trim(rt.track_title), ''), 'Unknown Track') AS track_title,
      NULLIF(regexp_replace(upper(COALESCE(rt.isrc, '')), '[^A-Z0-9]', '', 'g'), '') AS isrc,
      COALESCE(rt.net_revenue, 0)::numeric AS net_revenue,
      COALESCE(rt.gross_revenue, 0)::numeric AS gross_revenue,
      COALESCE(rt.quantity, 0)::numeric AS quantity,
      COALESCE(NULLIF(trim(rt.territory), ''), 'Unknown') AS territory,
      COALESCE(NULLIF(trim(rt.platform), ''), 'Unknown') AS platform,
      COALESCE(NULLIF(trim(rt.usage_type), ''), 'Unknown') AS usage_type,
      COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date
    FROM public.royalty_transactions rt
    INNER JOIN public.cmo_reports cr ON cr.id = rt.report_id
    WHERE
      public.can_access_workspace_member_data(rt.user_id)
      AND cr.status <> 'failed'
      AND public.artist_insights_key(rt.artist_name) = p_artist_key
      AND COALESCE(rt.period_end, rt.period_start, rt.created_at::date) BETWEEN v_from AND v_to
  ),
  top_track_leader AS (
    SELECT
      track_title,
      sum(net_revenue)::numeric(20, 6) AS net_revenue
    FROM base
    GROUP BY track_title
    ORDER BY net_revenue DESC, track_title ASC
    LIMIT 1
  ),
  territory_leader AS (
    SELECT
      territory,
      sum(net_revenue)::numeric(20, 6) AS net_revenue
    FROM base
    GROUP BY territory
    ORDER BY net_revenue DESC, territory ASC
    LIMIT 1
  ),
  platform_leader AS (
    SELECT
      platform,
      sum(net_revenue)::numeric(20, 6) AS net_revenue
    FROM base
    GROUP BY platform
    ORDER BY net_revenue DESC, platform ASC
    LIMIT 1
  ),
  summary_data AS (
    SELECT jsonb_build_object(
      'artist_key', p_artist_key,
      'artist_name', max(artist_name),
      'track_count', count(DISTINCT track_key),
      'net_revenue', sum(net_revenue),
      'gross_revenue', sum(gross_revenue),
      'quantity', sum(quantity),
      'net_per_unit', CASE WHEN sum(quantity) > 0 THEN sum(net_revenue) / sum(quantity) ELSE 0 END,
      'avg_track_revenue', CASE WHEN count(DISTINCT track_key) > 0 THEN sum(net_revenue) / count(DISTINCT track_key) ELSE 0 END,
      'top_track_title', (SELECT track_title FROM top_track_leader),
      'top_track_revenue', COALESCE((SELECT net_revenue FROM top_track_leader), 0),
      'top_territory', (SELECT territory FROM territory_leader),
      'top_platform', (SELECT platform FROM platform_leader)
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
      SELECT
        territory,
        sum(net_revenue)::numeric(20, 6) AS net_revenue,
        sum(quantity)::numeric(20, 6) AS quantity
      FROM base
      GROUP BY territory
      ORDER BY net_revenue DESC
      LIMIT 12
    ) x
  ),
  platform_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        platform,
        sum(net_revenue)::numeric(20, 6) AS net_revenue,
        sum(quantity)::numeric(20, 6) AS quantity
      FROM base
      GROUP BY platform
      ORDER BY net_revenue DESC
      LIMIT 12
    ) x
  ),
  usage_mix_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        usage_type,
        sum(net_revenue)::numeric(20, 6) AS net_revenue,
        sum(quantity)::numeric(20, 6) AS quantity
      FROM base
      GROUP BY usage_type
      ORDER BY net_revenue DESC
      LIMIT 12
    ) x
  ),
  top_tracks_data AS (
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.net_revenue DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        track_key,
        track_title,
        max(isrc) AS isrc,
        sum(net_revenue)::numeric(20, 6) AS net_revenue,
        sum(gross_revenue)::numeric(20, 6) AS gross_revenue,
        sum(quantity)::numeric(20, 6) AS quantity,
        CASE WHEN sum(quantity) > 0 THEN (sum(net_revenue) / sum(quantity)) ELSE 0 END::numeric(20, 6) AS net_per_unit
      FROM base
      GROUP BY track_key, track_title
      ORDER BY net_revenue DESC
      LIMIT 12
    ) x
  )
  SELECT
    summary_data.value,
    monthly_data.value,
    territory_data.value,
    platform_data.value,
    usage_mix_data.value,
    top_tracks_data.value
  INTO
    v_summary,
    v_monthly,
    v_territory,
    v_platform,
    v_usage_mix,
    v_top_tracks
  FROM
    summary_data,
    monthly_data,
    territory_data,
    platform_data,
    usage_mix_data,
    top_tracks_data;

  RETURN jsonb_build_object(
    'summary', COALESCE(v_summary, '{}'::jsonb),
    'monthly_trend', COALESCE(v_monthly, '[]'::jsonb),
    'territory_mix', COALESCE(v_territory, '[]'::jsonb),
    'platform_mix', COALESCE(v_platform, '[]'::jsonb),
    'usage_mix', COALESCE(v_usage_mix, '[]'::jsonb),
    'top_tracks', COALESCE(v_top_tracks, '[]'::jsonb),
    'query_meta', jsonb_build_object(
      'from_date', v_from,
      'to_date', v_to,
      'artist_key', p_artist_key
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
