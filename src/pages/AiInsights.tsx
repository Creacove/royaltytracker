import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowUpRight,
  MoveHorizontal,
  CalendarRange,
  Copy,
  Lightbulb,
  ListChecks,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  User,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { defaultDateRange } from "@/lib/insights";
import { toMoney } from "@/lib/royalty";
import type {
  AiInsightsAnswerBlock,
  AiInsightsEntityContext,
  AiInsightsMode,
  AiInsightsTurnRequest,
  AiInsightsTurnResponse,
  TrackInsightListRow,
} from "@/types/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiAnswerView } from "@/components/insights/AiAnswerView";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "hsl(var(--brand-accent))",
  "hsl(var(--tone-pending))",
  "hsl(var(--tone-success))",
  "hsl(var(--tone-info))",
  "hsl(var(--tone-warning))",
];

type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  payload?: AiInsightsTurnResponse;
};

function toSafeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function resolveFunctionError(error: unknown, data: unknown): Promise<string> {
  const dataObj = toSafeRecord(data);
  let message =
    (typeof dataObj?.error === "string" && dataObj.error) ||
    (error instanceof Error ? error.message : "Request failed.");

  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as unknown;
      const obj = toSafeRecord(payload);
      if (typeof obj?.detail === "string" && typeof obj?.error === "string") {
        return `${obj.error} (${obj.detail})`;
      }
      if (typeof obj?.error === "string") return obj.error;
      if (typeof obj?.message === "string") return obj.message;
    } catch {
      try {
        const text = await context.clone().text();
        if (text.trim().length > 0) message = text.trim();
      } catch {
        // Keep fallback message.
      }
    }
  }

  return message;
}

function modeLabel(mode: AiInsightsMode): string {
  if (mode === "track") return "Track";
  if (mode === "artist") return "Artist";
  return "Workspace";
}

