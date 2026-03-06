-- Deterministic semantic-key registry for artist natural chat (custom-fields-first).

CREATE TABLE IF NOT EXISTS public.artist_chat_field_mapping_v1 (
  semantic_key TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  value_kind TEXT NOT NULL DEFAULT 'text',
  PRIMARY KEY (semantic_key, alias_key)
);

INSERT INTO public.artist_chat_field_mapping_v1 (semantic_key, alias_key, value_kind) VALUES
  ('streams', 'streams', 'number'),
  ('streams', 'stream_count', 'number'),
  ('streams', 'streams_count', 'number'),
  ('streams', 'total_streams', 'number'),
  ('streams', 'plays', 'number'),
  ('sync_flag', 'sync', 'text'),
  ('sync_flag', 'sync_flag', 'text'),
  ('sync_flag', 'sync_type', 'text'),
  ('publisher_royalty', 'publisher_royalty', 'number'),
  ('publisher_royalty', 'publishing_royalty', 'number'),
  ('publisher_royalty', 'publishing_revenue', 'number'),
  ('master_royalty', 'master_royalty', 'number'),
  ('master_royalty', 'master_revenue', 'number'),
  ('master_royalty', 'master_net', 'number'),
  ('collaborator', 'collaborator', 'text'),
  ('collaborator', 'collaborators', 'text'),
  ('collaborator', 'featured_artist', 'text'),
  ('producer', 'producer', 'text'),
  ('producer', 'producers', 'text'),
  ('short_form_platform', 'short_form_platform', 'text'),
  ('short_form_platform', 'social_platform', 'text'),
  ('short_form_platform', 'ugc_platform', 'text'),
  ('short_form_platform', 'tiktok_reels_shorts', 'text'),
  ('derivative_type', 'derivative_type', 'text'),
  ('derivative_type', 'cover', 'text'),
  ('derivative_type', 'sample', 'text'),
  ('derivative_type', 'interpolation', 'text'),
  ('pitched_flag', 'pitched', 'text'),
  ('pitched_flag', 'pitched_flag', 'text'),
  ('pitched_flag', 'pitch_status', 'text')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_artist_chat_mapping_manifest_v1()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'semantic_key', semantic_key,
        'alias_key', alias_key,
        'value_kind', value_kind
      )
      ORDER BY semantic_key, alias_key
    ),
    '[]'::jsonb
  )
  FROM public.artist_chat_field_mapping_v1;
$$;

GRANT SELECT ON public.artist_chat_field_mapping_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_artist_chat_mapping_manifest_v1() TO authenticated;
