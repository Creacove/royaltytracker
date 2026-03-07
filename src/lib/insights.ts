import type { Json } from "@/integrations/supabase/types";
import type {
  AssistantExportResponseV1,
  ArtistSnapshotDetail,
  AssistantTurnResponseV2,
  TrackAssistantResult,
  TrackInsightDetail,
  TrackInsightListRow,
  TrackNaturalChatPlanResponse,
  TrackNaturalChatRunResponse,
} from "@/types/insights";

export function defaultDateRange(): { fromDate: string; toDate: string } {
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 12);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: today.toISOString().slice(0, 10),
  };
}

export function clampPercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function toConfidenceGrade(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  if (value >= 92) return "A";
  if (value >= 85) return "B";
  if (value >= 75) return "C";
  if (value >= 65) return "D";
  return "E";
}

export function parseListRows(input: Json | null): TrackInsightListRow[] {
  if (!Array.isArray(input)) return [];
  return input as unknown as TrackInsightListRow[];
}

export function parseDetail(input: Json | null): TrackInsightDetail | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as unknown as TrackInsightDetail;
}

export function parseArtistSnapshotDetail(input: Json | null): ArtistSnapshotDetail | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as unknown as ArtistSnapshotDetail;
}

export function parseAssistantResult(input: Json | null): TrackAssistantResult | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as unknown as TrackAssistantResult;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toString(item))
    .filter((item): item is string => !!item);
}

function toChartType(value: unknown): "bar" | "line" | "none" {
  if (value === "bar" || value === "line" || value === "none") return value;
  return "none";
}

export function parseNaturalChatPlanResponse(input: unknown): TrackNaturalChatPlanResponse | null {
  const root = toObject(input);
  if (!root) return null;

  const safety = toObject(root.safety);
  const planId = toString(root.plan_id);
  const understoodQuestion = toString(root.understood_question);
  const sqlPreview = toString(root.sql_preview);
  const executionToken = toString(root.execution_token);
  const expiresAt = toString(root.expires_at);
  if (!planId || !understoodQuestion || !sqlPreview || !executionToken || !expiresAt || !safety) return null;

  const rowLimit = toNumber(safety.row_limit);
  const timeoutMs = toNumber(safety.timeout_ms);
  if (rowLimit == null || timeoutMs == null) return null;

  return {
    plan_id: planId,
    understood_question: understoodQuestion,
    sql_preview: sqlPreview,
    expected_columns: toStringArray(root.expected_columns),
    execution_token: executionToken,
    expires_at: expiresAt,
    safety: {
      read_only: true,
      row_limit: rowLimit,
      timeout_ms: timeoutMs,
      track_scoped: true,
    },
  };
}

export function parseNaturalChatRunResponse(input: unknown): TrackNaturalChatRunResponse | null {
  const root = toObject(input);
  if (!root) return null;

  const answerTitle = toString(root.answer_title);
  const answerText = toString(root.answer_text);
  const evidence = toObject(root.evidence);
  if (!answerTitle || !answerText || !evidence) return null;

  const rowCount = toNumber(evidence.row_count);
  const durationMs = toNumber(evidence.duration_ms);
  const fromDate = toString(evidence.from_date);
  const toDate = toString(evidence.to_date);
  if (rowCount == null || durationMs == null || !fromDate || !toDate) return null;

  const kpis = Array.isArray(root.kpis)
    ? root.kpis
        .map((item) => {
          const obj = toObject(item);
          if (!obj) return null;
          const label = toString(obj.label);
          const value = toString(obj.value);
          if (!label || !value) return null;
          return {
            label,
            value,
            change: toString(obj.change) ?? undefined,
          };
        })
        .filter((item): item is { label: string; value: string; change?: string } => !!item)
    : [];

  const tableObj = toObject(root.table);
  const table =
    tableObj && Array.isArray(tableObj.rows)
      ? {
          columns: toStringArray(tableObj.columns),
          rows: tableObj.rows
            .map((row) => toObject(row))
            .filter((row): row is Record<string, unknown> => !!row)
            .map((row) => {
              const output: Record<string, string | number | null> = {};
              for (const [key, value] of Object.entries(row)) {
                if (value == null || typeof value === "string" || typeof value === "number") {
                  output[key] = value as string | number | null;
                } else if (typeof value === "boolean") {
                  output[key] = value ? "true" : "false";
                } else {
                  output[key] = String(value);
                }
              }
              return output;
            }),
        }
      : undefined;

  const chartObj = toObject(root.chart);
  const chart = chartObj
    ? {
        type: toChartType(chartObj.type),
        x: toString(chartObj.x) ?? "",
        y: toStringArray(chartObj.y),
        title: toString(chartObj.title) ?? undefined,
      }
    : undefined;

  return {
    answer_title: answerTitle,
    answer_text: answerText,
    kpis,
    table,
    chart,
    evidence: {
      row_count: rowCount,
      duration_ms: durationMs,
      from_date: fromDate,
      to_date: toDate,
      provenance: toStringArray(evidence.provenance),
    },
    follow_up_questions: toStringArray(root.follow_up_questions),
  };
}

