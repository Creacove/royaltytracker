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

export type ArtistSnapshotDetail = {
  summary: {
    artist_key: string;
    artist_name: string;
    track_count: number;
    net_revenue: number;
    gross_revenue: number;
    quantity: number;
    net_per_unit: number;
    avg_track_revenue: number;
    top_track_title: string | null;
    top_track_revenue: number;
    top_territory: string | null;
    top_platform: string | null;
  };
  monthly_trend: Array<{
    month_start: string;
    net_revenue: number;
    quantity: number;
    gross_revenue: number;
  }>;
  territory_mix: Array<{ territory: string; net_revenue: number; quantity: number }>;
  platform_mix: Array<{ platform: string; net_revenue: number; quantity: number }>;
  usage_mix: Array<{ usage_type: string; net_revenue: number; quantity: number }>;
  top_tracks: Array<{
    track_key: string;
    track_title: string;
    isrc: string | null;
    net_revenue: number;
    gross_revenue: number;
    quantity: number;
    net_per_unit: number;
  }>;
  query_meta: {
    from_date: string;
    to_date: string;
    artist_key: string;
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

export type AssistantDiagnostics = {
  intent: string;
  confidence: "high" | "medium" | "low";
  used_fields: string[];
  missing_fields: string[];
  strict_mode: boolean;
  analysis_plan?: Record<string, unknown>;
  required_columns?: string[];
  chosen_columns?: string[];
  verifier_status?: "passed" | "failed" | "pending" | string;
  insufficiency_reason?: string | null;
  compiler_source?: "model" | "fallback" | string;
  top_n?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc" | string;
  stage?: "catalog" | "parse" | "plan" | "compile" | "execute" | "verify" | string;
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
  diagnostics?: AssistantDiagnostics;
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

export type AiInsightsMode = "workspace-general" | "artist" | "track";

export type AiInsightsEntityContext = {
  track_key?: string;
  track_title?: string;
  artist_key?: string;
  artist_name?: string;
  recording_id?: string;
  work_id?: string;
  party_id?: string;
};

export type AiInsightsEvidence = {
  row_count: number;
  scanned_rows: number;
  from_date: string;
  to_date: string;
  provenance: string[];
  system_confidence: "high" | "medium" | "low";
};

export type AiInsightsAction = {
  label: string;
  href: string;
  kind?: "primary" | "secondary" | "ghost";
};

export type AiInsightsVisual = {
  type: "bar" | "line" | "table" | "none";
  title?: string;
  x?: string;
  y?: string[];
  rows?: Array<Record<string, string | number | null>>;
  columns?: string[];
};

export type AiInsightsCitation = {
  title: string;
  url?: string;
  publisher?: string;
  retrieved_at?: string;
  claim_ids?: string[];
  source_type?: "workspace_data" | "external";
};

export type AiInsightsRecommendation = {
  action: string;
  rationale: string;
  impact?: string;
  risk?: string;
  horizon?: "now" | "this_quarter" | "next_quarter";
  confidence?: "high" | "medium" | "low";
  citations?: string[];
};

export type AiInsightsAnswerBlockType =
  | "direct_answer"
  | "deep_summary"
  | "kpi_strip"
  | "table"
  | "bar_chart"
  | "line_chart"
  | "recommendations"
  | "scenario_options"
  | "risk_flags"
  | "past_pattern_inference"
  | "action_plan"
  | "citations";

export type AiInsightsAnswerBlock = {
  id: string;
  type: AiInsightsAnswerBlockType;
  priority: number;
  title?: string;
  source: "workspace_data" | "external";
  confidence?: "high" | "medium" | "low";
  payload: Record<string, unknown>;
};

export type AiInsightsRenderHints = {
  layout: "adaptive_card_stack" | "prose_first";
  density: "compact" | "expanded";
  visual_preference: "chart" | "table" | "none";
  show_confidence_badges: boolean;
  evidence_visibility?: "collapsed" | "expanded";
  visible_artifact_ids?: string[];
  answer_depth?: "concise" | "standard" | "deep";
};

export type AiInsightsAnswerDesign = {
  capabilities: string[];
  depth: "concise" | "standard" | "deep";
  external_enrichment_allowed: boolean;
  evidence_visibility: "collapsed" | "expanded";
};

export type AiAnswerSection = {
  id: string;
  title: string;
  content: string;
  evidence_job_ids?: string[];
  status?: "supported" | "partial" | "unsupported";
};

export type AiEvidenceBundleSqlJob = {
  job_id: string;
  purpose: string;
  requirement?: "required" | "supporting" | "optional" | string;
  required_for_answer?: boolean;
  row_count?: number;
  columns?: string[];
  rows?: Array<Record<string, string | number | null>>;
  chosen_columns?: string[];
  verifier_status?: "passed" | "failed" | string;
  warnings?: string[];
  error?: string;
};

export type AiEvidenceBundle = {
  evidence_answer_pack?: Record<string, unknown> | null;
  multi_evidence_plan?: Record<string, unknown>;
  sql_evidence_jobs?: AiEvidenceBundleSqlJob[];
  structured_sidecar_evidence?: Record<string, unknown> | null;
};

export type AiJobDiagnostic = {
  job_id: string;
  type: "sql" | "rights_splits" | "documents" | "quality" | "external" | string;
  status: "passed" | "failed" | "missing" | "partial" | string;
  row_count?: number;
  warnings?: string[];
  error?: string;
};

export type AiInsightsTurnRequest = {
  question: string;
  from_date: string;
  to_date: string;
  conversation_id?: string;
  entity_context?: AiInsightsEntityContext;
};

export type AiInsightsTurnResponse = {
  conversation_id: string;
  resolved_mode: AiInsightsMode;
  resolved_entities: AiInsightsEntityContext;
  answer_title?: string;
  executive_answer: string;
  why_this_matters: string;
  evidence: AiInsightsEvidence;
  actions: AiInsightsAction[];
  follow_up_questions: string[];
  visual: AiInsightsVisual;
  kpis: Array<{ label: string; value: string }>;
  diagnostics?: AssistantDiagnostics;
  quality_outcome?: "pass" | "clarify" | "constrained";
  clarification?: {
    question: string;
    reason: string;
    options?: string[];
  };
  resolved_scope?: {
    mode: "track" | "artist" | "workspace-general";
    entity_context: AiInsightsEntityContext;
    from_date: string;
    to_date: string;
    scope_token: string;
    scope_epoch: number;
  };
  plan_trace?: {
    intent?: string;
    selected_columns?: string[];
    missing_columns?: string[];
    column_requirements?: {
      required: string[];
      optional: string[];
      missing_requested: string[];
    };
    constraints?: Record<string, unknown>;
  };
  claims?: Array<{
    claim_id: string;
    text: string;
    supporting_fields: string[];
    source_ref: string;
  }>;
  detected_intent?: string;
  detected_persona?: "publisher" | "marketer" | "tour_manager" | "label_head" | "executive_decision_maker";
  answer_blocks?: AiInsightsAnswerBlock[];
  render_hints?: AiInsightsRenderHints;
  evidence_map?: Record<string, "workspace_data" | "external">;
  recommendations?: AiInsightsRecommendation[];
  recommended_actions?: unknown[];
  citations?: AiInsightsCitation[];
  unknowns?: string[];
  answer_design?: AiInsightsAnswerDesign;
  answer_sections?: AiAnswerSection[];
  evidence_bundle?: AiEvidenceBundle;
  job_diagnostics?: AiJobDiagnostic[];
  synthesis_source?: "ai_final_writer" | "deterministic_fallback" | "deterministic_policy" | string;
  answer_quality?: {
    status?: "passed" | "failed" | string;
    reasons?: string[];
  };
};
