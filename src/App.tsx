import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import Company from "@/pages/Company";
import Settings from "@/pages/Settings";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Reports from "@/pages/Reports";
import Transactions from "@/pages/Transactions";
import DataQualityQueue from "@/pages/DataQualityQueue";
import Insights from "@/pages/Insights";
import TrackInsightsDetail from "@/pages/TrackInsightsDetail";
import Onboarding from "@/pages/Onboarding";
import NotFound from "./pages/NotFound";
import { resolveRouteMeta } from "@/lib/route-meta";

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const {
    state: onboardingState,
    loading: onboardingLoading,
    loaded: onboardingLoaded,
    schemaReady,
    error: onboardingError,
    refresh: refreshOnboardingState,
  } = useOnboardingState(user?.id ?? null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Auth />;

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

  const canManageInvites =
    onboardingState.isPlatformAdmin ||
    onboardingState.activeMembershipRole === "owner" ||
    onboardingState.activeMembershipRole === "admin";

  if (!onboardingState.onboardingComplete && !onboardingState.isPlatformAdmin) {
    if (location.pathname !== "/onboarding") {
      return <Navigate to="/onboarding" replace />;
    }

    return <Onboarding initialState={onboardingState} onCompleted={refreshOnboardingState} />;
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

  const routeMeta = resolveRouteMeta(location.pathname);

  return (
    <AppLayout
      routeMeta={routeMeta}
      companyName={onboardingState.companyName}
      companyRole={onboardingState.activeMembershipRole}
      isPlatformAdmin={onboardingState.isPlatformAdmin}
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/insights/:trackKey" element={<TrackInsightsDetail />} />
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
        <Route path="/company" element={<Navigate to="/workspace" replace />} />
        <Route path="/admin/invites" element={<Navigate to="/workspace" replace />} />
        <Route path="/validation" element={<Navigate to="/transactions?view=issues" replace />} />
        <Route path="/review-queue" element={<DataQualityQueue />} />
        <Route path="/quality-queue" element={<Navigate to="/review-queue" replace />} />
        <Route path="/analytics" element={<Navigate to="/insights" replace />} />
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