export function parseAssistantTurnResponseV2(input: unknown): AssistantTurnResponseV2 | null {
  const root = toObject(input);
  if (!root) return null;

  const conversationId = toString(root.conversation_id);
  const answerTitle = toString(root.answer_title);
  const answerText = toString(root.answer_text);
  const evidence = toObject(root.evidence);
  if (!conversationId || !answerTitle || !answerText || !evidence) return null;

  const rowCount = toNumber(evidence.row_count);
  const durationMs = toNumber(evidence.duration_ms);
  const fromDate = toString(evidence.from_date);
  const toDate = toString(evidence.to_date);
  if (rowCount == null || durationMs == null || !fromDate || !toDate) return null;

  const kpis = Array.isArray(root.kpis)
    ? root.kpis
        .map((item) => {
          const obj = toObject(item);
          if (!obj) return null;
          const label = toString(obj.label);
          const value = toString(obj.value);
          if (!label || !value) return null;
          return {
            label,
            value,
            change: toString(obj.change) ?? undefined,
          };
        })
        .filter((item): item is { label: string; value: string; change?: string } => !!item)
    : [];

  const tableObj = toObject(root.table);
  const table =
    tableObj && Array.isArray(tableObj.rows)
      ? {
          columns: toStringArray(tableObj.columns),
          rows: tableObj.rows
            .map((row) => toObject(row))
            .filter((row): row is Record<string, unknown> => !!row)
            .map((row) => {
              const output: Record<string, string | number | null> = {};
              for (const [key, value] of Object.entries(row)) {
                if (value == null || typeof value === "string" || typeof value === "number") {
                  output[key] = value as string | number | null;
                } else if (typeof value === "boolean") {
                  output[key] = value ? "true" : "false";
                } else {
                  output[key] = String(value);
                }
              }
              return output;
            }),
        }
      : undefined;

  const chartObj = toObject(root.chart);
  const chart = chartObj
    ? {
        type: toChartType(chartObj.type),
        x: toString(chartObj.x) ?? "",
        y: toStringArray(chartObj.y),
        title: toString(chartObj.title) ?? undefined,
      }
    : undefined;

  const clarificationObj = toObject(root.clarification);
  const clarification = clarificationObj
    ? {
        prompt: toString(clarificationObj.prompt) ?? "Please choose one option.",
        options: toStringArray(clarificationObj.options),
      }
    : undefined;
  const diagnosticsObj = toObject(root.diagnostics);
  const diagnostics = diagnosticsObj
    ? {
        intent: toString(diagnosticsObj.intent) ?? "unknown",
        confidence: ((toString(diagnosticsObj.confidence) ?? "low") as "high" | "medium" | "low"),
        used_fields: toStringArray(diagnosticsObj.used_fields),
        missing_fields: toStringArray(diagnosticsObj.missing_fields),
        strict_mode: Boolean(diagnosticsObj.strict_mode),
        analysis_plan: toObject(diagnosticsObj.analysis_plan) ?? undefined,
        required_columns: toStringArray(diagnosticsObj.required_columns),
        chosen_columns: toStringArray(diagnosticsObj.chosen_columns),
        verifier_status: toString(diagnosticsObj.verifier_status) ?? undefined,
        insufficiency_reason: toString(diagnosticsObj.insufficiency_reason),
        compiler_source: toString(diagnosticsObj.compiler_source) ?? undefined,
        top_n: toNumber(diagnosticsObj.top_n) ?? undefined,
        sort_by: toString(diagnosticsObj.sort_by) ?? undefined,
        sort_dir: toString(diagnosticsObj.sort_dir) ?? undefined,
        stage: toString(diagnosticsObj.stage) ?? undefined,
      }
    : undefined;

  return {
    conversation_id: conversationId,
    answer_title: answerTitle,
    answer_text: answerText,
    why_this_matters: toString(root.why_this_matters) ?? undefined,
    kpis,
    table,
    chart,
    evidence: {
      row_count: rowCount,
      duration_ms: durationMs,
      from_date: fromDate,
      to_date: toDate,
      provenance: toStringArray(evidence.provenance),
    },
    follow_up_questions: toStringArray(root.follow_up_questions),
    clarification,
    diagnostics,
  };
}

export function parseAssistantExportResponseV1(input: unknown): AssistantExportResponseV1 | null {
  const root = toObject(input);
  if (!root) return null;

  const pdfUrl = toString(root.pdf_url) ?? undefined;
  const xlsxUrl = toString(root.xlsx_url) ?? undefined;
  const jobId = toString(root.job_id) ?? undefined;
  const status = toString(root.status) ?? undefined;

  if (!pdfUrl && !xlsxUrl && !jobId && !status) return null;
  return {
    pdf_url: pdfUrl,
    xlsx_url: xlsxUrl,
    job_id: jobId,
    status,
  };
}
