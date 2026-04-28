CREATE TABLE IF NOT EXISTS public.catalog_split_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  source_report_id UUID REFERENCES public.cmo_reports(id) ON DELETE SET NULL,
  source_row_id UUID REFERENCES public.source_rows(id) ON DELETE SET NULL,
  work_id UUID REFERENCES public.catalog_works(id) ON DELETE SET NULL,
  party_id UUID REFERENCES public.catalog_parties(id) ON DELETE SET NULL,
  work_title TEXT,
  iswc TEXT,
  source_work_code TEXT,
  party_name TEXT,
  ipi_number TEXT,
  source_role TEXT,
  source_rights_code TEXT,
  source_rights_label TEXT,
  source_language TEXT NOT NULL DEFAULT 'en',
  canonical_rights_stream TEXT,
  share_pct NUMERIC(8,4),
  territory_scope TEXT,
  valid_from DATE,
  valid_to DATE,
  confidence NUMERIC(8,4),
  review_status TEXT NOT NULL DEFAULT 'pending',
  managed_party_match BOOLEAN,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_split_claims
  DROP CONSTRAINT IF EXISTS catalog_split_claims_review_status_check,
  DROP CONSTRAINT IF EXISTS catalog_split_claims_share_pct_check;

ALTER TABLE public.catalog_split_claims
  ADD CONSTRAINT catalog_split_claims_review_status_check
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT catalog_split_claims_share_pct_check
    CHECK (share_pct IS NULL OR (share_pct >= 0 AND share_pct <= 100));

CREATE INDEX IF NOT EXISTS idx_catalog_split_claims_company_work
  ON public.catalog_split_claims(company_id, work_id, lower(COALESCE(work_title, '')));
CREATE INDEX IF NOT EXISTS idx_catalog_split_claims_company_party
  ON public.catalog_split_claims(company_id, party_id, lower(COALESCE(party_name, '')));
CREATE INDEX IF NOT EXISTS idx_catalog_split_claims_company_status
  ON public.catalog_split_claims(company_id, review_status, canonical_rights_stream);
CREATE INDEX IF NOT EXISTS idx_catalog_split_claims_source_report
  ON public.catalog_split_claims(source_report_id, source_row_id);

ALTER TABLE public.catalog_split_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can read split claims" ON public.catalog_split_claims;
CREATE POLICY "Company members can read split claims"
  ON public.catalog_split_claims
  FOR SELECT
  USING (public.can_access_company_data(company_id));

DROP POLICY IF EXISTS "Company members can manage split claims" ON public.catalog_split_claims;
CREATE POLICY "Company members can manage split claims"
  ON public.catalog_split_claims
  FOR ALL
  USING (public.can_access_company_data(company_id))
  WITH CHECK (public.can_access_company_data(company_id));

CREATE OR REPLACE TRIGGER set_catalog_split_claims_updated_at
BEFORE UPDATE ON public.catalog_split_claims
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE VIEW public.assistant_revenue_fact_v1 AS
SELECT
  i.company_id,
  i.transaction_id,
  i.report_id AS source_report_id,
  i.source_row_id,
  i.recording_id,
  i.work_id,
  i.recording_title,
  i.recording_artist,
  i.work_title,
  i.isrc,
  i.iswc,
  i.rights_family,
  i.rights_stream,
  i.basis_type,
  i.event_date,
  i.territory,
  i.platform,
  i.usage_type,
  i.quantity,
  i.gross_revenue,
  i.commission,
  i.net_revenue,
  i.currency,
  i.validation_status,
  i.confidence,
  'assistant_income_scope_v1'::TEXT AS source_ref
FROM public.assistant_income_scope_v1 i;

