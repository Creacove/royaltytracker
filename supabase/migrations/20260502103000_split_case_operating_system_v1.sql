-- Split Case operating metadata for document-level Rights & Splits review.

ALTER TABLE public.catalog_split_claims
ADD COLUMN IF NOT EXISTS split_group_key TEXT,
ADD COLUMN IF NOT EXISTS split_fingerprint TEXT,
ADD COLUMN IF NOT EXISTS dedupe_status TEXT NOT NULL DEFAULT 'new_needs_review',
ADD COLUMN IF NOT EXISTS matched_existing_rights_position_id UUID REFERENCES public.catalog_rights_positions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS review_case_status TEXT NOT NULL DEFAULT 'new_needs_review',
ADD COLUMN IF NOT EXISTS auto_applied_at TIMESTAMPTZ;

ALTER TABLE public.catalog_split_claims
DROP CONSTRAINT IF EXISTS catalog_split_claims_dedupe_status_check,
DROP CONSTRAINT IF EXISTS catalog_split_claims_review_case_status_check;

ALTER TABLE public.catalog_split_claims
ADD CONSTRAINT catalog_split_claims_dedupe_status_check
CHECK (
  dedupe_status IN (
    'new_needs_review',
    'exact_duplicate',
    'auto_applied',
    'trusted_duplicate',
    'conflict',
    'weak_match',
    'manual'
  )
),
ADD CONSTRAINT catalog_split_claims_review_case_status_check
CHECK (
  review_case_status IN (
    'new_needs_review',
    'ready_to_approve',
    'already_known',
    'needs_attention',
    'conflict',
    'approved',
    'rejected',
    'archived'
  )
);

CREATE INDEX IF NOT EXISTS idx_catalog_split_claims_case_status
  ON public.catalog_split_claims(company_id, review_case_status, dedupe_status);

CREATE INDEX IF NOT EXISTS idx_catalog_split_claims_split_group
  ON public.catalog_split_claims(company_id, source_report_id, split_group_key);

CREATE INDEX IF NOT EXISTS idx_catalog_split_claims_fingerprint
  ON public.catalog_split_claims(company_id, split_fingerprint)
  WHERE split_fingerprint IS NOT NULL;
