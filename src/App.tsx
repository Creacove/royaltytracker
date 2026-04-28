import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import { useWorkspaceSubscriptionState } from "@/hooks/useWorkspaceSubscriptionState";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import Company from "@/pages/Company";
import Settings from "@/pages/Settings";
import ActivateWorkspace from "@/pages/ActivateWorkspace";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Reports from "@/pages/Reports";
import RightsSplits from "@/pages/RightsSplits";
import Transactions from "@/pages/Transactions";
import DataQualityQueue from "@/pages/DataQualityQueue";
import AiInsights from "@/pages/AiInsights";
import SnapshotPage from "@/pages/SnapshotPage";
import Onboarding from "@/pages/Onboarding";
import AcceptInvite from "@/pages/AcceptInvite";
import NotFound from "./pages/NotFound";
import { resolveRouteMeta } from "@/lib/route-meta";

const queryClient = new QueryClient();


function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const hashParams = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  const searchParams = new URLSearchParams(location.search);
  // Recovery from Settings page (password reset → /settings?password_reset=1).
  // Note: recovery from the invite page redirects back to /accept-invite which
  // handles itself — we must NOT intercept it here.
  const isRecoveryFlow =
    location.pathname !== "/accept-invite" &&
    (hashParams.get("type") === "recovery" || searchParams.get("password_reset") === "1");
  const {
    state: onboardingState,
    loading: onboardingLoading,
    loaded: onboardingLoaded,
    schemaReady,
    error: onboardingError,
    refresh: refreshOnboardingState,
  } = useOnboardingState(user?.id ?? null);
  const {
    state: subscriptionState,
    loading: subscriptionLoading,
    loaded: subscriptionLoaded,
    schemaReady: subscriptionSchemaReady,
    error: subscriptionError,
    refresh: refreshSubscriptionState,
  } = useWorkspaceSubscriptionState(user?.id ?? null);
  const {
    data: reportCount = 0,
    isLoading: reportCountLoading,
    isError: reportCountErrored,
  } = useQuery({
    queryKey: ["workspace-report-count", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("cmo_reports")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (location.pathname === "/accept-invite") {
    return <AcceptInvite />;
  }

  if (!user) {
    return <Auth />;
  }

  if (!onboardingLoaded || onboardingLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Preparing your workspace...</p>
      </div>
    );
  }

  if (onboardingError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-md border border-border/50 bg-card p-6 text-center">
          <h1 className="font-display text-xl">Workspace Check Failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{onboardingError}</p>
          <Button className="mt-4 w-full" onClick={() => void refreshOnboardingState()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const hasWorkspaceMembership = onboardingState.hasActiveMembership && Boolean(onboardingState.companyId);
  const canManageBilling =
    onboardingState.isPlatformAdmin ||
    onboardingState.activeMembershipRole === "owner" ||
    onboardingState.activeMembershipRole === "admin";
  const activationRoute = location.pathname.startsWith("/activate");
  const enforceSubscriptionGate = hasWorkspaceMembership && !onboardingState.isPlatformAdmin && canManageBilling;

  if (activationRoute && !canManageBilling) {
    return <Navigate to="/" replace />;
  }

  if (enforceSubscriptionGate && (!subscriptionLoaded || subscriptionLoading)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Checking subscription status...</p>
      </div>
    );
  }

  if (enforceSubscriptionGate && subscriptionSchemaReady && subscriptionError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-md border border-border/50 bg-card p-6 text-center">
          <h1 className="font-display text-xl">Billing Check Failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subscriptionError}</p>
          <Button className="mt-4 w-full" onClick={() => void refreshSubscriptionState()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!onboardingState.onboardingComplete && !onboardingState.isPlatformAdmin) {
    if (isRecoveryFlow) {
      // Password reset from Settings — let them through to /settings
      if (location.pathname !== "/settings") {
        return <Navigate to="/settings?password_reset=1" replace />;
      }
    } else if (location.pathname === "/accept-invite") {
      // /accept-invite handles its own onboarding inline — let it through
      return <AcceptInvite />;
    } else if (location.pathname !== "/onboarding") {
      return <Navigate to="/onboarding" replace />;
    }

    if (location.pathname === "/onboarding") {
      return <Onboarding initialState={onboardingState} onCompleted={refreshOnboardingState} />;
    }
  }

  if (!onboardingState.onboardingComplete && onboardingState.isPlatformAdmin) {
    if (location.pathname === "/onboarding") {
      return <Onboarding initialState={onboardingState} onCompleted={refreshOnboardingState} />;
    }

    if (location.pathname !== "/workspace") {
      return <Navigate to="/workspace" replace />;
    }
  }

  if (location.pathname === "/onboarding" && onboardingState.onboardingComplete) {
    return <Navigate to="/" replace />;
  }

  const hasAnyUploads = reportCountErrored ? true : reportCount > 0;
  const isReviewRoute =
    location.pathname === "/review-queue" ||
    location.pathname === "/validation" ||
    location.pathname === "/quality-queue";
  const shouldGateForFirstUpload =
    onboardingState.onboardingComplete &&
    !onboardingState.isPlatformAdmin &&
    !hasAnyUploads &&
    (location.pathname === "/" || isReviewRoute);

  if (
    onboardingState.onboardingComplete &&
    !onboardingState.isPlatformAdmin &&
    !hasAnyUploads &&
    reportCountLoading
  ) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Checking workspace data...</p>
      </div>
    );
  }

  if (shouldGateForFirstUpload) {
    return <Navigate to="/reports" replace />;
  }

  if (enforceSubscriptionGate) {
    const hasResolvedSubscriptionState = subscriptionSchemaReady && Boolean(subscriptionState.companyId);
    const shouldRequireActivation = !hasResolvedSubscriptionState || subscriptionState.needsActivation;

    if (shouldRequireActivation && !activationRoute) {
      return <Navigate to="/activate" replace />;
    }

    if (hasResolvedSubscriptionState && !subscriptionState.needsActivation && activationRoute) {
      return <Navigate to="/" replace />;
    }
  }

  const routeMeta = resolveRouteMeta(location.pathname);

  return (
    <AppLayout
      routeMeta={routeMeta}
      companyName={onboardingState.companyName}
      companyRole={onboardingState.activeMembershipRole}
      isPlatformAdmin={onboardingState.isPlatformAdmin}
      hasAnyUploads={hasAnyUploads}
    >
      <Routes>
        <Route path="/" element={hasAnyUploads ? <Dashboard /> : <Navigate to="/reports" replace />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/rights-splits" element={<RightsSplits />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/ai-insights" element={<AiInsights />} />

        <Route path="/ai-insights/snapshots/track/:trackKey" element={<SnapshotPage scope="track" />} />
        <Route path="/ai-insights/snapshots/artist/:artistKey" element={<SnapshotPage scope="artist" />} />
        <Route path="/insights" element={<Navigate to="/ai-insights" replace />} />
        <Route path="/insights/:trackKey" element={<Navigate to="/ai-insights" replace />} />
        <Route
          path="/activate"
          element={
            <ActivateWorkspace
              onboardingState={onboardingState}
              subscriptionState={subscriptionState}
              refreshSubscriptionState={refreshSubscriptionState}
            />
          }
        />
        <Route
          path="/workspace"
          element={
            <Company
              onboardingState={onboardingState}
              schemaReady={schemaReady}
              onCompanyUpdated={refreshOnboardingState}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <Settings
              userId={user.id}
              userEmail={user.email ?? ""}
              onboardingState={onboardingState}
              onProfileUpdated={refreshOnboardingState}
            />
          }
        />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/company" element={<Navigate to="/workspace" replace />} />
        <Route path="/admin/invites" element={<Navigate to="/workspace" replace />} />
        <Route
          path="/validation"
          element={<Navigate to={hasAnyUploads ? "/review-queue" : "/reports"} replace />}
        />
        <Route
          path="/review-queue"
          element={hasAnyUploads ? <DataQualityQueue /> : <Navigate to="/reports" replace />}
        />
        <Route
          path="/quality-queue"
          element={<Navigate to={hasAnyUploads ? "/review-queue" : "/reports"} replace />}
        />
        <Route path="/analytics" element={<Navigate to="/ai-insights" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