CREATE OR REPLACE VIEW public.assistant_split_claim_fact_v1 AS
SELECT
  s.company_id,
  s.id AS split_claim_id,
  s.source_report_id,
  s.source_row_id,
  s.work_id,
  s.party_id,
  COALESCE(w.canonical_title, NULLIF(trim(s.work_title), '')) AS work_title,
  public.normalize_music_identifier(COALESCE(w.iswc, s.iswc)) AS iswc,
  COALESCE(w.source_work_code, s.source_work_code) AS source_work_code,
  COALESCE(p.display_name, NULLIF(trim(s.party_name), '')) AS party_name,
  public.normalize_music_identifier(COALESCE(p.ipi_number, s.ipi_number)) AS ipi_number,
  s.source_role,
  s.source_rights_code,
  s.source_rights_label,
  s.source_language,
  s.canonical_rights_stream,
  s.share_pct,
  s.territory_scope,
  s.valid_from,
  s.valid_to,
  s.confidence,
  s.review_status,
  s.managed_party_match,
  s.raw_payload,
  r.file_name,
  r.cmo_name,
  r.document_kind,
  'catalog_split_claims'::TEXT AS source_ref
FROM public.catalog_split_claims s
LEFT JOIN public.catalog_works w
  ON w.id = s.work_id
LEFT JOIN public.catalog_parties p
  ON p.id = s.party_id
LEFT JOIN public.cmo_reports r
  ON r.id = s.source_report_id
WHERE public.can_access_company_data(s.company_id);

CREATE OR REPLACE VIEW public.assistant_rights_position_fact_v1 AS
SELECT
  rp.company_id,
  rp.id AS rights_position_id,
  rp.asset_type,
  rp.asset_id,
  CASE WHEN rp.asset_type = 'work' THEN w.id ELSE NULL END AS work_id,
  CASE WHEN rp.asset_type = 'recording' THEN rec.id ELSE NULL END AS recording_id,
  rp.party_id,
  COALESCE(w.canonical_title, rec.canonical_title) AS asset_title,
  w.canonical_title AS work_title,
  rec.canonical_title AS recording_title,
  p.display_name AS party_name,
  p.ipi_number,
  rp.rights_family,
  rp.rights_stream,
  rp.share_kind,
  rp.share_pct,
  rp.territory_scope,
  rp.valid_from,
  rp.valid_to,
  rp.basis_type,
  rp.confidence,
  rp.is_conflicted,
  rp.source_claim_id,
  'catalog_rights_positions'::TEXT AS source_ref
FROM public.catalog_rights_positions rp
LEFT JOIN public.catalog_works w
  ON rp.asset_type = 'work' AND w.id = rp.asset_id
LEFT JOIN public.catalog_recordings rec
  ON rp.asset_type = 'recording' AND rec.id = rp.asset_id
LEFT JOIN public.catalog_parties p
  ON p.id = rp.party_id
WHERE public.can_access_company_data(rp.company_id);

CREATE OR REPLACE VIEW public.assistant_allocation_fact_v1 AS
WITH split_basis AS (
  SELECT
    s.company_id,
    s.split_claim_id::TEXT AS evidence_id,
    s.work_id,
    NULL::UUID AS recording_id,
    s.party_id,
    s.work_title,
    s.party_name,
    s.canonical_rights_stream AS rights_stream,
    s.share_pct,
    CASE WHEN s.review_status = 'approved' THEN 'payable_allocation' ELSE 'estimated_allocation' END AS allocation_label,
    s.review_status,
    s.confidence,
    s.source_ref
  FROM public.assistant_split_claim_fact_v1 s
  WHERE s.review_status <> 'rejected'
  UNION ALL
  SELECT
    r.company_id,
    r.rights_position_id::TEXT AS evidence_id,
    r.work_id,
    r.recording_id,
    r.party_id,
    r.work_title,
    r.party_name,
    r.rights_stream,
    r.share_pct,
    CASE WHEN r.share_kind = 'payable' THEN 'payable_allocation' ELSE 'estimated_allocation' END AS allocation_label,
    'approved'::TEXT AS review_status,
    r.confidence,
    r.source_ref
  FROM public.assistant_rights_position_fact_v1 r
  WHERE COALESCE(r.is_conflicted, false) = false
)
SELECT
  rev.company_id,
  rev.transaction_id,
  rev.source_report_id,
  rev.source_row_id,
  rev.work_id,
  rev.recording_id,
  split_basis.party_id,
  COALESCE(split_basis.work_title, rev.work_title, rev.recording_title) AS work_title,
  split_basis.party_name,
  rev.platform,
  rev.territory,
  rev.usage_type,
  COALESCE(NULLIF(rev.rights_stream, 'unknown'), split_basis.rights_stream) AS rights_stream,
  rev.net_revenue,
  rev.gross_revenue,
  rev.currency,
  split_basis.share_pct,
  ROUND((COALESCE(rev.net_revenue, rev.gross_revenue, 0) * COALESCE(split_basis.share_pct, 0) / 100)::numeric, 6) AS allocation_amount,
  split_basis.allocation_label,
  split_basis.review_status,
  split_basis.confidence,
  ARRAY[rev.transaction_id::TEXT, split_basis.evidence_id] AS evidence_ids,
  CASE
    WHEN rev.rights_stream IS NULL OR rev.rights_stream = 'unknown' THEN 'Revenue stream missing; allocation estimated at available revenue level.'
    WHEN split_basis.rights_stream IS NULL OR split_basis.rights_stream = rev.rights_stream THEN 'Revenue stream matched split basis.'
    ELSE 'Revenue stream differs from split basis; allocation should be reviewed.'
  END AS allocation_basis,
  'assistant_allocation_fact_v1'::TEXT AS source_ref
