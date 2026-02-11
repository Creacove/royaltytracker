-- Full-fidelity storage for Custom Extractor output.
-- Keeps all labeled report-item fields so downstream workflows can inspect/query
-- every extracted figure beyond the normalized royalty_transactions projection.

CREATE TABLE public.document_ai_report_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.cmo_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  source_page INTEGER,
  item_index INTEGER NOT NULL,
  report_item TEXT,
  amount_in_original_currency TEXT,
  amount_in_reporting_currency TEXT,
  channel TEXT,
  config_type TEXT,
  country TEXT,
  exchange_rate TEXT,
  isrc TEXT,
  label TEXT,
  master_commission TEXT,
  original_currency TEXT,
  quantity TEXT,
  release_artist TEXT,
  release_title TEXT,
  release_upc TEXT,
  report_date TEXT,
  reporting_currency TEXT,
  royalty_revenue TEXT,
  sales_end TEXT,
  sales_start TEXT,
  track_artist TEXT,
  track_title TEXT,
  unit TEXT,
  ocr_confidence NUMERIC(6,5),
  raw_entity JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_ai_report_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own document ai report items"
ON public.document_ai_report_items
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own document ai report items"
ON public.document_ai_report_items
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own document ai report items"
ON public.document_ai_report_items
FOR DELETE
USING (auth.uid() = user_id);

CREATE INDEX idx_document_ai_report_items_report_id
ON public.document_ai_report_items(report_id);

CREATE INDEX idx_document_ai_report_items_user_id
ON public.document_ai_report_items(user_id);

CREATE INDEX idx_document_ai_report_items_isrc
ON public.document_ai_report_items(isrc);
