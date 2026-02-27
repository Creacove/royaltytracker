export type TrackInsightListRow = {
  track_key: string;
  identity_mode: "isrc" | "fallback" | string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
  net_revenue: number;
  gross_revenue: number;
  quantity: number;
  net_per_unit: number;
  trend_3m_pct: number;
  top_territory: string;
  top_platform: string;
  failed_line_count: number;
  open_critical_task_count: number;
  revenue_component: number;
  growth_component: number;
  leakage_component: number;
  quality_risk_component: number;
  opportunity_score: number;
  quality_flag: "low" | "medium" | "high" | string;
};

export type TrackInsightDetail = {
  summary: {
    track_key: string;
    track_title: string;
    artist_name: string;
    isrc: string | null;
    net_revenue: number;
    gross_revenue: number;
    commission: number;
    quantity: number;
    net_per_unit: number;
    effective_commission_rate: number;
    avg_confidence: number | null;
    line_count: number;
    failed_line_count: number;
  };
  monthly_trend: Array<{
    month_start: string;
    net_revenue: number;
    quantity: number;
    gross_revenue: number;
  }>;
  territory_mix: Array<{ territory: string; net_revenue: number; quantity: number }>;
  platform_mix: Array<{ platform: string; net_revenue: number; quantity: number }>;
  territory_platform_matrix: Array<{
    territory: string;
    platform: string;
    net_revenue: number;
    quantity: number;
    net_per_unit: number;
  }>;
  usage_mix: Array<{ usage_type: string; net_revenue: number; quantity: number }>;
  high_usage_low_payout: Array<{
    territory: string;
    quantity: number;
    net_revenue: number;
    usage_share: number;
    payout_share: number;
  }>;
  quality: {
    failed_line_count: number;
    open_task_count: number;
    open_critical_task_count: number;
    validation_critical_count: number;
    validation_warning_count: number;
    validation_info_count: number;
    avg_confidence: number | null;
  };
  extractor_coverage: Array<{
    field_name: string;
    populated_rows: number;
    total_rows: number;
    coverage_pct: number;
  }>;
  config_mix: Array<{
    config_type: string;
    row_count: number;
  }>;
  provenance: Array<{
    event_date: string;
    territory: string;
    platform: string;
    net_revenue: number;
    quantity: number;
    source_row_id: string | null;
    report_id: string;
    file_name: string;
    cmo_name: string;
    source_page: number | null;
    source_row: number | null;
  }>;
  query_meta: {
    from_date: string;
    to_date: string;
    track_key: string;
  };
};

export type TrackAssistantResult = {
  prompt_id: string;
  title?: string;
  summary?: string;
  rows?: unknown[];
  metrics?: Record<string, unknown>;
  query_meta?: {
    track_key: string;
    from_date: string;
    to_date: string;
    prompt_id: string;
  };
  query_provenance?: string[];
  error?: string;
  supported_prompt_ids?: string[];
};

export type TrackChatKpi = {
  label: string;
  value: string;
  change?: string;
};

export type TrackChatTable = {
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};

export type TrackChatChart = {
  type: "bar" | "line" | "none";
  x: string;
  y: string[];
  title?: string;
};

export type TrackChatEvidence = {
  row_count: number;
  duration_ms: number;
  from_date: string;
  to_date: string;
  provenance: string[];
};

export type TrackChatUiBlock = {
  answer_title: string;
  answer_text: string;
  kpis: TrackChatKpi[];
  table?: TrackChatTable;
  chart?: TrackChatChart;
  evidence: TrackChatEvidence;
  follow_up_questions: string[];
};

export type TrackNaturalChatPlanRequest = {
  action: "plan_query";
  track_key: string;
  question: string;
  from_date: string;
  to_date: string;
};

export type TrackNaturalChatPlanResponse = {
  plan_id: string;
  understood_question: string;
  sql_preview: string;
  expected_columns: string[];
  execution_token: string;
  expires_at: string;
  safety: {
    read_only: true;
    row_limit: number;
    timeout_ms: number;
    track_scoped: true;
  };
};

export type TrackNaturalChatRunRequest = {
  action: "run_query";
  track_key: string;
  from_date: string;
  to_date: string;
  plan_id: string;
  sql_preview: string;
  execution_token: string;
};

export type TrackNaturalChatRunResponse = {
  answer_title: string;
  answer_text: string;
  kpis: TrackChatKpi[];
  table?: TrackChatTable;
  chart?: TrackChatChart;
  evidence: TrackChatEvidence;
  follow_up_questions: string[];
};

export type TrackChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
  ui_block?: TrackChatUiBlock;
  plan?: TrackNaturalChatPlanResponse;
  error?: string;
};

export type AssistantClarificationV2 = {
  prompt: string;
  options: string[];
};

export type AssistantTurnRequestV2 = {
  action: "send_turn";
  track_key: string;
  from_date: string;
  to_date: string;
  question: string;
  conversation_id?: string;
};

export type AssistantTurnResponseV2 = {
  conversation_id: string;
  answer_title: string;
  answer_text: string;
  why_this_matters?: string;
  kpis: TrackChatKpi[];
  table?: TrackChatTable;
  chart?: TrackChatChart;
  evidence: TrackChatEvidence;
  follow_up_questions: string[];
  clarification?: AssistantClarificationV2;
};

export type AssistantExportRequestV1 = {
  action: "export_answer" | "export_monthly_snapshot";
  track_key: string;
  from_date: string;
  to_date: string;
  answer_payload?: AssistantTurnResponseV2;
};

export type AssistantExportResponseV1 = {
  pdf_url?: string;
  xlsx_url?: string;
  job_id?: string;
  status?: string;
};
