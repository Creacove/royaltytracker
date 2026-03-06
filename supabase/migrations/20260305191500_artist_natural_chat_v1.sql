-- Artist assistant scope and guarded SQL pipeline (parity with track assistant flow)

CREATE OR REPLACE FUNCTION public.artist_insights_key(p_artist_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_artist TEXT;
BEGIN
  v_artist := COALESCE(NULLIF(lower(trim(p_artist_name)), ''), 'unknown artist');
  v_artist := regexp_replace(v_artist, '\s+', ' ', 'g');
  RETURN 'artist:' || v_artist;
END;
$$;

CREATE OR REPLACE VIEW public.artist_assistant_scope_v1 AS
SELECT
  rt.id AS transaction_id,
  rt.user_id,
  rt.report_id,
  rt.source_row_id,
  public.artist_insights_key(rt.artist_name) AS artist_key,
  public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
  COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date,
  COALESCE(NULLIF(trim(rt.artist_name), ''), 'Unknown Artist') AS artist_name,
  COALESCE(NULLIF(trim(rt.track_title), ''), 'Unknown Track') AS track_title,
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
WHERE cr.status IN ('completed_passed', 'completed_with_warnings');

CREATE OR REPLACE FUNCTION public.get_artist_assistant_schema_v1(
  p_artist_key TEXT,
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

  IF p_artist_key IS NULL OR trim(p_artist_key) = '' THEN
    RAISE EXCEPTION 'p_artist_key is required.';
  END IF;

  IF v_from > v_to THEN
    RAISE EXCEPTION 'from_date cannot be after to_date.';
  END IF;

  RETURN (
    WITH scoped AS (
      SELECT *
      FROM public.artist_assistant_scope_v1
      WHERE
        public.can_access_workspace_member_data(user_id)
        AND artist_key = p_artist_key
        AND event_date BETWEEN v_from AND v_to
    ),
    canonical_field_defs AS (
      SELECT * FROM (
        VALUES
          ('artist_name', 'text'),
          ('track_title', 'text'),
          ('track_key', 'text'),
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
          ('artist_name', NULLIF(trim(s.artist_name), '')),
          ('track_title', NULLIF(trim(s.track_title), '')),
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
          ('event_date', CASE WHEN s.event_date IS NULL THEN NULL ELSE s.event_date::text END)
      ) AS kv(field_key, field_value)
      WHERE kv.field_value IS NOT NULL
    ),
    canonical_coverage AS (
      SELECT field_key, count(*)::INTEGER AS populated_rows
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
      'artist_key', p_artist_key,
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

CREATE OR REPLACE FUNCTION public.run_artist_chat_sql_v1(
  p_artist_key TEXT,
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

  IF p_artist_key IS NULL OR trim(p_artist_key) = '' THEN
    RAISE EXCEPTION 'p_artist_key is required.';
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
        artist_key,
        track_key,
        event_date,
        artist_name,
        track_title,
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
      FROM public.artist_assistant_scope_v1
      WHERE
        public.can_access_workspace_member_data(user_id)
        AND artist_key = %L
        AND event_date BETWEEN %L::date AND %L::date
    ),
    scoped_custom AS (
      SELECT
        sc.artist_key,
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
      SELECT public.get_artist_assistant_schema_v1(%L, %L::date, %L::date) AS payload
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
  $q$, p_artist_key, v_from, v_to, p_artist_key, v_from, v_to, v_sql);

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
      'artist_assistant_scope_v1',
      'royalty_transactions.custom_properties'
    ),
    'applied_scope', jsonb_build_object(
      'artist_key', p_artist_key,
      'from_date', v_from,
      'to_date', v_to,
      'row_limit', 200,
      'timeout_ms', 4000
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
