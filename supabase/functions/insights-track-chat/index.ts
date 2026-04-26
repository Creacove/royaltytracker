import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildCatalog } from "./query_engine.ts";
import {
  serveAssistantRuntime,
  RuntimeScope,
  SqlExecutionResponse,
} from "../_shared/assistant-runtime.ts";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveTrackScope(body: Record<string, unknown>): RuntimeScope {
  const entityContext = body.entity_context && typeof body.entity_context === "object" && !Array.isArray(body.entity_context)
    ? body.entity_context as Record<string, unknown>
    : {};
  const trackKey = asString(body.track_key) ?? asString(entityContext.track_key);
  if (!trackKey) throw new Error("track_key is required.");
  return { scopeValue: trackKey, entityContext: { track_key: trackKey } };
}

async function fetchTrackCatalog(
  userClient: ReturnType<typeof createClient>,
  scope: RuntimeScope,
  fromDate: string,
  toDate: string,
) {
  const trackKey = scope.scopeValue;
  const { data, error } = await userClient.rpc("get_track_assistant_catalog_v1", {
    p_track_key: trackKey,
    from_date: fromDate,
    to_date: toDate,
  });
  if (!error) return buildCatalog(data);

  const fallback = await userClient.rpc("get_track_assistant_schema_v2", {
    p_track_key: trackKey,
    from_date: fromDate,
    to_date: toDate,
  });
  if (fallback.error) throw new Error(`Failed to load assistant catalog: ${fallback.error.message}`);
  const root = (fallback.data ?? {}) as Record<string, unknown>;
  const canonical = Array.isArray(root.canonical_columns) ? root.canonical_columns : [];
  const custom = Array.isArray(root.custom_columns) ? root.custom_columns : [];
  return buildCatalog({
    total_rows: root.total_rows ?? 0,
    columns: [...canonical, ...custom].map((col) => ({
      ...(col as Record<string, unknown>),
      source: custom.includes(col) ? "custom" : "canonical",
    })),
    aliases: {},
  });
}

async function runTrackSql(
  userClient: ReturnType<typeof createClient>,
  scope: RuntimeScope,
  fromDate: string,
  toDate: string,
  sql: string,
): Promise<SqlExecutionResponse> {
  const { data, error } = await userClient.rpc("run_track_chat_sql_v2", {
    p_track_key: scope.scopeValue,
    from_date: fromDate,
    to_date: toDate,
    p_sql: sql,
  });
  if (error) throw new Error(`SQL execution failed: ${error.message}`);
  return (data ?? {}) as SqlExecutionResponse;
}

serveAssistantRuntime({
  mode: "track",
  scopeField: "track_key",
  scopeLabel: "Track",
  safetyFlag: "track_scoped",
  catalogProvenance: "get_track_assistant_catalog_v1",
  sqlSourceRef: "run_track_chat_sql_v2",
  resolveScope: resolveTrackScope,
  fetchCatalog: fetchTrackCatalog,
  runSql: runTrackSql,
});
