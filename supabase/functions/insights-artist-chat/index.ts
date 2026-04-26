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

function resolveArtistScope(body: Record<string, unknown>): RuntimeScope {
  const entityContext = body.entity_context && typeof body.entity_context === "object" && !Array.isArray(body.entity_context)
    ? body.entity_context as Record<string, unknown>
    : {};
  const artistKey = asString(body.artist_key) ?? asString(entityContext.artist_key);
  if (!artistKey) throw new Error("artist_key is required.");
  return { scopeValue: artistKey, entityContext: { artist_key: artistKey } };
}

async function fetchArtistCatalog(
  userClient: ReturnType<typeof createClient>,
  scope: RuntimeScope,
  fromDate: string,
  toDate: string,
) {
  const artistKey = scope.scopeValue;
  const { data, error } = await userClient.rpc("get_artist_assistant_catalog_v1", {
    p_artist_key: artistKey,
    from_date: fromDate,
    to_date: toDate,
  });
  if (!error) return buildCatalog(data);

  const fallback = await userClient.rpc("get_artist_assistant_schema_with_capabilities_v1", {
    p_artist_key: artistKey,
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

async function runArtistSql(
  userClient: ReturnType<typeof createClient>,
  scope: RuntimeScope,
  fromDate: string,
  toDate: string,
  sql: string,
): Promise<SqlExecutionResponse> {
  const { data, error } = await userClient.rpc("run_artist_chat_sql_v1", {
    p_artist_key: scope.scopeValue,
    from_date: fromDate,
    to_date: toDate,
    p_sql: sql,
  });
  if (error) {
    const preview = sql.replace(/\s+/g, " ").slice(0, 900);
    throw new Error(`SQL execution failed: ${error.message} | sql_preview=${preview}`);
  }
  return (data ?? {}) as SqlExecutionResponse;
}

async function logArtistTurn(
  adminClient: ReturnType<typeof createClient> | null,
  payload: Record<string, unknown>,
) {
  if (!adminClient) return;
  try {
    await adminClient.from("artist_ai_turn_logs_v1").insert(payload);
  } catch {
    // Best-effort logging only.
  }
}

serveAssistantRuntime({
  mode: "artist",
  scopeField: "artist_key",
  scopeLabel: "Artist",
  safetyFlag: "artist_scoped",
  catalogProvenance: "get_artist_assistant_catalog_v1",
  sqlSourceRef: "run_artist_chat_sql_v1",
  resolveScope: resolveArtistScope,
  fetchCatalog: fetchArtistCatalog,
  runSql: runArtistSql,
  logTurn: logArtistTurn,
});
