import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { AlertTriangle, ShieldAlert } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { parseLooseNumber, safePercent, toCompactMoney, toMoney } from "@/lib/royalty";
import { KpiStrip, PageHeader } from "@/components/layout";

type Report = Pick<
  Tables<"cmo_reports">,
  | "id"
  | "cmo_name"
  | "file_name"
  | "created_at"
  | "processed_at"
  | "report_period"
  | "status"
  | "transaction_count"
  | "total_revenue"
  | "accuracy_score"
  | "error_count"
>;

type Tx = Pick<
  Tables<"royalty_transactions">,
  | "report_id"
  | "territory"
  | "platform"
  | "gross_revenue"
  | "net_revenue"
  | "commission"
  | "quantity"
  | "track_title"
  | "artist_name"
>;

type Item = Pick<
  Tables<"document_ai_report_items">,
  | "report_id"
  | "country"
  | "channel"
  | "report_date"
  | "isrc"
  | "track_title"
  | "amount_in_original_currency"
  | "amount_in_reporting_currency"
  | "royalty_revenue"
  | "master_commission"
>;

type ExtractorPayload = {
  rows: Item[];
  available: boolean;
};

type SourceRankingRow = {
  cmo: string;
  docs: number;
  net: number;
  avgAccuracy: number | null;
  sharePct: number;
};

type PlatformMixRow = {
  name: string;
  value: number;
  sharePct: number;
};

const DASHBOARD_BATCH_SIZE = 1000;

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

const CHART_TOOLTIP_LABEL_STYLE = {
  color: "hsl(0 0% 9%)",
  fontFamily: "var(--font-display)",
  fontSize: "10px",
  letterSpacing: "var(--tracking-nav)",
  textTransform: "uppercase" as const,
};

function isMissingRelationError(error: unknown, relation: string): boolean {
  const e = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  if (!e) return false;
  if (e.code === "42P01") return true;
  const haystack = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  return haystack.includes(relation.toLowerCase());
}

async function fetchAllRows<T>(
  fetchBatch: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += DASHBOARD_BATCH_SIZE) {
    const { data, error } = await fetchBatch(from, from + DASHBOARD_BATCH_SIZE - 1);
    if (error) throw error;

    const batch = data ?? [];
    rows.push(...batch);

    if (batch.length < DASHBOARD_BATCH_SIZE) break;
  }

  return rows;
}

function monthKey(input: string | null): string | null {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "yyyy-MM");
}

function formatMonthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return format(date, "MMM yy");
}

function extractorRevenue(row: Item): number {
  return (
    parseLooseNumber(row.amount_in_reporting_currency) ??
    parseLooseNumber(row.royalty_revenue) ??
    parseLooseNumber(row.amount_in_original_currency) ??
    0
  );
}

function extractorCommission(row: Item): number {
  return parseLooseNumber(row.master_commission) ?? 0;
}

