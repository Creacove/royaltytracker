-- Add custom_properties to royalty_transactions to store unmapped column data
ALTER TABLE public.royalty_transactions 
ADD COLUMN custom_properties JSONB NOT NULL DEFAULT '{}';

-- Index for custom_properties for future query capability
CREATE INDEX idx_royalty_transactions_custom_properties ON public.royalty_transactions USING GIN (custom_properties);

-- Optimize column_mappings lookup
-- We often query by scope and is_active during ingestion
CREATE INDEX idx_column_mappings_scope_active ON public.column_mappings (scope, is_active) 
WHERE is_active = true;

-- Ensure source_fields.is_mapped is indexed for quality gate queries
CREATE INDEX idx_source_fields_is_mapped ON public.source_fields (report_id, is_mapped);

-- RPC for atomic JSONB property merging (returns affected row count for verification)
CREATE OR REPLACE FUNCTION public.merge_custom_property(
  p_report_id UUID,
  p_source_row_id UUID,
  p_key TEXT,
  p_value TEXT
) RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.royalty_transactions
  SET custom_properties = custom_properties || jsonb_build_object(p_key, p_value)
  WHERE report_id = p_report_id AND source_row_id = p_source_row_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
