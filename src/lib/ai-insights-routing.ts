import type { AiInsightsEntityContext, AiInsightsMode, AiInsightsTurnResponse } from "@/types/insights";

export function detectAiInsightsMode(question: string, context: AiInsightsEntityContext): AiInsightsMode {
  void question;
  if (context.track_key) return "track";
  if (context.artist_key || context.artist_name) return "artist";
  return "workspace-general";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAiInsightsTurnResponse(input: unknown): input is AiInsightsTurnResponse {
  if (!isObject(input)) return false;
  const mode = input.resolved_mode;
  if (mode !== "workspace-general" && mode !== "artist" && mode !== "track") return false;
  if (typeof input.conversation_id !== "string" || input.conversation_id.trim().length === 0) return false;
  if (typeof input.executive_answer !== "string" || input.executive_answer.trim().length === 0) return false;
  if (typeof input.why_this_matters !== "string") return false;

  if (!isObject(input.evidence)) return false;
  const evidence = input.evidence as Record<string, unknown>;
  if (typeof evidence.row_count !== "number") return false;
  if (typeof evidence.scanned_rows !== "number") return false;
  if (typeof evidence.from_date !== "string" || typeof evidence.to_date !== "string") return false;
  if (!Array.isArray(evidence.provenance)) return false;

  if (!Array.isArray(input.actions)) return false;
  if (!Array.isArray(input.follow_up_questions)) return false;
  if (!isObject(input.visual)) return false;
  if (!Array.isArray(input.kpis)) return false;
  return true;
}