export default function Dashboard() {
  const {
    data: reports = [],
    isLoading: reportsLoading,
    error: reportsError,
  } = useQuery({
    queryKey: ["dashboard-reports"],
    queryFn: async (): Promise<Report[]> => {
      const { data, error } = await supabase
        .from("cmo_reports")
        .select(
          "id,cmo_name,file_name,created_at,processed_at,report_period,status,transaction_count,total_revenue,accuracy_score,error_count"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: transactions = [],
    isLoading: txLoading,
    error: txError,
  } = useQuery({
    queryKey: ["dashboard-transactions"],
    queryFn: async (): Promise<Tx[]> =>
      fetchAllRows<Tx>((from, to) =>
        supabase
          .from("royalty_transactions")
          .select("report_id,territory,platform,gross_revenue,net_revenue,commission,quantity,track_title,artist_name")
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
  });

  const {
    data: extractor = { rows: [], available: true },
    isLoading: extractorLoading,
    error: extractorError,
  } = useQuery({
    queryKey: ["dashboard-document-ai-items"],
    queryFn: async (): Promise<ExtractorPayload> => {
      const rows: Item[] = [];

      for (let from = 0; ; from += DASHBOARD_BATCH_SIZE) {
        const { data, error } = await supabase
          .from("document_ai_report_items")
          .select(
            "report_id,country,channel,report_date,isrc,track_title,amount_in_original_currency,amount_in_reporting_currency,royalty_revenue,master_commission"
          )
          .order("created_at", { ascending: false })
          .range(from, from + DASHBOARD_BATCH_SIZE - 1);

        if (error) {
          if (from === 0 && isMissingRelationError(error, "document_ai_report_items")) {
            return { rows: [], available: false };
          }
          throw error;
        }

        const batch = data ?? [];
        rows.push(...batch);

        if (batch.length < DASHBOARD_BATCH_SIZE) break;
      }

      return { rows, available: true };
    },
  });

  const items = extractor.rows;
  const extractorAvailable = extractor.available;

  const reportById = useMemo(() => {
    const map = new Map<string, Report>();
    for (const report of reports) map.set(report.id, report);
    return map;
  }, [reports]);

  const metrics = useMemo(() => {
    const grossFromTx = transactions.reduce((sum, tx) => sum + (tx.gross_revenue ?? 0), 0);
    const netFromTx = transactions.reduce((sum, tx) => sum + (tx.net_revenue ?? 0), 0);
    const commissionFromTx = transactions.reduce((sum, tx) => sum + (tx.commission ?? 0), 0);

    const grossFromExtractor = items.reduce((sum, row) => sum + extractorRevenue(row), 0);
    const commissionFromExtractor = items.reduce((sum, row) => sum + extractorCommission(row), 0);

    const hasTxFinance = grossFromTx > 0 || netFromTx > 0;
    const gross = hasTxFinance ? grossFromTx : grossFromExtractor;
    const net = hasTxFinance ? netFromTx : Math.max(0, grossFromExtractor - commissionFromExtractor);

    const totalReports = reports.length;
    const completedReports = reports.filter((r) =>
      ["completed", "completed_passed", "completed_with_warnings"].includes(r.status)
    ).length;
    const failedReports = reports.filter((r) => r.status === "failed").length;
    const processingReports = reports.filter((r) => r.status === "processing" || r.status === "pending").length;
    const processingRate = totalReports > 0 ? (completedReports / totalReports) * 100 : 0;
    const activeCmos = new Set(reports.map((r) => r.cmo_name)).size;

    const accuracyValues = reports
      .map((r) => r.accuracy_score)
      .filter((value): value is number => typeof value === "number");

    const avgAccuracy =
      accuracyValues.length > 0
        ? accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length
        : null;

    const activeArtists = transactions.length
      ? new Set(transactions.map((tx) => tx.artist_name).filter((value): value is string => Boolean(value?.trim()))).size
      : null;

    const activeTitles = new Set(
      (transactions.length > 0 ? transactions.map((tx) => tx.track_title) : items.map((item) => item.track_title)).filter(
        (value): value is string => Boolean(value?.trim())
      )
    ).size;

    return {
      gross,
      net,
      totalReports,
      completedReports,
      failedReports,
      processingReports,
      processingRate,
      activeCmos,
      avgAccuracy,
      activeArtists,
      activeTitles,
    };
  }, [items, reports, transactions]);

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { gross: number; net: number; reports: number }>();

    for (const report of reports) {
      const key = monthKey(report.created_at);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { gross: 0, net: 0, reports: 0 });
      map.get(key)!.reports += 1;
    }

    if (transactions.length > 0) {
      for (const tx of transactions) {
        const report = reportById.get(tx.report_id);
        const key = monthKey(report?.created_at ?? null);
        if (!key) continue;
        if (!map.has(key)) map.set(key, { gross: 0, net: 0, reports: 0 });
        const row = map.get(key)!;
        row.gross += tx.gross_revenue ?? 0;
        row.net += tx.net_revenue ?? 0;
      }
    } else {
      for (const item of items) {
        const report = reportById.get(item.report_id);
        const key = monthKey(item.report_date) ?? monthKey(report?.created_at ?? null);
        if (!key) continue;
        if (!map.has(key)) map.set(key, { gross: 0, net: 0, reports: 0 });
        const row = map.get(key)!;
        const gross = extractorRevenue(item);
        row.gross += gross;
        row.net += Math.max(0, gross - extractorCommission(item));
      }
    }

    return Array.from(map.entries())
      .map(([month, row]) => ({
        month,
        label: formatMonthLabel(month),
        gross: Number(row.gross.toFixed(2)),
        net: Number(row.net.toFixed(2)),
        reports: row.reports,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);
  }, [items, reportById, reports, transactions]);

  const platformMix = useMemo<PlatformMixRow[]>(() => {
    const map = new Map<string, number>();

    if (transactions.length > 0) {
      for (const tx of transactions) {
        const key = tx.platform ?? "Unknown";
        map.set(key, (map.get(key) ?? 0) + (tx.net_revenue ?? 0));
      }
    } else {
      for (const row of items) {
        const key = row.channel ?? "Unknown";
        map.set(key, (map.get(key) ?? 0) + extractorRevenue(row));
      }
    }

    const ranked = Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const total = ranked.reduce((sum, row) => sum + row.value, 0);

    return ranked.map((row) => ({
      ...row,
      sharePct: total > 0 ? (row.value / total) * 100 : 0,
    }));
  }, [items, transactions]);

  const sourceRanking = useMemo<SourceRankingRow[]>(() => {
    const map = new Map<
      string,
      {
        cmo: string;
        docs: number;
        net: number;
        accuracySum: number;
        accuracyCount: number;
      }
    >();

    for (const report of reports) {
      if (!map.has(report.cmo_name)) {
        map.set(report.cmo_name, {
          cmo: report.cmo_name,
          docs: 0,
          net: 0,
          accuracySum: 0,
          accuracyCount: 0,
        });
      }

      const row = map.get(report.cmo_name)!;
      row.docs += 1;
      if (report.accuracy_score != null) {
        row.accuracySum += report.accuracy_score;
        row.accuracyCount += 1;
      }
    }

    if (transactions.length > 0) {
      for (const tx of transactions) {
        const report = reportById.get(tx.report_id);
        if (!report) continue;
        const row = map.get(report.cmo_name);
        if (!row) continue;
        row.net += tx.net_revenue ?? 0;
      }
    } else {
      for (const item of items) {
        const report = reportById.get(item.report_id);
        if (!report) continue;
        const row = map.get(report.cmo_name);
        if (!row) continue;
        const gross = extractorRevenue(item);
        row.net += Math.max(0, gross - extractorCommission(item));
      }
    }

    const ranked = Array.from(map.values())
      .map((row) => ({
        cmo: row.cmo,
        docs: row.docs,
        net: row.net,
        avgAccuracy: row.accuracyCount > 0 ? row.accuracySum / row.accuracyCount : null,
      }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 6);

    const total = ranked.reduce((sum, row) => sum + Math.max(0, row.net), 0);

    return ranked.map((row) => ({
      ...row,
      sharePct: total > 0 ? (Math.max(0, row.net) / total) * 100 : 0,
    }));
  }, [items, reportById, reports, transactions]);

  const loading = reportsLoading || txLoading || extractorLoading;
  const criticalError = reportsError || txError || extractorError;

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        title="Dashboard"
        meta={
          <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.7)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
            {metrics.activeCmos} sources
          </span>
        }
        actions={
          <Button asChild size="sm">
            <Link to="/ai-insights">AI Insights</Link>
          </Button>
        }
      />

      {!extractorAvailable ? (
        <Card surface="muted">
          <CardContent className="p-4">
            <div className="flex items-start gap-2 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p>
                Extractor table `document_ai_report_items` is not available in this environment yet. The dashboard is
                running from normalized transactions only.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {criticalError ? (
        <Card surface="critical">
          <CardContent className="p-4">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p>Dashboard data failed to load: {String((criticalError as Error).message ?? criticalError)}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <KpiStrip
        variant="hero"
        columnsClassName="xl:grid-cols-4"
        items={[
          {
            label: "Net Revenue",
            value: toMoney(metrics.net),
            hint: `Gross ${toMoney(metrics.gross)}`,
            tone: "default",
          },
          {
            label: "Statements",
            value: metrics.totalReports.toLocaleString(),
            hint: `${metrics.completedReports} completed across ${metrics.activeCmos} sources`,
            tone: "default",
          },
          {
            label: "Active Artists",
            value: metrics.activeArtists != null ? metrics.activeArtists.toLocaleString() : "—",
            hint: metrics.activeArtists != null ? "Artists represented in normalized lines" : "Available after normalization",
            tone: "default",
          },
          {
            label: "Active Titles",
            value: metrics.activeTitles.toLocaleString(),
            hint: "Tracks represented in current portfolio data",
            tone: "default",
          },
        ]}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <Card surface="hero">
          <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <div className="min-w-0">
              <CardTitle className="text-base">Revenue Trend</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">Net line and gross bars across the last 12 months.</p>
            </div>
            <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.8)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              12 months
            </span>
          </CardHeader>
          <CardContent className="pt-5">
            {monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={monthlyTrend}>
                  <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                  <XAxis dataKey="label" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                  <YAxis
                    yAxisId="revenue"
                    tick={CHART_TICK_STYLE}
                    axisLine={CHART_AXIS_STYLE}
                    tickLine={false}
                    tickFormatter={(value: number) => toCompactMoney(value)}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      toMoney(value),
                      name === "net" ? "Net Revenue" : "Gross Revenue",
                    ]}
                    labelFormatter={(value) => `Month: ${value}`}
                    contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                    labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                    itemStyle={{ color: "hsl(0 0% 9%)" }}
                    cursor={{ fill: "hsla(0, 0%, 9%, 0.05)" }}
                  />
                  <Bar
                    yAxisId="revenue"
                    dataKey="gross"
                    name="Gross Revenue"
                    fill="hsl(var(--tone-pending))"
                    fillOpacity={0.38}
                    maxBarSize={30}
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="revenue"
                    type="monotone"
                    dataKey="net"
                    name="Net Revenue"
                    stroke="hsl(var(--brand-accent))"
                    strokeWidth={2.4}
                    dot={{ r: 2.4, strokeWidth: 1, fill: "hsl(var(--brand-accent))", stroke: "hsl(var(--background))" }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading trend..." : "No trend data yet."}
              </div>
            )}
          </CardContent>
        </Card>

        <Card surface="evidence">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <CardTitle className="text-base">Operations Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
            <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Processing Success</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{safePercent(metrics.processingRate)}</p>
              <Progress value={Math.max(0, Math.min(100, metrics.processingRate))} className="mt-4 h-3" />
              <p className="mt-3 text-xs text-muted-foreground">{metrics.completedReports.toLocaleString()} completed statements</p>
            </div>

            <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">System Confidence</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{safePercent(metrics.avgAccuracy)}</p>
              <Progress value={Math.max(0, Math.min(100, metrics.avgAccuracy ?? 0))} className="mt-4 h-3" />
              <p className="mt-3 text-xs text-muted-foreground">Average extractor confidence across statements</p>
            </div>

            <div
              className={`${metrics.processingReports > 0 ? "surface-intelligence" : "surface-muted"} forensic-frame rounded-[calc(var(--radius-sm))] p-4`}
            >
              <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">In Progress</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{metrics.processingReports.toLocaleString()}</p>
              <p className="mt-3 text-xs text-muted-foreground">Statements waiting for normalized output</p>
            </div>

            <div
              className={`${metrics.failedReports > 0 ? "surface-critical" : "surface-muted"} forensic-frame rounded-[calc(var(--radius-sm))] p-4`}
            >
              <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Needs Attention</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{metrics.failedReports.toLocaleString()}</p>
              <p className="mt-3 text-xs text-muted-foreground">Statements requiring review or reprocessing</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <Card surface="evidence">
          <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <div className="min-w-0">
              <CardTitle className="text-base">Top Sources</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">Ranked by net revenue contribution.</p>
            </div>
            <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.8)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {sourceRanking.length} ranked
            </span>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {sourceRanking.length > 0 ? (
              sourceRanking.map((row, index) => (
                <article key={row.cmo} className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.75)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <p className="truncate text-[1rem] font-semibold text-foreground">{row.cmo}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.65)] px-2.5 py-1 text-muted-foreground">
                          {row.docs.toLocaleString()} statements
                        </span>
                        <span className="rounded-full border border-[hsl(var(--brand-accent)/0.14)] bg-[hsl(var(--brand-accent-ghost)/0.55)] px-2.5 py-1 text-[hsl(var(--brand-accent))]">
                          {row.avgAccuracy != null ? safePercent(row.avgAccuracy) : "No confidence"}
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-muted)/0.65)]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--brand-accent)),hsl(var(--brand-accent-soft)))]"
                          style={{ width: `${Math.max(0, Math.min(100, row.sharePct))}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Net Revenue</p>
                      <p className="mt-1 font-mono text-lg text-foreground">{toCompactMoney(row.net)}</p>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading sources..." : "No source ranking data yet."}
              </div>
            )}
          </CardContent>
        </Card>

        <Card surface="evidence">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <CardTitle className="text-base">Platform Revenue Mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {platformMix.length > 0 ? (
              platformMix.map((row) => (
                <article key={row.name} className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{row.name}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{safePercent(row.sharePct)} of visible revenue</p>
                    </div>
                    <p className="shrink-0 font-mono text-sm text-foreground">{toCompactMoney(row.value)}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-elevated)/0.78)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--tone-pending)),hsl(var(--brand-accent-soft)))]"
                      style={{ width: `${Math.max(0, Math.min(100, row.sharePct))}%` }}
                    />
                  </div>
                </article>
              ))
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading platforms..." : "No platform distribution yet."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
