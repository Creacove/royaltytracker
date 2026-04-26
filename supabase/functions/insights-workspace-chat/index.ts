import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildCatalog } from "./query_engine.ts";
import {
  serveAssistantRuntime,
  RuntimeScope,
  SqlExecutionResponse,
} from "../_shared/assistant-runtime.ts";

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

serveAssistantRuntime({
  mode: "workspace",
  scopeLabel: "Workspace",
  safetyFlag: "workspace_scoped",
  catalogProvenance: "get_workspace_assistant_catalog_v1",
  sqlSourceRef: "run_workspace_chat_sql_v1",
  resolveScope: () => ({ scopeValue: null, entityContext: {} }),
  fetchCatalog: fetchWorkspaceCatalog,
  runSql: runWorkspaceSql,
});
