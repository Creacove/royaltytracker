-- Artist-first query engine hardening:
-- 1) lock canonical artist scope parity with Transactions (non-failed reports)
-- 2) provide a single catalog function for compiler/runtime column intelligence
-- 3) add observability logs and miss dashboard view

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
WHERE cr.status <> 'failed';

CREATE OR REPLACE FUNCTION public.get_artist_assistant_catalog_v1(
  p_artist_key TEXT,
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
    ),
    aliases AS (
      SELECT
        semantic_key AS field_key,
        jsonb_agg(alias_key ORDER BY alias_key) AS alias_values
      FROM public.artist_chat_field_mapping_v1
      GROUP BY semantic_key
    ),
    columns_json AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'field_key', c.field_key,
            'inferred_type', c.inferred_type,
            'coverage_pct', c.coverage_pct,
            'source', c.source,
            'sample_values', c.sample_values
          )
          ORDER BY c.field_key
        ),
        '[]'::jsonb
      ) AS payload
      FROM all_columns c
    ),
    alias_json AS (
      SELECT COALESCE(
        jsonb_object_agg(a.field_key, a.alias_values),
        '{}'::jsonb
      ) AS payload
      FROM aliases a
    )
    SELECT jsonb_build_object(
      'artist_key', p_artist_key,
      'from_date', v_from,
      'to_date', v_to,
      'total_rows', (SELECT count(*) FROM scoped),
      'columns', (SELECT payload FROM columns_json),
      'aliases', (SELECT payload FROM alias_json)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_artist_assistant_catalog_v1(TEXT, DATE, DATE) TO authenticated;

CREATE TABLE IF NOT EXISTS public.artist_ai_turn_logs_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  artist_key TEXT NOT NULL,
  question TEXT NOT NULL,
  analysis_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  chosen_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  sql_text TEXT,
  sql_hash TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  verifier_status TEXT NOT NULL DEFAULT 'unknown',
  insufficiency_reason TEXT,
  final_answer_meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS artist_ai_turn_logs_v1_created_at_idx
  ON public.artist_ai_turn_logs_v1(created_at DESC);

CREATE INDEX IF NOT EXISTS artist_ai_turn_logs_v1_artist_key_idx
  ON public.artist_ai_turn_logs_v1(artist_key, created_at DESC);

CREATE INDEX IF NOT EXISTS artist_ai_turn_logs_v1_verifier_status_idx
  ON public.artist_ai_turn_logs_v1(verifier_status, created_at DESC);

ALTER TABLE public.artist_ai_turn_logs_v1 DISABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT ON public.artist_ai_turn_logs_v1 TO service_role;
GRANT SELECT ON public.artist_ai_turn_logs_v1 TO authenticated;

CREATE OR REPLACE VIEW public.artist_ai_misses_v1 AS
SELECT
  date_trunc('week', created_at)::date AS week_start,
  COALESCE(NULLIF(trim(insufficiency_reason), ''), 'none') AS failure_class,
  verifier_status,
  count(*)::INTEGER AS miss_count
FROM public.artist_ai_turn_logs_v1
WHERE verifier_status <> 'passed'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;

GRANT SELECT ON public.artist_ai_misses_v1 TO authenticated;