FROM public.assistant_revenue_fact_v1 rev
JOIN split_basis
  ON split_basis.company_id = rev.company_id
  AND (
    split_basis.work_id = rev.work_id
    OR split_basis.recording_id = rev.recording_id
    OR lower(COALESCE(split_basis.work_title, '')) = lower(COALESCE(rev.work_title, rev.recording_title, ''))
  )
WHERE public.can_access_company_data(rev.company_id);

CREATE OR REPLACE VIEW public.assistant_document_evidence_v1 AS
SELECT
  r.company_id,
  r.id AS source_report_id,
  NULL::UUID AS source_row_id,
  r.file_name,
  r.cmo_name,
  r.document_kind,
  r.business_side,
  r.parser_lane,
  r.source_system,
  r.source_reference,
  r.created_at,
  'cmo_reports'::TEXT AS source_ref
FROM public.cmo_reports r
WHERE r.company_id IS NOT NULL
  AND public.can_access_company_data(r.company_id)
UNION ALL
SELECT
  s.company_id,
  s.source_report_id,
  s.source_row_id,
  r.file_name,
  r.cmo_name,
  r.document_kind,
  r.business_side,
  r.parser_lane,
  r.source_system,
  r.source_reference,
  s.created_at,
  'catalog_split_claims'::TEXT AS source_ref
FROM public.catalog_split_claims s
LEFT JOIN public.cmo_reports r
  ON r.id = s.source_report_id
WHERE public.can_access_company_data(s.company_id);

CREATE OR REPLACE VIEW public.assistant_entity_resolution_v1 AS
SELECT
  company_id,
  'work'::TEXT AS entity_type,
  id AS entity_id,
  canonical_title AS display_name,
  normalized_title AS normalized_name,
  iswc AS primary_identifier,
  jsonb_build_object('source_work_code', source_work_code, 'status', status) AS identifiers
FROM public.catalog_works
WHERE public.can_access_company_data(company_id)
UNION ALL
SELECT
  company_id,
  'recording'::TEXT AS entity_type,
  id AS entity_id,
  canonical_title AS display_name,
  normalized_title AS normalized_name,
  isrc AS primary_identifier,
  jsonb_build_object('display_artist', display_artist, 'status', status) AS identifiers
FROM public.catalog_recordings
WHERE public.can_access_company_data(company_id)
UNION ALL
SELECT
  company_id,
  'party'::TEXT AS entity_type,
  id AS entity_id,
  display_name,
  normalized_name,
  ipi_number AS primary_identifier,
  jsonb_build_object('party_type', party_type, 'legal_name', legal_name, 'society_code', society_code, 'status', status) AS identifiers
FROM public.catalog_parties
WHERE public.can_access_company_data(company_id);

