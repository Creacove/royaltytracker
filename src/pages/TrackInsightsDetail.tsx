import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bot, CircleAlert, Compass, FileDown, LineChart, Loader2, Send, ShieldAlert, Sparkles } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { toCompactMoney, toMoney } from "@/lib/royalty";
import { FilterToolbar, KpiStrip, PageHeader } from "@/components/layout";
import { cn } from "@/lib/utils";
import {
  clampPercent,
  defaultDateRange,
  parseAssistantExportResponseV1,
  parseAssistantTurnResponseV2,
  parseNaturalChatPlanResponse,
  parseNaturalChatRunResponse,
  parseDetail,
  toConfidenceGrade,
} from "@/lib/insights";
import type {
  AssistantTurnResponseV2,
  TrackChatUiBlock,
  TrackInsightDetail,
} from "@/types/insights";

const CHART_COLORS = [
  "hsl(var(--brand-accent))",
  "hsl(var(--tone-pending))",
  "hsl(var(--tone-success))",
  "hsl(var(--tone-info))",
  "hsl(var(--tone-warning))",
  "hsl(var(--tone-archived))",
];

const CHART_TICK_STYLE = {
  fontSize: 10,
  fill: "hsl(0 0% 33%)",
  fontFamily: "var(--font-mono)",
};

const CHART_AXIS_STYLE = {
  stroke: "hsl(0 0% 20%)",
  strokeWidth: 1,
};

const CHART_TOOLTIP_CONTENT_STYLE = {
  backgroundColor: "hsl(44 14% 90%)",
  border: "1px solid hsl(0 0% 9%)",
  borderRadius: 0,
  color: "hsl(0 0% 9%)",
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
};

const CHART_GRID_STYLE = {
  stroke: "hsl(0 0% 20%)",
  strokeDasharray: "2 4",
  strokeOpacity: 0.14,
};

const CHAT_QUICK_STARTERS = [
  "Where is revenue strongest and weakest for this track?",
  "What changed most over the last 90 days?",
  "Which platform has the best and worst revenue per unit?",
  "What data quality blockers could affect payout confidence?",
  "Show anomalies I should review this week.",
];

const ALL_TIME_FROM = "2000-01-01";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateParam(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return ISO_DATE_RE.test(value) ? value : fallback;
}

function toEndOfMonth(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return monthEnd.toISOString().slice(0, 10);
}

type ChartLegendItem = {
  label: string;
  color: string;
  marker?: "swatch" | "line";
};

type ExportResult = {
  pdfUrl?: string;
  xlsxUrl?: string;
  status?: string;
  jobId?: string;
};

type ChartPanelHeaderProps = {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  legend?: ChartLegendItem[];
};

