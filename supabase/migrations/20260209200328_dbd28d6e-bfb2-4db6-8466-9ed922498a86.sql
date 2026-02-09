
-- CMO Reports table
CREATE TABLE public.cmo_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  cmo_name TEXT NOT NULL,
  report_period TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  accuracy_score NUMERIC(5,2),
  error_count INTEGER DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,
  total_revenue NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cmo_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reports" ON public.cmo_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own reports" ON public.cmo_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own reports" ON public.cmo_reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own reports" ON public.cmo_reports FOR DELETE USING (auth.uid() = user_id);

-- Royalty Transactions table
CREATE TABLE public.royalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.cmo_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  artist_name TEXT,
  track_title TEXT,
  isrc TEXT,
  iswc TEXT,
  territory TEXT,
  platform TEXT,
  usage_type TEXT,
  quantity BIGINT,
  gross_revenue NUMERIC(14,4),
  commission NUMERIC(14,4),
  net_revenue NUMERIC(14,4),
  currency TEXT DEFAULT 'USD',
  period_start DATE,
  period_end DATE,
  validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending', 'passed', 'warning', 'failed')),
  source_page INTEGER,
  source_row INTEGER,
  bbox_x NUMERIC,
  bbox_y NUMERIC,
  bbox_width NUMERIC,
  bbox_height NUMERIC,
  ocr_confidence NUMERIC(5,2),
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.royalty_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own transactions" ON public.royalty_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own transactions" ON public.royalty_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Validation Errors table
CREATE TABLE public.validation_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.cmo_reports(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.royalty_transactions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info')),
  error_type TEXT NOT NULL,
  field_name TEXT,
  expected_value TEXT,
  actual_value TEXT,
  message TEXT NOT NULL,
  source_page INTEGER,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.validation_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own errors" ON public.validation_errors FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own errors" ON public.validation_errors FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Storage bucket for PDF uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('cmo-reports', 'cmo-reports', false);

CREATE POLICY "Users can upload their own reports" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'cmo-reports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own reports" ON storage.objects FOR SELECT USING (bucket_id = 'cmo-reports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own reports" ON storage.objects FOR DELETE USING (bucket_id = 'cmo-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Indexes for performance
CREATE INDEX idx_transactions_report ON public.royalty_transactions(report_id);
CREATE INDEX idx_transactions_isrc ON public.royalty_transactions(isrc);
CREATE INDEX idx_transactions_territory ON public.royalty_transactions(territory);
CREATE INDEX idx_transactions_platform ON public.royalty_transactions(platform);
CREATE INDEX idx_transactions_artist ON public.royalty_transactions(artist_name);
CREATE INDEX idx_validation_errors_report ON public.validation_errors(report_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_cmo_reports_updated_at
  BEFORE UPDATE ON public.cmo_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
