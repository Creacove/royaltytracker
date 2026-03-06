CREATE OR REPLACE FUNCTION public.get_track_assistant_catalog_v1(
  p_track_key TEXT,
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
      WHERE public.can_access_workspace_member_data(user_id)
        AND track_key = p_track_key
        AND event_date BETWEEN v_from AND v_to
    ),
    canonical AS (
      SELECT * FROM (
        VALUES
          ('track_title','text'),('artist_name','text'),('track_key','text'),('isrc','text'),('iswc','text'),
          ('territory','text'),('platform','text'),('usage_type','text'),
          ('quantity','number'),('gross_revenue','number'),('commission','number'),('net_revenue','number'),
          ('currency','text'),('period_start','date'),('period_end','date'),('event_date','date'),
          ('validation_status','text'),('mapping_confidence','number')
      ) AS t(field_key, inferred_type)
    ),
    canonical_rows AS (
      SELECT kv.field_key, kv.field_value
      FROM scoped s
      CROSS JOIN LATERAL (
        VALUES
          ('track_title', NULLIF(trim(s.track_title), '')),
          ('artist_name', NULLIF(trim(s.artist_name), '')),
          ('track_key', NULLIF(trim(s.track_key), '')),
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
          ('event_date', CASE WHEN s.event_date IS NULL THEN NULL ELSE s.event_date::text END),
          ('validation_status', NULLIF(trim(s.validation_status), '')),
          ('mapping_confidence', CASE WHEN s.mapping_confidence IS NULL THEN NULL ELSE s.mapping_confidence::text END)
      ) AS kv(field_key, field_value)
      WHERE kv.field_value IS NOT NULL
    ),
    canonical_meta AS (
      SELECT
        c.field_key,
        c.inferred_type,
        CASE WHEN (SELECT count(*) FROM scoped) = 0 THEN 0
             ELSE ROUND((COALESCE(cnt.populated_rows, 0)::numeric / (SELECT count(*)::numeric FROM scoped)) * 100, 2)
        END AS coverage_pct,
        'canonical'::TEXT AS source,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(x.field_value) ORDER BY x.field_value ASC)
          FROM (
            SELECT DISTINCT field_value
            FROM canonical_rows
            WHERE field_key = c.field_key
            ORDER BY field_value ASC
            LIMIT 3
          ) x
        ), '[]'::jsonb) AS sample_values
      FROM canonical c
      LEFT JOIN (
        SELECT field_key, count(*)::INTEGER AS populated_rows
        FROM canonical_rows
        GROUP BY field_key
      ) cnt ON cnt.field_key = c.field_key
    ),
    custom_rows AS (
      SELECT NULLIF(trim(kv.key), '') AS field_key, NULLIF(trim(kv.value), '') AS field_value
      FROM scoped s
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(s.custom_properties, '{}'::jsonb)) kv
      WHERE NULLIF(trim(kv.key), '') IS NOT NULL
    ),
    custom_meta AS (
      SELECT
        c.field_key,
        CASE WHEN c.has_numeric THEN 'number' WHEN c.has_date THEN 'date' ELSE 'text' END AS inferred_type,
        CASE WHEN (SELECT count(*) FROM scoped) = 0 THEN 0
             ELSE ROUND((c.populated_rows::numeric / (SELECT count(*)::numeric FROM scoped)) * 100, 2)
        END AS coverage_pct,
        'custom'::TEXT AS source,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(x.field_value) ORDER BY x.field_value ASC)
          FROM (
            SELECT DISTINCT field_value
            FROM custom_rows
            WHERE field_key = c.field_key AND field_value IS NOT NULL
            ORDER BY field_value ASC
            LIMIT 3
          ) x
        ), '[]'::jsonb) AS sample_values
      FROM (
        SELECT
          field_key,
          count(*)::INTEGER AS populated_rows,
          bool_or(field_value ~ '^-?\d+(\.\d+)?$') AS has_numeric,
          bool_or(field_value ~ '^\d{4}-\d{2}-\d{2}$') AS has_date
        FROM custom_rows
        GROUP BY field_key
      ) c
    ),
    columns_json AS (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'field_key', c.field_key,
          'inferred_type', c.inferred_type,
          'coverage_pct', c.coverage_pct,
          'source', c.source,
          'sample_values', c.sample_values
        ) ORDER BY c.field_key
      ), '[]'::jsonb) AS payload
      FROM (
        SELECT * FROM canonical_meta
        UNION ALL
        SELECT * FROM custom_meta
      ) c
    )
    SELECT jsonb_build_object(
      'track_key', p_track_key,
      'from_date', v_from,
      'to_date', v_to,
      'total_rows', (SELECT count(*) FROM scoped),
      'columns', (SELECT payload FROM columns_json),
      'aliases', '{}'::jsonb
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_track_assistant_catalog_v1(TEXT, DATE, DATE) TO authenticated;
