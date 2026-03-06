CREATE OR REPLACE VIEW public.workspace_assistant_scope_v1 AS
SELECT
  transaction_id,
  user_id,
  report_id,
  source_row_id,
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
  custom_properties
FROM public.track_assistant_scope_v2;

CREATE OR REPLACE FUNCTION public.get_workspace_assistant_catalog_v1(
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

  IF v_from > v_to THEN
    RAISE EXCEPTION 'from_date cannot be after to_date.';
  END IF;

  RETURN (
    WITH scoped AS (
      SELECT *
      FROM public.workspace_assistant_scope_v1
      WHERE
        public.can_access_workspace_member_data(user_id)
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
          ('event_date', 'date'),
          ('validation_status', 'text'),
          ('mapping_confidence', 'number')
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
          ('event_date', CASE WHEN s.event_date IS NULL THEN NULL ELSE s.event_date::text END),
          ('validation_status', NULLIF(trim(s.validation_status), '')),
          ('mapping_confidence', CASE WHEN s.mapping_confidence IS NULL THEN NULL ELSE s.mapping_confidence::text END)
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
        'canonical'::TEXT AS source,
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
        'custom'::TEXT AS source,
        COALESCE(
          (
            SELECT jsonb_agg(to_jsonb(r.field_value) ORDER BY r.field_value ASC)
            FROM custom_ranked_samples r
            WHERE r.field_key = c.field_key AND r.rn <= 3
          ),
          '[]'::jsonb
        ) AS sample_values
      FROM custom_coverage c
    ),
    all_columns AS (
      SELECT field_key, inferred_type, coverage_pct, source, sample_values
      FROM canonical_meta
      UNION ALL
      SELECT field_key, inferred_type, coverage_pct, source, sample_values
      FROM custom_meta
    )
    SELECT jsonb_build_object(
      'from_date', v_from,
      'to_date', v_to,
      'total_rows', (SELECT count(*) FROM scoped),
      'columns',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'field_key', c.field_key,
              'inferred_type', c.inferred_type,
              'coverage_pct', c.coverage_pct,
              'source', c.source,
              'sample_values', c.sample_values
            )
            ORDER BY c.field_key
          )
          FROM all_columns c
        ),
        '[]'::jsonb
      ),
      'aliases', '{}'::jsonb
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

CREATE OR REPLACE FUNCTION public.run_workspace_chat_sql_v1(
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
      FROM public.workspace_assistant_scope_v1
      WHERE
        public.can_access_workspace_member_data(user_id)
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
      SELECT public.get_workspace_assistant_catalog_v1(%L::date, %L::date) AS payload
    ),
    scoped_columns AS (
      SELECT
        lower(trim(col ->> 'field_key')) AS field_key,
        col ->> 'inferred_type' AS inferred_type,
        col -> 'sample_values' AS sample_values
      FROM schema_json sj
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(sj.payload -> 'columns', '[]'::jsonb)
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
  $q$, v_from, v_to, v_from, v_to, v_sql);

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
      'workspace_assistant_scope_v1',
      'royalty_transactions.custom_properties'
    ),
    'applied_scope', jsonb_build_object(
      'from_date', v_from,
      'to_date', v_to,
      'row_limit', 200,
      'timeout_ms', 4000
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

GRANT SELECT ON public.workspace_assistant_scope_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_assistant_catalog_v1(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_workspace_chat_sql_v1(DATE, DATE, TEXT) TO authenticated;
