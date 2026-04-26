CREATE OR REPLACE VIEW public.workspace_assistant_unified_scope_v1 AS
SELECT
  'income'::TEXT AS source_kind,
  i.company_id,
  NULL::UUID AS user_id,
  i.report_id,
  i.source_row_id,
  i.transaction_id,
  i.recording_id,
  i.work_id,
  i.release_id,
  i.party_id,
  i.agreement_id,
  i.track_key,
  i.event_date,
  i.recording_title AS track_title,
  i.recording_artist AS artist_name,
  i.recording_title,
  i.recording_artist,
  i.work_title,
  i.release_title,
  NULL::TEXT AS party_name,
  i.isrc,
  i.iswc,
  NULL::TEXT AS ipi_number,
  i.upc,
  i.territory,
  i.platform,
  i.usage_type,
  i.quantity,
  i.gross_revenue,
  i.commission,
  i.net_revenue,
  i.currency,
  i.validation_status,
  i.confidence AS mapping_confidence,
  '{}'::JSONB AS custom_properties,
  i.asset_class,
  i.rights_family,
  i.rights_stream,
  NULL::TEXT AS share_kind,
  NULL::NUMERIC AS share_pct,
  i.basis_type,
  i.confidence,
  i.is_conflicted,
  NULL::TEXT AS territory_scope,
  NULL::DATE AS valid_from,
  NULL::DATE AS valid_to,
  NULL::BIGINT AS open_task_count,
  NULL::BIGINT AS open_critical_task_count,
  NULL::BIGINT AS mapping_task_count,
  NULL::BIGINT AS validation_task_count,
  NULL::BIGINT AS income_row_count,
  NULL::BIGINT AS recording_scope_count,
  NULL::BIGINT AS work_scope_count,
  NULL::BIGINT AS party_scope_count,
  NULL::BIGINT AS agreement_count,
  NULL::BIGINT AS rights_claim_count,
  NULL::BIGINT AS conflicted_rights_count
FROM public.assistant_income_scope_v1 i

UNION ALL

SELECT
  'rights',
  r.company_id,
  NULL::UUID,
  r.source_report_ids[1],
  r.source_row_ids[1],
  NULL::UUID,
  r.recording_id,
  r.work_id,
  r.release_id,
  r.party_id,
  r.agreement_id,
  r.track_key,
  COALESCE(r.valid_from, r.valid_to),
  COALESCE(r.recording_title, r.work_title),
  r.recording_artist,
  r.recording_title,
  r.recording_artist,
  r.work_title,
  r.release_title,
  r.party_name,
  r.isrc,
  r.iswc,
  r.ipi_number,
  r.upc,
  r.territory_scope,
  NULL::TEXT,
  NULL::TEXT,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::TEXT,
  COALESCE(r.resolution_status, 'resolved'),
  r.confidence,
  '{}'::JSONB,
  CASE
    WHEN r.work_id IS NOT NULL AND r.recording_id IS NOT NULL THEN 'mixed'
    WHEN r.work_id IS NOT NULL THEN 'work'
    WHEN r.recording_id IS NOT NULL THEN 'recording'
    ELSE 'unknown'
  END,
  r.rights_family,
  r.rights_stream,
  r.share_kind,
  r.share_pct,
  r.basis_type,
  r.confidence,
  r.is_conflicted,
  r.territory_scope,
  r.valid_from,
  r.valid_to,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT
FROM public.assistant_rights_scope_v1 r

UNION ALL

SELECT
  'entitlement',
  e.company_id,
  NULL::UUID,
  e.source_report_ids[1],
  e.source_row_ids[1],
  NULL::UUID,
  e.recording_id,
  e.work_id,
  e.release_id,
  e.party_id,
  e.agreement_id,
  e.track_key,
  COALESCE(e.valid_from, e.valid_to),
  COALESCE(e.recording_title, e.work_title),
  e.recording_artist,
  e.recording_title,
  e.recording_artist,
  e.work_title,
  e.release_title,
  e.party_name,
  e.isrc,
  e.iswc,
  e.ipi_number,
  e.upc,
  e.territory_scope,
  NULL::TEXT,
  NULL::TEXT,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::TEXT,
  e.term_mode,
  e.confidence,
  '{}'::JSONB,
  CASE
    WHEN e.work_id IS NOT NULL AND e.recording_id IS NOT NULL THEN 'mixed'
    WHEN e.work_id IS NOT NULL THEN 'work'
    WHEN e.recording_id IS NOT NULL THEN 'recording'
    ELSE 'unknown'
  END,
  e.rights_family,
  e.rights_stream,
  e.share_kind,
  e.share_pct,
  e.basis_type,
  e.confidence,
  e.is_conflicted,
  e.territory_scope,
  e.valid_from,
  e.valid_to,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT
