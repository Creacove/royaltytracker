-- V1 Music Business Copilot Foundation
-- Raw evidence stays immutable, the workspace/company graph becomes the durable truth,
-- and assistant read models become the AI query surface.

CREATE OR REPLACE FUNCTION public.normalize_music_identifier(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(upper(COALESCE(p_value, '')), '[^A-Z0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_catalog_text(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(lower(trim(COALESCE(p_value, ''))), '\s+', ' ', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.try_numeric(p_value TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_value TEXT := NULLIF(trim(COALESCE(p_value, '')), '');
BEGIN
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_value::numeric;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.try_date(p_value TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_value TEXT := NULLIF(trim(COALESCE(p_value, '')), '');
BEGIN
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_value::date;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_active_company_id(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.company_id
  FROM public.company_memberships m
  WHERE m.user_id = p_user_id
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.active_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.resolve_user_active_company_id(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_access_company_data(
  p_company_id UUID,
  p_fallback_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships m
        WHERE m.user_id = auth.uid()
          AND m.membership_status = 'active'
          AND m.company_id = COALESCE(
            p_company_id,
            public.resolve_user_active_company_id(p_fallback_user_id)
          )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.normalize_music_identifier(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_music_identifier(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_catalog_text(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_catalog_text(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_numeric(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_numeric(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_date(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_date(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_user_active_company_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_user_active_company_id(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.active_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_company_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.can_access_company_data(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_company_data(UUID, UUID) TO service_role;

CREATE TABLE IF NOT EXISTS public.catalog_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL DEFAULT 'unknown',
  display_name TEXT NOT NULL,
  legal_name TEXT,
  normalized_name TEXT,
  ipi_number TEXT,
  isni TEXT,
  society_code TEXT,
  country_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  canonical_title TEXT NOT NULL,
  normalized_title TEXT,
  iswc TEXT,
  source_work_code TEXT,
  deposit_date DATE,
  language TEXT,
  genre TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  canonical_title TEXT NOT NULL,
  normalized_title TEXT,
  display_artist TEXT,
  normalized_artist TEXT,
  isrc TEXT,
  release_date DATE,
  label_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  canonical_title TEXT NOT NULL,
  upc TEXT,
  release_date DATE,
  label_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  agreement_type TEXT NOT NULL,
  counterparty_party_id UUID REFERENCES public.catalog_parties(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  effective_start DATE,
  effective_end DATE,
  term_mode TEXT,
  term_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_document_id UUID REFERENCES public.cmo_reports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  alias_kind TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  normalized_alias TEXT,
  source_system TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  left_entity_type TEXT NOT NULL,
  left_entity_id UUID NOT NULL,
  link_type TEXT NOT NULL,
  right_entity_type TEXT NOT NULL,
  right_entity_id UUID NOT NULL,
  confidence NUMERIC(5,2),
  resolution_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  claim_type TEXT NOT NULL,
  basis_type TEXT NOT NULL,
  source_report_id UUID REFERENCES public.cmo_reports(id) ON DELETE SET NULL,
  source_row_id UUID REFERENCES public.source_rows(id) ON DELETE SET NULL,
  subject_entity_type TEXT,
  subject_entity_id UUID,
  related_entity_type TEXT,
  related_entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(5,2),
  resolution_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_rights_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  asset_id UUID,
  party_id UUID REFERENCES public.catalog_parties(id) ON DELETE SET NULL,
  rights_family TEXT NOT NULL DEFAULT 'unknown',
  rights_stream TEXT NOT NULL DEFAULT 'unknown',
  share_kind TEXT NOT NULL DEFAULT 'registered',
  share_pct NUMERIC(8,4),
  territory_scope TEXT,
  valid_from DATE,
  valid_to DATE,
  basis_type TEXT NOT NULL,
  source_claim_id UUID REFERENCES public.catalog_claims(id) ON DELETE SET NULL,
  confidence NUMERIC(5,2),
  is_conflicted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_resolution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  event_type TEXT NOT NULL,
  previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_by UUID,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_parties
  DROP CONSTRAINT IF EXISTS catalog_parties_party_type_check,
  DROP CONSTRAINT IF EXISTS catalog_parties_status_check;
ALTER TABLE public.catalog_parties
  ADD CONSTRAINT catalog_parties_party_type_check
    CHECK (party_type IN ('writer', 'publisher', 'artist', 'label', 'society', 'distributor', 'manager', 'company', 'person', 'unknown')),
  ADD CONSTRAINT catalog_parties_status_check
    CHECK (status IN ('active', 'inactive', 'pending', 'archived'));

ALTER TABLE public.catalog_works
  DROP CONSTRAINT IF EXISTS catalog_works_status_check;
ALTER TABLE public.catalog_works
  ADD CONSTRAINT catalog_works_status_check
    CHECK (status IN ('active', 'inactive', 'pending', 'archived'));

ALTER TABLE public.catalog_recordings
  DROP CONSTRAINT IF EXISTS catalog_recordings_status_check;
ALTER TABLE public.catalog_recordings
  ADD CONSTRAINT catalog_recordings_status_check
    CHECK (status IN ('active', 'inactive', 'pending', 'archived'));

ALTER TABLE public.catalog_releases
  DROP CONSTRAINT IF EXISTS catalog_releases_status_check;
ALTER TABLE public.catalog_releases
  ADD CONSTRAINT catalog_releases_status_check
    CHECK (status IN ('active', 'inactive', 'pending', 'archived'));

ALTER TABLE public.catalog_agreements
  DROP CONSTRAINT IF EXISTS catalog_agreements_status_check,
  DROP CONSTRAINT IF EXISTS catalog_agreements_term_mode_check;
ALTER TABLE public.catalog_agreements
  ADD CONSTRAINT catalog_agreements_status_check
    CHECK (status IN ('draft', 'active', 'inactive', 'expired', 'archived')),
  ADD CONSTRAINT catalog_agreements_term_mode_check
    CHECK (
      term_mode IS NULL
      OR term_mode IN ('flat_pct', 'rights_stream_pct', 'territory_pct', 'manual_summary', 'other')
    );

ALTER TABLE public.catalog_claims
  DROP CONSTRAINT IF EXISTS catalog_claims_basis_type_check,
  DROP CONSTRAINT IF EXISTS catalog_claims_resolution_status_check;
ALTER TABLE public.catalog_claims
  ADD CONSTRAINT catalog_claims_basis_type_check
    CHECK (basis_type IN ('observed', 'registered', 'contractual', 'estimated', 'external')),
  ADD CONSTRAINT catalog_claims_resolution_status_check
    CHECK (resolution_status IN ('pending', 'resolved', 'dismissed'));

ALTER TABLE public.catalog_rights_positions
  DROP CONSTRAINT IF EXISTS catalog_rights_positions_asset_type_check,
  DROP CONSTRAINT IF EXISTS catalog_rights_positions_rights_family_check,
  DROP CONSTRAINT IF EXISTS catalog_rights_positions_rights_stream_check,
  DROP CONSTRAINT IF EXISTS catalog_rights_positions_share_kind_check,
  DROP CONSTRAINT IF EXISTS catalog_rights_positions_basis_type_check;
ALTER TABLE public.catalog_rights_positions
  ADD CONSTRAINT catalog_rights_positions_asset_type_check
    CHECK (asset_type IN ('work', 'recording', 'release', 'mixed', 'unknown')),
  ADD CONSTRAINT catalog_rights_positions_rights_family_check
    CHECK (rights_family IN ('publishing', 'recording', 'neighboring', 'mixed', 'unknown')),
  ADD CONSTRAINT catalog_rights_positions_rights_stream_check
    CHECK (rights_stream IN ('performance', 'mechanical', 'sync', 'phonographic', 'other', 'unknown')),
  ADD CONSTRAINT catalog_rights_positions_share_kind_check
    CHECK (share_kind IN ('owned', 'collected', 'payable', 'registered', 'contractual', 'estimated', 'unknown')),
  ADD CONSTRAINT catalog_rights_positions_basis_type_check
    CHECK (basis_type IN ('observed', 'registered', 'contractual', 'estimated', 'external'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_parties_company_ipi
  ON public.catalog_parties (company_id, ipi_number)
  WHERE ipi_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_parties_company_name
  ON public.catalog_parties (company_id, normalized_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_works_company_iswc
  ON public.catalog_works (company_id, iswc)
  WHERE iswc IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_works_company_source_work_code
  ON public.catalog_works (company_id, source_work_code)
  WHERE source_work_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_works_company_title
  ON public.catalog_works (company_id, normalized_title);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_recordings_company_isrc
  ON public.catalog_recordings (company_id, isrc)
  WHERE isrc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_recordings_company_title_artist
  ON public.catalog_recordings (company_id, normalized_title, normalized_artist);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_releases_company_upc
  ON public.catalog_releases (company_id, upc)
  WHERE upc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_releases_company_title
  ON public.catalog_releases (company_id, canonical_title);

CREATE INDEX IF NOT EXISTS idx_catalog_agreements_company_status
  ON public.catalog_agreements (company_id, status, term_mode);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_entity_aliases_unique
  ON public.catalog_entity_aliases (company_id, entity_type, entity_id, alias_kind, alias_value);
CREATE INDEX IF NOT EXISTS idx_catalog_entity_aliases_lookup
  ON public.catalog_entity_aliases (company_id, entity_type, normalized_alias);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_entity_links_unique
  ON public.catalog_entity_links (company_id, left_entity_type, left_entity_id, link_type, right_entity_type, right_entity_id);

CREATE INDEX IF NOT EXISTS idx_catalog_claims_company_type
  ON public.catalog_claims (company_id, claim_type, basis_type, resolution_status);
CREATE INDEX IF NOT EXISTS idx_catalog_claims_source_report
  ON public.catalog_claims (source_report_id, source_row_id);

CREATE INDEX IF NOT EXISTS idx_catalog_rights_positions_company_asset
  ON public.catalog_rights_positions (company_id, asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_catalog_rights_positions_company_party
  ON public.catalog_rights_positions (company_id, party_id, rights_stream);

CREATE INDEX IF NOT EXISTS idx_catalog_resolution_events_company_entity
  ON public.catalog_resolution_events (company_id, entity_type, entity_id, decided_at DESC);

ALTER TABLE public.cmo_reports
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.partner_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_kind TEXT,
  ADD COLUMN IF NOT EXISTS business_side TEXT,
  ADD COLUMN IF NOT EXISTS parser_lane TEXT,
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_reference TEXT;

ALTER TABLE public.ingestion_files
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.partner_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_kind TEXT,
  ADD COLUMN IF NOT EXISTS business_side TEXT,
  ADD COLUMN IF NOT EXISTS parser_lane TEXT,
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_reference TEXT;

ALTER TABLE public.source_rows
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.partner_companies(id) ON DELETE SET NULL;

ALTER TABLE public.source_fields
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.partner_companies(id) ON DELETE SET NULL;

ALTER TABLE public.review_tasks
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.partner_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS resolved_entity_id UUID;

ALTER TABLE public.royalty_transactions
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.partner_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recording_id UUID,
  ADD COLUMN IF NOT EXISTS work_id UUID,
  ADD COLUMN IF NOT EXISTS release_id UUID,
  ADD COLUMN IF NOT EXISTS asset_class TEXT,
  ADD COLUMN IF NOT EXISTS rights_family TEXT,
  ADD COLUMN IF NOT EXISTS rights_stream TEXT,
  ADD COLUMN IF NOT EXISTS basis_type TEXT NOT NULL DEFAULT 'observed';

ALTER TABLE public.cmo_reports
  DROP CONSTRAINT IF EXISTS cmo_reports_document_kind_check,
  DROP CONSTRAINT IF EXISTS cmo_reports_business_side_check,
  DROP CONSTRAINT IF EXISTS cmo_reports_parser_lane_check;
ALTER TABLE public.cmo_reports
  ADD CONSTRAINT cmo_reports_document_kind_check
    CHECK (
      document_kind IS NULL
      OR document_kind IN ('income_statement', 'rights_catalog', 'split_sheet', 'contract_summary', 'mixed_statement')
    ),
  ADD CONSTRAINT cmo_reports_business_side_check
    CHECK (
      business_side IS NULL
      OR business_side IN ('publishing', 'recording', 'mixed', 'unknown')
    ),
  ADD CONSTRAINT cmo_reports_parser_lane_check
    CHECK (
      parser_lane IS NULL
      OR parser_lane IN ('income', 'rights', 'mixed')
    );

ALTER TABLE public.ingestion_files
  DROP CONSTRAINT IF EXISTS ingestion_files_document_kind_check,
  DROP CONSTRAINT IF EXISTS ingestion_files_business_side_check,
  DROP CONSTRAINT IF EXISTS ingestion_files_parser_lane_check;
ALTER TABLE public.ingestion_files
  ADD CONSTRAINT ingestion_files_document_kind_check
    CHECK (
      document_kind IS NULL
      OR document_kind IN ('income_statement', 'rights_catalog', 'split_sheet', 'contract_summary', 'mixed_statement')
    ),
  ADD CONSTRAINT ingestion_files_business_side_check
    CHECK (
      business_side IS NULL
      OR business_side IN ('publishing', 'recording', 'mixed', 'unknown')
    ),
  ADD CONSTRAINT ingestion_files_parser_lane_check
    CHECK (
      parser_lane IS NULL
      OR parser_lane IN ('income', 'rights', 'mixed')
    );

ALTER TABLE public.review_tasks
  DROP CONSTRAINT IF EXISTS review_tasks_resolution_status_check;
ALTER TABLE public.review_tasks
  ADD CONSTRAINT review_tasks_resolution_status_check
    CHECK (resolution_status IN ('pending', 'resolved', 'dismissed'));

ALTER TABLE public.royalty_transactions
  DROP CONSTRAINT IF EXISTS royalty_transactions_asset_class_check,
  DROP CONSTRAINT IF EXISTS royalty_transactions_rights_family_check,
  DROP CONSTRAINT IF EXISTS royalty_transactions_rights_stream_check,
  DROP CONSTRAINT IF EXISTS royalty_transactions_basis_type_check,
  DROP CONSTRAINT IF EXISTS royalty_transactions_recording_id_fkey,
  DROP CONSTRAINT IF EXISTS royalty_transactions_work_id_fkey,
  DROP CONSTRAINT IF EXISTS royalty_transactions_release_id_fkey;
ALTER TABLE public.royalty_transactions
  ADD CONSTRAINT royalty_transactions_asset_class_check
    CHECK (
      asset_class IS NULL
      OR asset_class IN ('work', 'recording', 'release', 'mixed', 'unknown')
    ),
  ADD CONSTRAINT royalty_transactions_rights_family_check
    CHECK (
      rights_family IS NULL
      OR rights_family IN ('publishing', 'recording', 'neighboring', 'mixed', 'unknown')
    ),
  ADD CONSTRAINT royalty_transactions_rights_stream_check
    CHECK (
      rights_stream IS NULL
      OR rights_stream IN ('performance', 'mechanical', 'sync', 'phonographic', 'other', 'unknown')
    ),
  ADD CONSTRAINT royalty_transactions_basis_type_check
    CHECK (basis_type IN ('observed', 'registered', 'contractual', 'estimated', 'external')),
  ADD CONSTRAINT royalty_transactions_recording_id_fkey
    FOREIGN KEY (recording_id) REFERENCES public.catalog_recordings(id) ON DELETE SET NULL,
  ADD CONSTRAINT royalty_transactions_work_id_fkey
    FOREIGN KEY (work_id) REFERENCES public.catalog_works(id) ON DELETE SET NULL,
  ADD CONSTRAINT royalty_transactions_release_id_fkey
    FOREIGN KEY (release_id) REFERENCES public.catalog_releases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cmo_reports_company_created
  ON public.cmo_reports (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_files_company_created
  ON public.ingestion_files (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_rows_company_report
  ON public.source_rows (company_id, report_id, source_row_index);
CREATE INDEX IF NOT EXISTS idx_source_fields_company_report
  ON public.source_fields (company_id, report_id, field_name);
CREATE INDEX IF NOT EXISTS idx_review_tasks_company_status
  ON public.review_tasks (company_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_royalty_transactions_company_event
  ON public.royalty_transactions (company_id, period_end, period_start, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_royalty_transactions_company_recording
  ON public.royalty_transactions (company_id, recording_id, work_id, release_id);

UPDATE public.cmo_reports r
SET
  company_id = COALESCE(r.company_id, public.resolve_user_active_company_id(r.user_id)),
  document_kind = COALESCE(r.document_kind, 'income_statement'),
  business_side = COALESCE(r.business_side, 'unknown'),
  parser_lane = COALESCE(r.parser_lane, 'income'),
  source_system = COALESCE(r.source_system, r.cmo_name, 'workspace_upload'),
  source_reference = COALESCE(r.source_reference, r.statement_reference, r.file_name)
WHERE
  r.company_id IS NULL
  OR r.document_kind IS NULL
  OR r.business_side IS NULL
  OR r.parser_lane IS NULL
  OR r.source_system IS NULL
  OR r.source_reference IS NULL;

UPDATE public.ingestion_files f
SET
  company_id = COALESCE(
    f.company_id,
    (SELECT r.company_id FROM public.cmo_reports r WHERE r.id = f.report_id),
    public.resolve_user_active_company_id(f.user_id)
  ),
  document_kind = COALESCE(
    f.document_kind,
    (SELECT r.document_kind FROM public.cmo_reports r WHERE r.id = f.report_id),
    'income_statement'
  ),
  business_side = COALESCE(
    f.business_side,
    (SELECT r.business_side FROM public.cmo_reports r WHERE r.id = f.report_id),
    'unknown'
  ),
  parser_lane = COALESCE(
    f.parser_lane,
    (SELECT r.parser_lane FROM public.cmo_reports r WHERE r.id = f.report_id),
    'income'
  ),
  source_system = COALESCE(
    f.source_system,
    (SELECT r.source_system FROM public.cmo_reports r WHERE r.id = f.report_id),
    'workspace_upload'
  ),
  source_reference = COALESCE(
    f.source_reference,
    (SELECT r.source_reference FROM public.cmo_reports r WHERE r.id = f.report_id),
    f.file_name
  )
WHERE
  f.company_id IS NULL
  OR f.document_kind IS NULL
  OR f.business_side IS NULL
  OR f.parser_lane IS NULL
  OR f.source_system IS NULL
  OR f.source_reference IS NULL;

UPDATE public.source_rows sr
SET company_id = COALESCE(
  sr.company_id,
  (SELECT r.company_id FROM public.cmo_reports r WHERE r.id = sr.report_id),
  public.resolve_user_active_company_id(sr.user_id)
)
WHERE sr.company_id IS NULL;

UPDATE public.source_fields sf
SET company_id = COALESCE(
  sf.company_id,
  (SELECT sr.company_id FROM public.source_rows sr WHERE sr.id = sf.source_row_id),
  (SELECT r.company_id FROM public.cmo_reports r WHERE r.id = sf.report_id),
  public.resolve_user_active_company_id(sf.user_id)
)
WHERE sf.company_id IS NULL;

UPDATE public.review_tasks rt
SET
  company_id = COALESCE(
    rt.company_id,
    (SELECT r.company_id FROM public.cmo_reports r WHERE r.id = rt.report_id),
    public.resolve_user_active_company_id(rt.user_id)
  ),
  resolution_status = COALESCE(rt.resolution_status, 'pending')
WHERE rt.company_id IS NULL OR rt.resolution_status IS NULL;

UPDATE public.royalty_transactions rt
SET
  company_id = COALESCE(
    rt.company_id,
    (SELECT r.company_id FROM public.cmo_reports r WHERE r.id = rt.report_id),
    public.resolve_user_active_company_id(rt.user_id)
  ),
  asset_class = COALESCE(rt.asset_class, CASE WHEN rt.iswc IS NOT NULL THEN 'mixed' ELSE 'recording' END),
  rights_family = COALESCE(rt.rights_family, CASE WHEN rt.iswc IS NOT NULL THEN 'publishing' ELSE 'recording' END),
  rights_stream = COALESCE(rt.rights_stream, 'unknown'),
  basis_type = COALESCE(rt.basis_type, 'observed')
WHERE
  rt.company_id IS NULL
  OR rt.asset_class IS NULL
  OR rt.rights_family IS NULL
  OR rt.rights_stream IS NULL
  OR rt.basis_type IS NULL;

CREATE OR REPLACE FUNCTION public.sync_workspace_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME <> 'cmo_reports' AND NEW.report_id IS NOT NULL THEN
    IF NEW.report_id IS NOT NULL THEN
      SELECT r.company_id
      INTO v_company_id
      FROM public.cmo_reports r
      WHERE r.id = NEW.report_id;
    END IF;
  END IF;

  IF v_company_id IS NULL AND NEW.user_id IS NOT NULL THEN
    v_company_id := public.resolve_user_active_company_id(NEW.user_id);
  END IF;

  NEW.company_id := v_company_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_cmo_reports_company_id ON public.cmo_reports;
CREATE TRIGGER sync_cmo_reports_company_id
BEFORE INSERT OR UPDATE ON public.cmo_reports
FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_company_id();

DROP TRIGGER IF EXISTS sync_ingestion_files_company_id ON public.ingestion_files;
CREATE TRIGGER sync_ingestion_files_company_id
BEFORE INSERT OR UPDATE ON public.ingestion_files
FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_company_id();

DROP TRIGGER IF EXISTS sync_source_rows_company_id ON public.source_rows;
CREATE TRIGGER sync_source_rows_company_id
BEFORE INSERT OR UPDATE ON public.source_rows
FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_company_id();

DROP TRIGGER IF EXISTS sync_source_fields_company_id ON public.source_fields;
CREATE TRIGGER sync_source_fields_company_id
BEFORE INSERT OR UPDATE ON public.source_fields
FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_company_id();

DROP TRIGGER IF EXISTS sync_review_tasks_company_id ON public.review_tasks;
CREATE TRIGGER sync_review_tasks_company_id
BEFORE INSERT OR UPDATE ON public.review_tasks
FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_company_id();

DROP TRIGGER IF EXISTS sync_royalty_transactions_company_id ON public.royalty_transactions;
CREATE TRIGGER sync_royalty_transactions_company_id
BEFORE INSERT OR UPDATE ON public.royalty_transactions
FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_company_id();

INSERT INTO public.catalog_recordings (
  company_id,
  canonical_title,
  normalized_title,
  display_artist,
  normalized_artist,
  isrc,
  release_date,
  status
)
SELECT
  rt.company_id,
  COALESCE(max(NULLIF(trim(rt.track_title), '')), 'Unknown Track') AS canonical_title,
  max(public.normalize_catalog_text(rt.track_title)) AS normalized_title,
  max(NULLIF(trim(rt.artist_name), '')) AS display_artist,
  max(public.normalize_catalog_text(rt.artist_name)) AS normalized_artist,
  public.normalize_music_identifier(rt.isrc) AS isrc,
  max(COALESCE(rt.period_end, rt.period_start)) AS release_date,
  'active'
FROM public.royalty_transactions rt
WHERE rt.company_id IS NOT NULL
  AND public.normalize_music_identifier(rt.isrc) IS NOT NULL
GROUP BY rt.company_id, public.normalize_music_identifier(rt.isrc)
ON CONFLICT (company_id, isrc) WHERE isrc IS NOT NULL DO UPDATE
SET
  canonical_title = COALESCE(EXCLUDED.canonical_title, public.catalog_recordings.canonical_title),
  normalized_title = COALESCE(EXCLUDED.normalized_title, public.catalog_recordings.normalized_title),
  display_artist = COALESCE(EXCLUDED.display_artist, public.catalog_recordings.display_artist),
  normalized_artist = COALESCE(EXCLUDED.normalized_artist, public.catalog_recordings.normalized_artist),
  release_date = COALESCE(EXCLUDED.release_date, public.catalog_recordings.release_date),
  updated_at = now();

INSERT INTO public.catalog_works (
  company_id,
  canonical_title,
  normalized_title,
  iswc,
  deposit_date,
  status
)
SELECT
  rt.company_id,
  COALESCE(max(NULLIF(trim(rt.track_title), '')), 'Unknown Work') AS canonical_title,
  max(public.normalize_catalog_text(rt.track_title)) AS normalized_title,
  public.normalize_music_identifier(rt.iswc) AS iswc,
  max(COALESCE(rt.period_end, rt.period_start)) AS deposit_date,
  'active'
FROM public.royalty_transactions rt
WHERE rt.company_id IS NOT NULL
  AND public.normalize_music_identifier(rt.iswc) IS NOT NULL
GROUP BY rt.company_id, public.normalize_music_identifier(rt.iswc)
ON CONFLICT (company_id, iswc) WHERE iswc IS NOT NULL DO UPDATE
SET
  canonical_title = COALESCE(EXCLUDED.canonical_title, public.catalog_works.canonical_title),
  normalized_title = COALESCE(EXCLUDED.normalized_title, public.catalog_works.normalized_title),
  deposit_date = COALESCE(EXCLUDED.deposit_date, public.catalog_works.deposit_date),
  updated_at = now();

UPDATE public.royalty_transactions rt
SET recording_id = cr.id
FROM public.catalog_recordings cr
WHERE rt.recording_id IS NULL
  AND rt.company_id = cr.company_id
  AND public.normalize_music_identifier(rt.isrc) = cr.isrc;

UPDATE public.royalty_transactions rt
SET work_id = cw.id,
    asset_class = CASE
      WHEN rt.recording_id IS NOT NULL THEN 'mixed'
      ELSE COALESCE(rt.asset_class, 'work')
    END,
    rights_family = COALESCE(NULLIF(rt.rights_family, ''), 'publishing')
FROM public.catalog_works cw
WHERE rt.work_id IS NULL
  AND rt.company_id = cw.company_id
  AND public.normalize_music_identifier(rt.iswc) = cw.iswc;

INSERT INTO public.catalog_entity_aliases (
  company_id,
  entity_type,
  entity_id,
  alias_kind,
  alias_value,
  normalized_alias,
  source_system
)
SELECT
  cr.company_id,
  'recording',
  cr.id,
  'isrc',
  cr.isrc,
  cr.isrc,
  'migration_backfill'
FROM public.catalog_recordings cr
WHERE cr.isrc IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.catalog_entity_aliases (
  company_id,
  entity_type,
  entity_id,
  alias_kind,
  alias_value,
  normalized_alias,
  source_system
)
SELECT
  cw.company_id,
  'work',
  cw.id,
  'iswc',
  cw.iswc,
  cw.iswc,
  'migration_backfill'
FROM public.catalog_works cw
WHERE cw.iswc IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.catalog_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_rights_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_resolution_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can view catalog parties" ON public.catalog_parties;
DROP POLICY IF EXISTS "Company members can insert catalog parties" ON public.catalog_parties;
DROP POLICY IF EXISTS "Company members can update catalog parties" ON public.catalog_parties;
CREATE POLICY "Company members can view catalog parties"
ON public.catalog_parties FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog parties"
ON public.catalog_parties FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog parties"
ON public.catalog_parties FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog works" ON public.catalog_works;
DROP POLICY IF EXISTS "Company members can insert catalog works" ON public.catalog_works;
DROP POLICY IF EXISTS "Company members can update catalog works" ON public.catalog_works;
CREATE POLICY "Company members can view catalog works"
ON public.catalog_works FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog works"
ON public.catalog_works FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog works"
ON public.catalog_works FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog recordings" ON public.catalog_recordings;
DROP POLICY IF EXISTS "Company members can insert catalog recordings" ON public.catalog_recordings;
DROP POLICY IF EXISTS "Company members can update catalog recordings" ON public.catalog_recordings;
CREATE POLICY "Company members can view catalog recordings"
ON public.catalog_recordings FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog recordings"
ON public.catalog_recordings FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog recordings"
ON public.catalog_recordings FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog releases" ON public.catalog_releases;
DROP POLICY IF EXISTS "Company members can insert catalog releases" ON public.catalog_releases;
DROP POLICY IF EXISTS "Company members can update catalog releases" ON public.catalog_releases;
CREATE POLICY "Company members can view catalog releases"
ON public.catalog_releases FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog releases"
ON public.catalog_releases FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog releases"
ON public.catalog_releases FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog agreements" ON public.catalog_agreements;
DROP POLICY IF EXISTS "Company members can insert catalog agreements" ON public.catalog_agreements;
DROP POLICY IF EXISTS "Company members can update catalog agreements" ON public.catalog_agreements;
CREATE POLICY "Company members can view catalog agreements"
ON public.catalog_agreements FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog agreements"
ON public.catalog_agreements FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog agreements"
ON public.catalog_agreements FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog entity aliases" ON public.catalog_entity_aliases;
DROP POLICY IF EXISTS "Company members can insert catalog entity aliases" ON public.catalog_entity_aliases;
DROP POLICY IF EXISTS "Company members can update catalog entity aliases" ON public.catalog_entity_aliases;
CREATE POLICY "Company members can view catalog entity aliases"
ON public.catalog_entity_aliases FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog entity aliases"
ON public.catalog_entity_aliases FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog entity aliases"
ON public.catalog_entity_aliases FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog entity links" ON public.catalog_entity_links;
DROP POLICY IF EXISTS "Company members can insert catalog entity links" ON public.catalog_entity_links;
DROP POLICY IF EXISTS "Company members can update catalog entity links" ON public.catalog_entity_links;
CREATE POLICY "Company members can view catalog entity links"
ON public.catalog_entity_links FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog entity links"
ON public.catalog_entity_links FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog entity links"
ON public.catalog_entity_links FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog claims" ON public.catalog_claims;
DROP POLICY IF EXISTS "Company members can insert catalog claims" ON public.catalog_claims;
DROP POLICY IF EXISTS "Company members can update catalog claims" ON public.catalog_claims;
CREATE POLICY "Company members can view catalog claims"
ON public.catalog_claims FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog claims"
ON public.catalog_claims FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog claims"
ON public.catalog_claims FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog rights positions" ON public.catalog_rights_positions;
DROP POLICY IF EXISTS "Company members can insert catalog rights positions" ON public.catalog_rights_positions;
DROP POLICY IF EXISTS "Company members can update catalog rights positions" ON public.catalog_rights_positions;
CREATE POLICY "Company members can view catalog rights positions"
ON public.catalog_rights_positions FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog rights positions"
ON public.catalog_rights_positions FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can update catalog rights positions"
ON public.catalog_rights_positions FOR UPDATE
USING (public.can_access_company_data(company_id, NULL))
WITH CHECK (public.can_access_company_data(company_id, NULL));

DROP POLICY IF EXISTS "Company members can view catalog resolution events" ON public.catalog_resolution_events;
DROP POLICY IF EXISTS "Company members can insert catalog resolution events" ON public.catalog_resolution_events;
CREATE POLICY "Company members can view catalog resolution events"
ON public.catalog_resolution_events FOR SELECT
USING (public.can_access_company_data(company_id, NULL));
CREATE POLICY "Company members can insert catalog resolution events"
ON public.catalog_resolution_events FOR INSERT
WITH CHECK (public.can_access_company_data(company_id, NULL));

GRANT SELECT, INSERT, UPDATE ON public.catalog_parties TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_works TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_recordings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_releases TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_agreements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_entity_aliases TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_entity_links TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_claims TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalog_rights_positions TO authenticated;
GRANT SELECT, INSERT ON public.catalog_resolution_events TO authenticated;

GRANT ALL ON public.catalog_parties TO service_role;
GRANT ALL ON public.catalog_works TO service_role;
GRANT ALL ON public.catalog_recordings TO service_role;
GRANT ALL ON public.catalog_releases TO service_role;
GRANT ALL ON public.catalog_agreements TO service_role;
GRANT ALL ON public.catalog_entity_aliases TO service_role;
GRANT ALL ON public.catalog_entity_links TO service_role;
GRANT ALL ON public.catalog_claims TO service_role;
GRANT ALL ON public.catalog_rights_positions TO service_role;
GRANT ALL ON public.catalog_resolution_events TO service_role;

DROP TRIGGER IF EXISTS update_catalog_parties_updated_at ON public.catalog_parties;
CREATE TRIGGER update_catalog_parties_updated_at
BEFORE UPDATE ON public.catalog_parties
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_works_updated_at ON public.catalog_works;
CREATE TRIGGER update_catalog_works_updated_at
BEFORE UPDATE ON public.catalog_works
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_recordings_updated_at ON public.catalog_recordings;
CREATE TRIGGER update_catalog_recordings_updated_at
BEFORE UPDATE ON public.catalog_recordings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_releases_updated_at ON public.catalog_releases;
CREATE TRIGGER update_catalog_releases_updated_at
BEFORE UPDATE ON public.catalog_releases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_agreements_updated_at ON public.catalog_agreements;
CREATE TRIGGER update_catalog_agreements_updated_at
BEFORE UPDATE ON public.catalog_agreements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_entity_links_updated_at ON public.catalog_entity_links;
CREATE TRIGGER update_catalog_entity_links_updated_at
BEFORE UPDATE ON public.catalog_entity_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_claims_updated_at ON public.catalog_claims;
CREATE TRIGGER update_catalog_claims_updated_at
BEFORE UPDATE ON public.catalog_claims
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_catalog_rights_positions_updated_at ON public.catalog_rights_positions;
CREATE TRIGGER update_catalog_rights_positions_updated_at
BEFORE UPDATE ON public.catalog_rights_positions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE VIEW public.track_assistant_scope_v2 AS
SELECT
  rt.id AS transaction_id,
  rt.user_id,
  rt.report_id,
  rt.source_row_id,
  public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
  COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date,
  COALESCE(NULLIF(trim(rt.track_title), ''), 'Unknown Track') AS track_title,
  COALESCE(NULLIF(trim(rt.artist_name), ''), 'Unknown Artist') AS artist_name,
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
  COALESCE(rt.custom_properties, '{}'::jsonb) AS custom_properties,
  rt.company_id,
  rt.recording_id,
  rt.work_id,
  rt.release_id,
  COALESCE(rt.asset_class, 'unknown') AS asset_class,
  COALESCE(rt.rights_family, 'unknown') AS rights_family,
  COALESCE(rt.rights_stream, 'unknown') AS rights_stream,
  COALESCE(rt.basis_type, 'observed') AS basis_type
FROM public.royalty_transactions rt
INNER JOIN public.cmo_reports cr
  ON cr.id = rt.report_id
WHERE cr.status <> 'failed'
  AND COALESCE(rt.basis_type, 'observed') = 'observed';

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
  custom_properties,
  company_id,
  recording_id,
  work_id,
  release_id,
  asset_class,
  rights_family,
  rights_stream,
  basis_type
FROM public.track_assistant_scope_v2;

CREATE OR REPLACE VIEW public.assistant_income_scope_v1 AS
SELECT
  rt.company_id,
  rt.id AS transaction_id,
  rt.report_id,
  rt.source_row_id,
  rt.recording_id,
  rt.work_id,
  rt.release_id,
  NULL::UUID AS party_id,
  NULL::UUID AS agreement_id,
  public.track_insights_key(rt.isrc, rt.track_title, rt.artist_name) AS track_key,
  COALESCE(rec.canonical_title, NULLIF(trim(rt.track_title), ''), 'Unknown Track') AS recording_title,
  COALESCE(rec.display_artist, NULLIF(trim(rt.artist_name), ''), 'Unknown Artist') AS recording_artist,
  work.canonical_title AS work_title,
  rel.canonical_title AS release_title,
  public.normalize_music_identifier(COALESCE(rec.isrc, rt.isrc)) AS isrc,
  public.normalize_music_identifier(COALESCE(work.iswc, rt.iswc)) AS iswc,
  rel.upc,
  COALESCE(rt.asset_class, CASE WHEN rt.work_id IS NOT NULL AND rt.recording_id IS NOT NULL THEN 'mixed' ELSE 'recording' END) AS asset_class,
  COALESCE(rt.rights_family, CASE WHEN rt.work_id IS NOT NULL THEN 'publishing' ELSE 'recording' END) AS rights_family,
  COALESCE(rt.rights_stream, 'unknown') AS rights_stream,
  COALESCE(rt.basis_type, 'observed') AS basis_type,
  COALESCE(
    rt.mapping_confidence,
    CASE
      WHEN rt.ocr_confidence IS NULL THEN NULL
      WHEN rt.ocr_confidence <= 1 THEN rt.ocr_confidence * 100
      ELSE rt.ocr_confidence
    END
  ) AS confidence,
  false AS is_conflicted,
  ARRAY[rt.report_id]::UUID[] AS source_report_ids,
  CASE
    WHEN rt.source_row_id IS NULL THEN ARRAY[]::UUID[]
    ELSE ARRAY[rt.source_row_id]::UUID[]
  END AS source_row_ids,
  COALESCE(rt.period_end, rt.period_start, rt.created_at::date) AS event_date,
  COALESCE(NULLIF(trim(rt.territory), ''), 'Unknown') AS territory,
  COALESCE(NULLIF(trim(rt.platform), ''), 'Unknown') AS platform,
  COALESCE(NULLIF(trim(rt.usage_type), ''), 'Unknown') AS usage_type,
  COALESCE(rt.quantity, 0)::numeric(20,6) AS quantity,
  COALESCE(rt.gross_revenue, 0)::numeric(20,6) AS gross_revenue,
  COALESCE(rt.commission, 0)::numeric(20,6) AS commission,
  COALESCE(rt.net_revenue, 0)::numeric(20,6) AS net_revenue,
  COALESCE(rt.currency_reporting, rt.currency_original, rt.currency, 'USD') AS currency,
  COALESCE(rt.validation_status, 'pending') AS validation_status,
  cr.cmo_name,
  cr.document_kind,
  cr.business_side
FROM public.royalty_transactions rt
INNER JOIN public.cmo_reports cr
  ON cr.id = rt.report_id
LEFT JOIN public.catalog_recordings rec
  ON rec.id = rt.recording_id
LEFT JOIN public.catalog_works work
  ON work.id = rt.work_id
LEFT JOIN public.catalog_releases rel
  ON rel.id = rt.release_id
WHERE rt.company_id IS NOT NULL
  AND cr.status <> 'failed'
  AND COALESCE(rt.basis_type, 'observed') = 'observed';

CREATE OR REPLACE VIEW public.assistant_rights_scope_v1 AS
SELECT
  c.company_id,
  CASE WHEN lower(COALESCE(c.subject_entity_type, '')) = 'recording' THEN c.subject_entity_id ELSE NULL END AS recording_id,
  CASE WHEN lower(COALESCE(c.subject_entity_type, '')) = 'work' THEN c.subject_entity_id ELSE NULL END AS work_id,
  CASE WHEN lower(COALESCE(c.subject_entity_type, '')) = 'release' THEN c.subject_entity_id ELSE NULL END AS release_id,
  CASE WHEN lower(COALESCE(c.related_entity_type, '')) = 'party' THEN c.related_entity_id ELSE NULL END AS party_id,
  NULL::UUID AS agreement_id,
  CASE
    WHEN lower(COALESCE(c.subject_entity_type, '')) = 'recording'
      OR public.normalize_music_identifier(COALESCE(rec.isrc, c.payload ->> 'isrc')) IS NOT NULL
    THEN public.track_insights_key(
      COALESCE(rec.isrc, c.payload ->> 'isrc'),
      COALESCE(rec.canonical_title, c.payload ->> 'track_title', c.payload ->> 'recording_title'),
      COALESCE(rec.display_artist, c.payload ->> 'artist_name', c.payload ->> 'track_artist')
    )
    ELSE NULL
  END AS track_key,
  COALESCE(rec.canonical_title, NULLIF(trim(COALESCE(c.payload ->> 'track_title', c.payload ->> 'recording_title')), '')) AS recording_title,
  COALESCE(rec.display_artist, NULLIF(trim(COALESCE(c.payload ->> 'artist_name', c.payload ->> 'track_artist', c.payload ->> 'release_artist')), '')) AS recording_artist,
  COALESCE(work.canonical_title, NULLIF(trim(COALESCE(c.payload ->> 'work_title', c.payload ->> 'title', c.payload ->> 'track_title')), '')) AS work_title,
  rel.canonical_title AS release_title,
  COALESCE(
    party.display_name,
    NULLIF(trim(COALESCE(
      c.payload ->> 'rightsholder_name',
      c.payload ->> 'publisher_name',
      c.payload ->> 'writer_name',
      c.payload ->> 'party_name',
      c.payload ->> 'artist_name'
    )), '')
  ) AS party_name,
  public.normalize_music_identifier(COALESCE(rec.isrc, c.payload ->> 'isrc')) AS isrc,
  public.normalize_music_identifier(COALESCE(work.iswc, c.payload ->> 'iswc')) AS iswc,
  public.normalize_music_identifier(COALESCE(party.ipi_number, c.payload ->> 'ipi_number', c.payload ->> 'ipi')) AS ipi_number,
  rel.upc,
  COALESCE(
    NULLIF(lower(COALESCE(c.payload ->> 'rights_family', '')), ''),
    CASE
      WHEN public.normalize_music_identifier(COALESCE(work.iswc, c.payload ->> 'iswc')) IS NOT NULL THEN 'publishing'
      WHEN public.normalize_music_identifier(COALESCE(rec.isrc, c.payload ->> 'isrc')) IS NOT NULL THEN 'recording'
      ELSE 'unknown'
    END
  ) AS rights_family,
  COALESCE(
    NULLIF(lower(COALESCE(c.payload ->> 'rights_stream', '')), ''),
    CASE
      WHEN c.payload ? 'de_share' THEN 'performance'
      WHEN c.payload ? 'dr_share' THEN 'mechanical'
      WHEN c.payload ? 'ph_share' THEN 'phonographic'
      ELSE 'unknown'
    END
  ) AS rights_stream,
  COALESCE(NULLIF(lower(COALESCE(c.payload ->> 'share_kind', '')), ''), 'registered') AS share_kind,
  COALESCE(
    public.try_numeric(c.payload ->> 'share_pct'),
    public.try_numeric(c.payload ->> 'publisher_share'),
    public.try_numeric(c.payload ->> 'writer_share'),
    public.try_numeric(c.payload ->> 'share')
  ) AS share_pct,
  c.basis_type,
  c.confidence,
  false AS is_conflicted,
  ARRAY_REMOVE(ARRAY[c.source_report_id], NULL)::UUID[] AS source_report_ids,
  ARRAY_REMOVE(ARRAY[c.source_row_id], NULL)::UUID[] AS source_row_ids,
  NULLIF(trim(COALESCE(c.payload ->> 'territory_scope', c.payload ->> 'territory')), '') AS territory_scope,
  public.try_date(c.payload ->> 'valid_from') AS valid_from,
  public.try_date(c.payload ->> 'valid_to') AS valid_to,
  c.resolution_status
FROM public.catalog_claims c
LEFT JOIN public.catalog_recordings rec
  ON rec.id = c.subject_entity_id
 AND lower(COALESCE(c.subject_entity_type, '')) = 'recording'
LEFT JOIN public.catalog_works work
  ON work.id = c.subject_entity_id
 AND lower(COALESCE(c.subject_entity_type, '')) = 'work'
LEFT JOIN public.catalog_releases rel
  ON rel.id = c.subject_entity_id
 AND lower(COALESCE(c.subject_entity_type, '')) = 'release'
LEFT JOIN public.catalog_parties party
  ON party.id = c.related_entity_id
 AND lower(COALESCE(c.related_entity_type, '')) = 'party'
WHERE c.company_id IS NOT NULL
  AND c.claim_type IN ('rights_catalog', 'split_sheet', 'contract_summary', 'mixed_statement');

CREATE OR REPLACE VIEW public.assistant_entitlement_scope_v1 AS
SELECT
  r.company_id,
  r.recording_id,
  r.work_id,
  r.release_id,
  r.party_id,
  ag.id AS agreement_id,
  r.track_key,
  r.recording_title,
  r.recording_artist,
  r.work_title,
  r.release_title,
  COALESCE(counterparty.display_name, r.party_name) AS party_name,
  r.isrc,
  r.iswc,
  COALESCE(counterparty.ipi_number, r.ipi_number) AS ipi_number,
  r.upc,
  COALESCE(NULLIF(lower(COALESCE(ag.term_payload ->> 'rights_family', '')), ''), r.rights_family, 'unknown') AS rights_family,
  COALESCE(NULLIF(lower(COALESCE(ag.term_payload ->> 'rights_stream', '')), ''), r.rights_stream, 'unknown') AS rights_stream,
  COALESCE(NULLIF(lower(COALESCE(ag.term_payload ->> 'share_kind', '')), ''), 'payable') AS share_kind,
  COALESCE(
    public.try_numeric(ag.term_payload ->> 'share_pct'),
    public.try_numeric((ag.term_payload -> 'rights_streams') ->> COALESCE(r.rights_stream, 'unknown')),
    r.share_pct
  ) AS share_pct,
  'estimated'::TEXT AS basis_type,
  LEAST(COALESCE(r.confidence, 70), 80) AS confidence,
  (COALESCE(r.is_conflicted, false) OR COALESCE(ag.status, 'draft') <> 'active') AS is_conflicted,
  ARRAY(
    SELECT DISTINCT report_id
    FROM unnest(
      COALESCE(r.source_report_ids, ARRAY[]::UUID[])
      || ARRAY_REMOVE(ARRAY[ag.source_document_id], NULL)::UUID[]
    ) AS report_id
  ) AS source_report_ids,
  COALESCE(r.source_row_ids, ARRAY[]::UUID[]) AS source_row_ids,
  r.territory_scope,
  COALESCE(ag.effective_start, r.valid_from) AS valid_from,
  COALESCE(ag.effective_end, r.valid_to) AS valid_to,
  ag.term_mode
FROM public.assistant_rights_scope_v1 r
INNER JOIN public.catalog_agreements ag
  ON ag.company_id = r.company_id
LEFT JOIN public.catalog_parties counterparty
  ON counterparty.id = ag.counterparty_party_id
WHERE ag.status IN ('active', 'draft')
  AND ag.term_mode IN ('flat_pct', 'rights_stream_pct', 'territory_pct', 'manual_summary');

CREATE OR REPLACE VIEW public.assistant_catalog_scope_v1 AS
SELECT
  company_id,
  'recording'::TEXT AS entity_type,
  id AS entity_id,
  id AS recording_id,
  NULL::UUID AS work_id,
  NULL::UUID AS release_id,
  NULL::UUID AS party_id,
  NULL::UUID AS agreement_id,
  public.track_insights_key(isrc, canonical_title, display_artist) AS track_key,
  canonical_title AS entity_name,
  display_artist AS secondary_name,
  isrc,
  NULL::TEXT AS iswc,
  NULL::TEXT AS ipi_number,
  NULL::TEXT AS upc,
  status,
  ARRAY[]::UUID[] AS source_report_ids,
  ARRAY[]::UUID[] AS source_row_ids
FROM public.catalog_recordings
UNION ALL
SELECT
  company_id,
  'work',
  id,
  NULL::UUID,
  id,
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  NULL::TEXT,
  canonical_title,
  NULL::TEXT,
  NULL::TEXT,
  iswc,
  NULL::TEXT,
  NULL::TEXT,
  status,
  ARRAY[]::UUID[],
  ARRAY[]::UUID[]
FROM public.catalog_works
UNION ALL
SELECT
  company_id,
  'release',
  id,
  NULL::UUID,
  NULL::UUID,
  id,
  NULL::UUID,
  NULL::UUID,
  NULL::TEXT,
  canonical_title,
  label_name,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  upc,
  status,
  ARRAY[]::UUID[],
  ARRAY[]::UUID[]
FROM public.catalog_releases
UNION ALL
SELECT
  company_id,
  'party',
  id,
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  id,
  NULL::UUID,
  NULL::TEXT,
  display_name,
  legal_name,
  NULL::TEXT,
  NULL::TEXT,
  ipi_number,
  NULL::TEXT,
  status,
  ARRAY[]::UUID[],
  ARRAY[]::UUID[]
FROM public.catalog_parties
UNION ALL
SELECT
  company_id,
  'agreement',
  id,
  NULL::UUID,
  NULL::UUID,
  NULL::UUID,
  counterparty_party_id,
  id,
  NULL::TEXT,
  agreement_type,
  term_mode,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  NULL::TEXT,
  status,
  ARRAY_REMOVE(ARRAY[source_document_id], NULL)::UUID[],
  ARRAY[]::UUID[]
FROM public.catalog_agreements;

CREATE OR REPLACE VIEW public.assistant_quality_scope_v1 AS
WITH task_base AS (
  SELECT
    t.company_id,
    tx.recording_id,
    tx.work_id,
    tx.release_id,
    public.track_insights_key(tx.isrc, tx.track_title, tx.artist_name) AS track_key,
    t.report_id,
    t.source_row_id,
    t.task_type,
    t.severity,
    t.status
  FROM public.review_tasks t
  LEFT JOIN public.royalty_transactions tx
    ON tx.source_row_id = t.source_row_id
   AND tx.report_id = t.report_id
  WHERE t.company_id IS NOT NULL
)
SELECT
  company_id,
  recording_id,
  work_id,
  release_id,
  NULL::UUID AS party_id,
  NULL::UUID AS agreement_id,
  track_key,
  COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::BIGINT AS open_task_count,
  COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND severity = 'critical')::BIGINT AS open_critical_task_count,
  COUNT(*) FILTER (WHERE task_type = 'mapping_unresolved' AND status IN ('open', 'in_progress'))::BIGINT AS mapping_task_count,
  COUNT(*) FILTER (
    WHERE task_type IN ('missing_required_field', 'revenue_math_mismatch', 'currency_missing', 'period_mismatch', 'period_year_out_of_range')
      AND status IN ('open', 'in_progress')
  )::BIGINT AS validation_task_count,
  ARRAY_AGG(DISTINCT task_type ORDER BY task_type) FILTER (WHERE status IN ('open', 'in_progress')) AS task_types,
  ARRAY_AGG(DISTINCT report_id) FILTER (WHERE report_id IS NOT NULL) AS source_report_ids,
  ARRAY_AGG(DISTINCT source_row_id) FILTER (WHERE source_row_id IS NOT NULL) AS source_row_ids
FROM task_base
GROUP BY company_id, recording_id, work_id, release_id, track_key;

CREATE OR REPLACE VIEW public.assistant_workspace_overview_v1 AS
WITH income AS (
  SELECT
    company_id,
    COUNT(*)::BIGINT AS income_row_count,
    SUM(net_revenue)::numeric(20,6) AS net_revenue,
    SUM(gross_revenue)::numeric(20,6) AS gross_revenue,
    SUM(quantity)::numeric(20,6) AS quantity,
    COUNT(DISTINCT COALESCE(recording_id::TEXT, track_key))::BIGINT AS recording_scope_count,
    ARRAY_AGG(DISTINCT report_id) FILTER (WHERE report_id IS NOT NULL) AS source_report_ids
  FROM public.assistant_income_scope_v1
  GROUP BY company_id
),
rights AS (
  SELECT
    company_id,
    COUNT(*)::BIGINT AS rights_claim_count,
    COUNT(*) FILTER (WHERE is_conflicted)::BIGINT AS conflicted_rights_count,
    COUNT(DISTINCT COALESCE(work_id::TEXT, work_title, iswc))::BIGINT AS work_scope_count,
    COUNT(DISTINCT COALESCE(party_id::TEXT, party_name, ipi_number))::BIGINT AS party_scope_count
  FROM public.assistant_rights_scope_v1
  GROUP BY company_id
),
quality AS (
  SELECT
    company_id,
    COALESCE(SUM(open_task_count), 0)::BIGINT AS open_task_count,
    COALESCE(SUM(open_critical_task_count), 0)::BIGINT AS open_critical_task_count
  FROM public.assistant_quality_scope_v1
  GROUP BY company_id
),
agreements AS (
  SELECT company_id, COUNT(*)::BIGINT AS agreement_count
  FROM public.catalog_agreements
  GROUP BY company_id
)
SELECT
  COALESCE(i.company_id, r.company_id, q.company_id, a.company_id) AS company_id,
  COALESCE(i.income_row_count, 0) AS income_row_count,
  COALESCE(i.net_revenue, 0)::numeric(20,6) AS net_revenue,
  COALESCE(i.gross_revenue, 0)::numeric(20,6) AS gross_revenue,
  COALESCE(i.quantity, 0)::numeric(20,6) AS quantity,
  COALESCE(i.recording_scope_count, 0) AS recording_scope_count,
  COALESCE(r.work_scope_count, 0) AS work_scope_count,
  COALESCE(r.party_scope_count, 0) AS party_scope_count,
  COALESCE(a.agreement_count, 0) AS agreement_count,
  COALESCE(r.rights_claim_count, 0) AS rights_claim_count,
  COALESCE(r.conflicted_rights_count, 0) AS conflicted_rights_count,
  COALESCE(q.open_task_count, 0) AS open_task_count,
  COALESCE(q.open_critical_task_count, 0) AS open_critical_task_count,
  COALESCE(i.source_report_ids, ARRAY[]::UUID[]) AS source_report_ids
FROM income i
FULL OUTER JOIN rights r
  ON r.company_id = i.company_id
FULL OUTER JOIN quality q
  ON q.company_id = COALESCE(i.company_id, r.company_id)
FULL OUTER JOIN agreements a
  ON a.company_id = COALESCE(i.company_id, r.company_id, q.company_id);

CREATE OR REPLACE VIEW public.company_catalog_snapshot_v1 AS
SELECT *
FROM public.assistant_catalog_scope_v1;

CREATE OR REPLACE VIEW public.company_income_cube_v1 AS
SELECT
  company_id,
  event_date,
  territory,
  platform,
  usage_type,
  recording_id,
  work_id,
  release_id,
  track_key,
  isrc,
  iswc,
  upc,
  rights_family,
  rights_stream,
  basis_type,
  SUM(quantity)::numeric(20,6) AS quantity,
  SUM(gross_revenue)::numeric(20,6) AS gross_revenue,
  SUM(commission)::numeric(20,6) AS commission,
  SUM(net_revenue)::numeric(20,6) AS net_revenue,
  ARRAY_AGG(DISTINCT report_id) FILTER (WHERE report_id IS NOT NULL) AS source_report_ids,
  ARRAY_AGG(DISTINCT source_row_id) FILTER (WHERE source_row_id IS NOT NULL) AS source_row_ids
FROM public.assistant_income_scope_v1
GROUP BY
  company_id,
  event_date,
  territory,
  platform,
  usage_type,
  recording_id,
  work_id,
  release_id,
  track_key,
  isrc,
  iswc,
  upc,
  rights_family,
  rights_stream,
  basis_type;

CREATE OR REPLACE VIEW public.company_rights_snapshot_v1 AS
SELECT *
FROM public.assistant_rights_scope_v1;

CREATE OR REPLACE VIEW public.company_quality_snapshot_v1 AS
SELECT *
FROM public.assistant_quality_scope_v1;

GRANT SELECT ON public.track_assistant_scope_v2 TO authenticated;
GRANT SELECT ON public.track_assistant_scope_v2 TO service_role;
GRANT SELECT ON public.workspace_assistant_scope_v1 TO authenticated;
GRANT SELECT ON public.workspace_assistant_scope_v1 TO service_role;
GRANT SELECT ON public.assistant_income_scope_v1 TO authenticated;
GRANT SELECT ON public.assistant_income_scope_v1 TO service_role;
GRANT SELECT ON public.assistant_rights_scope_v1 TO authenticated;
GRANT SELECT ON public.assistant_rights_scope_v1 TO service_role;
GRANT SELECT ON public.assistant_entitlement_scope_v1 TO authenticated;
GRANT SELECT ON public.assistant_entitlement_scope_v1 TO service_role;
GRANT SELECT ON public.assistant_catalog_scope_v1 TO authenticated;
GRANT SELECT ON public.assistant_catalog_scope_v1 TO service_role;
GRANT SELECT ON public.assistant_quality_scope_v1 TO authenticated;
GRANT SELECT ON public.assistant_quality_scope_v1 TO service_role;
GRANT SELECT ON public.assistant_workspace_overview_v1 TO authenticated;
GRANT SELECT ON public.assistant_workspace_overview_v1 TO service_role;
GRANT SELECT ON public.company_catalog_snapshot_v1 TO authenticated;
GRANT SELECT ON public.company_catalog_snapshot_v1 TO service_role;
GRANT SELECT ON public.company_income_cube_v1 TO authenticated;
GRANT SELECT ON public.company_income_cube_v1 TO service_role;
GRANT SELECT ON public.company_rights_snapshot_v1 TO authenticated;
GRANT SELECT ON public.company_rights_snapshot_v1 TO service_role;
GRANT SELECT ON public.company_quality_snapshot_v1 TO authenticated;
GRANT SELECT ON public.company_quality_snapshot_v1 TO service_role;
