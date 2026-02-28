import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  EMPTY_ONBOARDING_STATE,
  normalizeOnboardingState,
  type OnboardingState,
  type OnboardingStateRow,
} from "@/types/onboarding";

export function useOnboardingState(userId: string | null) {
  const [state, setState] = useState<OnboardingState>({ ...EMPTY_ONBOARDING_STATE });
  const [loading, setLoading] = useState(Boolean(userId));
  const [loaded, setLoaded] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setState({ ...EMPTY_ONBOARDING_STATE });
      setLoading(false);
      setLoaded(true);
      setSchemaReady(true);
      setError(null);
      return;
    }

    setLoading(true);
    setLoaded(false);
    setError(null);

    const { data, error: rpcError } = await (supabase as any).rpc("get_my_onboarding_state");
    if (rpcError) {
      const message = rpcError.message ?? "";
      const missingFunction =
        rpcError.code === "42883" ||
        message.includes("get_my_onboarding_state") ||
        message.includes("Could not find the function");

      if (missingFunction) {
        setState({
          ...EMPTY_ONBOARDING_STATE,
          onboardingComplete: true,
          hasActiveMembership: true,
        });
        setSchemaReady(false);
        setError(null);
        setLoading(false);
        setLoaded(true);
        return;
      }

      setSchemaReady(true);
      setError(rpcError.message ?? "Unable to load onboarding state.");
      setLoading(false);
      setLoaded(true);
      return;
    }

    const row = Array.isArray(data) ? (data[0] as OnboardingStateRow | undefined) : (data as OnboardingStateRow | null);
    setState(normalizeOnboardingState(row));
    setSchemaReady(true);
    setLoading(false);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, loading, loaded, schemaReady, error, refresh };
}
