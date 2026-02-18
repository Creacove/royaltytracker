import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Reports from "@/pages/Reports";
import Transactions from "@/pages/Transactions";
import DataQualityQueue from "@/pages/DataQualityQueue";
import Insights from "@/pages/Insights";
import TrackInsightsDetail from "@/pages/TrackInsightsDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Auth />;

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/insights/:trackKey" element={<TrackInsightsDetail />} />
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
