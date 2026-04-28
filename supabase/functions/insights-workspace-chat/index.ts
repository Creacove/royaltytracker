import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildCatalog } from "./query_engine.ts";
import {
  serveAssistantRuntime,
  RuntimeScope,
  SqlExecutionResponse,
} from "../_shared/assistant-runtime.ts";
import {
  buildEvidencePack,
  type EvidencePack,
  type EvidencePlan,
  type EvidenceJobResults,
} from "../_shared/assistant-evidence/index.ts";

async function fetchWorkspaceCatalog(
  userClient: ReturnType<typeof createClient>,
  _scope: RuntimeScope,
  fromDate: string,
  toDate: string,
) {
  const { data, error } = await userClient.rpc("get_workspace_assistant_catalog_v1", {
    from_date: fromDate,
    to_date: toDate,
  });
  if (error) throw new Error(`Failed to load assistant catalog: ${error.message}`);
  return buildCatalog(data);
}

async function runWorkspaceSql(
  userClient: ReturnType<typeof createClient>,
  _scope: RuntimeScope,
  fromDate: string,
  toDate: string,
  sql: string,
): Promise<SqlExecutionResponse> {
  const { data, error } = await userClient.rpc("run_workspace_chat_sql_v1", {
    from_date: fromDate,
    to_date: toDate,
    p_sql: sql,
  });
  if (error) throw new Error(`SQL execution failed: ${error.message}`);
  return (data ?? {}) as SqlExecutionResponse;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

async function runWorkspaceEvidencePlan(
  userClient: ReturnType<typeof createClient>,
  _scope: RuntimeScope,
  fromDate: string,
  toDate: string,
  evidencePlan: EvidencePlan,
): Promise<EvidencePack> {
  const { data, error } = await userClient.rpc("run_workspace_evidence_plan_v1", {
    from_date: fromDate,
    to_date: toDate,
    p_plan: evidencePlan,
  });
  if (error) throw new Error(`Evidence plan execution failed: ${error.message}`);

  const payload = (data ?? {}) as Record<string, unknown>;
  const results: EvidenceJobResults = {
    revenue_evidence: asArray(payload.revenue_evidence).map((row) => ({
      id: String(row.transaction_id ?? ""),
      work_title: typeof row.work_title === "string" ? row.work_title : null,
      recording_title: typeof row.recording_title === "string" ? row.recording_title : null,
      net_revenue: typeof row.net_revenue === "number" ? row.net_revenue : Number(row.net_revenue ?? 0),
      gross_revenue: typeof row.gross_revenue === "number" ? row.gross_revenue : Number(row.gross_revenue ?? 0),
      currency: typeof row.currency === "string" ? row.currency : null,
      rights_stream: typeof row.rights_stream === "string" ? row.rights_stream : null,
      platform: typeof row.platform === "string" ? row.platform : null,
      territory: typeof row.territory === "string" ? row.territory : null,
      source_ref: typeof row.source_ref === "string" ? row.source_ref : "assistant_revenue_fact_v1",
    })),
    split_evidence: asArray(payload.split_evidence).map((row) => ({
      id: String(row.split_claim_id ?? ""),
      work_title: typeof row.work_title === "string" ? row.work_title : null,
      party_name: typeof row.party_name === "string" ? row.party_name : null,
      share_pct: typeof row.share_pct === "number" ? row.share_pct : Number(row.share_pct ?? 0),
      canonical_rights_stream: typeof row.canonical_rights_stream === "string" ? row.canonical_rights_stream : null,
      source_rights_code: typeof row.source_rights_code === "string" ? row.source_rights_code : null,
      source_rights_label: typeof row.source_rights_label === "string" ? row.source_rights_label : null,
      review_status: typeof row.review_status === "string" ? row.review_status : null,
      confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence ?? 0),
      source_ref: typeof row.source_ref === "string" ? row.source_ref : "assistant_split_claim_fact_v1",
    })),
    rights_evidence: asArray(payload.rights_evidence).map((row) => ({
      id: String(row.rights_position_id ?? ""),
      work_title: typeof row.work_title === "string" ? row.work_title : typeof row.asset_title === "string" ? row.asset_title : null,
      party_name: typeof row.party_name === "string" ? row.party_name : null,
      share_pct: typeof row.share_pct === "number" ? row.share_pct : Number(row.share_pct ?? 0),
      canonical_rights_stream: typeof row.rights_stream === "string" ? row.rights_stream : null,
      review_status: "approved",
      confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence ?? 0),
      source_ref: typeof row.source_ref === "string" ? row.source_ref : "assistant_rights_position_fact_v1",
    })),
    source_documents: asArray(payload.source_documents),
    quality_flags: asArray(payload.quality_flags).map((row) => ({
      code: typeof row.error_type === "string" ? row.error_type : typeof row.fact_type === "string" ? row.fact_type : "quality_flag",
      severity: row.severity === "blocking" || row.severity === "warning" || row.severity === "info" ? row.severity : "warning",
      message: typeof row.message === "string" ? row.message : "Evidence quality flag.",
      evidence_ids: [],
    })),
  };

  return buildEvidencePack(evidencePlan, results);
}

serveAssistantRuntime({
  mode: "workspace",
  scopeLabel: "Workspace",
  safetyFlag: "workspace_scoped",
  catalogProvenance: "get_workspace_assistant_catalog_v1",
  sqlSourceRef: "run_workspace_chat_sql_v1",
  resolveScope: () => ({ scopeValue: null, entityContext: {} }),
  fetchCatalog: fetchWorkspaceCatalog,
  runSql: runWorkspaceSql,
  runEvidencePlan: runWorkspaceEvidencePlan,
});
