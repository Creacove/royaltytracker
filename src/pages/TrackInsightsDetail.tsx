import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bot, CircleAlert, Compass, FileDown, LineChart, Send, ShieldAlert, Sparkles } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { toCompactMoney, toMoney } from "@/lib/royalty";
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
  fontFamily: '"Courier New", monospace',
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
  fontFamily: '"Courier New", monospace',
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
  const trackKey = decodeURIComponent(params.trackKey ?? "");
  const defaults = defaultDateRange();
  const { toast } = useToast();

  const [fromDate, setFromDate] = useState(defaults.fromDate);
  const [toDate, setToDate] = useState(defaults.toDate);
  const [chatInput, setChatInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [latestAnswer, setLatestAnswer] = useState<AssistantTurnResponseV2 | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string>("");

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
    onSuccess: (result, question) => {
      setLastQuestion(question);
      setConversationId(result.conversation_id);
      setLatestAnswer(result);
      setChatInput("");
    },
  });

  const exportAnswerMutation = useMutation({
    mutationFn: async (): Promise<{ pdfUrl?: string; xlsxUrl?: string; status?: string; jobId?: string }> => {
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
    onSuccess: (result) => {
      if (result.pdfUrl) window.open(result.pdfUrl, "_blank", "noopener,noreferrer");
      if (result.xlsxUrl) window.open(result.xlsxUrl, "_blank", "noopener,noreferrer");
      toast({
        title: "Export Ready",
        description: result.pdfUrl || result.xlsxUrl ? "PDF and XLSX export generated." : result.status ?? "Export queued.",
      });
    },
  });

  const exportMonthlyMutation = useMutation({
    mutationFn: async (): Promise<{ pdfUrl?: string; xlsxUrl?: string; status?: string; jobId?: string }> => {
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
    onSuccess: (result) => {
      if (result.pdfUrl) window.open(result.pdfUrl, "_blank", "noopener,noreferrer");
      if (result.xlsxUrl) window.open(result.xlsxUrl, "_blank", "noopener,noreferrer");
      toast({
        title: "Monthly Snapshot Ready",
        description: result.pdfUrl || result.xlsxUrl ? "Monthly PDF and XLSX generated." : result.status ?? "Export queued.",
      });
    },
  });

  const detail = detailData;
  const summary = detail?.summary;

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

  const assistantBusy =
    assistantTurnMutation.isPending || exportAnswerMutation.isPending || exportMonthlyMutation.isPending;
  const latestChartData = buildChatChartData(latestAnswer ?? undefined);
  const latestTableColumns = latestAnswer?.table?.columns.slice(0, 6) ?? [];

  if (!trackKey) {
    return (
      <div className="rhythm-page">
        <p className="text-sm text-muted-foreground">Missing track key.</p>
      </div>
    );
  }

  return (
    <div className="rhythm-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-[0.03em] leading-none mb-1">Track Insights</h1>
          <p className="text-sm text-muted-foreground">
            Track ID: <span className="font-mono text-xs">{trackKey}</span>
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/insights">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Insights
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="border-y border-border">
          <CardHeader className="space-y-3 pb-4">
            <CardTitle className="text-base">Date Range</CardTitle>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1">
                <p className="text-xs font-mono uppercase text-muted-foreground">From</p>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-mono uppercase text-muted-foreground">To</p>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2 xl:col-span-3 flex items-end justify-start xl:justify-end">
                <Button size="sm" variant="outline" onClick={() => exportMonthlyMutation.mutate()} disabled={assistantBusy}>
                  <FileDown className="mr-1.5 h-3 w-3" />
                  Monthly Snapshot
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Reporting window: {fromDate} to {toDate}
            </p>
          </CardHeader>
        </Card>


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
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">No data for this track in the selected range.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {[
                { label: "Track", val: summary.track_title },
                { label: "Artist", val: summary.artist_name },
                { label: "Net Revenue", val: toMoney(summary.net_revenue) },
                { label: "Units", val: Math.round(summary.quantity ?? 0).toLocaleString() },
                { label: "Revenue / Unit", val: toMoney(summary.net_per_unit) },
                { label: "Data Confidence", val: toConfidenceGrade(summary.avg_confidence) },
              ].map((m, i) => (
                <div key={i} className="border border-border/35 p-4 bg-background/70">
                  <p className="text-[10px] font-mono uppercase font-bold text-muted-foreground mb-1">{m.label}</p>
                  <p className={`font-display ${m.label.includes("Revenue") ? "text-2xl" : "text-sm"} leading-none tracking-tight`}>{m.val}</p>
                </div>
              ))}
            </div>

            {/* Decision Assistant */}
            <section className="border border-[hsl(var(--brand-accent))]/30 bg-[hsl(var(--brand-accent-ghost))]/45 p-6">
              <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center border border-[hsl(var(--brand-accent))]/35 bg-background/70">
                      <Bot className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg leading-none">Track AI Agent</h2>
                      <p className="text-xs text-muted-foreground">
                        Chat with the AI agent about this track for the selected date range.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => exportAnswerMutation.mutate()}
                    disabled={!latestAnswer || assistantBusy}
                    className="border-[hsl(var(--brand-accent))]/30 bg-background/80"
                  >
                    <FileDown className="mr-1.5 h-3 w-3" />
                    Export AI Response
                  </Button>
                </div>

                <div className="space-y-3 border border-border/40 bg-background/70 p-4">
                  <label className="text-xs font-mono uppercase text-muted-foreground">Ask the AI agent about this track</label>
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
                        className="h-auto border border-border/40 bg-background/70 px-2 py-1 text-left text-[11px] normal-case tracking-normal whitespace-normal"
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

                {!latestAnswer && !assistantTurnMutation.isPending && (
                  <div className="flex flex-col items-center justify-center gap-2 border border-border/40 bg-background/70 p-6 text-center">
                    <Sparkles className="h-7 w-7 text-[hsl(var(--brand-accent))]" />
                    <p className="font-display text-sm">Start a conversation with the AI agent</p>
                    <p className="max-w-lg text-xs text-muted-foreground">
                      Responses, charts, and data evidence will appear below.
                    </p>
                  </div>
                )}

                {assistantTurnMutation.isPending && (
                  <div className="flex flex-col items-center justify-center gap-2 border border-border/40 bg-background/70 p-6 text-center">
                    <p className="font-display text-sm">AI agent is analyzing...</p>
                    <p className="text-xs text-muted-foreground">
                      Reviewing performance, market, and quality data.
                    </p>
                  </div>
                )}

                {latestAnswer && (
                  <div className="space-y-4 border border-border/40 bg-background/70 p-4">
                    <div className="space-y-2">
                          {lastQuestion && (
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono uppercase">Your question:</span> {lastQuestion}
                            </p>
                          )}
                      <h3 className="font-display text-2xl leading-tight">{latestAnswer.answer_title}</h3>
                      <p className="text-sm leading-relaxed">{latestAnswer.answer_text}</p>
                    </div>

                    {latestAnswer.kpis.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {latestAnswer.kpis.map((kpi, idx) => (
                          <div key={idx} className="border border-border/35 bg-background/60 p-3">
                            <p className="text-[10px] font-mono uppercase text-muted-foreground">{kpi.label}</p>
                            <p className="font-display text-lg leading-tight">{kpi.value}</p>
                            {kpi.change && <p className="text-[10px] text-muted-foreground">{kpi.change}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {latestAnswer.why_this_matters && (
                      <div className="border border-border/35 bg-background/60 p-3">
                        <p className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">Business impact</p>
                        <p className="text-xs leading-relaxed">{latestAnswer.why_this_matters}</p>
                      </div>
                    )}

                    {latestAnswer.chart && latestAnswer.chart.type !== "none" && latestChartData.length > 0 && (
                      <div className="border border-border/35 bg-background/60 p-3">
                        <p className="mb-2 text-[10px] font-mono uppercase text-muted-foreground">
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
                        <p className="mb-2 text-[10px] font-mono uppercase text-muted-foreground">AI query result preview</p>
                        <div className="overflow-x-auto">
                          <Table className="text-[11px]">
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
                      <p className="text-[10px] font-mono uppercase text-muted-foreground">
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

                    {latestAnswer.follow_up_questions.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {latestAnswer.follow_up_questions.map((q) => (
                          <Button
                            key={q}
                            size="sm"
                            variant="ghost"
                            className="h-auto border border-border/40 bg-background/70 px-2 py-1 text-[11px] normal-case tracking-normal whitespace-normal"
                            onClick={() => handleSubmitChatQuestion(q)}
                            disabled={assistantBusy}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* EXPLORER TABS */}
            <Tabs defaultValue="performance" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="opportunity">Opportunities</TabsTrigger>
                <TabsTrigger value="quality">Data Quality</TabsTrigger>
              </TabsList>

              <TabsContent value="performance" className="space-y-8">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                  <div className="xl:col-span-8 bg-background/70 border border-border/35 p-4">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-display text-lg uppercase flex items-center gap-2">
                        <LineChart className="h-4 w-4" />
                        Monthly Revenue and Units
                      </h3>
                    </div>
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

                  <div className="xl:col-span-4 flex flex-col gap-6">
                    <div className="bg-background/70 border border-border/35 p-4 flex-1">
                      <h3 className="font-display text-sm uppercase mb-4">Executive Summary</h3>
                      <div className="space-y-4 text-xs">
                        <div className="flex justify-between items-baseline border-b border-border/25 pb-2">
                          <span className="text-muted-foreground uppercase font-mono text-[10px]">90-day momentum</span>
                          <span className={`font-bold ${trendPct >= 0 ? "text-[hsl(var(--tone-success))]" : "text-destructive"}`}>{trendPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-baseline border-b border-border/25 pb-2">
                          <span className="text-muted-foreground uppercase font-mono text-[10px]">Top territory</span>
                          <span className="font-bold">{topTerritory?.territory ?? 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-baseline border-b border-border/25 pb-2">
                          <span className="text-muted-foreground uppercase font-mono text-[10px]">Top platform</span>
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

                <div className="bg-background/70 border border-border/35 overflow-hidden">
                  <div className="bg-secondary/60 p-2 border-b border-border/35">
                    <h3 className="font-display text-xs uppercase text-center">Territory and Platform Breakdown</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="text-[11px]">
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

              <TabsContent value="opportunity" className="space-y-8">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                  <div className="bg-background/70 border border-border/35 p-4">
                    <h3 className="font-display text-sm uppercase mb-6 flex items-center gap-2">
                      <Compass className="h-4 w-4" />
                      Revenue by Usage Type
                    </h3>
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

                  <div className="bg-background/70 border border-border/35 p-4">
                    <h3 className="font-display text-sm uppercase mb-6 flex items-center gap-2">
                      <CircleAlert className="h-4 w-4" />
                      Concentration Risk
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="border border-border/35 bg-background/60 p-4">
                        <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Top Territory Share</p>
                        <p className="font-display text-4xl leading-none">{concentration.territoryShare.toFixed(1)}%</p>
                        <div className={`h-1 w-full mt-3 ${concentration.territoryRisk ? "bg-destructive" : "bg-[hsl(var(--tone-success))]"}`} />
                        <p className="text-[10px] mt-2 text-muted-foreground">
                          {concentration.territoryRisk ? "High concentration" : "Healthy spread"}
                        </p>
                      </div>
                      <div className="border border-border/35 bg-background/60 p-4">
                        <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Top Platform Share</p>
                        <p className="font-display text-4xl leading-none">{concentration.platformShare.toFixed(1)}%</p>
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

                  <div className="xl:col-span-2 bg-background/70 border border-border/35 p-4">
                    <h3 className="font-display text-sm uppercase mb-4">Under-Monetized Territories</h3>
                    <div className="overflow-x-auto">
                      <Table className="text-[11px]">
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

              <TabsContent value="quality" className="space-y-8">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                  <div className="bg-background/70 border border-border/35 p-4">
                    <h3 className="font-display text-sm uppercase mb-6 flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4" />
                      Data Quality Overview
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: "Failed Lines", val: quality?.failed_line_count ?? 0 },
                        { label: "Critical Tasks", val: quality?.open_critical_task_count ?? 0 },
                        { label: "Validation Errors", val: quality?.validation_critical_count ?? 0 },
                        { label: "Data Confidence", val: `${(quality?.avg_confidence ?? 0).toFixed(1)}%` }
                      ].map((m, i) => (
                        <div key={i} className="border border-border/35 bg-background/60 p-4">
                          <p className="text-[9px] font-mono uppercase text-muted-foreground mb-1">{m.label}</p>
                          <p className="font-display text-3xl leading-none">{m.val}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-background/70 border border-border/35 p-4">
                    <h3 className="font-display text-sm uppercase mb-6">Extraction Coverage by Type</h3>
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

                  <div className="xl:col-span-2 bg-background/70 border border-border/35 p-4">
                    <h3 className="font-display text-sm uppercase mb-6">Field Coverage</h3>
                    <div className="space-y-4">
                      {coverage.map((row) => (
                        <div key={row.field_name} className="flex items-center gap-4">
                          <span className="w-40 font-mono text-[10px] uppercase font-bold truncate">{row.field_name}</span>
                          <div className="flex-1 h-3 border border-border/35 bg-muted overflow-hidden">
                            <div
                              className="h-full bg-[hsl(var(--brand-accent))]"
                              style={{ width: `${clampPercent(row.coverage_pct)}%` }}
                            />
                          </div>
                          <span className="w-24 text-right font-mono text-[10px] font-bold">
                            {row.populated_rows} / {row.total_rows}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="xl:col-span-2 bg-background/70 border border-border/35">
                    <div className="bg-secondary/60 p-2 border-b border-border/35">
                      <h3 className="font-display text-xs uppercase text-center">Data Provenance</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <Table className="text-[10px]">
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
