import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bot, CircleAlert, Compass, LineChart, Send, ShieldAlert, Sparkles } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
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
import { toCompactMoney, toMoney } from "@/lib/royalty";
import {
  clampPercent,
  defaultDateRange,
  parseAssistantResult,
  parseDetail,
  parseNaturalChatPlanResponse,
  parseNaturalChatRunResponse,
  toConfidenceGrade,
} from "@/lib/insights";
import type {
  TrackAssistantResult,
  TrackChatMessage,
  TrackChatUiBlock,
  TrackInsightDetail,
  TrackNaturalChatPlanResponse,
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

const ASSISTANT_PROMPTS: Array<{ id: string; label: string; summary: string }> = [
  {
    id: "growth_fastest",
    label: "Fastest Growth Areas",
    summary: "Which markets are growing fastest for this track?",
  },
  {
    id: "usage_high_payout_low",
    label: "Usage vs Payout Gaps",
    summary: "Where is usage high but payout still low?",
  },
  {
    id: "change_last_90d",
    label: "Last 90 Days Change",
    summary: "How have revenue and quantity shifted recently?",
  },
  {
    id: "quality_risks",
    label: "Quality Risk Overview",
    summary: "What data-quality risks can impact this track?",
  },
];

const CHAT_QUICK_STARTERS = [
  "Who owes me money, and where is payout still hanging?",
  "What changed most in the last 90 days?",
  "Which platform is driving the highest net per unit?",
  "Show concentration risk by territory and platform.",
];

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

function toSafeRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => toSafeRecord(row))
    .filter((row): row is Record<string, unknown> => !!row);
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
  return source;
}

function toChatMessage(role: "user" | "assistant", text: string, uiBlock?: TrackChatUiBlock): TrackChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    created_at: new Date().toISOString(),
    ui_block: uiBlock,
  };
}

