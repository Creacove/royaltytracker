-- Expand allowed task types to support actionable resolutions
ALTER TABLE public.review_tasks 
DROP CONSTRAINT IF EXISTS review_tasks_task_type_check;

ALTER TABLE public.review_tasks 
ADD CONSTRAINT review_tasks_task_type_check 
CHECK (
  task_type IN (
    'missing_required_field',
    'low_confidence',
    'normalization_uncertainty',
    'outlier',
    'numeric_outlier',
    'currency_mismatch',
    'currency_missing',
    'period_mismatch',
    'provenance_missing',
    'mapping_unresolved',
    'numeric_parse_guard',
    'revenue_math_mismatch',
    'quantity_missing',
    'manual_override',
    'other'
  )
);
