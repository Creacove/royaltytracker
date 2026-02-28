import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  EMPTY_WORKSPACE_SUBSCRIPTION_STATE,
  normalizeWorkspaceSubscriptionState,
  type WorkspaceSubscriptionState,
  type WorkspaceSubscriptionStateRow,
} from "@/types/workspace-billing";

export function useWorkspaceSubscriptionState(userId: string | null) {
  const [state, setState] = useState<WorkspaceSubscriptionState>({ ...EMPTY_WORKSPACE_SUBSCRIPTION_STATE });
  const [loading, setLoading] = useState(Boolean(userId));
  const [loaded, setLoaded] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setState({ ...EMPTY_WORKSPACE_SUBSCRIPTION_STATE });
      setLoading(false);
      setLoaded(true);
      setSchemaReady(true);
      setError(null);
      return;
    }

    setLoading(true);
    setLoaded(false);
    setError(null);

    const { data, error: rpcError } = await (supabase as any).rpc("get_my_workspace_subscription_state");
    if (rpcError) {
      const message = rpcError.message ?? "";
      const normalizedMessage = message.toLowerCase();
      const missingFunction =
        rpcError.code === "42883" ||
        normalizedMessage.includes("could not find the function") ||
        (normalizedMessage.includes("schema cache") &&
          normalizedMessage.includes("get_my_workspace_subscription_state"));

      if (missingFunction) {
        setState({ ...EMPTY_WORKSPACE_SUBSCRIPTION_STATE });
        setSchemaReady(false);
        setError(null);
        setLoading(false);
        setLoaded(true);
        return;
      }

      setSchemaReady(true);
      setError(rpcError.message ?? "Unable to load workspace subscription state.");
      setLoading(false);
      setLoaded(true);
      return;
    }

    const row = Array.isArray(data)
      ? (data[0] as WorkspaceSubscriptionStateRow | undefined)
      : (data as WorkspaceSubscriptionStateRow | null);
    setState(normalizeWorkspaceSubscriptionState(row));
    setSchemaReady(true);
    setLoading(false);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, loading, loaded, schemaReady, error, refresh };
}