function ChartPanelHeader({ icon, title, subtitle, legend = [] }: ChartPanelHeaderProps) {
  return (
    <header className="mb-4 border-b border-border/25 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="type-display-section flex items-center gap-2 text-sm md:text-base">
            {icon}
            {title}
          </h3>
          {subtitle ? <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {legend.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            {legend.map((item) => (
              <span
                key={item.label}
                className="type-micro inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
              >
                <span
                  className={cn(
                    "shrink-0 rounded-[1px]",
                    item.marker === "line" ? "h-[2px] w-4" : "h-2.5 w-2.5 border border-border/25"
                  )}
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function toMonthlySnapshotRange(anchorDate: string): { fromDate: string; toDate: string } {
  const parsed = new Date(`${anchorDate}T00:00:00`);
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return {
    fromDate: monthStart.toISOString().slice(0, 10),
    toDate: monthEnd.toISOString().slice(0, 10),
  };
}

function toDateLabel(monthStart: string): string {
  const date = new Date(`${monthStart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return monthStart;
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function toAssistantLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatAssistantValue(key: string, value: unknown): string {
  if (value == null) return "-";
  const numeric = asNumber(value);
  if (numeric == null) return String(value);

  const isMoney = /(revenue|net|gross|commission|payout)/i.test(key);
  if (isMoney) return toMoney(numeric);

  const isPercent = /(pct|percent|share|rate|growth)/i.test(key);
  if (isPercent) {
    const normalized = /(share|rate)/i.test(key) && Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
    return `${normalized.toFixed(1)}%`;
  }

  const isCount = /(qty|quantity|count|line|task|row|critical|warning|info)/i.test(key);
  if (isCount) return Math.round(numeric).toLocaleString();

  return Number.isInteger(numeric) ? numeric.toLocaleString() : numeric.toFixed(2);
}

function toSafeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function buildChatChartData(
  uiBlock: TrackChatUiBlock | undefined
): Array<Record<string, string | number | null>> {
  if (!uiBlock?.table || !uiBlock.chart || uiBlock.chart.type === "none") return [];
  const { table, chart } = uiBlock;
  if (!chart.x || chart.y.length === 0) return [];

  const validY = chart.y.filter((col) => table.columns.includes(col));
  if (!table.columns.includes(chart.x) || validY.length === 0) return [];

  return table.rows
    .slice(0, 16)
    .map((row) => {
      const record: Record<string, string | number | null> = { [chart.x]: row[chart.x] ?? null };
      for (const y of validY) {
        const raw = row[y];
        const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
        if (Number.isFinite(numeric)) record[y] = numeric;
      }
      return record;
    })
    .filter((row) => Object.keys(row).length > 1);
}

function toEvidenceSourceLabel(source: string): string {
  if (source === "track_chat_fact_v1") return "Track performance data";
  if (source === "track_quality_v1") return "Quality checks";
  if (source === "track_extractor_coverage_v1") return "Extraction coverage";
  if (source === "track_assistant_scope_v2") return "Reviewed track performance data";
  if (source === "royalty_transactions.custom_properties") return "Custom statement fields";
  return source;
}

function openExportPlaceholder(message: string): Window | null {
  const popup = window.open("", "_blank");
  if (!popup) return null;
  try {
    popup.document.title = "Preparing export...";
    popup.document.body.style.fontFamily = "Arial, sans-serif";
    popup.document.body.style.padding = "16px";
    popup.document.body.innerHTML = `<p>${message}</p>`;
  } catch {
    // Ignore cross-window write failures.
  }
  return popup;
}

function openExportUrl(url: string, pendingWindow: Window | null): void {
  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.location.href = url;
    return;
  }

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.assign(url);
    return;
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) return;

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function resolveEdgeFunctionError(error: unknown, data: unknown): Promise<string> {
  const dataObj = toSafeRecord(data);
  let message =
    (typeof dataObj?.error === "string" && dataObj.error) ||
    (error instanceof Error ? error.message : "Request failed.");

  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const json = (await context.clone().json()) as unknown;
      const jsonObj = toSafeRecord(json);
      if (typeof jsonObj?.error === "string" && jsonObj.error) return jsonObj.error;
      if (typeof jsonObj?.message === "string" && jsonObj.message) return jsonObj.message;
    } catch {
      try {
        const text = await context.clone().text();
        if (text.trim().length > 0) message = text.trim();
      } catch {
        // Keep default message.
      }
    }
  }

  return message;
}

export default function TrackInsightsDetail() {
  const params = useParams<{ trackKey: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const trackKey = decodeURIComponent(params.trackKey ?? "");
  const defaults = defaultDateRange();
  const todayDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [hasExplicitScopeFromUrl] = useState(() => searchParams.has("from") || searchParams.has("to"));
  const initialFromDate = normalizeDateParam(searchParams.get("from"), defaults.fromDate);
  const initialToDate = normalizeDateParam(searchParams.get("to"), defaults.toDate);
  const { toast } = useToast();

  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(initialToDate);
  const [chatInput, setChatInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [latestAnswer, setLatestAnswer] = useState<AssistantTurnResponseV2 | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string>("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [hasAutoAdjustedRange, setHasAutoAdjustedRange] = useState(false);

  const { data: detailData, isLoading, isError, error } = useQuery({
    queryKey: ["track-insight-detail", trackKey, fromDate, toDate],
    enabled: !!trackKey,
    queryFn: async (): Promise<TrackInsightDetail | null> => {
      const { data, error } = await supabase.rpc("get_track_insight_detail_v1", {
        p_track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        filters_json: {},
      });
      if (error) throw error;
      return parseDetail(data as Json | null);
    },
  });
  const assistantTurnMutation = useMutation({
    mutationFn: async (question: string): Promise<AssistantTurnResponseV2> => {
      const v2Payload = {
        action: "send_turn",
        track_key: trackKey,
        question,
        from_date: fromDate,
        to_date: toDate,
        conversation_id: conversationId,
      };
      const { data, error } = await supabase.functions.invoke("insights-natural-chat", {
        body: v2Payload,
      });

      if (!error) {
        const parsed = parseAssistantTurnResponseV2(data);
        if (parsed) return parsed;
        throw new Error("Assistant returned an invalid response.");
      }

      const message = await resolveEdgeFunctionError(error, data);
      if (!/unsupported action/i.test(message)) {
        throw new Error(message);
      }

      const { data: planData, error: planError } = await supabase.functions.invoke("insights-natural-chat", {
        body: {
          action: "plan_query",
          track_key: trackKey,
          question,
          from_date: fromDate,
          to_date: toDate,
        },
      });
      if (planError) {
        const planMessage = await resolveEdgeFunctionError(planError, planData);
        throw new Error(planMessage);
      }
      const plan = parseNaturalChatPlanResponse(planData);
      if (!plan) throw new Error("Assistant planning returned an invalid response.");

      const { data: runData, error: runError } = await supabase.functions.invoke("insights-natural-chat", {
        body: {
          action: "run_query",
          track_key: trackKey,
          from_date: fromDate,
          to_date: toDate,
          plan_id: plan.plan_id,
          sql_preview: plan.sql_preview,
          execution_token: plan.execution_token,
        },
      });
      if (runError) {
        const runMessage = await resolveEdgeFunctionError(runError, runData);
        throw new Error(runMessage);
      }

      const legacy = parseNaturalChatRunResponse(runData);
      if (!legacy) throw new Error("Assistant run response was invalid.");

      return {
        conversation_id: conversationId ?? crypto.randomUUID(),
        answer_title: legacy.answer_title,
        answer_text: legacy.answer_text,
        why_this_matters: "Use this output to choose the next best action for this track.",
        kpis: legacy.kpis,
        table: legacy.table,
        chart: legacy.chart,
        evidence: legacy.evidence,
        follow_up_questions: legacy.follow_up_questions,
      };
    },
    onMutate: (question) => {
      setPendingQuestion(question);
      setChatInput("");
    },
    onSuccess: (result, question) => {
      setLastQuestion(question);
      setConversationId(result.conversation_id);
      setLatestAnswer(result);
    },
    onError: (_error, question) => {
      setChatInput((current) => (current.trim().length > 0 ? current : question));
    },
    onSettled: () => {
      setPendingQuestion(null);
    },
  });

  const exportAnswerMutation = useMutation({
    mutationFn: async (): Promise<ExportResult> => {
      if (!latestAnswer) throw new Error("Ask the AI agent a question before exporting.");
      const payload = {
        action: "export_answer",
        track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        answer_payload: latestAnswer,
      };
      const { data, error } = await supabase.functions.invoke("insights-export-v1", { body: payload });
      if (error) {
        const message = await resolveEdgeFunctionError(error, data);
        throw new Error(message);
      }
      const parsed = parseAssistantExportResponseV1(data);
      if (!parsed) throw new Error("Export service returned an invalid response.");
      return {
        pdfUrl: parsed.pdf_url,
        xlsxUrl: parsed.xlsx_url,
        status: parsed.status,
        jobId: parsed.job_id,
      };
    },
  });

  const exportMonthlyMutation = useMutation({
    mutationFn: async (): Promise<ExportResult> => {
      const monthlyRange = toMonthlySnapshotRange(toDate);
      const payload = {
        action: "export_monthly_snapshot",
        track_key: trackKey,
        from_date: monthlyRange.fromDate,
        to_date: monthlyRange.toDate,
      };
      const { data, error } = await supabase.functions.invoke("insights-export-v1", { body: payload });
      if (error) {
        const message = await resolveEdgeFunctionError(error, data);
        throw new Error(message);
      }
      const parsed = parseAssistantExportResponseV1(data);
      if (!parsed) throw new Error("Monthly export service returned an invalid response.");
      return {
        pdfUrl: parsed.pdf_url,
        xlsxUrl: parsed.xlsx_url,
        status: parsed.status,
        jobId: parsed.job_id,
      };
    },
  });

  const detail = detailData;
  const summary = detail?.summary;

  const { data: lifetimeDetail, isLoading: isLifetimeLoading } = useQuery({
    queryKey: ["track-insight-detail-lifetime", trackKey, todayDate],
    enabled: Boolean(trackKey) && !isLoading && !isError && !summary,
    queryFn: async (): Promise<TrackInsightDetail | null> => {
      const { data, error } = await supabase.rpc("get_track_insight_detail_v1", {
        p_track_key: trackKey,
        from_date: ALL_TIME_FROM,
        to_date: todayDate,
        filters_json: {},
      });
      if (error) throw error;
      return parseDetail(data as Json | null);
    },
  });
  const lifetimeSummary = lifetimeDetail?.summary;
  const lifetimeRange = useMemo(() => {
    const months = lifetimeDetail?.monthly_trend ?? [];
    if (months.length === 0) {
      return { fromDate: ALL_TIME_FROM, toDate: todayDate };
    }
    const first = months[0]?.month_start ?? ALL_TIME_FROM;
    const last = months[months.length - 1]?.month_start ?? todayDate;
    return {
      fromDate: first,
      toDate: toEndOfMonth(last),
    };
  }, [lifetimeDetail, todayDate]);

  useEffect(() => {
    if (hasExplicitScopeFromUrl || hasAutoAdjustedRange) return;
    if (isLoading || isError) return;
    if (summary) {
      setHasAutoAdjustedRange(true);
      return;
    }
    if (isLifetimeLoading) return;

    if (!lifetimeSummary) {
      setHasAutoAdjustedRange(true);
      return;
    }

    if (fromDate === lifetimeRange.fromDate && toDate === lifetimeRange.toDate) {
      setHasAutoAdjustedRange(true);
      return;
    }

    setFromDate(lifetimeRange.fromDate);
    setToDate(lifetimeRange.toDate);
    setHasAutoAdjustedRange(true);
  }, [
    fromDate,
    hasAutoAdjustedRange,
    hasExplicitScopeFromUrl,
    isError,
    isLifetimeLoading,
    isLoading,
    lifetimeRange.fromDate,
    lifetimeRange.toDate,
    lifetimeSummary,
    summary,
    toDate,
  ]);

  const monthlyTrend = useMemo(
    () =>
      (detail?.monthly_trend ?? []).map((row) => ({
        ...row,
        label: toDateLabel(row.month_start),
      })),
    [detail]
  );

  const territoryMix = useMemo(() => detail?.territory_mix ?? [], [detail?.territory_mix]);
  const platformMix = useMemo(() => detail?.platform_mix ?? [], [detail?.platform_mix]);
  const usageMix = useMemo(() => detail?.usage_mix ?? [], [detail?.usage_mix]);
  const matrix = useMemo(() => detail?.territory_platform_matrix ?? [], [detail?.territory_platform_matrix]);
  const coverage = useMemo(() => detail?.extractor_coverage ?? [], [detail?.extractor_coverage]);
  const configMix = useMemo(() => detail?.config_mix ?? [], [detail?.config_mix]);
  const provenance = useMemo(() => detail?.provenance ?? [], [detail?.provenance]);
  const quality = detail?.quality;
  const underMonetized = detail?.high_usage_low_payout?.[0];

  const topTerritory = territoryMix[0];
  const topPlatform = platformMix[0];

  const recent3m = monthlyTrend.slice(-3).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
  const previous3m = monthlyTrend.slice(-6, -3).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
  const trendPct =
    previous3m === 0 ? (recent3m > 0 ? 100 : 0) : ((recent3m - previous3m) / Math.abs(previous3m)) * 100;

  const concentration = useMemo(() => {
    const territoryTotal = territoryMix.reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const platformTotal = platformMix.reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const territoryShare = territoryTotal > 0 ? ((topTerritory?.net_revenue ?? 0) / territoryTotal) * 100 : 0;
    const platformShare = platformTotal > 0 ? ((topPlatform?.net_revenue ?? 0) / platformTotal) * 100 : 0;
    return {
      territoryShare,
      platformShare,
      territoryRisk: territoryShare > 45,
      platformRisk: platformShare > 60,
    };
  }, [platformMix, territoryMix, topPlatform, topTerritory]);
  const activeChatError =
    (assistantTurnMutation.error as Error | null)?.message ??
    (exportAnswerMutation.error as Error | null)?.message ??
    (exportMonthlyMutation.error as Error | null)?.message ??
    null;

  const handleSubmitChatQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || assistantTurnMutation.isPending) return;
    assistantTurnMutation.mutate(trimmed);
  };

  const handleExportAiResponse = async () => {
    if (!latestAnswer || assistantTurnMutation.isPending || exportAnswerMutation.isPending || exportMonthlyMutation.isPending) {
      return;
    }

    const pendingWindow = openExportPlaceholder("Preparing your AI export...");
    try {
      const result = await exportAnswerMutation.mutateAsync();
      const preferredUrl = result.pdfUrl ?? result.xlsxUrl;
      if (preferredUrl) {
        openExportUrl(preferredUrl, pendingWindow);
      } else if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.close();
      }

      toast({
        title: "Export Ready",
        description:
          result.pdfUrl || result.xlsxUrl
            ? "Your AI export is ready."
            : result.status ?? "Export queued.",
      });
    } catch (error) {
      if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unable to generate AI export.",
        variant: "destructive",
      });
    }
  };

  const handleExportMonthlySnapshot = async () => {
    if (assistantTurnMutation.isPending || exportAnswerMutation.isPending || exportMonthlyMutation.isPending) return;

    const pendingWindow = openExportPlaceholder("Preparing your monthly snapshot export...");
    try {
      const result = await exportMonthlyMutation.mutateAsync();
      const preferredUrl = result.pdfUrl ?? result.xlsxUrl;
      if (preferredUrl) {
        openExportUrl(preferredUrl, pendingWindow);
      } else if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.close();
      }

      toast({
        title: "Monthly Snapshot Ready",
        description:
          result.pdfUrl || result.xlsxUrl
            ? "Your monthly snapshot is ready."
            : result.status ?? "Export queued.",
      });
    } catch (error) {
      if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unable to generate monthly snapshot.",
        variant: "destructive",
      });
    }
  };

  const assistantBusy =
    assistantTurnMutation.isPending || exportAnswerMutation.isPending || exportMonthlyMutation.isPending;
  const latestChartData = buildChatChartData(latestAnswer ?? undefined);
  const latestTableColumns = latestAnswer?.table?.columns.slice(0, 6) ?? [];
  const hasAssistantResult = Boolean(latestAnswer);

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("from", fromDate);
      next.set("to", toDate);
      return next;
    }, { replace: true });
  }, [fromDate, toDate, setSearchParams]);

  if (!trackKey) {
    return (
      <div className="rhythm-page">
        <p className="text-sm text-muted-foreground">Missing track key.</p>
      </div>
    );
  }

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        title="Track Insights"
        subtitle={`Track ID: ${trackKey}`}
        actions={
          <Button asChild variant="outline">
            <Link to={`/insights?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to Insights
            </Link>
          </Button>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-5">
        <FilterToolbar
          title="Analysis Context"
          description="AI responses and exports use this active date scope."
          sticky
          className="p-3 md:p-4"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
            <div className="space-y-1 xl:col-span-2">
              <p className="type-nav text-xs text-muted-foreground">From</p>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1 xl:col-span-2">
              <p className="type-nav text-xs text-muted-foreground">To</p>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-5">
              <p className="type-nav text-xs text-muted-foreground">Active Scope</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center border border-border/40 bg-background/75 px-2 py-1 text-[11px] text-muted-foreground">
                  {fromDate} to {toDate}
                </span>
                {summary?.track_title ? (
                  <span
                    className="inline-flex max-w-[240px] truncate items-center border border-border/35 bg-background/70 px-2 py-1 text-[11px]"
                    title={summary.track_title}
                  >
                    {summary.track_title}
                  </span>
                ) : null}
                {summary?.artist_name ? (
                  <span className="inline-flex items-center border border-border/35 bg-background/70 px-2 py-1 text-[11px]">
                    {summary.artist_name}
                  </span>
                ) : null}
                {summary?.avg_confidence != null ? (
                  <span className="inline-flex items-center border border-border/35 bg-background/70 px-2 py-1 text-[11px]">
                    Confidence {toConfidenceGrade(summary.avg_confidence)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="md:col-span-2 xl:col-span-3 flex items-end justify-start xl:justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportMonthlySnapshot}
                disabled={assistantBusy}
                className="w-full sm:w-auto"
              >
                <FileDown className="mr-1.5 h-3 w-3" />
                Monthly Snapshot
              </Button>
            </div>
          </div>
        </FilterToolbar>


        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">Loading track details...</p>
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-destructive">Failed to load: {(error as Error).message}</p>
            </CardContent>
          </Card>
        ) : !summary ? (
          <Card>
            <CardContent className="space-y-3 p-6">
              <p className="text-sm text-muted-foreground">No data for this track in the selected range ({fromDate} to {toDate}).</p>
              {isLifetimeLoading ? (
                <p className="text-xs text-muted-foreground">Checking track lifetime availability...</p>
              ) : lifetimeSummary ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFromDate(lifetimeRange.fromDate);
                      setToDate(lifetimeRange.toDate);
                    }}
                  >
                    Use available lifetime range
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Available window: {lifetimeRange.fromDate} to {lifetimeRange.toDate}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No data found for this track even when checking full history.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Decision Assistant */}
            <section className="min-w-0 rounded-sm border border-[hsl(var(--brand-accent))]/35 bg-[hsl(var(--brand-accent-ghost))]/45 p-4 md:p-5">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center border border-[hsl(var(--brand-accent))]/35 bg-background/70">
                      <Bot className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
                    </div>
                    <div>
                      <h2 className="type-display-section text-lg md:text-xl">Track AI Agent</h2>
                      <p className="text-xs text-muted-foreground">
                        Ask performance, risk, and market questions for this track.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportAiResponse}
                    disabled={!latestAnswer || assistantBusy}
                    className="border-[hsl(var(--brand-accent))]/30 bg-background/80"
                  >
                    <FileDown className="mr-1.5 h-3 w-3" />
                    Export AI Response
                  </Button>
                </div>

                <div className={cn("grid min-w-0 gap-4", hasAssistantResult && "xl:grid-cols-12")}>
                  <div className={cn("min-w-0 space-y-3", hasAssistantResult ? "xl:col-span-8" : "xl:col-span-12")}>
                    <div className="space-y-3 rounded-sm border border-border/45 bg-background/75 p-4">
                  <label className="type-nav text-xs text-muted-foreground">Ask the AI agent about this track</label>
                  <Textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about revenue trends, payout risk, market opportunity, or data quality for this track."
                    className="min-h-[110px] bg-background"
                  />
                  <div className="flex flex-wrap gap-2">
                    {CHAT_QUICK_STARTERS.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="ghost"
                        className="h-auto border border-border/45 bg-background/80 px-2 py-1 text-left text-[11px] normal-case tracking-normal whitespace-normal transition-colors hover:bg-muted/40"
                        onClick={() => handleSubmitChatQuestion(s)}
                        disabled={assistantBusy}
                      >
                        {s}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center justify-end">
                    <Button
                      onClick={() => handleSubmitChatQuestion(chatInput)}
                      disabled={!chatInput.trim() || assistantBusy}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Ask AI Agent
                    </Button>
                  </div>
                    </div>

                {activeChatError && (
                  <div className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-3">
                    <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
                    <p className="text-xs text-destructive">{activeChatError}</p>
                  </div>
                )}

                {latestAnswer && assistantTurnMutation.isPending && (
                  <div className="flex items-start gap-2 border border-[hsl(var(--brand-accent))]/35 bg-[hsl(var(--brand-accent-ghost))]/45 p-3">
                    <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-[hsl(var(--brand-accent))]" />
                    <div className="min-w-0">
                      <p className="type-nav text-xs text-[hsl(var(--brand-accent))]">Analyzing next question</p>
                      <p className="truncate text-xs text-muted-foreground" title={pendingQuestion ?? undefined}>
                        {pendingQuestion ?? "Working on your latest prompt..."}
                      </p>
                    </div>
                  </div>
                )}

                {!latestAnswer && !assistantTurnMutation.isPending && (
                      <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 border border-border/40 bg-background/70 p-6 text-center">
                        <Sparkles className="h-7 w-7 text-[hsl(var(--brand-accent))]" />
                        <p className="type-display-section text-sm">Start a conversation with the AI agent</p>
                        <p className="max-w-lg text-xs text-muted-foreground">
                          Responses, charts, and evidence will appear in this workspace.
                        </p>
                      </div>
                    )}

                    {!latestAnswer && assistantTurnMutation.isPending && (
                      <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 border border-border/40 bg-background/70 p-6 text-center">
                        <p className="type-display-section text-sm">AI agent is analyzing...</p>
                        <p className="text-xs text-muted-foreground">
                          Reviewing performance, market, and quality data.
                        </p>
                      </div>
                    )}

                    {latestAnswer && (
                  <div
                    className={cn(
                      "space-y-4 rounded-sm border border-border/40 bg-background/75 p-4 transition-opacity",
                      assistantTurnMutation.isPending && "opacity-65"
                    )}
                  >
                    <div className="space-y-2">
                          {lastQuestion && (
                            <p className="text-xs text-muted-foreground">
                              <span className="type-nav">Your question:</span> {lastQuestion}
                            </p>
                          )}
                          <h3 className="type-display-section text-xl leading-tight md:text-2xl">{latestAnswer.answer_title}</h3>
                      <p className="text-sm leading-relaxed">{latestAnswer.answer_text}</p>
                    </div>

                    {latestAnswer.why_this_matters && (
                      <div className="border border-border/35 bg-background/60 p-3">
                        <p className="type-micro mb-1 text-[10px] text-muted-foreground">Business impact</p>
                        <p className="text-xs leading-relaxed">{latestAnswer.why_this_matters}</p>
                      </div>
                    )}

                    {latestAnswer.chart && latestAnswer.chart.type !== "none" && latestChartData.length > 0 && (
                      <div className="border border-border/35 bg-background/60 p-3">
                        <p className="type-micro mb-2 text-[10px] text-muted-foreground">
                          {latestAnswer.chart.title ?? "AI response chart"}
                        </p>
                        <ResponsiveContainer width="100%" height={220}>
                          {latestAnswer.chart.type === "line" ? (
                            <ComposedChart data={latestChartData}>
                              <CartesianGrid {...CHART_GRID_STYLE} vertical={false} />
                              <XAxis
                                dataKey={latestAnswer.chart.x}
                                tick={CHART_TICK_STYLE}
                                axisLine={CHART_AXIS_STYLE}
                                tickLine={false}
                              />
                              <YAxis tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                              <Tooltip
                                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                                formatter={(value: number | string, name: string) => [
                                  formatAssistantValue(name, value),
                                  toAssistantLabel(name),
                                ]}
                              />
                              {latestAnswer.chart.y.map((column, idx) => (
                                <Line
                                  key={column}
                                  type="monotone"
                                  dataKey={column}
                                  name={toAssistantLabel(column)}
                                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                                  strokeWidth={2}
                                  dot={{ r: 2 }}
                                  activeDot={{ r: 3 }}
                                />
                              ))}
                            </ComposedChart>
                          ) : (
                            <BarChart data={latestChartData}>
                              <CartesianGrid {...CHART_GRID_STYLE} vertical={false} />
                              <XAxis
                                dataKey={latestAnswer.chart.x}
                                tick={CHART_TICK_STYLE}
                                axisLine={CHART_AXIS_STYLE}
                                tickLine={false}
                              />
                              <YAxis tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                              <Tooltip
                                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                                formatter={(value: number | string, name: string) => [
                                  formatAssistantValue(name, value),
                                  toAssistantLabel(name),
                                ]}
                              />
                              {latestAnswer.chart.y.map((column, idx) => (
                                <Bar
                                  key={column}
                                  dataKey={column}
                                  name={toAssistantLabel(column)}
                                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                                  fillOpacity={0.7}
                                />
                              ))}
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    )}

                    {latestAnswer.table && latestTableColumns.length > 0 && (
                      <div className="border border-border/35 bg-background/60 p-3">
                        <p className="type-micro mb-2 text-[10px] text-muted-foreground">AI query result preview</p>
                        <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                          <Table className="min-w-[680px] text-[11px]">
                            <TableHeader className="bg-muted/30">
                              <TableRow>
                                {latestTableColumns.map((column) => (
                                  <TableHead key={column}>{toAssistantLabel(column)}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {latestAnswer.table.rows.slice(0, 6).map((row, rowIdx) => (
                                <TableRow key={rowIdx}>
                                  {latestTableColumns.map((column) => (
                                    <TableCell key={column}>{formatAssistantValue(column, row[column])}</TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="type-micro text-[10px] text-muted-foreground">
                        Data evidence - {latestAnswer.evidence.row_count.toLocaleString()} rows -{" "}
                        {latestAnswer.evidence.duration_ms.toLocaleString()}ms
                      </p>
                      {latestAnswer.evidence.provenance.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {latestAnswer.evidence.provenance.slice(0, 6).map((source, idx) => (
                            <span
                              key={`${source}-${idx}`}
                              className="inline-flex items-center border border-border/35 bg-background/60 px-2 py-1 text-[10px] text-muted-foreground"
                            >
                              {toEvidenceSourceLabel(source)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                )}

                  </div>

                  {hasAssistantResult ? (
                    <aside className="min-w-0 space-y-3 xl:col-span-4 xl:sticky xl:top-24 xl:self-start">
                      <div className="rounded-sm border border-border/40 bg-background/75 p-4">
                        <p className="type-micro text-[10px] text-muted-foreground">AI context</p>
                        <div className="mt-2 space-y-2 text-xs">
                          <div className="flex items-start justify-between gap-3 border-b border-border/25 pb-2">
                            <span className="text-muted-foreground">Track</span>
                            <span className="max-w-[160px] text-right font-medium" title={summary.track_title ?? "-"}>
                              {summary.track_title ?? "-"}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3 border-b border-border/25 pb-2">
                            <span className="text-muted-foreground">Artist</span>
                            <span className="max-w-[160px] text-right font-medium">{summary.artist_name ?? "-"}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3 border-b border-border/25 pb-2">
                            <span className="text-muted-foreground">Net revenue</span>
                            <span className="font-medium">{toCompactMoney(summary.net_revenue)}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3 border-b border-border/25 pb-2">
                            <span className="text-muted-foreground">Data confidence</span>
                            <span className="font-medium">{toConfidenceGrade(summary.avg_confidence)}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-muted-foreground">Range</span>
                            <span className="font-mono text-[10px]">{fromDate} to {toDate}</span>
                          </div>
                        </div>
                      </div>

                      {latestAnswer?.kpis.length ? (
                        <div className="rounded-sm border border-border/40 bg-background/75 p-4">
                          <p className="type-micro mb-2 text-[10px] text-muted-foreground">AI key signals</p>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                            {latestAnswer.kpis.map((kpi, idx) => (
                              <div key={idx} className="min-h-[80px] border border-border/35 bg-background/60 p-2.5">
                                <p className="type-micro text-[10px] text-muted-foreground">{kpi.label}</p>
                                <p className="type-display-section text-base [overflow-wrap:anywhere]">{kpi.value}</p>
                                {kpi.change ? <p className="text-[10px] text-muted-foreground">{kpi.change}</p> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {latestAnswer?.follow_up_questions.length ? (
                        <div className="rounded-sm border border-border/40 bg-background/75 p-4">
                          <p className="type-micro mb-2 text-[10px] text-muted-foreground">Next questions</p>
                          <div className="flex flex-wrap gap-2">
                            {latestAnswer.follow_up_questions.map((q) => (
                              <Button
                                key={q}
                                size="sm"
                                variant="ghost"
                                className="h-auto border border-border/45 bg-background/80 px-2 py-1 text-left text-[11px] normal-case tracking-normal whitespace-normal transition-colors hover:bg-muted/40"
                                onClick={() => handleSubmitChatQuestion(q)}
                                disabled={assistantBusy}
                              >
                                {q}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </aside>
                  ) : null}
                </div>
              </div>
            </section>

            <KpiStrip
              items={[
                {
                  label: "Track",
                  value: (
                    <span className="block truncate" title={summary.track_title ?? "-"}>
                      {summary.track_title ?? "-"}
                    </span>
                  ),
                },
                {
                  label: "Artist",
                  value: (
                    <span className="block truncate" title={summary.artist_name ?? "-"}>
                      {summary.artist_name ?? "-"}
                    </span>
                  ),
                },
                { label: "Net Revenue", value: toCompactMoney(summary.net_revenue) },
                { label: "Units", value: Math.round(summary.quantity ?? 0).toLocaleString() },
                { label: "Revenue / Unit", value: toCompactMoney(summary.net_per_unit) },
                { label: "Data Confidence", value: toConfidenceGrade(summary.avg_confidence) },
              ]}
              columnsClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
              className="py-3"
            />

            {/* EXPLORER TABS */}
            <Tabs defaultValue="performance" className="w-full min-w-0">
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-sm border border-border/40 bg-background/70 p-1">
                <TabsTrigger className="text-[11px] md:text-xs" value="performance">Performance</TabsTrigger>
                <TabsTrigger className="text-[11px] md:text-xs" value="opportunity">Opportunities</TabsTrigger>
                <TabsTrigger className="text-[11px] md:text-xs" value="quality">Data Quality</TabsTrigger>
              </TabsList>

              <TabsContent value="performance" className="space-y-6">
                <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-12">
                  <div className="min-w-0 xl:col-span-8 bg-background/70 border border-border/35 p-4 md:p-5">
                    <ChartPanelHeader
                      icon={<LineChart className="h-4 w-4" />}
                      title="Monthly Revenue and Units"
                      subtitle="Reporting-currency net revenue and unit volume across the selected date range."
                      legend={[
                        { label: "Net Revenue", color: CHART_COLORS[0], marker: "swatch" },
                        { label: "Units", color: CHART_COLORS[2], marker: "line" },
                      ]}
                    />
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={monthlyTrend}>
                        <CartesianGrid {...CHART_GRID_STYLE} vertical={false} />
                        <XAxis dataKey="label" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <YAxis yAxisId="net" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} tickFormatter={(v) => toCompactMoney(v)} />
                        <YAxis yAxisId="qty" orientation="right" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} tickFormatter={(v) => Math.round(v).toLocaleString()} allowDecimals={false} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          formatter={(v: number, n: string) => n === "quantity" ? [Math.round(v).toLocaleString(), "Units"] : [toMoney(v), "Net Revenue"]}
                        />
                        <Bar
                          yAxisId="net"
                          dataKey="net_revenue"
                          name="Net Revenue"
                          fill={CHART_COLORS[0]}
                          fillOpacity={0.45}
                          maxBarSize={32}
                        />
                        <Line
                          yAxisId="qty"
                          type="stepAfter"
                          dataKey="quantity"
                          name="Units"
                          stroke={CHART_COLORS[2]}
                          strokeWidth={2}
                          dot={{ r: 1.5, fill: CHART_COLORS[2] }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="min-w-0 xl:col-span-4 flex flex-col gap-6">
                    <div className="min-w-0 bg-background/70 border border-border/35 p-4 flex-1">
                      <h3 className="type-display-section mb-4 text-sm">Executive Summary</h3>
                      <div className="space-y-4 text-xs">
                        <div className="flex justify-between items-baseline border-b border-border/25 pb-2">
                          <span className="type-micro text-[10px] text-muted-foreground">90-day momentum</span>
                          <span className={`font-bold ${trendPct >= 0 ? "text-[hsl(var(--tone-success))]" : "text-destructive"}`}>{trendPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-baseline border-b border-border/25 pb-2">
                          <span className="type-micro text-[10px] text-muted-foreground">Top territory</span>
                          <span className="font-bold">{topTerritory?.territory ?? 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-baseline border-b border-border/25 pb-2">
                          <span className="type-micro text-[10px] text-muted-foreground">Top platform</span>
                          <span className="font-bold">{topPlatform?.platform ?? 'N/A'}</span>
                        </div>
                        <p className="text-[10px] leading-relaxed opacity-70 mt-4">
                          {summary.track_title} is {trendPct >= 0 ? "growing" : "softening"} across key markets.
                          Data confidence is {toConfidenceGrade(summary.avg_confidence)}.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 bg-background/70 border border-border/35 overflow-hidden">
                  <div className="bg-secondary/60 p-2 border-b border-border/35">
                    <h3 className="type-display-section text-center text-xs">Territory and Platform Breakdown</h3>
                  </div>
                  <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                    <Table className="min-w-[680px] text-[11px]">
                      <TableHeader className="bg-muted/30 font-mono text-[10px] uppercase">
                        <TableRow>
                          <TableHead className="rounded-none">Territory</TableHead>
                          <TableHead>Platform</TableHead>
                          <TableHead className="text-right">Net Revenue</TableHead>
                          <TableHead className="text-right">Units</TableHead>
                          <TableHead className="text-right bg-muted/20">Revenue/Unit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {matrix.slice(0, 15).map((row, index) => (
                          <TableRow key={index} className="hover:bg-muted/20">
                            <TableCell className="font-medium">{row.territory}</TableCell>
                            <TableCell>{row.platform}</TableCell>
                            <TableCell className="text-right font-mono">{toMoney(row.net_revenue)}</TableCell>
                            <TableCell className="text-right font-mono">{Math.round(row.quantity ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono">{toMoney(row.net_per_unit)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="opportunity" className="space-y-6">
                <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
                  <div className="min-w-0 bg-background/70 border border-border/35 p-4 md:p-5">
                    <ChartPanelHeader
                      icon={<Compass className="h-4 w-4" />}
                      title="Revenue by Usage Type"
                      subtitle="Identify which usage classes carry the strongest contribution."
                      legend={[{ label: "Net Revenue", color: CHART_COLORS[1], marker: "swatch" }]}
                    />
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={usageMix.slice(0, 12)} layout="vertical">
                        <CartesianGrid {...CHART_GRID_STYLE} vertical={false} />
                        <XAxis type="number" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <YAxis dataKey="usage_type" type="category" width={110} tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <Tooltip formatter={(v: number) => toMoney(v)} contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                        <Bar dataKey="net_revenue" fill={CHART_COLORS[1]} fillOpacity={0.75} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="min-w-0 bg-background/70 border border-border/35 p-4">
                    <h3 className="type-display-section mb-6 flex items-center gap-2 text-sm">
                      <CircleAlert className="h-4 w-4" />
                      Concentration Risk
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="border border-border/35 bg-background/60 p-4">
                        <p className="type-micro mb-1 text-[10px] text-muted-foreground">Top Territory Share</p>
                        <p className="type-display-section text-[clamp(1.7rem,3.2vw,2.2rem)] whitespace-nowrap">{concentration.territoryShare.toFixed(1)}%</p>
                        <div className={`h-1 w-full mt-3 ${concentration.territoryRisk ? "bg-destructive" : "bg-[hsl(var(--tone-success))]"}`} />
                        <p className="text-[10px] mt-2 text-muted-foreground">
                          {concentration.territoryRisk ? "High concentration" : "Healthy spread"}
                        </p>
                      </div>
                      <div className="border border-border/35 bg-background/60 p-4">
                        <p className="type-micro mb-1 text-[10px] text-muted-foreground">Top Platform Share</p>
                        <p className="type-display-section text-[clamp(1.7rem,3.2vw,2.2rem)] whitespace-nowrap">{concentration.platformShare.toFixed(1)}%</p>
                        <div className={`h-1 w-full mt-3 ${concentration.platformRisk ? "bg-destructive" : "bg-[hsl(var(--tone-success))]"}`} />
                        <p className="text-[10px] mt-2 text-muted-foreground">
                          {concentration.platformRisk ? "High concentration" : "Healthy spread"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-6 space-y-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="font-semibold">Monetization alert:</span> {underMonetized
                          ? `The market in ${underMonetized.territory} accounts for ${(underMonetized.usage_share * 100).toFixed(1)}% of total usage but only yields ${(underMonetized.payout_share * 100).toFixed(1)}% of payout.`
                          : "Monetization is currently aligned with usage volume across all primary territories."}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0 xl:col-span-2 bg-background/70 border border-border/35 p-4">
                    <h3 className="type-display-section mb-4 text-sm">Under-Monetized Territories</h3>
                    <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                      <Table className="min-w-[760px] text-[11px]">
                        <TableHeader className="bg-muted/30 font-mono text-[10px] uppercase">
                          <TableRow>
                            <TableHead>Territory</TableHead>
                            <TableHead className="text-right">Usage Share</TableHead>
                            <TableHead className="text-right">Payout Share</TableHead>
                            <TableHead className="text-right">Yield Gap</TableHead>
                            <TableHead className="text-right">Units</TableHead>
                            <TableHead className="text-right">Net Revenue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(detail?.high_usage_low_payout ?? []).map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{row.territory}</TableCell>
                              <TableCell className="text-right font-mono">{(row.usage_share * 100).toFixed(1)}%</TableCell>
                              <TableCell className="text-right font-mono">{(row.payout_share * 100).toFixed(1)}%</TableCell>
                              <TableCell className="text-right font-mono text-destructive">-{((row.usage_share - row.payout_share) * 100).toFixed(1)}%</TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">{Math.round(row.quantity ?? 0).toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{toMoney(row.net_revenue)}</TableCell>
                            </TableRow>
                          ))}
                          {(!detail?.high_usage_low_payout || detail.high_usage_low_payout.length === 0) && (
                            <TableRow>
                              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground italic">No yield gaps currently identified.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="quality" className="space-y-6">
                <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
                  <div className="min-w-0 bg-background/70 border border-border/35 p-4">
                    <h3 className="type-display-section mb-6 flex items-center gap-2 text-sm">
                      <ShieldAlert className="h-4 w-4" />
                      Data Quality Overview
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {[
                        { label: "Failed Lines", val: quality?.failed_line_count ?? 0 },
                        { label: "Critical Tasks", val: quality?.open_critical_task_count ?? 0 },
                        { label: "Validation Errors", val: quality?.validation_critical_count ?? 0 },
                        { label: "Data Confidence", val: `${(quality?.avg_confidence ?? 0).toFixed(1)}%` }
                      ].map((m, i) => (
                        <div key={i} className="border border-border/35 bg-background/60 p-4">
                          <p className="type-micro mb-1 text-[9px] text-muted-foreground">{m.label}</p>
                          <p className="type-display-section text-[clamp(1.45rem,2.7vw,1.95rem)] whitespace-nowrap">{m.val}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0 bg-background/70 border border-border/35 p-4 md:p-5">
                    <ChartPanelHeader
                      title="Extraction Coverage by Type"
                      subtitle="Row coverage by extractor configuration family."
                      legend={[{ label: "Rows", color: CHART_COLORS[3], marker: "swatch" }]}
                    />
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={configMix.slice(0, 10)} layout="vertical">
                        <CartesianGrid {...CHART_GRID_STYLE} vertical={false} />
                        <XAxis type="number" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <YAxis dataKey="config_type" type="category" width={140} tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                        <Bar dataKey="row_count" fill={CHART_COLORS[3]} fillOpacity={0.75} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="min-w-0 xl:col-span-2 bg-background/70 border border-border/35 p-4">
                    <h3 className="type-display-section mb-6 text-sm">Field Coverage</h3>
                    <div className="space-y-4">
                      {coverage.map((row) => (
                        <div key={row.field_name} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                          <span className="type-micro w-full text-[10px] sm:w-40 sm:truncate">{row.field_name}</span>
                          <div className="h-3 w-full flex-1 border border-border/35 bg-muted overflow-hidden">
                            <div
                              className="h-full bg-[hsl(var(--brand-accent))]"
                              style={{ width: `${clampPercent(row.coverage_pct)}%` }}
                            />
                          </div>
                          <span className="w-full font-mono text-[10px] font-semibold sm:w-24 sm:text-right">
                            {row.populated_rows} / {row.total_rows}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0 xl:col-span-2 bg-background/70 border border-border/35">
                    <div className="bg-secondary/60 p-2 border-b border-border/35">
                      <h3 className="type-display-section text-center text-xs">Data Provenance</h3>
                    </div>
                    <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                      <Table className="min-w-[840px] text-[10px]">
                        <TableHeader className="bg-muted/30 font-mono text-[9px] uppercase">
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>CMO Source</TableHead>
                            <TableHead>File Signature</TableHead>
                            <TableHead>Territory</TableHead>
                            <TableHead>Platform</TableHead>
                            <TableHead className="text-right">Revenue</TableHead>
                            <TableHead className="text-right">Ref</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {provenance.slice(0, 20).map((row, i) => (
                            <TableRow key={i} className="hover:bg-muted/20">
                              <TableCell className="font-bold whitespace-nowrap">{row.event_date}</TableCell>
                              <TableCell>{row.cmo_name}</TableCell>
                              <TableCell className="max-w-[180px] truncate opacity-60">{row.file_name}</TableCell>
                              <TableCell>{row.territory}</TableCell>
                              <TableCell>{row.platform}</TableCell>
                              <TableCell className="text-right font-mono">{toMoney(row.net_revenue)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{row.source_page}/{row.source_row}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