CREATE OR REPLACE VIEW public.assistant_data_quality_fact_v1 AS
SELECT
  rt.company_id,
  rt.id AS quality_fact_id,
  rt.report_id AS source_report_id,
  rt.source_row_id,
  'review_task'::TEXT AS fact_type,
  rt.severity,
  rt.status,
  rt.error_type,
  rt.message,
  rt.field_name,
  rt.created_at,
  'review_tasks'::TEXT AS source_ref
FROM public.review_tasks rt
WHERE rt.company_id IS NOT NULL
  AND public.can_access_company_data(rt.company_id)
UNION ALL
SELECT
  s.company_id,
  s.id AS quality_fact_id,
  s.source_report_id,
  s.source_row_id,
  'pending_split_claim'::TEXT AS fact_type,
  CASE WHEN s.review_status = 'pending' THEN 'warning' ELSE 'info' END AS severity,
  s.review_status AS status,
  'split_review_status'::TEXT AS error_type,
  'Split claim is not yet approved into canonical rights positions.'::TEXT AS message,
  'review_status'::TEXT AS field_name,
  s.created_at,
  'catalog_split_claims'::TEXT AS source_ref
FROM public.catalog_split_claims s
WHERE s.review_status <> 'approved'
  AND public.can_access_company_data(s.company_id);

CREATE OR REPLACE FUNCTION public.run_workspace_evidence_plan_v1(
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL,
  p_plan JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company_id UUID := public.active_company_id();
  v_from DATE := COALESCE(from_date, (CURRENT_DATE - INTERVAL '12 months')::date);
  v_to DATE := COALESCE(to_date, CURRENT_DATE);
  v_family TEXT := COALESCE(p_plan ->> 'family', 'revenue_lookup');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Active company required.';
  END IF;

  RETURN jsonb_build_object(
    'question_family', v_family,
    'revenue_evidence', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.event_date DESC)
      FROM (
        SELECT *
        FROM public.assistant_revenue_fact_v1
        WHERE company_id = v_company_id
          AND event_date BETWEEN v_from AND v_to
        LIMIT 100
      ) r
    ), '[]'::jsonb),
    'split_evidence', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.review_status, s.work_title, s.party_name)
      FROM (
        SELECT *
        FROM public.assistant_split_claim_fact_v1
        WHERE company_id = v_company_id
        LIMIT 100
      ) s
    ), '[]'::jsonb),
    'rights_evidence', COALESCE((
      SELECT jsonb_agg(to_jsonb(rp) ORDER BY rp.asset_title, rp.party_name)
      FROM (
        SELECT *
        FROM public.assistant_rights_position_fact_v1
        WHERE company_id = v_company_id
        LIMIT 100
      ) rp
    ), '[]'::jsonb),
    'computed_allocations', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.allocation_amount DESC)
      FROM (
        SELECT *
        FROM public.assistant_allocation_fact_v1
        WHERE company_id = v_company_id
        LIMIT 100
      ) a
    ), '[]'::jsonb),
    'source_documents', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC)
      FROM (
        SELECT *
        FROM public.assistant_document_evidence_v1
        WHERE company_id = v_company_id
        LIMIT 50
      ) d
    ), '[]'::jsonb),
    'quality_flags', COALESCE((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC)
      FROM (
        SELECT *
        FROM public.assistant_data_quality_fact_v1
        WHERE company_id = v_company_id
        LIMIT 100
      ) q
    ), '[]'::jsonb),
    'applied_scope', jsonb_build_object('from_date', v_from, 'to_date', v_to, 'company_id', v_company_id)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT SELECT ON public.catalog_split_claims TO authenticated;
GRANT SELECT ON public.assistant_revenue_fact_v1 TO authenticated;
GRANT SELECT ON public.assistant_split_claim_fact_v1 TO authenticated;
GRANT SELECT ON public.assistant_rights_position_fact_v1 TO authenticated;
GRANT SELECT ON public.assistant_allocation_fact_v1 TO authenticated;
GRANT SELECT ON public.assistant_document_evidence_v1 TO authenticated;
GRANT SELECT ON public.assistant_entity_resolution_v1 TO authenticated;
GRANT SELECT ON public.assistant_data_quality_fact_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_workspace_evidence_plan_v1(DATE, DATE, JSONB) TO authenticated;
