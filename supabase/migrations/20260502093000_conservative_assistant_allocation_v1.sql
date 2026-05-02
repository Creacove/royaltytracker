CREATE OR REPLACE VIEW public.assistant_allocation_fact_v1 AS
WITH split_basis AS (
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
    r.confidence::numeric AS confidence,
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
  split_basis.confidence::numeric AS confidence,
  ARRAY[rev.transaction_id::TEXT, split_basis.evidence_id] AS evidence_ids,
  CASE
    WHEN rev.rights_stream IS NULL OR rev.rights_stream = 'unknown' THEN 'Revenue stream missing; allocation estimated at available revenue level.'
    WHEN split_basis.rights_stream IS NULL OR split_basis.rights_stream = rev.rights_stream THEN 'Revenue stream matched approved rights basis.'
    ELSE 'Revenue stream differs from approved rights basis; allocation should be reviewed.'
  END AS allocation_basis,
  'assistant_allocation_fact_v1'::TEXT AS source_ref
FROM public.assistant_revenue_fact_v1 rev
JOIN split_basis
  ON split_basis.company_id = rev.company_id
  AND (
    split_basis.work_id = rev.work_id
    OR split_basis.recording_id = rev.recording_id
  )
WHERE public.can_access_company_data(rev.company_id);