function isTechnicalKpiLabel(label: string): boolean {
  return /(row|rows|runtime|duration|ms|query|provenance|source|sql|token)/i.test(label);
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

  const [fromDate, setFromDate] = useState(defaults.fromDate);
  const [toDate, setToDate] = useState(defaults.toDate);
  const [assistantResult, setAssistantResult] = useState<TrackAssistantResult | null>(null);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<TrackChatMessage[]>([]);

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

  const assistantMutation = useMutation({
    mutationFn: async (promptId: string): Promise<TrackAssistantResult | null> => {
      const { data, error } = await supabase.rpc("run_track_assistant_prompt_v1", {
        p_track_key: trackKey,
        p_prompt_id: promptId,
        from_date: fromDate,
        to_date: toDate,
        filters_json: {},
      });
      if (error) throw error;
      return parseAssistantResult(data as Json | null);
    },
    onSuccess: (result, promptId) => {
      setActivePrompt(promptId);
      setAssistantResult(result);
    },
  });

  const chatPlanMutation = useMutation({
    mutationFn: async (question: string): Promise<TrackNaturalChatPlanResponse> => {
      const payload = {
        action: "plan_query",
        track_key: trackKey,
        question,
        from_date: fromDate,
        to_date: toDate,
      };
      const { data, error } = await supabase.functions.invoke("insights-natural-chat", {
        body: payload,
      });

      if (error) {
        const message = await resolveEdgeFunctionError(error, data);
        throw new Error(message);
      }

      const parsed = parseNaturalChatPlanResponse(data);
      if (!parsed) throw new Error("Assistant returned an invalid plan response.");
      return parsed;
    },
    onSuccess: (plan, question) => {
      setChatMessages((prev) => [...prev, toChatMessage("user", question)]);
      setChatInput("");
      chatRunMutation.mutate(plan);
    },
  });

  const chatRunMutation = useMutation({
    mutationFn: async (plan: TrackNaturalChatPlanResponse): Promise<TrackChatUiBlock> => {
      const payload = {
        action: "run_query",
        track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        plan_id: plan.plan_id,
        sql_preview: plan.sql_preview,
        execution_token: plan.execution_token,
      };
      const { data, error } = await supabase.functions.invoke("insights-natural-chat", {
        body: payload,
      });

      if (error) {
        const message = await resolveEdgeFunctionError(error, data);
        throw new Error(message);
      }

      const parsed = parseNaturalChatRunResponse(data);
      if (!parsed) throw new Error("Assistant returned an invalid run response.");
      return parsed;
    },
    onSuccess: (result) => {
      setChatMessages((prev) => [...prev, toChatMessage("assistant", result.answer_text, result)]);
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

  const assistantMetrics = useMemo(
    () => toSafeRecord(assistantResult?.metrics),
    [assistantResult?.metrics]
  );
  const assistantRows = useMemo(
    () => toSafeRows(assistantResult?.rows),
    [assistantResult?.rows]
  );
  const assistantColumns = useMemo(
    () => Array.from(new Set(assistantRows.flatMap((row) => Object.keys(row)))),
    [assistantRows]
  );

  const assistantTakeaway = useMemo(() => {
    if (!assistantResult || assistantResult.error) return null;

    if (activePrompt === "growth_fastest" && assistantRows[0]) {
      const territory = String(assistantRows[0].territory ?? "Unknown");
      const growth = formatAssistantValue("growth_pct", assistantRows[0].growth_pct);
      return `Top growth market is ${territory} at ${growth} in the latest window.`;
    }

    if (activePrompt === "usage_high_payout_low" && assistantRows[0]) {
      const territory = String(assistantRows[0].territory ?? "Unknown");
      const usageShare = formatAssistantValue("usage_share", assistantRows[0].usage_share);
      const payoutShare = formatAssistantValue("payout_share", assistantRows[0].payout_share);
      return `${territory} shows strong usage (${usageShare}) but weaker payout (${payoutShare}).`;
    }

    if (activePrompt === "change_last_90d" && assistantMetrics) {
      const recentNet = asNumber(assistantMetrics.recent_net);
      const priorNet = asNumber(assistantMetrics.prior_net);
      const recentQty = asNumber(assistantMetrics.recent_qty);
      const priorQty = asNumber(assistantMetrics.prior_qty);
      if (recentNet != null && priorNet != null) {
        const netPct = priorNet === 0 ? (recentNet > 0 ? 100 : 0) : ((recentNet - priorNet) / Math.abs(priorNet)) * 100;
        const qtyPct =
          recentQty != null && priorQty != null
            ? priorQty === 0
              ? recentQty > 0
                ? 100
                : 0
              : ((recentQty - priorQty) / Math.abs(priorQty)) * 100
            : null;
        return `Last 90 days net changed by ${netPct.toFixed(1)}%${qtyPct != null ? ` and quantity changed by ${qtyPct.toFixed(1)}%.` : "."}`;
      }
    }

    if (activePrompt === "quality_risks" && assistantMetrics) {
      const criticalTasks = asNumber(assistantMetrics.open_critical_task_count) ?? 0;
      const failedLines = asNumber(assistantMetrics.failed_line_count) ?? 0;
      const avgConfidence = asNumber(assistantMetrics.avg_confidence);
      return `Quality view shows ${Math.round(criticalTasks)} open critical task(s), ${Math.round(failedLines)} failed line(s)${avgConfidence != null ? `, and average confidence of ${avgConfidence.toFixed(1)}%.` : "."}`;
    }

    return assistantResult.summary ?? "Assistant results are ready.";
  }, [activePrompt, assistantMetrics, assistantResult, assistantRows]);

  const activeChatError =
    (chatPlanMutation.error as Error | null)?.message ?? (chatRunMutation.error as Error | null)?.message ?? null;

  const handleSubmitChatQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || chatPlanMutation.isPending || chatRunMutation.isPending) return;
    chatPlanMutation.mutate(trimmed);
  };

  if (!trackKey) {
    return (
      <div className="rhythm-page">
        <p className="text-sm text-muted-foreground">Missing track key.</p>
      </div>
    );
  }

  return (
    <div className="rhythm-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-[0.03em]">Track Command Center</h1>
          <p className="text-sm text-muted-foreground">
            Performance, opportunity, quality evidence, and guided analysis for one track.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/insights">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back To Insights
          </Link>
        </Button>
      </div>

      <Card className="!border-0 border-t border-border bg-transparent">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Scope</CardTitle>
          <div className="grid gap-3 md:grid-cols-4">
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            <Input value={trackKey} readOnly className="font-mono text-xs md:col-span-2" />
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading track details...</p>
      ) : isError ? (
        <p className="text-sm text-destructive">Failed to load: {(error as Error).message}</p>
      ) : !summary ? (
        <p className="text-sm text-muted-foreground">No data for this track in the selected range.</p>
      ) : (
        <>
          <section className="border-y border-foreground py-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <div>
                <p className="text-xs text-muted-foreground">Track</p>
                <p className="text-sm font-semibold truncate">{summary.track_title}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Artist</p>
                <p className="text-sm font-semibold truncate">{summary.artist_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net Revenue</p>
                <p className="font-display text-2xl">{toMoney(summary.net_revenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Quantity</p>
                <p className="font-display text-2xl">{Math.round(summary.quantity ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net / Unit</p>
                <p className="font-display text-2xl">{toMoney(summary.net_per_unit)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Confidence Grade</p>
                <p className="font-display text-2xl">{toConfidenceGrade(summary.avg_confidence)}</p>
              </div>
            </div>
          </section>

          <Card className="!border-0 border-t border-border bg-transparent">
            <CardHeader>
              <CardTitle className="text-base">What Matters Now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Highest earning territory/platform:{" "}
                <span className="font-medium">
                  {topTerritory ? `${topTerritory.territory} (${toMoney(topTerritory.net_revenue)})` : "N/A"}
                </span>{" "}
                /{" "}
                <span className="font-medium">
                  {topPlatform ? `${topPlatform.platform} (${toMoney(topPlatform.net_revenue)})` : "N/A"}
                </span>
              </p>
              <p>
                Recent momentum (last 3M vs prior 3M):{" "}
                <span className={trendPct >= 0 ? "font-medium text-foreground" : "font-medium text-destructive"}>
                  {trendPct.toFixed(1)}%
                </span>
              </p>
              <p>
                Under-monetized area:{" "}
                <span className="font-medium">
                  {underMonetized
                    ? `${underMonetized.territory} (usage ${(underMonetized.usage_share * 100).toFixed(1)}%, payout ${(underMonetized.payout_share * 100).toFixed(1)}%)`
                    : "No territory currently flags high-usage/low-payout in this period."}
                </span>
              </p>
              <p>
                Quality risk:{" "}
                <span className="font-medium">
                  {quality && (quality.open_critical_task_count > 0 || quality.failed_line_count > 0)
                    ? `${quality.open_critical_task_count} open critical task(s), ${quality.failed_line_count} failed line(s).`
                    : "No critical quality blockers currently in scope."}
                </span>
              </p>
            </CardContent>
          </Card>

          <Card className="!border-0 border-t border-border bg-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" />
                Insights Assistant
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">Guided Prompts</p>
                    <p className="text-xs text-muted-foreground">
                      One-click analyses for core publisher decisions.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ASSISTANT_PROMPTS.map((prompt) => (
                      <Button
                        key={prompt.id}
                        variant={activePrompt === prompt.id ? "default" : "outline"}
                        className="justify-start text-left normal-case"
                        onClick={() => assistantMutation.mutate(prompt.id)}
                        disabled={assistantMutation.isPending}
                      >
                        <div>
                          <p className="font-medium">{prompt.label}</p>
                          <p className="text-[11px] opacity-80">{prompt.summary}</p>
                        </div>
                      </Button>
                    ))}
                  </div>

                  {assistantMutation.isPending ? (
                    <p className="text-sm text-muted-foreground">Running guided query...</p>
                  ) : assistantResult ? (
                    <div className="space-y-3 border-t border-black/20 pt-3">
                      <p className="font-display text-lg">{assistantResult.title ?? "Assistant Result"}</p>
                      {assistantResult.summary ? <p className="text-sm">{assistantResult.summary}</p> : null}
                      {assistantTakeaway ? <p className="text-sm font-medium">{assistantTakeaway}</p> : null}
                      {assistantResult.error ? (
                        <p className="text-sm text-destructive">{assistantResult.error}</p>
                      ) : null}
                      {assistantMetrics ? (
                        <div className="grid gap-3 border border-black/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
                          {Object.entries(assistantMetrics).map(([key, value]) => (
                            <div key={key}>
                              <p className="text-[11px] text-muted-foreground">{toAssistantLabel(key)}</p>
                              <p className="font-mono text-sm">{formatAssistantValue(key, value)}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {assistantRows.length > 0 ? (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {assistantColumns.map((column) => (
                                  <TableHead key={column}>{toAssistantLabel(column)}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {assistantRows.map((row, index) => (
                                <TableRow key={index}>
                                  {assistantColumns.map((column) => (
                                    <TableCell key={`${index}-${column}`} className="font-mono">
                                      {formatAssistantValue(column, row[column])}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Choose a guided prompt to run a safe template query against this track.
                    </p>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    <div>
                      <p className="text-sm font-medium">Ask Assistant</p>
                      <p className="text-xs text-muted-foreground">
                        Natural language analysis with charts and supporting evidence.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {CHAT_QUICK_STARTERS.map((starter) => (
                      <Button
                        key={starter}
                        size="sm"
                        variant="outline"
                        className="text-xs normal-case"
                        onClick={() => handleSubmitChatQuestion(starter)}
                        disabled={chatPlanMutation.isPending || chatRunMutation.isPending}
                      >
                        {starter}
                      </Button>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask a track question, for example: Who owes me money, and where is payout still hanging?"
                      className="min-h-[96px]"
                    />
                    <div className="flex justify-end">
                      <Button
                        onClick={() => handleSubmitChatQuestion(chatInput)}
                        disabled={!chatInput.trim() || chatPlanMutation.isPending || chatRunMutation.isPending}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Ask Assistant
                      </Button>
                    </div>
                  </div>

                  {chatPlanMutation.isPending ? (
                    <p className="text-sm text-muted-foreground">Understanding your question...</p>
                  ) : null}
                  {chatRunMutation.isPending ? (
                    <p className="text-sm text-muted-foreground">Analyzing track data...</p>
                  ) : null}
                  {activeChatError ? <p className="text-sm text-destructive">{activeChatError}</p> : null}
                </div>
              </div>

              {chatMessages.length > 0 ? (
                <div className="space-y-4 border-t border-black/20 pt-4">
                  {chatMessages.map((message) => {
                    const ui = message.ui_block;
                    const visibleKpis = (ui?.kpis ?? []).filter((kpi) => !isTechnicalKpiLabel(kpi.label));
                    const chartData = buildChatChartData(ui);
                    return (
                      <div
                        key={message.id}
                        className={message.role === "user" ? "ml-auto max-w-[90%]" : "mr-auto max-w-full"}
                      >
                        <div
                          className={
                            message.role === "user"
                              ? "border border-black/20 bg-primary/10 p-3 text-sm"
                              : "border border-black/20 bg-background p-3 text-sm"
                          }
                        >
                          <p className="mb-1 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                            {message.role === "user" ? "You" : "Assistant"}
                          </p>
                          <p>{message.text}</p>

                          {ui ? (
                            <div className="mt-3 space-y-3 border-t border-black/20 pt-3">
                              <p className="font-display text-lg">{ui.answer_title}</p>
                              {visibleKpis.length > 0 ? (
                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                  {visibleKpis.map((kpi, idx) => (
                                    <div key={`${kpi.label}-${idx}`} className="border border-black/20 p-2">
                                      <p className="text-[11px] text-muted-foreground">{kpi.label}</p>
                                      <p className="font-mono text-sm">{kpi.value}</p>
                                      {kpi.change ? <p className="text-[11px] text-muted-foreground">{kpi.change}</p> : null}
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {ui.table ? (
                                <div className="overflow-x-auto">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        {ui.table.columns.map((col) => (
                                          <TableHead key={col}>{toAssistantLabel(col)}</TableHead>
                                        ))}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {ui.table.rows.map((row, idx) => (
                                        <TableRow key={idx}>
                                          {ui.table!.columns.map((col) => (
                                            <TableCell key={`${idx}-${col}`} className="font-mono">
                                              {formatAssistantValue(col, row[col])}
                                            </TableCell>
                                          ))}
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              ) : null}

                              {ui.chart && ui.chart.type !== "none" && chartData.length > 0 ? (
                                <Card className="!border-0 border-t border-border bg-transparent">
                                  <CardHeader>
                                    <CardTitle className="text-sm">
                                      {ui.chart.title ?? `${toAssistantLabel(ui.chart.y[0])} by ${toAssistantLabel(ui.chart.x)}`}
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <ResponsiveContainer width="100%" height={220}>
                                      {ui.chart.type === "line" ? (
                                        <ComposedChart data={chartData}>
                                          <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                                          <XAxis dataKey={ui.chart.x} tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                                          <YAxis tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                                          <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                                          {ui.chart.y.map((yCol, idx) => (
                                            <Line
                                              key={yCol}
                                              type="monotone"
                                              dataKey={yCol}
                                              stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                                              strokeWidth={2.2}
                                              dot={{
                                                r: 2.5,
                                                strokeWidth: 1,
                                                fill: CHART_COLORS[idx % CHART_COLORS.length],
                                                stroke: "hsl(var(--background))",
                                              }}
                                              activeDot={{ r: 4 }}
                                              connectNulls
                                            />
                                          ))}
                                        </ComposedChart>
                                      ) : (
                                        <BarChart data={chartData}>
                                          <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                                          <XAxis dataKey={ui.chart.x} tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                                          <YAxis tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                                          <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                                          {ui.chart.y.map((yCol, idx) => (
                                            <Bar key={yCol} dataKey={yCol} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                                          ))}
                                        </BarChart>
                                      )}
                                    </ResponsiveContainer>
                                  </CardContent>
                                </Card>
                              ) : null}

                              <p className="text-xs text-muted-foreground">
                                Based on {ui.evidence.row_count.toLocaleString()} matched record(s) from{" "}
                                {ui.evidence.from_date} to {ui.evidence.to_date}.
                                {ui.evidence.provenance.length > 0
                                  ? ` Data sources: ${ui.evidence.provenance.map(toEvidenceSourceLabel).join(", ")}.`
                                  : ""}
                              </p>

                              {ui.follow_up_questions.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {ui.follow_up_questions.map((followUp) => (
                                    <Button
                                      key={followUp}
                                      size="sm"
                                      variant="outline"
                                      className="text-xs normal-case"
                                      onClick={() => handleSubmitChatQuestion(followUp)}
                                      disabled={chatPlanMutation.isPending || chatRunMutation.isPending}
                                    >
                                      {followUp}
                                    </Button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Tabs defaultValue="performance">
            <TabsList className="grid w-full max-w-xl grid-cols-3">
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="opportunity">Opportunity</TabsTrigger>
              <TabsTrigger value="quality">Quality & Evidence</TabsTrigger>
            </TabsList>

            <TabsContent value="performance" className="space-y-6 pt-2">
              <div className="grid gap-6 xl:grid-cols-3">
                <Card className="!border-0 border-t border-border bg-transparent xl:col-span-3">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <LineChart className="h-4 w-4" />
                      Monthly Trend (Net + Quantity)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={monthlyTrend}>
                        <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                        <XAxis dataKey="label" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <YAxis
                          yAxisId="net"
                          tick={CHART_TICK_STYLE}
                          axisLine={CHART_AXIS_STYLE}
                          tickLine={false}
                          tickFormatter={(value: number) => toCompactMoney(value)}
                        />
                        <YAxis
                          yAxisId="qty"
                          orientation="right"
                          tick={CHART_TICK_STYLE}
                          axisLine={CHART_AXIS_STYLE}
                          tickLine={false}
                          tickFormatter={(value: number) => Math.round(value).toLocaleString()}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                          formatter={(value: number, name: string) =>
                            name === "quantity"
                              ? [Math.round(value).toLocaleString(), "Quantity"]
                              : [toMoney(value), "Net Revenue"]
                          }
                        />
                        <Bar
                          yAxisId="net"
                          dataKey="net_revenue"
                          name="Net Revenue"
                          fill="hsl(var(--brand-accent))"
                          fillOpacity={0.42}
                          maxBarSize={28}
                          radius={[2, 2, 0, 0]}
                        />
                        <Line
                          yAxisId="qty"
                          type="monotone"
                          dataKey="quantity"
                          name="Quantity"
                          stroke="hsl(var(--tone-pending))"
                          strokeWidth={2.4}
                          dot={{ r: 2.5, strokeWidth: 1, fill: "hsl(var(--tone-pending))", stroke: "hsl(var(--background))" }}
                          activeDot={{ r: 4 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent">
                  <CardHeader>
                    <CardTitle className="text-base">Revenue by Territory</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={territoryMix.slice(0, 8)} layout="vertical">
                        <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                        <XAxis type="number" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <YAxis dataKey="territory" type="category" width={90} tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <Tooltip formatter={(v: number) => toMoney(v)} contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                        <Bar dataKey="net_revenue" fill="hsl(var(--tone-pending))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent">
                  <CardHeader>
                    <CardTitle className="text-base">Revenue by Platform</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={platformMix.slice(0, 8)} dataKey="net_revenue" nameKey="platform" innerRadius={52} outerRadius={90}>
                          {platformMix.slice(0, 8).map((row, index) => (
                            <Cell key={row.platform} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => toMoney(v)} contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent xl:col-span-3">
                  <CardHeader>
                    <CardTitle className="text-base">Top Territory x Platform</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Territory</TableHead>
                            <TableHead>Platform</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Net/Unit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {matrix.slice(0, 12).map((row, index) => (
                            <TableRow key={`${row.territory}-${row.platform}-${index}`}>
                              <TableCell>{row.territory}</TableCell>
                              <TableCell>{row.platform}</TableCell>
                              <TableCell className="text-right font-mono">{toMoney(row.net_revenue)}</TableCell>
                              <TableCell className="text-right font-mono">{Math.round(row.quantity ?? 0).toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{toMoney(row.net_per_unit)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="opportunity" className="space-y-6 pt-2">
              <div className="grid gap-6 xl:grid-cols-2">
                <Card className="!border-0 border-t border-border bg-transparent">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Compass className="h-4 w-4" />
                      Usage Type Mix
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={usageMix.slice(0, 12)} layout="vertical">
                        <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                        <XAxis type="number" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <YAxis dataKey="usage_type" type="category" width={120} tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <Tooltip formatter={(v: number) => toMoney(v)} contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                        <Bar dataKey="net_revenue" fill="hsl(var(--tone-success))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CircleAlert className="h-4 w-4" />
                      Concentration Risk
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Top Territory Share</p>
                      <p className="font-display text-3xl">{concentration.territoryShare.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">
                        {concentration.territoryRisk ? "Above 45% threshold." : "Within acceptable spread."}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Top Platform Share</p>
                      <p className="font-display text-3xl">{concentration.platformShare.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">
                        {concentration.platformRisk ? "Above 60% threshold." : "Within acceptable spread."}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent xl:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">High Usage / Low Payout</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {detail?.high_usage_low_payout?.length ? (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Territory</TableHead>
                              <TableHead className="text-right">Usage Share</TableHead>
                              <TableHead className="text-right">Payout Share</TableHead>
                              <TableHead className="text-right">Quantity</TableHead>
                              <TableHead className="text-right">Net</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.high_usage_low_payout.map((row) => (
                              <TableRow key={row.territory}>
                                <TableCell>{row.territory}</TableCell>
                                <TableCell className="text-right font-mono">{(row.usage_share * 100).toFixed(1)}%</TableCell>
                                <TableCell className="text-right font-mono">{(row.payout_share * 100).toFixed(1)}%</TableCell>
                                <TableCell className="text-right font-mono">{Math.round(row.quantity ?? 0).toLocaleString()}</TableCell>
                                <TableCell className="text-right font-mono">{toMoney(row.net_revenue)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No high-usage/low-payout territories in this range.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="quality" className="space-y-6 pt-2">
              <div className="grid gap-6 xl:grid-cols-2">
                <Card className="!border-0 border-t border-border bg-transparent">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShieldAlert className="h-4 w-4" />
                      Quality Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Failed Lines</p>
                      <p className="font-display text-3xl">{quality?.failed_line_count ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Open Critical Tasks</p>
                      <p className="font-display text-3xl">{quality?.open_critical_task_count ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Validation (Critical)</p>
                      <p className="font-display text-3xl">{quality?.validation_critical_count ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Confidence</p>
                      <p className="font-display text-3xl">{(quality?.avg_confidence ?? 0).toFixed(1)}%</p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent">
                  <CardHeader>
                    <CardTitle className="text-base">Config / Usage Extraction Mix</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={configMix.slice(0, 10)} layout="vertical">
                        <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                        <XAxis type="number" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <YAxis dataKey="config_type" type="category" width={140} tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                        <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                        <Bar dataKey="row_count" fill="hsl(var(--tone-warning))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent xl:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Extractor Field Coverage</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {coverage.length > 0 ? (
                      coverage.map((row) => (
                        <div key={row.field_name} className="grid grid-cols-12 items-center gap-3 border-b border-black/20 py-2 text-sm">
                          <span className="col-span-4 font-mono text-xs">{row.field_name}</span>
                          <div className="col-span-6 h-2 border border-border bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.max(2, clampPercent(row.coverage_pct))}%` }}
                            />
                          </div>
                          <span className="col-span-2 text-right font-mono text-xs">
                            {row.populated_rows}/{row.total_rows}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No extractor coverage data for this track.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="!border-0 border-t border-border bg-transparent xl:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Provenance (Latest Rows)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>CMO</TableHead>
                            <TableHead>File</TableHead>
                            <TableHead>Territory</TableHead>
                            <TableHead>Platform</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Page/Row</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {provenance.slice(0, 20).map((row, index) => (
                            <TableRow key={`${row.report_id}-${row.source_row_id ?? index}`}>
                              <TableCell>{row.event_date}</TableCell>
                              <TableCell>{row.cmo_name}</TableCell>
                              <TableCell className="max-w-[220px] truncate">{row.file_name}</TableCell>
                              <TableCell>{row.territory}</TableCell>
                              <TableCell>{row.platform}</TableCell>
                              <TableCell className="text-right font-mono">{toMoney(row.net_revenue)}</TableCell>
                              <TableCell className="text-right font-mono">{Math.round(row.quantity ?? 0).toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">
                                {row.source_page ?? "-"} / {row.source_row ?? "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

          </Tabs>
        </>
      )}
    </div>
  );
}
