
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  RadioTower,
  ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const CHART_CATEGORY_COLORS = [
  "hsl(var(--brand-accent))",
  "hsl(var(--tone-pending))",
  "hsl(var(--tone-success))",
  "hsl(var(--tone-info))",
  "hsl(var(--tone-warning))",
  "hsl(var(--tone-archived))",
];
const CHART_STATUS_COLORS: Record<string, string> = {
  completed: "hsl(var(--tone-success))",
  completed_passed: "hsl(var(--tone-success))",
  completed_with_warnings: "hsl(var(--tone-warning))",
  needs_review: "hsl(var(--brand-accent))",
  processing: "hsl(var(--tone-pending))",
  pending: "hsl(var(--tone-pending))",
  failed: "hsl(var(--tone-critical))",
};
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

function safeDateLabel(input: string | null | undefined, pattern = "MMM d, yyyy"): string {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, pattern);
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

function nonEmptyValue(value: string | null | undefined): boolean {
  return !!value && value.trim() !== "";
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
    queryFn: async (): Promise<Tx[]> => {
      const { data, error } = await supabase
        .from("royalty_transactions")
        .select("report_id,territory,platform,gross_revenue,net_revenue,commission,quantity,track_title,artist_name")
        .limit(9000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: extractor = { rows: [], available: true },
    isLoading: extractorLoading,
    error: extractorError,
  } = useQuery({
    queryKey: ["dashboard-document-ai-items"],
    queryFn: async (): Promise<ExtractorPayload> => {
      const { data, error } = await supabase
        .from("document_ai_report_items")
        .select(
          "report_id,country,channel,report_date,isrc,track_title,amount_in_original_currency,amount_in_reporting_currency,royalty_revenue,master_commission"
        )
        .limit(12000);

      if (error) {
        if (isMissingRelationError(error, "document_ai_report_items")) {
          return { rows: [], available: false };
        }
        throw error;
      }

      return { rows: data ?? [], available: true };
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
    const commission = hasTxFinance ? commissionFromTx : commissionFromExtractor;

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
      .filter((v): v is number => typeof v === "number");
    const avgAccuracy =
      accuracyValues.length > 0
        ? accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length
        : null;

    const extractedLines =
      transactions.length > 0
        ? transactions.length
        : items.length > 0
          ? items.length
          : reports.reduce((sum, r) => sum + (r.transaction_count ?? 0), 0);

    return {
      gross,
      net,
      commission,
      commissionRate: gross > 0 ? (commission / gross) * 100 : null,
      totalReports,
      completedReports,
      failedReports,
      processingReports,
      processingRate,
      activeCmos,
      avgAccuracy,
      extractedLines,
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

  const territoryData = useMemo(() => {
    const map = new Map<string, number>();
    if (transactions.length > 0) {
      for (const tx of transactions) {
        const key = tx.territory ?? "Unknown";
        map.set(key, (map.get(key) ?? 0) + (tx.net_revenue ?? 0));
      }
    } else {
      for (const row of items) {
        const key = row.country ?? "Unknown";
        map.set(key, (map.get(key) ?? 0) + extractorRevenue(row));
      }
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [items, transactions]);

  const platformData = useMemo(() => {
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
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [items, transactions]);

  const cmoScorecard = useMemo(() => {
    const map = new Map<
      string,
      {
        cmo: string;
        docs: number;
        lines: number;
        gross: number;
        net: number;
        failed: number;
        processing: number;
        accuracySum: number;
        accuracyCount: number;
        lastUpload: string | null;
        territoryTotals: Map<string, number>;
        platformTotals: Map<string, number>;
      }
    >();

    for (const report of reports) {
      if (!map.has(report.cmo_name)) {
        map.set(report.cmo_name, {
          cmo: report.cmo_name,
          docs: 0,
          lines: 0,
          gross: 0,
          net: 0,
          failed: 0,
          processing: 0,
          accuracySum: 0,
          accuracyCount: 0,
          lastUpload: null,
          territoryTotals: new Map<string, number>(),
          platformTotals: new Map<string, number>(),
        });
      }

      const row = map.get(report.cmo_name)!;
      row.docs += 1;
      row.lines += report.transaction_count ?? 0;
      if (report.status === "failed") row.failed += 1;
      if (report.status === "processing" || report.status === "pending") row.processing += 1;
      if (report.accuracy_score != null) {
        row.accuracySum += report.accuracy_score;
        row.accuracyCount += 1;
      }

      if (!row.lastUpload || new Date(report.created_at) > new Date(row.lastUpload)) {
        row.lastUpload = report.created_at;
      }
    }

    if (transactions.length > 0) {
      for (const tx of transactions) {
        const report = reportById.get(tx.report_id);
        if (!report) continue;
        const row = map.get(report.cmo_name);
        if (!row) continue;
        row.gross += tx.gross_revenue ?? 0;
        row.net += tx.net_revenue ?? 0;
        if (tx.territory) {
          row.territoryTotals.set(
            tx.territory,
            (row.territoryTotals.get(tx.territory) ?? 0) + (tx.net_revenue ?? 0)
          );
        }
        if (tx.platform) {
          row.platformTotals.set(
            tx.platform,
            (row.platformTotals.get(tx.platform) ?? 0) + (tx.net_revenue ?? 0)
          );
        }
      }
    } else {
      for (const item of items) {
        const report = reportById.get(item.report_id);
        if (!report) continue;
        const row = map.get(report.cmo_name);
        if (!row) continue;
        const gross = extractorRevenue(item);
        row.gross += gross;
        row.net += Math.max(0, gross - extractorCommission(item));
        if (item.country) {
          row.territoryTotals.set(item.country, (row.territoryTotals.get(item.country) ?? 0) + gross);
        }
        if (item.channel) {
          row.platformTotals.set(item.channel, (row.platformTotals.get(item.channel) ?? 0) + gross);
        }
      }
    }

    const toTopKey = (bucket: Map<string, number>): string | null => {
      let bestKey: string | null = null;
      let bestValue = -1;
      for (const [key, value] of bucket.entries()) {
        if (value > bestValue) {
          bestValue = value;
          bestKey = key;
        }
      }
      return bestKey;
    };

    return Array.from(map.values())
      .map((row) => ({
        cmo: row.cmo,
        docs: row.docs,
        lines: row.lines,
        gross: row.gross,
        net: row.net,
        failed: row.failed,
        processing: row.processing,
        avgAccuracy: row.accuracyCount > 0 ? row.accuracySum / row.accuracyCount : null,
        lastUpload: row.lastUpload,
        topTerritory: toTopKey(row.territoryTotals),
        topPlatform: toTopKey(row.platformTotals),
      }))
      .sort((a, b) => b.net - a.net);
  }, [items, reportById, reports, transactions]);

  const reportStatusMix = useMemo(() => {
    const order = ["completed", "completed_passed", "completed_with_warnings", "needs_review", "processing", "pending", "failed"];
    const labelFor = (status: string) => {
      switch (status) {
        case "completed":
        case "completed_passed":
          return "Completed";
        case "completed_with_warnings":
          return "Completed w/ Warnings";
        case "needs_review":
          return "Needs Review";
        case "processing":
          return "Processing";
        case "pending":
          return "Pending";
        case "failed":
          return "Failed";
        default:
          return status;
      }
    };

    const byStatus = new Map<string, number>();
    for (const report of reports) {
      byStatus.set(report.status, (byStatus.get(report.status) ?? 0) + 1);
    }

    return order
      .filter((status) => (byStatus.get(status) ?? 0) > 0)
      .map((status) => ({
        status,
        label: labelFor(status),
        value: byStatus.get(status) ?? 0,
      }));
  }, [reports]);

  const loading = reportsLoading || txLoading || extractorLoading;
  const criticalError = reportsError || txError || extractorError;

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        title="Dashboard"
        meta={
          <>
            <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.7)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
              {metrics.activeCmos} sources
            </span>
            <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-elevated)/0.84)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
              {metrics.extractedLines.toLocaleString()} lines
            </span>
          </>
        }
        actions={
          <Button asChild size="sm">
            <Link to="/ai-insights">AI Insights</Link>
          </Button>
        }
      />

      {!extractorAvailable ? (
        <Card surface="muted">
          <CardContent className="px-4 py-4">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-foreground" />
            <p>
              Extractor table `document_ai_report_items` is not available in this environment yet.
              The dashboard is running from normalized transactions only.
            </p>
          </div>
          </CardContent>
        </Card>
      ) : null}

      {criticalError ? (
        <Card surface="critical">
          <CardContent className="px-4 py-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-foreground" />
            <p>
              Dashboard data failed to load: {String((criticalError as Error).message ?? criticalError)}
            </p>
          </div>
          </CardContent>
        </Card>
      ) : null}

      <KpiStrip
        variant="hero"
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
            hint: `${metrics.completedReports} completed | ${metrics.processingReports} in-flight`,
            tone: "default",
          },
          {
            label: "Commission",
            value: toMoney(metrics.commission),
            hint: `Effective rate ${safePercent(metrics.commissionRate)}`,
            tone: "default",
          },
          {
            label: "Reports In Progress",
            value: metrics.processingReports.toLocaleString(),
            hint: "Currently being processed",
            tone: metrics.processingReports > 0 ? "accent" : "default",
          },
          {
            label: "Reports Needing Attention",
            value: metrics.failedReports.toLocaleString(),
            hint: "Require review or reprocessing",
            tone: metrics.failedReports > 0 ? "critical" : "success",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.75fr)]">
        <Card surface="hero">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
            <CardTitle className="text-[1.2rem]">Operational confidence</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Processing success</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{safePercent(metrics.processingRate)}</p>
              <Progress
                value={Math.max(0, Math.min(100, metrics.processingRate))}
                className="mt-4 h-3"
              />
            </div>
            <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
              <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">System confidence</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{safePercent(metrics.avgAccuracy)}</p>
              <Progress
                value={Math.max(0, Math.min(100, metrics.avgAccuracy ?? 0))}
                className="mt-4 h-3"
              />
            </div>
          </CardContent>
        </Card>

        <Card surface="evidence">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
            <CardTitle className="text-[1.2rem]">Backlog</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Needs attention</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{metrics.failedReports.toLocaleString()}</p>
              </div>
              <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">In progress</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{metrics.processingReports.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card surface="hero" className="xl:col-span-3">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <CardTitle className="text-base">Revenue Trend (12 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={monthlyTrend}>
                  <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.16} vertical={false} />
                  <XAxis dataKey="label" tick={CHART_TICK_STYLE} axisLine={CHART_AXIS_STYLE} tickLine={false} />
                  <YAxis
                    yAxisId="revenue"
                    tick={CHART_TICK_STYLE}
                    axisLine={CHART_AXIS_STYLE}
                    tickLine={false}
                    tickFormatter={(value: number) => toCompactMoney(value)}
                    width={68}
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
                    cursor={{ fill: "hsla(0, 0%, 9%, 0.06)" }}
                  />
                  <Bar
                    yAxisId="revenue"
                    dataKey="gross"
                    name="Gross Revenue"
                    fill="hsl(var(--tone-pending))"
                    fillOpacity={0.4}
                    maxBarSize={30}
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    yAxisId="revenue"
                    type="monotone"
                    dataKey="net"
                    name="Net Revenue"
                    stroke="hsl(var(--brand-accent))"
                    strokeWidth={2.4}
                    dot={{ r: 2.5, strokeWidth: 1, fill: "hsl(var(--brand-accent))", stroke: "hsl(var(--background))" }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading trend..." : "No trend data yet."}
              </div>
            )}
          </CardContent>
        </Card>

        <Card surface="evidence" className="xl:col-span-2">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <CardTitle className="text-base">Platform Revenue Mix</CardTitle>
          </CardHeader>
          <CardContent>
            {platformData.length > 0 ? (
              <div className="flex items-center gap-3">
                <ResponsiveContainer width="55%" height={300}>
                  <PieChart>
                    <Pie
                      data={platformData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={98}
                      paddingAngle={2}
                    >
                      {platformData.map((_, idx) => (
                        <Cell key={idx} fill={CHART_CATEGORY_COLORS[idx % CHART_CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => toMoney(value)}
                      contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                      labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                      itemStyle={{ color: "hsl(0 0% 9%)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {platformData.map((row, idx) => (
                    <div key={row.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2.5 w-2.5 border border-border"
                        style={{ backgroundColor: CHART_CATEGORY_COLORS[idx % CHART_CATEGORY_COLORS.length] }}
                      />
                      <span className="max-w-[130px] truncate text-muted-foreground">{row.name}</span>
                      <span className="font-mono">{toCompactMoney(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading platforms..." : "No platform distribution yet."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card surface="evidence" className="xl:col-span-2">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="h-4 w-4" />
              Top Territories
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {territoryData.length > 0 ? (
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={territoryData} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid stroke="hsl(0 0% 9%)" strokeDasharray="2 4" strokeOpacity={0.14} vertical={false} />
                    <XAxis
                      type="number"
                      tick={CHART_TICK_STYLE}
                      axisLine={CHART_AXIS_STYLE}
                      tickLine={false}
                      tickFormatter={(value) => toCompactMoney(Number(value))}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={84}
                      tick={CHART_TICK_STYLE}
                      axisLine={CHART_AXIS_STYLE}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number) => toMoney(value)}
                      contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                      labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                      itemStyle={{ color: "hsl(0 0% 9%)" }}
                    />
                    <Bar dataKey="value" fill="hsl(var(--tone-pending))" radius={[0, 0, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                <div className="border-t border-black/20 pt-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Report Status Mix</p>
                  {reportStatusMix.length > 0 ? (
                    <div className="flex items-center gap-3">
                      <ResponsiveContainer width="50%" height={130}>
                        <PieChart>
                          <Pie
                            data={reportStatusMix}
                            dataKey="value"
                            cx="50%"
                            cy="50%"
                            innerRadius={28}
                            outerRadius={46}
                            paddingAngle={2}
                          >
                            {reportStatusMix.map((_, idx) => (
                              <Cell
                                key={idx}
                                fill={CHART_STATUS_COLORS[reportStatusMix[idx].status] ?? CHART_CATEGORY_COLORS[idx % CHART_CATEGORY_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number) => `${value.toLocaleString()} report(s)`}
                            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                            itemStyle={{ color: "hsl(0 0% 9%)" }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1">
                        {reportStatusMix.map((row, idx) => (
                          <div key={row.status} className="flex items-center gap-2 text-[11px]">
                            <span
                              className="h-2.5 w-2.5 border border-border"
                              style={{
                                backgroundColor:
                                  CHART_STATUS_COLORS[row.status] ?? CHART_CATEGORY_COLORS[idx % CHART_CATEGORY_COLORS.length],
                              }}
                            />
                            <span className="max-w-[120px] truncate text-muted-foreground">{row.label}</span>
                            <span className="font-mono">{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-[130px] items-center justify-center text-xs text-muted-foreground">
                      No report status data yet.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-[324px] items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading territories..." : "No territory data yet."}
              </div>
            )}
          </CardContent>
        </Card>

        <Card surface="evidence" className="xl:col-span-3">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4 pt-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTower className="h-4 w-4" />
              CMO Performance Scorecard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cmoScorecard.length > 0 ? (
                <Table className="min-w-[860px]" variant="evidence" density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>CMO</TableHead>
                      <TableHead className="text-right">Docs</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead>Top Territory</TableHead>
                      <TableHead>Top Platform</TableHead>
                      <TableHead>Last Upload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cmoScorecard.slice(0, 10).map((row) => (
                      <TableRow key={row.cmo}>
                        <TableCell className="font-medium">{row.cmo}</TableCell>
                        <TableCell className="text-right font-mono">{row.docs}</TableCell>
                        <TableCell className="text-right font-mono">{row.lines.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{toCompactMoney(row.net)}</TableCell>
                        <TableCell className="text-right font-mono">{safePercent(row.avgAccuracy)}</TableCell>
                        <TableCell>{row.topTerritory ?? "-"}</TableCell>
                        <TableCell>{row.topPlatform ?? "-"}</TableCell>
                        <TableCell>{safeDateLabel(row.lastUpload)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            ) : (
              <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                No CMO performance data yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {metrics.failedReports === 0 && metrics.processingReports === 0 && metrics.totalReports > 0 ? (
        <Card surface="muted">
          <CardContent className="pt-5">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-foreground" />
            <span>All statements are completed with no current processing backlog.</span>
          </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
