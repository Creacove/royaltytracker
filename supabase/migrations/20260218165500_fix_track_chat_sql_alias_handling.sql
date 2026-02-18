-- Fix natural chat SQL guard to allow alias.column while still blocking schema-qualified FROM/JOIN relations.

CREATE OR REPLACE FUNCTION public.run_track_chat_sql_v1(
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
  v_allowed_relations CONSTANT TEXT[] := ARRAY['scoped_facts', 'scoped_quality', 'scoped_coverage'];
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

  PERFORM set_config('statement_timeout', '3000', true);
  PERFORM set_config('search_path', 'pg_temp', true);

  v_exec_sql := format($q$
    WITH scoped_facts AS (
      SELECT
        event_date,
        territory,
        platform,
        usage_type,
        net_revenue,
        gross_revenue,
        commission,
        quantity,
        report_id,
        source_row_id
      FROM public.track_chat_fact_v1
      WHERE
        user_id = auth.uid()
        AND track_key = %L
        AND event_date BETWEEN %L::date AND %L::date
    ),
    scoped_quality AS (
      SELECT
        failed_line_count,
        warning_line_count,
        open_task_count,
        open_critical_task_count,
        validation_critical_count,
        validation_warning_count,
        validation_info_count,
        avg_confidence,
        line_count
      FROM public.track_quality_v1
      WHERE user_id = auth.uid() AND track_key = %L
    ),
    scoped_coverage AS (
      SELECT
        field_name,
        populated_rows,
        total_rows,
        coverage_pct
      FROM public.track_extractor_coverage_v1
      WHERE user_id = auth.uid() AND track_key = %L
    ),
    user_query AS (
      %s
    ),
    limited_rows AS (
      SELECT * FROM user_query LIMIT 200
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(limited_rows)), '[]'::jsonb)
    FROM limited_rows
  $q$, p_track_key, v_from, v_to, p_track_key, p_track_key, v_sql);

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
      'track_chat_fact_v1',
      'track_quality_v1',
      'track_extractor_coverage_v1'
    ),
    'applied_scope', jsonb_build_object(
      'track_key', p_track_key,
      'from_date', v_from,
      'to_date', v_to,
      'row_limit', 200,
      'timeout_ms', 3000
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
