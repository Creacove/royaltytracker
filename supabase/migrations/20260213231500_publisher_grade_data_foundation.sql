-- Publisher-grade data foundation for ingestion, normalization, provenance, and review workflows.

-- 1) Extend report status model to support gated completion states.
ALTER TABLE public.cmo_reports
DROP CONSTRAINT IF EXISTS cmo_reports_status_check;

ALTER TABLE public.cmo_reports
ADD CONSTRAINT cmo_reports_status_check
CHECK (
  status IN (
    'pending',
    'processing',
    'completed',
    'completed_passed',
    'completed_with_warnings',
    'needs_review',
    'failed'
  )
);

-- 2) Add statement/pipeline metadata to report header.
ALTER TABLE public.cmo_reports
ADD COLUMN IF NOT EXISTS file_hash_sha256 TEXT,
ADD COLUMN IF NOT EXISTS source_format TEXT,
ADD COLUMN IF NOT EXISTS statement_currency TEXT,
ADD COLUMN IF NOT EXISTS statement_period_start DATE,
ADD COLUMN IF NOT EXISTS statement_period_end DATE,
ADD COLUMN IF NOT EXISTS statement_reference TEXT,
ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'v2',
ADD COLUMN IF NOT EXISTS quality_gate_status TEXT NOT NULL DEFAULT 'needs_review'
  CHECK (quality_gate_status IN ('passed', 'needs_review', 'failed')),
ADD COLUMN IF NOT EXISTS ingestion_file_id UUID;

-- 3) Ingestion file ledger (idempotency + versioned replay).
CREATE TABLE IF NOT EXISTS public.ingestion_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  report_id UUID REFERENCES public.cmo_reports(id) ON DELETE SET NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'cmo-reports',
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_extension TEXT,
  file_hash_sha256 TEXT NOT NULL,
  file_size BIGINT,
  source_format TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source_format IN ('pdf', 'csv', 'xlsx', 'xls', 'unknown')),
  parser_version TEXT NOT NULL DEFAULT 'v2',
  pipeline_version TEXT NOT NULL DEFAULT 'v2',
  ingestion_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      ingestion_status IN (
        'pending',
        'processing',
        'extracted',
        'normalized',
        'validated',
        'needs_review',
        'published',
        'failed'
      )
    ),
  duplicate_of_file_id UUID REFERENCES public.ingestion_files(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_files_hash_pipeline
  ON public.ingestion_files (file_hash_sha256, pipeline_version);

CREATE INDEX IF NOT EXISTS idx_ingestion_files_user_created
  ON public.ingestion_files (user_id, created_at DESC);

ALTER TABLE public.cmo_reports
ADD CONSTRAINT cmo_reports_ingestion_file_id_fkey
FOREIGN KEY (ingestion_file_id) REFERENCES public.ingestion_files(id) ON DELETE SET NULL;

-- 4) Immutable row-level extracted payload with provenance envelope.
CREATE TABLE IF NOT EXISTS public.source_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.cmo_reports(id) ON DELETE CASCADE,
  ingestion_file_id UUID REFERENCES public.ingestion_files(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  source_row_index INTEGER NOT NULL,
  source_page INTEGER,
  source_table TEXT,
  row_hash TEXT,
  parser_version TEXT NOT NULL DEFAULT 'v2',
  extraction_confidence NUMERIC(6,5),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_id, source_row_index)
);

CREATE INDEX IF NOT EXISTS idx_source_rows_report
  ON public.source_rows (report_id, source_row_index);

CREATE INDEX IF NOT EXISTS idx_source_rows_ingestion
  ON public.source_rows (ingestion_file_id);