FROM public.assistant_entitlement_scope_v1 e

UNION ALL

SELECT
  'quality',
  q.company_id,
  NULL::UUID,
  q.source_report_ids[1],
  q.source_row_ids[1],
  NULL::UUID,
  q.recording_id,
  q.work_id,
  q.release_id,
  q.party_id,
  q.agreement_id,
  q.track_key,
  NULL::DATE,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::TEXT,
  'quality',
  NULL::NUMERIC,
  '{}'::JSONB,
  CASE
    WHEN q.work_id IS NOT NULL AND q.recording_id IS NOT NULL THEN 'mixed'
    WHEN q.work_id IS NOT NULL THEN 'work'
    WHEN q.recording_id IS NOT NULL THEN 'recording'
    ELSE 'unknown'
  END,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::NUMERIC,
  'quality',
  NULL::NUMERIC,
  CASE WHEN COALESCE(q.open_critical_task_count, 0) > 0 THEN true ELSE false END,
  NULL::TEXT,
  NULL::DATE,
  NULL::DATE,
  q.open_task_count,
  q.open_critical_task_count,
  q.mapping_task_count,
  q.validation_task_count,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT
FROM public.assistant_quality_scope_v1 q

UNION ALL

SELECT
  'catalog',
  c.company_id,
  NULL::UUID,
  c.source_report_ids[1],
  c.source_row_ids[1],
  NULL::UUID,
  c.recording_id,
  c.work_id,
  c.release_id,
  c.party_id,
  c.agreement_id,
  c.track_key,
  NULL::DATE,
  CASE WHEN c.entity_type = 'recording' THEN c.entity_name ELSE NULL END,
  CASE WHEN c.entity_type = 'recording' THEN c.secondary_name ELSE NULL END,
  CASE WHEN c.entity_type = 'recording' THEN c.entity_name ELSE NULL END,
  CASE WHEN c.entity_type = 'recording' THEN c.secondary_name ELSE NULL END,
  CASE WHEN c.entity_type = 'work' THEN c.entity_name ELSE NULL END,
  CASE WHEN c.entity_type = 'release' THEN c.entity_name ELSE NULL END,
  CASE WHEN c.entity_type = 'party' THEN c.entity_name ELSE NULL END,
  c.isrc,
  c.iswc,
  c.ipi_number,
  c.upc,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::NUMERIC,
  NULL::TEXT,
  c.status,
  NULL::NUMERIC,
  '{}'::JSONB,
  c.entity_type,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::NUMERIC,
  'catalog',
  NULL::NUMERIC,
  false,
  NULL::TEXT,
  NULL::DATE,
  NULL::DATE,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT
FROM public.assistant_catalog_scope_v1 c

UNION ALL

SELECT
  'overview',
  w.company_id,
  NULL::UUID,
  w.source_report_ids[1],
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  NULL::TEXT,
  NULL::DATE,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  w.quantity,
  w.gross_revenue,
  NULL::NUMERIC,
  w.net_revenue,
  NULL::TEXT,
  'overview',
  NULL::NUMERIC,
  '{}'::JSONB,
  'workspace',
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::NUMERIC,
  'overview',
  NULL::NUMERIC,
  CASE WHEN COALESCE(w.conflicted_rights_count, 0) > 0 OR COALESCE(w.open_critical_task_count, 0) > 0 THEN true ELSE false END,
  NULL::TEXT,
  NULL::DATE,
  NULL::DATE,
  w.open_task_count,
  w.open_critical_task_count,
  NULL::BIGINT,
  NULL::BIGINT,
  w.income_row_count,
  w.recording_scope_count,
  w.work_scope_count,
  w.party_scope_count,
  w.agreement_count,
  w.rights_claim_count,
  w.conflicted_rights_count