function formatEvidenceConfidence(confidence: string): string {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  return "Low confidence";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toAssistantLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAssistantValue(key: string, value: unknown): string {
  if (value == null) return "-";
  const numeric = toNumber(value);
  if (numeric == null) return String(value);

  const isMoney = /(revenue|net|gross|commission|payout|amount)/i.test(key);
  if (isMoney) return toMoney(numeric);

  const isPercent = /(pct|percent|share|rate|growth|trend)/i.test(key);
  if (isPercent) {
    const normalized = /(share|rate)/i.test(key) && Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
    return `${normalized.toFixed(1)}%`;
  }

  const isCount = /(qty|quantity|count|line|task|row|critical|warning|info|units?)/i.test(key);
  if (isCount) return Math.round(numeric).toLocaleString();

  return Number.isInteger(numeric) ? numeric.toLocaleString() : numeric.toFixed(2);
}

function normalizeArtistKey(artistName: string): string {
  const normalized = artistName.trim().toLowerCase().replace(/\s+/g, " ");
  return `artist:${normalized || "unknown artist"}`;
}

function getContextLabel(entityContext: AiInsightsEntityContext): string {
  if (entityContext.track_title) return `Scope: ${entityContext.track_title}`;
  if (entityContext.track_key) return `Scope: ${entityContext.track_key}`;
  if (entityContext.artist_name) return `CONTEXT: ${entityContext.artist_name}`;
  return "Scope: Workspace";
}

function formatDateWindow(fromDate: string, toDate: string): string {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return `${fromDate} - ${toDate}`;
  }

  return `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;
}

function formatTurnTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "HH:mm");
}

function activeScopeTitle(entityContext: AiInsightsEntityContext): string {
  if (entityContext.track_title) return entityContext.track_title;
  if (entityContext.track_key) return entityContext.track_key;
  if (entityContext.artist_name) return entityContext.artist_name;
  return "Workspace";
}

function activeScopeDescriptor(entityContext: AiInsightsEntityContext): string {
  if (entityContext.track_key) return "Track scope";
  if (entityContext.artist_name) return "Artist scope";
  return "Workspace scope";
}

function formatCompactMetric(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const prefix = value < 0 ? "-$" : "$";
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return toMoney(value);
}

function formatTrendDelta(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Flat";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function trendToneClass(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.7)] text-muted-foreground";
  }
  if (value > 0) {
    return "border-[hsl(var(--tone-success)/0.18)] bg-[hsl(var(--tone-success)/0.12)] text-[hsl(var(--tone-success))]";
  }
  if (value < 0) {
    return "border-[hsl(var(--tone-critical)/0.18)] bg-[hsl(var(--tone-critical)/0.12)] text-[hsl(var(--tone-critical))]";
  }
  return "border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.7)] text-muted-foreground";
}

function confidenceToneClass(confidence: string | undefined): string {
  if (confidence === "high") {
    return "border-[hsl(var(--tone-success)/0.2)] bg-[hsl(var(--tone-success)/0.12)] text-[hsl(var(--tone-success))]";
  }
  if (confidence === "medium") {
    return "border-[hsl(var(--tone-warning)/0.2)] bg-[hsl(var(--tone-warning)/0.12)] text-[hsl(var(--tone-warning))]";
  }
  return "border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.75)] text-muted-foreground";
}

function axisLabel(value: string | number): string {
  const text = String(value ?? "");
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

function createTurn(
  role: ConversationTurn["role"],
  text: string,
  payload?: AiInsightsTurnResponse,
): ConversationTurn {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
    payload,
  };
}

function toFallbackBlocks(payload: AiInsightsTurnResponse): AiInsightsAnswerBlock[] {
  const blocks: AiInsightsAnswerBlock[] = [];

  if (
    payload.visual?.type === "table" &&
    Array.isArray(payload.visual.columns) &&
    Array.isArray(payload.visual.rows) &&
    payload.visual.columns.length > 0 &&
    payload.visual.rows.length > 0
  ) {
    blocks.push({
      id: "fallback-table",
      type: "table",
      priority: 30,
      source: "workspace_data",
      title: payload.visual.title ?? "Table",
      payload: {
        columns: payload.visual.columns,
        rows: payload.visual.rows,
      },
    });
  }

  if (
    (payload.visual?.type === "bar" || payload.visual?.type === "line") &&
    typeof payload.visual.x === "string" &&
    Array.isArray(payload.visual.y) &&
    Array.isArray(payload.visual.rows) &&
    payload.visual.y.length > 0 &&
    payload.visual.rows.length > 0
  ) {
    blocks.push({
      id: "fallback-visual",
      type: payload.visual.type === "bar" ? "bar_chart" : "line_chart",
      priority: 32,
      source: "workspace_data",
      title: payload.visual.title ?? "Chart",
      payload: {
        x: payload.visual.x,
        y: payload.visual.y,
        rows: payload.visual.rows,
      },
    });
  }

  if (Array.isArray(payload.recommendations) && payload.recommendations.length > 0) {
    blocks.push({
      id: "fallback-recommendations",
      type: "recommendations",
      priority: 40,
      source: "workspace_data",
      title: "Recommendations",
      payload: {
        items: payload.recommendations,
      },
    });
  }

  if (Array.isArray(payload.citations) && payload.citations.length > 0) {
    blocks.push({
      id: "fallback-citations",
      type: "citations",
      priority: 70,
      source: "workspace_data",
      title: "Sources",
      payload: {
        items: payload.citations,
      },
    });
  }

  return blocks;
}

function blockItems(block: AiInsightsAnswerBlock): Record<string, unknown>[] {
  const items = (block.payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function blockText(block: AiInsightsAnswerBlock, key = "text"): string | null {
  const value = (block.payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

type RecommendationMeta = { label: string; value: string; tone?: "neutral" | "good" | "caution" };
type RecommendationCardModel = {
  title: string;
  body?: string;
  bullets: string[];
  meta: RecommendationMeta[];
  cta?: { label: string; href: string };
};

function toLabelCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeRecommendationItem(item: Record<string, unknown>, idx: number): RecommendationCardModel {
  const title =
    (typeof item.title === "string" && item.title.trim()) ||
    (typeof item.action === "string" && item.action.trim()) ||
    (typeof item.label === "string" && item.label.trim()) ||
    `Recommendation ${idx + 1}`;

  const bodyCandidate =
    (typeof item.summary === "string" && item.summary.trim()) ||
    (typeof item.rationale === "string" && item.rationale.trim()) ||
    (typeof item.reason === "string" && item.reason.trim()) ||
    (typeof item.why === "string" && item.why.trim()) ||
    "";

  const bullets: string[] = [];
  const pushArray = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const row of value) {
      if (typeof row === "string" && row.trim().length > 0) bullets.push(row.trim());
    }
  };
  pushArray(item.steps);
  pushArray(item.next_steps);
  pushArray(item.checklist);
  if (typeof item.action === "string" && item.action.trim().length > 0 && item.action.trim() !== title) {
    bullets.push(item.action.trim());
  }

  const meta: RecommendationMeta[] = [];
  const impact = typeof item.impact === "string" ? item.impact.trim() : "";
  const risk = typeof item.risk === "string" ? item.risk.trim() : "";
  const timeline = typeof item.timeline === "string" ? item.timeline.trim() : "";
  const owner = typeof item.owner === "string" ? item.owner.trim() : "";
  if (impact) meta.push({ label: "Impact", value: impact, tone: "good" });
  if (risk) meta.push({ label: "Risk", value: risk, tone: "caution" });
  if (timeline) meta.push({ label: "Timeline", value: timeline, tone: "neutral" });
  if (owner) meta.push({ label: "Owner", value: owner, tone: "neutral" });

  const knownKeys = new Set([
    "action",
    "title",
    "label",
    "rationale",
    "reason",
    "why",
    "summary",
    "impact",
    "risk",
    "timeline",
    "owner",
    "steps",
    "next_steps",
    "checklist",
    "href",
    "url",
    "cta_label",
  ]);
  for (const [key, value] of Object.entries(item)) {
    if (knownKeys.has(key)) continue;
    if (typeof value === "string" && value.trim().length > 0) {
      bullets.push(`${toLabelCase(key)}: ${value.trim()}`);
    }
  }

  const href =
    (typeof item.href === "string" && item.href.trim()) ||
    (typeof item.url === "string" && item.url.trim()) ||
    "";
  const ctaLabel = (typeof item.cta_label === "string" && item.cta_label.trim()) || "Open";
  const cta = href ? { label: ctaLabel, href } : undefined;

  return {
    title,
    body: bodyCandidate || undefined,
    bullets: Array.from(new Set(bullets)).slice(0, 6),
    meta,
    cta,
  };
}

function AdaptiveAnswerStack({
  payload,
  onUseQuestion,
}: {
  payload: AiInsightsTurnResponse;
  onUseQuestion: (question: string) => void;
}) {
  const responseBlocks = Array.isArray(payload.answer_blocks) ? [...payload.answer_blocks] : [];
  const fallbackBlocks = responseBlocks.length === 0 ? toFallbackBlocks(payload) : [];
  const blocks = [...responseBlocks, ...fallbackBlocks].sort((a, b) => a.priority - b.priority);
  if (blocks.length === 0) return <LegacyAnswerView payload={payload} />;

  const leadBlock = blocks.find((block) => block.type === "direct_answer");
  const summaryBlock = blocks.find((block) => block.type === "deep_summary");
  const kpiBlock = blocks.find((block) => block.type === "kpi_strip");
  const leadTitle =
    (leadBlock && typeof leadBlock.payload.title === "string" && leadBlock.payload.title) ||
    payload.answer_title ||
    "AI Brief";
  const leadText = (leadBlock && blockText(leadBlock)) || payload.executive_answer;
  const summaryText = (summaryBlock && blockText(summaryBlock)) || payload.why_this_matters;
  const kpiItems =
    kpiBlock && blockItems(kpiBlock).length > 0
      ? blockItems(kpiBlock).slice(0, 6).map((item, idx) => ({
          label: typeof item.label === "string" ? item.label : `Metric ${idx + 1}`,
          value:
            typeof item.value === "string" || typeof item.value === "number"
              ? String(item.value)
              : "-",
        }))
      : (payload.kpis || []).slice(0, 6).map((kpi) => ({ label: kpi.label, value: kpi.value }));
  return (
    <div className="w-full min-w-0 flex-1 space-y-5">
      <section className="surface-hero forensic-frame spotlight-border relative min-w-0 overflow-hidden rounded-[calc(var(--radius)-2px)] p-5 md:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_left,hsl(var(--brand-accent)/0.22),transparent_62%)]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-28 w-28 translate-x-8 translate-y-8 rounded-full bg-[hsl(var(--brand-accent-ghost)/0.8)] blur-3xl" />
        <div className="relative min-w-0 space-y-5">
          <div className="grid min-w-0 gap-4">
            <div className="min-w-0 space-y-5">
              <div className="min-w-0 space-y-3">
                <h3 className="type-display-section w-full break-words text-[clamp(2rem,2.3vw+1.1rem,3.2rem)] leading-[0.98] tracking-tight text-foreground [overflow-wrap:anywhere]">
                  {leadTitle}
                </h3>
                <p className="w-full break-words text-[15px] leading-7 text-foreground/82 [overflow-wrap:anywhere]">
                  {leadText}
                </p>
              </div>

              {kpiItems.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {kpiItems.map((item) => (
                    <div key={item.label} className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                      <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-2 font-mono text-[1.05rem] font-semibold tracking-tight text-foreground">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="min-w-0 space-y-3">
              <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                <p className="text-[10px] font-ui uppercase tracking-[0.16em] text-muted-foreground">
                  Current scope
                </p>
                <p className="mt-2 break-words text-lg font-semibold tracking-tight text-foreground">
                  {activeScopeTitle(payload.resolved_entities || {})}
                </p>
                <p className="mt-1 break-words text-xs uppercase tracking-[0.14em] text-[hsl(var(--brand-accent))] [overflow-wrap:anywhere]">
                  {modeLabel(payload.resolved_mode)} scope • {payload.evidence ? formatDateWindow(payload.evidence.from_date, payload.evidence.to_date) : "No date range"}
                </p>
              </div>

              <div className="surface-intelligence forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                <div className="flex items-center gap-2 text-[10px] font-ui uppercase tracking-[0.16em] text-[hsl(var(--brand-accent))]">
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span>What matters</span>
                </div>
                <p className="mt-3 break-words text-sm leading-6 text-foreground/80 [overflow-wrap:anywhere]">
                  {summaryText}
                </p>
              </div>

            </div>
          </div>

          {payload.clarification ? (
            <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] border-[hsl(var(--tone-warning)/0.18)] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.16em] text-[hsl(var(--tone-warning))]">
                Clarification needed
              </p>
              <p className="mt-2 text-sm leading-6 text-foreground">{payload.clarification.question}</p>
              {payload.clarification.options?.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {payload.clarification.options.map((option) => (
                    <Button key={option} size="sm" variant="outline" onClick={() => onUseQuestion(option)}>
                      {option}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {blocks.map((block) => {
        if (block.type === "direct_answer") {
          return null;
        }

        if (block.type === "deep_summary") {
          return null;
        }

        if (block.type === "kpi_strip") {
          return null;
        }

        if (block.type === "table") {
          const columns = ((block.payload as { columns?: unknown }).columns ?? []) as string[];
          const rows = ((block.payload as { rows?: unknown }).rows ?? []) as Array<Record<string, string | number | null>>;
          if (!Array.isArray(columns) || !Array.isArray(rows) || columns.length === 0 || rows.length === 0) return null;
          return (
            <Card key={block.id} surface="evidence">
              <CardHeader className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border)/0.1)] pb-4">
                <CardTitle className="min-w-0 break-words text-[1rem]">{block.title ?? "Evidence Table"}</CardTitle>
                <Badge variant="outline" className="border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.7)] font-mono text-[9px] uppercase tracking-[0.16em]">
                  {rows.length} rows
                </Badge>
              </CardHeader>
              <CardContent className="min-w-0 space-y-3">
                <div className="mx-auto min-w-0 w-full max-w-[56rem] space-y-2">
                  <Table
                    variant="evidence"
                    density="compact"
                    style={{ minWidth: `${Math.max(560, columns.length * 128)}px` }}
                  >
                    <TableHeader>
                      <TableRow>
                        {columns.map((column) => (
                          <TableHead key={column}>{toAssistantLabel(column)}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 12).map((row, rIdx) => (
                        <TableRow key={`${block.id}-${rIdx}`}>
                          {columns.map((column) => (
                            <TableCell
                              key={`${block.id}-${rIdx}-${column}`}
                              className="whitespace-nowrap font-mono text-[11px]"
                            >
                              {formatAssistantValue(column, row[column])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {columns.length > 4 ? (
                    <div className="flex items-center justify-end gap-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground md:hidden">
                      <MoveHorizontal className="h-3 w-3" />
                      <span>Swipe</span>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        }

        if (block.type === "bar_chart" || block.type === "line_chart") {
          const x = typeof (block.payload as { x?: unknown }).x === "string" ? (block.payload as { x: string }).x : "";
          const y = ((block.payload as { y?: unknown }).y ?? []) as string[];
          const rows = ((block.payload as { rows?: unknown }).rows ?? []) as Array<Record<string, string | number | null>>;
          if (!x || !Array.isArray(y) || y.length === 0 || !Array.isArray(rows) || rows.length === 0) return null;
          return (
            <Card key={block.id} surface="evidence">
              <CardHeader className="gap-3 border-b border-[hsl(var(--border)/0.1)] pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-[1rem]">{block.title ?? "Evidence Chart"}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {y.map((column, idx) => (
                      <span
                        key={`${block.id}-${column}`}
                        className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.7)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                        />
                        {toAssistantLabel(column)}
                      </span>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="h-[280px] w-full md:h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    {block.type === "bar_chart" ? (
                      <BarChart data={rows} margin={{ top: 12, right: 12, left: -10, bottom: 4 }}>
                        <CartesianGrid
                          stroke="hsl(var(--border))"
                          strokeDasharray="3 5"
                          vertical={false}
                          opacity={0.28}
                        />
                        <XAxis
                          dataKey={x}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: "var(--font-mono)" }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={18}
                          tickFormatter={axisLabel}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: "var(--font-mono)" }}
                          tickLine={false}
                          axisLine={false}
                          width={60}
                          tickFormatter={(value: number) => formatCompactMetric(Number(value))}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: "18px",
                            border: "1px solid hsl(var(--border))",
                            backgroundColor: "hsl(var(--surface-elevated))",
                            boxShadow: "0 24px 60px -40px rgba(0,0,0,0.28)",
                          }}
                          labelStyle={{
                            color: "hsl(var(--foreground))",
                            fontFamily: "var(--font-display)",
                            fontSize: "11px",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                          itemStyle={{ color: "hsl(var(--foreground))", fontFamily: "var(--font-mono)", fontSize: "11px" }}
                        />
                        {y.map((column, idx) => (
                          <Bar
                            key={`${block.id}-${column}`}
                            dataKey={column}
                            fill={CHART_COLORS[idx % CHART_COLORS.length]}
                            radius={[8, 8, 2, 2]}
                            maxBarSize={34}
                          />
                        ))}
                      </BarChart>
                    ) : (
                      <LineChart data={rows} margin={{ top: 12, right: 12, left: -10, bottom: 4 }}>
                        <CartesianGrid
                          stroke="hsl(var(--border))"
                          strokeDasharray="3 5"
                          vertical={false}
                          opacity={0.28}
                        />
                        <XAxis
                          dataKey={x}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: "var(--font-mono)" }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={18}
                          tickFormatter={axisLabel}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: "var(--font-mono)" }}
                          tickLine={false}
                          axisLine={false}
                          width={60}
                          tickFormatter={(value: number) => formatCompactMetric(Number(value))}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: "18px",
                            border: "1px solid hsl(var(--border))",
                            backgroundColor: "hsl(var(--surface-elevated))",
                            boxShadow: "0 24px 60px -40px rgba(0,0,0,0.28)",
                          }}
                          labelStyle={{
                            color: "hsl(var(--foreground))",
                            fontFamily: "var(--font-display)",
                            fontSize: "11px",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                          itemStyle={{ color: "hsl(var(--foreground))", fontFamily: "var(--font-mono)", fontSize: "11px" }}
                        />
                        {y.map((column, idx) => (
                          <Line
                            key={`${block.id}-${column}`}
                            type="monotone"
                            dataKey={column}
                            stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                            strokeWidth={3}
                            dot={false}
                            activeDot={{
                              r: 5,
                              fill: CHART_COLORS[idx % CHART_COLORS.length],
                              stroke: "hsl(var(--background))",
                              strokeWidth: 2,
                            }}
                          />
                        ))}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          );
        }

        if (block.type === "recommendations" || block.type === "action_plan" || block.type === "scenario_options") {
          const items = blockItems(block);
          const questionPrompt = typeof (block.payload as { question?: unknown }).question === "string"
            ? ((block.payload as { question: string }).question)
            : null;
          if (items.length === 0 && !questionPrompt) return null;
          const heading = block.type === "recommendations" ? "Recommendations" : block.type === "action_plan" ? "Action Plan" : "Scenario Options";
          const Icon = block.type === "recommendations" ? Lightbulb : ListChecks;
          const cards = items.map((item, idx) => normalizeRecommendationItem(item, idx));
          return (
            <Card key={block.id} surface="muted">
              <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
                <CardTitle className="flex items-center gap-2 text-[1rem]">
                  <Icon className="h-4 w-4 text-[hsl(var(--brand-accent))]" />
                  {heading}
                </CardTitle>
                {questionPrompt ? (
                  <p className="text-sm leading-6 text-muted-foreground">{questionPrompt}</p>
                ) : null}
              </CardHeader>
              <CardContent className={cn("gap-3", cards.length > 1 ? "grid md:grid-cols-2" : "space-y-3")}>
                {cards.map((card, idx) => (
                  <div
                    key={`${block.id}-${idx}`}
                    className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--brand-accent)/0.18)] bg-[hsl(var(--brand-accent-ghost)/0.9)] text-[10px] font-mono font-semibold text-[hsl(var(--brand-accent))]">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="break-words text-sm font-semibold leading-6 text-foreground">{card.title}</p>
                        {card.body && (
                          <p className="text-sm leading-6 text-muted-foreground">{card.body}</p>
                        )}
                        {card.meta.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {card.meta.map((m, mIdx) => (
                              <span
                                key={`${block.id}-${idx}-meta-${mIdx}`}
                                className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground"
                              >
                                {m.label}: {m.value}
                              </span>
                            ))}
                          </div>
                        )}
                        {card.bullets.length > 0 && (
                          <div className="space-y-1.5">
                            {card.bullets.map((bullet, bIdx) => (
                              <p key={`${block.id}-${idx}-bullet-${bIdx}`} className="text-sm leading-6 text-foreground/78">
                                {bullet}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        }

        if (block.type === "risk_flags") {
          return null;
        }

        if (block.type === "past_pattern_inference") {
          return (
            <Card key={block.id} surface="elevated">
              <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
                <CardTitle className="text-[1rem]">Pattern inference</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  {blockText(block) ?? "Pattern inference available from historical data."}
                </p>
              </CardContent>
            </Card>
          );
        }

        if (block.type === "citations") {
          const items = ((block.payload as { items?: unknown }).items ?? []) as Array<Record<string, unknown>>;
          if (!Array.isArray(items) || items.length === 0) return null;
          return (
            <Card key={block.id} surface="muted">
              <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
                <CardTitle className="text-[1rem]">Sources</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item, idx) => {
                  const title =
                    (typeof item.title === "string" && item.title) ||
                    (typeof item.publisher === "string" && item.publisher) ||
                    `Source ${idx + 1}`;
                  const publisher = typeof item.publisher === "string" ? item.publisher : null;
                  const url = typeof item.url === "string" ? item.url : null;
                  const sourceType = typeof item.source_type === "string" ? item.source_type : null;
                  return (
                    <div
                      key={`${block.id}-${idx}`}
                      className="surface-elevated forensic-frame flex flex-col gap-2 rounded-[calc(var(--radius-sm))] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{title}</p>
                        {sourceType ? (
                          <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                            {sourceType === "workspace_data" ? "Workspace" : "External"}
                          </span>
                        ) : null}
                      </div>
                      {publisher ? <p className="text-sm text-muted-foreground">{publisher}</p> : null}
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-[0.14em] text-[hsl(var(--brand-accent))] hover:underline"
                        >
                          Open source
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        }

        return null;
      })}

    </div>
  );
}

function LegacyAnswerView({
  payload,
}: {
  payload: AiInsightsTurnResponse;
}) {
  return (
    <div className="w-full min-w-0 flex-1 space-y-5">
      <section className="surface-hero forensic-frame spotlight-border min-w-0 rounded-[calc(var(--radius)-2px)] p-5 md:p-6">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.84)] px-3 py-1 text-[10px] font-ui uppercase tracking-[0.16em] text-[hsl(var(--brand-accent))]">
              {modeLabel(payload.resolved_mode)} scope
            </span>
            <span className={cn("rounded-full border px-3 py-1 text-[10px] font-ui uppercase tracking-[0.16em]", confidenceToneClass(payload.evidence?.system_confidence))}>
              {formatEvidenceConfidence(payload.evidence?.system_confidence ?? "low")}
            </span>
          </div>
          <h3 className="type-display-section break-words text-[clamp(2rem,2.3vw+1.1rem,3.2rem)] leading-[0.98] tracking-tight [overflow-wrap:anywhere]">
          {payload.answer_title}
        </h3>
          <p className="break-words text-[15px] leading-7 text-foreground/82 [overflow-wrap:anywhere]">
            {payload.executive_answer}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(payload.kpis || []).map((kpi) => (
              <div key={kpi.label} className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">{kpi.label}</p>
                <p className="mt-2 font-mono text-[1.05rem] font-semibold tracking-tight text-foreground" title={kpi.value}>
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Card surface="elevated">
        <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
          <CardTitle className="text-[1rem]">What matters</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">{payload.why_this_matters}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AiInsights() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const defaults = defaultDateRange();
  const [question, setQuestion] = useState("");
  const [fromDate, setFromDate] = useState(searchParams.get("from") ?? defaults.fromDate);
  const [toDate, setToDate] = useState(searchParams.get("to") ?? defaults.toDate);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [entityContext, setEntityContext] = useState<AiInsightsEntityContext>({
    track_key: searchParams.get("track_key") ?? undefined,
    artist_key: searchParams.get("artist_key") ?? undefined,
    artist_name: searchParams.get("artist") ?? undefined,
  });
  const [trackSearch, setTrackSearch] = useState("");
  const [artistSearch, setArtistSearch] = useState("");
  const [activeRailTab, setActiveRailTab] = useState<"tracks" | "artists">("tracks");
  const [isRailOpen, setIsRailOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const {
    data: trackRows = [],
    isLoading: trackRowsLoading,
    error: trackRowsError,
  } = useQuery({
    queryKey: ["ai-insights-track-rows", fromDate, toDate],
    queryFn: async (): Promise<TrackInsightListRow[]> => {
      const { data, error } = await supabase.rpc("get_track_insights_list_v1", {
        from_date: fromDate,
        to_date: toDate,
        filters_json: {},
      });
      if (error) throw error;
      return (data ?? []) as TrackInsightListRow[];
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: AiInsightsTurnRequest): Promise<AiInsightsTurnResponse> => {
      const { data, error } = await supabase.functions.invoke("ai-insights-router-v1", { body: payload });
      if (error) {
        const message = await resolveFunctionError(error, data);
        throw new Error(message);
      }
      const response = data as AiInsightsTurnResponse | undefined;
      if (!response?.executive_answer) throw new Error("AI insights response was empty.");
      return response;
    },
    onSuccess: (response) => {
      setConversationId(response.conversation_id);
      setTurns((prev) => [...prev, createTurn("assistant", response.executive_answer, response)]);
    },
    onError: (error: Error) => {
      toast({ title: "AI request failed", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("from", fromDate);
      next.set("to", toDate);
      if (entityContext.track_key) next.set("track_key", entityContext.track_key);
      else next.delete("track_key");
      if (entityContext.artist_key) next.set("artist_key", entityContext.artist_key);
      else next.delete("artist_key");
      if (entityContext.artist_name) next.set("artist", entityContext.artist_name);
      else next.delete("artist");
      return next;
    }, { replace: true });
  }, [entityContext.artist_key, entityContext.artist_name, entityContext.track_key, fromDate, setSearchParams, toDate]);

  const submitQuestionText = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || sendMutation.isPending) return;
    setTurns((prev) => [...prev, createTurn("user", trimmed)]);
    setQuestion("");
    sendMutation.mutate({
      question: trimmed,
      from_date: fromDate,
      to_date: toDate,
      conversation_id: conversationId,
      entity_context: entityContext,
    });
  };

  const submitQuestion = () => {
    submitQuestionText(question);
  };

  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    if (question.trim().length === 0) {
      element.style.height = "24px";
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [question]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns.length, sendMutation.isPending]);

  const copyShareLink = async () => {
    const url = new URL(window.location.href);
    await navigator.clipboard.writeText(url.toString());
    toast({ title: "Link copied", description: "Share link copied to clipboard." });
  };

  const openTrackSnapshot = (track: TrackInsightListRow) => {
    const next = new URLSearchParams({ from: fromDate, to: toDate });
    if (track.artist_name) next.set("artist", track.artist_name);
    navigate(`/ai-insights/snapshots/track/${encodeURIComponent(track.track_key)}?${next.toString()}`);
  };

  const openArtistSnapshot = (artistName: string, artistKey: string) => {
    const next = new URLSearchParams({ from: fromDate, to: toDate, artist: artistName });
    navigate(`/ai-insights/snapshots/artist/${encodeURIComponent(artistKey)}?${next.toString()}`);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--surface-muted)/0.42)_100%)] font-ui">
      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-10 border-b border-[hsl(var(--border)/0.12)] bg-[linear-gradient(180deg,hsl(var(--surface-panel)/0.96),hsl(var(--surface-elevated)/0.94))] px-4 py-4 shadow-[0_16px_40px_-34px_hsl(var(--surface-shadow)/0.28)] md:px-6">
          <div className="flex items-center gap-2 md:gap-4 xl:justify-between">
            <div className="order-2 flex min-w-0 flex-1 items-center justify-end gap-2 md:order-1 md:flex-none md:gap-3">
            <Sheet open={isRailOpen} onOpenChange={setIsRailOpen}>
              <SheetContent side="right" className="w-[min(340px,calc(100vw-1rem))] border-l-0 bg-[hsl(var(--surface-panel))] p-0">
                <ContextRail
                  trackRows={trackRows}
                  isLoading={trackRowsLoading}
                  error={trackRowsError as Error | null}
                  onOpenTrackSnapshot={openTrackSnapshot}
                  onOpenArtistSnapshot={openArtistSnapshot}
                  onArtistSelect={(artistName, artistKey) => {
                    setEntityContext({ artist_name: artistName, artist_key: artistKey });
                    setIsRailOpen(false);
                  }}
                  onTrackSelect={(track) => {
                    setEntityContext({
                      track_key: track.track_key,
                      track_title: track.track_title,
                      artist_name: track.artist_name,
                    });
                    setIsRailOpen(false);
                  }}
                  onClearScope={() => {
                    setEntityContext({});
                    setIsRailOpen(false);
                  }}
                  trackSearch={trackSearch}
                  setTrackSearch={setTrackSearch}
                  artistSearch={artistSearch}
                  setArtistSearch={setArtistSearch}
                  activeTab={activeRailTab}
                  setActiveTab={setActiveRailTab}
                  selectedContext={entityContext}
                />
              </SheetContent>
              <SheetTrigger asChild>
                <button className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[hsl(var(--brand-accent)/0.18)] bg-[hsl(var(--brand-accent-ghost)/0.68)] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--brand-accent))] transition-all active:scale-95 md:max-w-[220px] md:flex-none xl:hidden">
                  <Target className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{activeScopeTitle(entityContext)}</span>
                </button>
              </SheetTrigger>
            </Sheet>
            <div className="hidden min-w-0 md:block">
              <span className="editorial-kicker">AI Insights</span>
            </div>
          </div>
          <div className="order-1 flex min-w-0 flex-1 items-center gap-2 md:order-2 md:flex-initial md:flex-wrap md:gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.74)] px-4 py-2.5 text-left transition-all hover:border-[hsl(var(--brand-accent))]/35 hover:bg-[hsl(var(--brand-accent-ghost))]/86 sm:flex-none">
                  <CalendarRange className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--brand-accent))]" />
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--brand-accent))]">
                    {formatDateWindow(fromDate, toDate)}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] rounded-[calc(var(--radius)-2px)] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated))] p-6 shadow-[0_28px_80px_-42px_hsl(var(--surface-shadow)/0.38)]" align="end">
                <div className="grid gap-6">
                  <div className="space-y-2">
                    <p className="text-[10px] font-ui uppercase tracking-[0.16em] text-muted-foreground">From</p>
                    <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 font-mono md:text-xs" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-ui uppercase tracking-[0.16em] text-muted-foreground">To</p>
                    <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-10 font-mono md:text-xs" />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <div className="hidden">
              <CalendarRange className="h-3 w-3 md:h-3.5 md:w-3.5 text-[hsl(var(--brand-accent))] opacity-60" />
              <span className="font-mono text-[9px] md:text-[10px] uppercase text-[hsl(var(--brand-accent))]">
                {fromDate.split('-').reverse().slice(0, 2).join('.')} — {toDate.split('-').reverse().slice(0, 2).join('.')}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={copyShareLink} className="hidden h-9 border-[hsl(var(--brand-accent))/0.18] bg-[hsl(var(--surface-panel)/0.72)] px-3 text-[hsl(var(--brand-accent))] hover:bg-[hsl(var(--brand-accent))] hover:text-white md:inline-flex">
              <Copy className="h-3 w-3" />
              <span className="ml-2 text-[9px] font-bold uppercase tracking-[0.16em]">Share</span>
            </Button>
          </div>
          </div>
        </header>

        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--surface-muted)/0.34)_100%)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,hsl(var(--brand-accent)/0.14),transparent_58%)]" />
          {turns.length === 0 ? (
            <div className="relative z-[1] flex flex-1 items-center overflow-hidden px-4 md:px-6">
              <div className="mx-auto w-full max-w-3xl py-6 md:py-8">
                {trackRowsError ? (
                  <Card surface="critical">
                    <CardContent className="flex items-center gap-3 px-5 py-4">
                      <AlertTriangle className="h-4 w-4" />
                      <p className="text-sm">Failed to load context: {(trackRowsError as Error).message}</p>
                    </CardContent>
                  </Card>
                ) : null}

                <Card surface="hero">
                  <CardContent className="p-6 text-center md:p-8">
                    <div className="space-y-6">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--brand-accent)/0.18)] bg-[hsl(var(--brand-accent-ghost)/0.82)] text-[hsl(var(--brand-accent))] shadow-[0_18px_36px_-28px_hsl(var(--brand-accent)/0.42)]">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div className="space-y-3">
                        <p className="editorial-kicker">AI Insights</p>
                        <h1 className="type-display-section text-[clamp(2.2rem,2.2vw+1.4rem,3.6rem)] leading-[0.96] tracking-tight text-foreground">
                          Ask the portfolio
                        </h1>
                        <p className="mx-auto max-w-2xl text-sm leading-7 text-muted-foreground">
                          Start with one question about movement, anomalies, or what needs action next.
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {[
                          "Where is revenue leaking the most right now?",
                          "Which artists deserve immediate attention?",
                          "What needs action first?",
                        ].map((starter) => (
                          <button
                            key={starter}
                            onClick={() => submitQuestionText(starter)}
                            className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] px-4 py-4 text-left text-sm leading-6 text-foreground transition-all hover:border-[hsl(var(--brand-accent))/0.24] hover:bg-[hsl(var(--brand-accent-ghost)/0.42)]"
                          >
                            {starter}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="relative z-[1] flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-4 xl:px-5 [scrollbar-gutter:stable]">
              <div className="mx-auto w-full min-w-0 max-w-5xl py-4 md:py-10 xl:max-w-none">
                <div className="space-y-6 md:space-y-8">
                  {turns.map((turn, idx) => (
                    <div
                      key={turn.id}
                      className={cn(
                        "flex w-full min-w-0 flex-col gap-3 md:gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500",
                        idx > 0 && "border-t border-[hsl(var(--border)/0.08)] pt-6 md:pt-8"
                      )}
                    >
                      <div className="flex w-full min-w-0 items-start gap-3 md:gap-4">
                        <div className={cn(
                          "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border shadow-[0_16px_32px_-24px_hsl(var(--surface-shadow)/0.38)] md:h-10 md:w-10",
                          turn.role === "assistant"
                            ? "border-[hsl(var(--brand-accent)/0.18)] bg-[hsl(var(--brand-accent-ghost)/0.92)] text-[hsl(var(--brand-accent))]"
                            : "border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.92)] text-foreground"
                        )}>
                          {turn.role === "assistant" && (
                            <>
                              <div
                                className="absolute inset-0 bg-center bg-cover opacity-85"
                                style={{ backgroundImage: "url('/logo-icon.png')" }}
                              />
                              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,hsl(var(--brand-accent)/0.12))]" />
                            </>
                          )}
                          {turn.role === "assistant" ? null : <User className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1 space-y-4">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <p className="type-micro text-[10px] font-bold tracking-[0.2em] text-[hsl(var(--brand-accent))]">
                              {turn.role === "assistant" ? "AI BRIEF" : "YOU ASKED"}
                            </p>
                            <p className="shrink-0 font-mono text-[9px] text-muted-foreground opacity-40 uppercase">
                              {formatTurnTime(turn.createdAt)}
                            </p>
                          </div>

                          {turn.payload ? (
                            <div className="min-w-0">
                              <AiAnswerView payload={turn.payload} onUseQuestion={submitQuestionText} />
                            </div>
                          ) : (
                            <div className="surface-elevated forensic-frame w-full max-w-full rounded-[calc(var(--radius-sm))] px-4 py-4 md:max-w-[90%] xl:max-w-full">
                              <p className="break-words text-lg leading-relaxed tracking-tight text-foreground [overflow-wrap:anywhere]">
                                {turn.text}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {sendMutation.isPending && turns[turns.length - 1]?.role === "user" && (
                    <div className="flex items-start gap-4 opacity-80">
                      <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[hsl(var(--brand-accent)/0.18)] bg-[hsl(var(--brand-accent-ghost)/0.92)] text-[hsl(var(--brand-accent))] shadow-[0_16px_32px_-24px_hsl(var(--brand-accent)/0.42)]">
                        <div
                          className="absolute inset-0 bg-center bg-cover opacity-85"
                          style={{ backgroundImage: "url('/logo-icon.png')" }}
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,hsl(var(--brand-accent)/0.12))]" />
                        <div className="absolute inset-x-0 top-[-120%] h-[220%] bg-gradient-to-b from-transparent via-white/35 to-transparent animate-[shimmer_1.8s_infinite]" />
                      </div>
                      <div className="surface-elevated forensic-frame flex-1 space-y-4 rounded-[calc(var(--radius-sm))] p-4">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--brand-accent))] animate-pulse"></span>
                          <p className="type-micro text-[9px] font-bold tracking-[0.3em] text-[hsl(var(--brand-accent))] animate-pulse">
                            AI IS READING THE WORKSPACE
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="h-[1px] w-full bg-[hsl(var(--brand-accent))]/10 relative overflow-hidden">
                            <div className="absolute inset-0 bg-[hsl(var(--brand-accent))] animate-[loading-bar_3s_infinite]"></div>
                          </div>
                          <div className="h-[1px] w-2/3 bg-[hsl(var(--brand-accent))]/10 relative overflow-hidden">
                            <div className="absolute inset-0 bg-[hsl(var(--brand-accent))] animate-[loading-bar_2s_infinite_0.5s]"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-[hsl(var(--border)/0.12)] bg-[linear-gradient(180deg,hsl(var(--surface-panel)/0.92),hsl(var(--surface-elevated)/0.98))] p-3 md:p-4">
          <div className="mx-auto w-full max-w-5xl xl:max-w-none">
            <div className="surface-hero forensic-frame spotlight-border relative overflow-hidden rounded-[calc(var(--radius)-2px)] px-3 py-3 md:px-4 md:py-3.5">
              <div className="pointer-events-none absolute right-0 top-0 h-20 w-20 translate-x-5 -translate-y-5 rounded-full bg-[hsl(var(--brand-accent-ghost)/0.78)] blur-3xl" />
              <div className="relative flex items-end gap-3">
                <div className="min-w-0 flex-1 rounded-[calc(var(--radius-sm)+4px)] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.88)] px-4 py-3 shadow-[inset_0_1px_0_hsl(var(--background)/0.55)]">
                  <Textarea
                    ref={composerRef}
                    rows={1}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask about leakage, growth, anomalies, top performers, or what needs action next."
                    className="min-h-[24px] max-h-[200px] w-full resize-none border-0 bg-transparent p-0 text-[0.98rem] leading-6 text-foreground placeholder:text-muted-foreground/55 focus-visible:ring-0 md:text-[1.02rem]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitQuestion();
                      }
                    }}
                  />
                </div>
                <Button
                  onClick={submitQuestion}
                  disabled={sendMutation.isPending || !question.trim()}
                  className="h-11 shrink-0 rounded-full px-5 shadow-[0_18px_40px_-28px_hsl(var(--brand-accent)/0.52)]"
                >
                  <Send className="mr-2 h-4 w-4" />
                  Ask AI
                </Button>
              </div>
            </div>
          </div>
        </footer>
      </main>

      {/* Sidebar: Context Rail */}
      <aside className="hidden w-[320px] flex-shrink-0 xl:block">
        <ContextRail
          trackRows={trackRows}
          isLoading={trackRowsLoading}
          error={trackRowsError as Error | null}
          onOpenTrackSnapshot={openTrackSnapshot}
          onOpenArtistSnapshot={openArtistSnapshot}
          onTrackSelect={(track) =>
            setEntityContext({
              track_key: track.track_key,
              track_title: track.track_title,
              artist_name: track.artist_name,
            })
          }
          onArtistSelect={(artistName, artistKey) =>
            setEntityContext({ artist_name: artistName, artist_key: artistKey })
          }
          onClearScope={() => setEntityContext({})}
          trackSearch={trackSearch}
          setTrackSearch={setTrackSearch}
          artistSearch={artistSearch}
          setArtistSearch={setArtistSearch}
          activeTab={activeRailTab}
          setActiveTab={setActiveRailTab}
          selectedContext={entityContext}
        />
      </aside>
    </div>
  );
}

function ContextRail({
  trackRows,
  isLoading,
  error,
  onOpenTrackSnapshot,
  onOpenArtistSnapshot,
  onTrackSelect,
  onArtistSelect,
  onClearScope,
  trackSearch,
  setTrackSearch,
  artistSearch,
  setArtistSearch,
  activeTab,
  setActiveTab,
  selectedContext,
}: {
  trackRows: TrackInsightListRow[];
  isLoading: boolean;
  error: Error | null;
  onOpenTrackSnapshot: (track: TrackInsightListRow) => void;
  onOpenArtistSnapshot: (artistName: string, artistKey: string) => void;
  onTrackSelect: (track: TrackInsightListRow) => void;
  onArtistSelect: (artistName: string, artistKey: string) => void;
  onClearScope: () => void;
  trackSearch: string;
  setTrackSearch: (v: string) => void;
  artistSearch: string;
  setArtistSearch: (v: string) => void;
  activeTab: "tracks" | "artists";
  setActiveTab: (v: "tracks" | "artists") => void;
  selectedContext: {
    track_key?: string;
    track_title?: string;
    artist_key?: string;
    artist_name?: string;
  };
}) {
  const deferredTrackSearch = useDeferredValue(trackSearch);
  const deferredArtistSearch = useDeferredValue(artistSearch);

  const filteredTracks = useMemo(() => {
    const sorted = [...trackRows].sort((a, b) => (b.net_revenue ?? 0) - (a.net_revenue ?? 0));
    if (!deferredTrackSearch.trim()) return sorted;
    const term = deferredTrackSearch.toLowerCase();
    return sorted.filter((t) =>
      t.track_title?.toLowerCase().includes(term) ||
      t.artist_name?.toLowerCase().includes(term)
    );
  }, [deferredTrackSearch, trackRows]);

  const allArtists = useMemo(() => {
    const map = new Map<string, { artist: string; artist_key: string; net: number; tracks: number; critical: number }>();
    for (const row of trackRows) {
      const key = row.artist_name || "Unknown Artist";
      if (!map.has(key)) {
        map.set(key, { artist: key, artist_key: normalizeArtistKey(key), net: 0, tracks: 0, critical: 0 });
      }
      map.get(key)!.net += row.net_revenue ?? 0;
      map.get(key)!.tracks += 1;
      map.get(key)!.critical += row.open_critical_task_count ?? 0;
    }
    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  }, [trackRows]);

  const filteredArtists = useMemo(() => {
    if (!deferredArtistSearch.trim()) return allArtists;
    const term = deferredArtistSearch.toLowerCase();
    return allArtists.filter((a) => a.artist.toLowerCase().includes(term));
  }, [allArtists, deferredArtistSearch]);

  const activeScopeLabel = activeScopeTitle(selectedContext);
  const activeScopeType = activeScopeDescriptor(selectedContext);
  const hasSelectedScope = Boolean(selectedContext.track_key || selectedContext.artist_key);

  return (
    <div className="flex h-full flex-col border-l border-[hsl(var(--border)/0.12)] bg-[linear-gradient(180deg,hsl(var(--surface-panel)/0.98)_0%,hsl(var(--surface-muted)/0.9)_100%)] backdrop-blur-md">
      <div className="border-b border-[hsl(var(--border)/0.1)] p-4">
        <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="editorial-kicker">Data context</p>
              <p className="mt-2 truncate text-sm font-semibold tracking-tight text-foreground md:text-[0.95rem]">
                {activeScopeLabel}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {hasSelectedScope ? `${activeScopeType} selected` : "Choose a track or artist to narrow the answer."}
              </p>
            </div>
            {hasSelectedScope && (
              <Button type="button" size="sm" variant="quiet" className="h-8 px-3" onClick={onClearScope}>
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] p-1">
          <button
            onClick={() => setActiveTab("tracks")}
            className={cn(
              "flex-1 rounded-full px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] transition-all",
              activeTab === "tracks"
                ? "bg-[hsl(var(--brand-accent))] text-white shadow-[0_12px_24px_-18px_hsl(var(--brand-accent)/0.45)]"
                : "text-muted-foreground hover:bg-[hsl(var(--surface-elevated)/0.92)] hover:text-foreground"
            )}
          >
            Tracks
          </button>
          <button
            onClick={() => setActiveTab("artists")}
            className={cn(
              "flex-1 rounded-full px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] transition-all",
              activeTab === "artists"
                ? "bg-[hsl(var(--brand-accent))] text-white shadow-[0_12px_24px_-18px_hsl(var(--brand-accent)/0.45)]"
                : "text-muted-foreground hover:bg-[hsl(var(--surface-elevated)/0.92)] hover:text-foreground"
            )}
          >
            Artists
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="px-4 py-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--brand-accent))]/40 transition-colors group-focus-within:text-[hsl(var(--brand-accent))]" />
            <Input
              value={activeTab === "tracks" ? trackSearch : artistSearch}
              onChange={(e) => activeTab === "tracks" ? setTrackSearch(e.target.value) : setArtistSearch(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="h-10 border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.88)] pl-9 text-[11px] font-medium tracking-tight shadow-none transition-all focus-visible:ring-1 focus-visible:ring-[hsl(var(--brand-accent))]/28"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 px-4 pb-4">
          {error ? (
            <div className="surface-critical forensic-frame rounded-[calc(var(--radius-sm))] p-4 text-sm text-foreground">
              Failed to load context: {error.message}
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="surface-elevated forensic-frame h-24 animate-pulse rounded-[calc(var(--radius-sm))] bg-[hsl(var(--surface-panel)/0.82)]" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {activeTab === "tracks" ? (
                filteredTracks.length > 0 ? (
                  filteredTracks.map((track) => {
                    const isActive = Boolean(selectedContext.track_key) && selectedContext.track_key === track.track_key;
                    return (
                      <div
                        key={track.track_key}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isActive}
                        onClick={() => onTrackSelect(track)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onTrackSelect(track);
                          }
                        }}
                        className={cn(
                          "group relative cursor-pointer overflow-hidden rounded-[calc(var(--radius-sm))] border p-3.5 outline-none transition-all focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-accent))/0.3]",
                          isActive
                            ? "border-[hsl(var(--brand-accent))/0.34] bg-[linear-gradient(180deg,hsl(var(--brand-accent-ghost)/0.98),hsl(var(--surface-elevated)))] shadow-[0_22px_40px_-30px_hsl(var(--brand-accent)/0.42)]"
                            : "bg-[hsl(var(--surface-elevated)/0.82)] hover:border-[hsl(var(--brand-accent))/0.22] hover:bg-[hsl(var(--surface-elevated))]"
                        )}
                      >
                        {isActive ? (
                          <div className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[hsl(var(--brand-accent))]" />
                        ) : null}
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {isActive ? (
                                <span className="rounded-full border border-[hsl(var(--brand-accent))/0.18] bg-[hsl(var(--brand-accent))] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white">
                                  In scope
                                </span>
                              ) : null}
                              {track.open_critical_task_count > 0 ? (
                                <span className="rounded-full border border-[hsl(var(--tone-critical)/0.18)] bg-[hsl(var(--tone-critical)/0.12)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--tone-critical))]">
                                  {track.open_critical_task_count} critical
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 truncate text-sm font-semibold tracking-tight text-foreground">{track.track_title}</p>
                            <p className="mt-1 truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                              {track.artist_name || "Unknown artist"}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-foreground">
                                {formatCompactCurrency(track.net_revenue ?? 0)}
                              </span>
                              <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em]", trendToneClass(track.trend_3m_pct))}>
                                {formatTrendDelta(track.trend_3m_pct)}
                              </span>
                              {track.top_territory ? (
                                <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                  {track.top_territory}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenTrackSnapshot(track);
                            }}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.8)] px-3 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-all hover:border-[hsl(var(--brand-accent))/0.24] hover:text-[hsl(var(--brand-accent))]"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            <span>Snapshot</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="py-8 text-center text-[10px] text-muted-foreground uppercase tracking-widest">No tracks matched</p>
                )
              ) : (
                filteredArtists.length > 0 ? (
                  filteredArtists.map((artist) => {
                    const isActive = !selectedContext.track_key && selectedContext.artist_key === artist.artist_key;
                    return (
                      <div
                        key={artist.artist_key}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isActive}
                        onClick={() => onArtistSelect(artist.artist, artist.artist_key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onArtistSelect(artist.artist, artist.artist_key);
                          }
                        }}
                        className={cn(
                          "group relative cursor-pointer overflow-hidden rounded-[calc(var(--radius-sm))] border p-3.5 outline-none transition-all focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-accent))/0.3]",
                          isActive
                            ? "border-[hsl(var(--brand-accent))/0.34] bg-[linear-gradient(180deg,hsl(var(--brand-accent-ghost)/0.98),hsl(var(--surface-elevated)))] shadow-[0_22px_40px_-30px_hsl(var(--brand-accent)/0.42)]"
                            : "bg-[hsl(var(--surface-elevated)/0.82)] hover:border-[hsl(var(--brand-accent))/0.22] hover:bg-[hsl(var(--surface-elevated))]"
                        )}
                      >
                        {isActive ? (
                          <div className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[hsl(var(--brand-accent))]" />
                        ) : null}
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {isActive ? (
                                <span className="rounded-full border border-[hsl(var(--brand-accent))/0.18] bg-[hsl(var(--brand-accent))] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white">
                                  In scope
                                </span>
                              ) : null}
                              {artist.critical > 0 ? (
                                <span className="rounded-full border border-[hsl(var(--tone-critical)/0.18)] bg-[hsl(var(--tone-critical)/0.12)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--tone-critical))]">
                                  {artist.critical} critical
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 truncate text-sm font-semibold tracking-tight text-foreground">
                              {artist.artist}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-foreground">
                                {formatCompactCurrency(artist.net)}
                              </span>
                              <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                {artist.tracks} tracks
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenArtistSnapshot(artist.artist, artist.artist_key);
                            }}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.8)] px-3 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-all hover:border-[hsl(var(--brand-accent))/0.24] hover:text-[hsl(var(--brand-accent))]"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            <span>Snapshot</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="py-8 text-center text-[10px] text-muted-foreground uppercase tracking-widest">No artists matched</p>
                )
              )}
            </div>
          )}
        </ScrollArea>
      </div>

    </div>
  );
}