-- 5) Field-level payload for auditing and mapping confidence.
CREATE TABLE IF NOT EXISTS public.source_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_row_id UUID NOT NULL REFERENCES public.source_rows(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.cmo_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  raw_value TEXT,
  normalized_value TEXT,
  parser_confidence NUMERIC(6,5),
  source_page INTEGER,
  bbox JSONB,
  is_mapped BOOLEAN NOT NULL DEFAULT false,
  mapping_rule TEXT,
  mapping_confidence NUMERIC(5,2),
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_fields_report
  ON public.source_fields (report_id, field_name);

CREATE INDEX IF NOT EXISTS idx_source_fields_source_row
  ON public.source_fields (source_row_id);

-- 6) Manual review queue.
CREATE TABLE IF NOT EXISTS public.review_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.cmo_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  source_row_id UUID REFERENCES public.source_rows(id) ON DELETE CASCADE,
  source_field_id UUID REFERENCES public.source_fields(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL
    CHECK (
      task_type IN (
        'missing_required_field',
        'low_confidence',
        'outlier',
        'currency_mismatch',
        'period_mismatch',
        'provenance_missing',
        'mapping_unresolved',
        'manual_override',
        'other'
      )
    ),
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('critical', 'warning', 'info')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_note TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_tasks_report_status
  ON public.review_tasks (report_id, status);

CREATE INDEX IF NOT EXISTS idx_review_tasks_user_status
  ON public.review_tasks (user_id, status);

-- 7) Scoped normalization rule registry.
CREATE TABLE IF NOT EXISTS public.normalization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID,
  cmo_name TEXT,
  source_format TEXT,
  source_field TEXT NOT NULL,
  source_value TEXT NOT NULL,
  canonical_field TEXT NOT NULL,
  canonical_value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'tenant'
    CHECK (scope IN ('global', 'tenant', 'cmo')),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_rules_lookup
  ON public.normalization_rules (user_id, cmo_name, source_field, source_value)
  WHERE is_active = true;

-- 8) Extend canonical transactions for dual-currency and provenance lineage.
ALTER TABLE public.royalty_transactions
ADD COLUMN IF NOT EXISTS source_row_id UUID REFERENCES public.source_rows(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS amount_original NUMERIC(18,6),
ADD COLUMN IF NOT EXISTS amount_reporting NUMERIC(18,6),
ADD COLUMN IF NOT EXISTS currency_original TEXT,
ADD COLUMN IF NOT EXISTS currency_reporting TEXT,
ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),
ADD COLUMN IF NOT EXISTS quantity_unit TEXT,
ADD COLUMN IF NOT EXISTS rights_type TEXT,
ADD COLUMN IF NOT EXISTS territory_raw TEXT,
ADD COLUMN IF NOT EXISTS mapping_confidence NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS validation_blockers JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_royalty_transactions_source_row
  ON public.royalty_transactions (source_row_id);

-- 9) RLS and policies for new tables.
ALTER TABLE public.ingestion_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalization_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ingestion files"
ON public.ingestion_files FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ingestion files"
ON public.ingestion_files FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ingestion files"
ON public.ingestion_files FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own source rows"
ON public.source_rows FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own source rows"
ON public.source_rows FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own source fields"
ON public.source_fields FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own source fields"
ON public.source_fields FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own review tasks"
ON public.review_tasks FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own review tasks"
ON public.review_tasks FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own review tasks"
ON public.review_tasks FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own normalization rules"
ON public.normalization_rules FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own normalization rules"
ON public.normalization_rules FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own normalization rules"
ON public.normalization_rules FOR UPDATE
USING (auth.uid() = user_id);

-- 10) Updated-at triggers for new mutable tables.
DROP TRIGGER IF EXISTS update_ingestion_files_updated_at ON public.ingestion_files;
CREATE TRIGGER update_ingestion_files_updated_at
BEFORE UPDATE ON public.ingestion_files
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_review_tasks_updated_at ON public.review_tasks;
CREATE TRIGGER update_review_tasks_updated_at
BEFORE UPDATE ON public.review_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_normalization_rules_updated_at ON public.normalization_rules;
CREATE TRIGGER update_normalization_rules_updated_at
BEFORE UPDATE ON public.normalization_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