FROM public.assistant_workspace_overview_v1 w

UNION ALL

SELECT
  'legacy_income',
  sc.company_id,
  sc.user_id,
  sc.report_id,
  sc.source_row_id,
  sc.transaction_id,
  sc.recording_id,
  sc.work_id,
  sc.release_id,
  NULL::UUID,
  NULL::UUID,
  sc.track_key,
  sc.event_date,
  sc.track_title,
  sc.artist_name,
  sc.track_title,
  sc.artist_name,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  sc.isrc,
  sc.iswc,
  NULL::TEXT,
  NULL::TEXT,
  sc.territory,
  sc.platform,
  sc.usage_type,
  sc.quantity,
  sc.gross_revenue,
  sc.commission,
  sc.net_revenue,
  sc.currency,
  sc.validation_status,
  sc.mapping_confidence,
  COALESCE(sc.custom_properties, '{}'::JSONB),
  sc.asset_class,
  sc.rights_family,
  sc.rights_stream,
  NULL::TEXT,
  NULL::NUMERIC,
  sc.basis_type,
  sc.mapping_confidence,
  false,
  NULL::TEXT,
  NULL::DATE,
  NULL::DATE,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT,
  NULL::BIGINT
FROM public.workspace_assistant_scope_v1 sc
WHERE sc.company_id IS NULL;

