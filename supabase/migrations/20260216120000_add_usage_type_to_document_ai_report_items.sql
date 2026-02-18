-- Add usage_type column to document_ai_report_items table
-- This column stores the usage type (e.g., Streaming, Download, Ad-supported) from config_type

ALTER TABLE public.document_ai_report_items
ADD COLUMN IF NOT EXISTS usage_type TEXT;
