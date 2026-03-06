-- Capability-enriched schema wrapper for artist natural chat.

CREATE OR REPLACE FUNCTION public.get_artist_assistant_schema_with_capabilities_v1(
  p_artist_key TEXT,
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_base JSONB;
  v_canonical_fields TEXT[] := ARRAY[]::TEXT[];
  v_custom_fields TEXT[] := ARRAY[]::TEXT[];
  v_present_fields TEXT[] := ARRAY[]::TEXT[];
  v_available_metrics TEXT[] := ARRAY[]::TEXT[];
  v_available_dimensions TEXT[] := ARRAY[]::TEXT[];
  v_metrics CONSTANT TEXT[] := ARRAY['net_revenue', 'gross_revenue', 'commission', 'quantity', 'streams', 'publisher_royalty', 'master_royalty'];
  v_dimensions CONSTANT TEXT[] := ARRAY['track_title', 'artist_name', 'territory', 'platform', 'usage_type', 'event_date', 'collaborator', 'producer', 'short_form_platform', 'derivative_type'];
  v_requirements JSONB := jsonb_build_object(
    'top_revenue_track', jsonb_build_array('track_title', 'net_revenue'),
    'artist_revenue_qoq', jsonb_build_array('event_date', 'net_revenue'),
    'top5_revenue_share', jsonb_build_array('track_title', 'net_revenue'),
    'underperforming_vs_streams', jsonb_build_array('track_title', 'net_revenue', 'streams'),
    'top_streamed_tracks_dsp', jsonb_build_array('track_title', 'platform', 'streams'),
    'geo_consumption', jsonb_build_array('territory', 'quantity'),
    'trending_tracks', jsonb_build_array('track_title', 'event_date', 'quantity'),
    'sync_usage_tracks', jsonb_build_array('track_title', 'sync_flag'),
    'licensing_potential_unpitched', jsonb_build_array('track_title', 'streams', 'pitched_flag'),
    'older_songs_renewed_growth', jsonb_build_array('track_title', 'event_date', 'quantity'),
    'collaborator_or_producer_revenue', jsonb_build_array('track_title', 'net_revenue', 'collaborator'),
    'publishing_vs_master', jsonb_build_array('track_title', 'publisher_royalty', 'master_royalty'),
    'short_form_performance', jsonb_build_array('track_title', 'quantity', 'short_form_platform'),
    'derivative_activity', jsonb_build_array('track_title', 'derivative_type')
  );
  v_missing_for_question JSONB := '{}'::jsonb;
  v_intent TEXT;
  v_required JSONB;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_field TEXT;
  v_aliases TEXT[];
  v_alias TEXT;
BEGIN
  v_base := public.get_artist_assistant_schema_v1(p_artist_key, from_date, to_date);

  SELECT COALESCE(array_agg(lower(trim(col->>'field_key'))), ARRAY[]::TEXT[])
  INTO v_canonical_fields
  FROM jsonb_array_elements(COALESCE(v_base->'canonical_columns', '[]'::jsonb)) col;

  SELECT COALESCE(array_agg(lower(trim(col->>'field_key'))), ARRAY[]::TEXT[])
  INTO v_custom_fields
  FROM jsonb_array_elements(COALESCE(v_base->'custom_columns', '[]'::jsonb)) col;

  v_present_fields := ARRAY(SELECT DISTINCT unnest(v_canonical_fields || v_custom_fields));

  FOR v_intent, v_required IN
    SELECT key, value
    FROM jsonb_each(v_requirements)
  LOOP
    v_missing := ARRAY[]::TEXT[];
    FOR v_field IN
      SELECT jsonb_array_elements_text(v_required)
    LOOP
      IF array_position(v_present_fields, v_field) IS NULL THEN
        SELECT array_agg(alias_key ORDER BY alias_key)
        INTO v_aliases
        FROM public.artist_chat_field_mapping_v1
        WHERE semantic_key = v_field;

        IF v_aliases IS NULL OR array_length(v_aliases, 1) IS NULL THEN
          v_missing := array_append(v_missing, v_field);
        ELSE
          IF NOT EXISTS (
            SELECT 1
            FROM unnest(v_aliases) a
            WHERE array_position(v_present_fields, lower(trim(a))) IS NOT NULL
          ) THEN
            v_missing := array_append(v_missing, v_field);
          END IF;
        END IF;
      END IF;
    END LOOP;

    v_missing_for_question := v_missing_for_question || jsonb_build_object(v_intent, to_jsonb(v_missing));
  END LOOP;

  FOREACH v_field IN ARRAY v_metrics
  LOOP
    IF array_position(v_present_fields, v_field) IS NOT NULL THEN
      v_available_metrics := array_append(v_available_metrics, v_field);
    ELSE
      SELECT array_agg(alias_key ORDER BY alias_key)
      INTO v_aliases
      FROM public.artist_chat_field_mapping_v1
      WHERE semantic_key = v_field;
      IF v_aliases IS NOT NULL AND EXISTS (
        SELECT 1
        FROM unnest(v_aliases) a
        WHERE array_position(v_present_fields, lower(trim(a))) IS NOT NULL
      ) THEN
        v_available_metrics := array_append(v_available_metrics, v_field);
      END IF;
    END IF;
  END LOOP;

  FOREACH v_field IN ARRAY v_dimensions
  LOOP
    IF array_position(v_present_fields, v_field) IS NOT NULL THEN
      v_available_dimensions := array_append(v_available_dimensions, v_field);
    ELSE
      SELECT array_agg(alias_key ORDER BY alias_key)
      INTO v_aliases
      FROM public.artist_chat_field_mapping_v1
      WHERE semantic_key = v_field;
      IF v_aliases IS NOT NULL AND EXISTS (
        SELECT 1
        FROM unnest(v_aliases) a
        WHERE array_position(v_present_fields, lower(trim(a))) IS NOT NULL
      ) THEN
        v_available_dimensions := array_append(v_available_dimensions, v_field);
      END IF;
    END IF;
  END LOOP;

  RETURN v_base || jsonb_build_object(
    'capabilities',
    jsonb_build_object(
      'available_metrics', to_jsonb(v_available_metrics),
      'available_dimensions', to_jsonb(v_available_dimensions),
      'missing_for_question', v_missing_for_question
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_artist_assistant_schema_with_capabilities_v1(TEXT, DATE, DATE) TO authenticated;