CREATE OR REPLACE FUNCTION public.get_workspace_assistant_catalog_v1(
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company_id UUID := public.active_company_id();
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
      FROM public.workspace_assistant_unified_scope_v1 s
      WHERE (
        ((v_company_id IS NOT NULL AND s.company_id = v_company_id) OR (v_company_id IS NULL AND s.company_id IS NOT NULL AND public.can_access_company_data(s.company_id)))
        OR (s.company_id IS NULL AND s.user_id IS NOT NULL AND public.can_access_workspace_member_data(s.user_id))
      )
      AND (
        (s.source_kind IN ('income', 'legacy_income') AND s.event_date BETWEEN v_from AND v_to)
        OR (s.source_kind IN ('rights', 'entitlement') AND COALESCE(s.valid_to, v_to) >= v_from AND COALESCE(s.valid_from, v_from) <= v_to)
        OR s.source_kind IN ('quality', 'catalog', 'overview')
      )
    ),
    kv AS (
      SELECT
        j.key AS field_key,
        NULLIF(trim(j.value), '') AS field_value
      FROM scoped s
      CROSS JOIN LATERAL jsonb_each_text(to_jsonb(s) - 'company_id' - 'user_id' - 'report_id' - 'source_row_id' - 'transaction_id' - 'recording_id' - 'work_id' - 'release_id' - 'party_id' - 'agreement_id' - 'custom_properties') j
      WHERE NULLIF(trim(j.value), '') IS NOT NULL
    ),
    coverage AS (
      SELECT
        field_key,
        count(*)::INTEGER AS populated_rows,
        bool_or(field_value ~ '^-?\\d+(\\.\\d+)?$') AS has_numeric,
        bool_or(field_value ~ '^\\d{4}-\\d{2}-\\d{2}$') AS has_date
      FROM kv
      GROUP BY field_key
    ),
    ranked_samples AS (
      SELECT
        field_key,
        field_value,
        row_number() OVER (PARTITION BY field_key ORDER BY field_value ASC) AS rn
      FROM (
        SELECT DISTINCT field_key, field_value
        FROM kv
      ) deduped
    )
    SELECT jsonb_build_object(
      'from_date', v_from,
      'to_date', v_to,
      'total_rows', (SELECT count(*) FROM scoped),
      'columns',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'field_key', c.field_key,
            'inferred_type', CASE WHEN c.has_numeric THEN 'number' WHEN c.has_date THEN 'date' ELSE 'text' END,
            'coverage_pct', CASE WHEN (SELECT count(*) FROM scoped) = 0 THEN 0 ELSE ROUND((c.populated_rows::numeric / (SELECT count(*)::numeric FROM scoped)) * 100, 2) END,
            'source', 'canonical',
            'sample_values', COALESCE((
              SELECT jsonb_agg(to_jsonb(r.field_value) ORDER BY r.field_value ASC)
              FROM ranked_samples r
              WHERE r.field_key = c.field_key AND r.rn <= 3
            ), '[]'::jsonb)
          )
          ORDER BY c.field_key
        )
        FROM coverage c
      ), '[]'::jsonb),
      'aliases',
      jsonb_build_object(
        'platform', jsonb_build_array('dsp', 'service'),
        'track_title', jsonb_build_array('song', 'track'),
        'recording_title', jsonb_build_array('master', 'track_title'),
        'artist_name', jsonb_build_array('artist', 'recording_artist'),
        'recording_artist', jsonb_build_array('artist_name', 'artist'),
        'work_title', jsonb_build_array('work', 'composition'),
        'party_name', jsonb_build_array('owner', 'writer', 'publisher', 'rightsholder'),
        'share_pct', jsonb_build_array('share', 'split', 'ownership'),
        'share_kind', jsonb_build_array('registered_share', 'payable_share'),
        'rights_stream', jsonb_build_array('rights_type'),
        'net_revenue', jsonb_build_array('revenue', 'earnings', 'money')
      )
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
  v_company_id UUID := public.active_company_id();
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

  IF position(';' IN v_sql) > 0 OR v_sql ~ '(--|/\*|\*/)' OR v_sql ~ '"' THEN
    RAISE EXCEPTION 'Disallowed SQL syntax detected.';
  END IF;

  IF v_sql_lower ~ '\y(insert|update|delete|drop|alter|create|grant|revoke|copy|call|do|truncate)\y' THEN
    RAISE EXCEPTION 'Disallowed SQL keyword detected.';
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
      SELECT *
      FROM public.workspace_assistant_unified_scope_v1 s
      WHERE (
        ((%L::uuid IS NOT NULL AND s.company_id = %L::uuid) OR (%L::uuid IS NULL AND s.company_id IS NOT NULL AND public.can_access_company_data(s.company_id)))
        OR (s.company_id IS NULL AND s.user_id IS NOT NULL AND public.can_access_workspace_member_data(s.user_id))
      )
      AND (
        (s.source_kind IN ('income', 'legacy_income') AND s.event_date BETWEEN %L::date AND %L::date)
        OR (s.source_kind IN ('rights', 'entitlement') AND COALESCE(s.valid_to, %L::date) >= %L::date AND COALESCE(s.valid_from, %L::date) <= %L::date)
        OR s.source_kind IN ('quality', 'catalog', 'overview')
      )
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
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sj.payload -> 'columns', '[]'::jsonb)) col
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
  $q$,
    v_company_id, v_company_id, v_company_id,
    v_from, v_to, v_to, v_from, v_from, v_to,
    v_from, v_to,
    v_sql
  );

  EXECUTE v_exec_sql INTO v_rows;

  v_row_count := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_row_count > 0 THEN
    SELECT COALESCE(jsonb_agg(k.key ORDER BY k.key), '[]'::jsonb)
    INTO v_columns
    FROM jsonb_object_keys(v_rows -> 0) AS k(key);
  END IF;

  v_duration_ms := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at)) * 1000)::INTEGER);

  RETURN jsonb_build_object(
    'columns', v_columns,
    'rows', v_rows,
    'row_count', v_row_count,
    'duration_ms', v_duration_ms,
    'query_provenance', jsonb_build_array(
      'assistant_income_scope_v1',
      'assistant_rights_scope_v1',
      'assistant_entitlement_scope_v1',
      'assistant_quality_scope_v1',
      'assistant_catalog_scope_v1',
      'assistant_workspace_overview_v1',
      'workspace_assistant_scope_v1'
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

GRANT SELECT ON public.workspace_assistant_unified_scope_v1 TO authenticated;
GRANT SELECT ON public.workspace_assistant_unified_scope_v1 TO service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_assistant_catalog_v1(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_workspace_chat_sql_v1(DATE, DATE, TEXT) TO authenticated;
