
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseLooseNumber, safePercent, toCompactMoney, toMoney } from "@/lib/royalty";

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

const CHART_COLORS = [
  "hsl(250 65% 55%)",
  "hsl(160 65% 42%)",
  "hsl(30 95% 52%)",
  "hsl(355 72% 55%)",
  "hsl(205 76% 48%)",
  "hsl(338 72% 52%)",
];

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

  const topCmo = cmoScorecard[0];
  const loading = reportsLoading || txLoading || extractorLoading;
  const criticalError = reportsError || txError || extractorError;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Revenue pulse, report progress, and CMO performance at a glance.
          </p>
        </div>
        {topCmo ? (
          <Badge variant="outline" className="font-mono text-xs">
            Top CMO: {topCmo.cmo} ({toCompactMoney(topCmo.net)})
          </Badge>
        ) : null}
      </div>

      {!extractorAvailable ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="pt-4 text-sm">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-warning" />
              <p>
                Extractor table `document_ai_report_items` is not available in this environment yet.
                The dashboard is running from normalized transactions only.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {criticalError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-4 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
              <p>
                Dashboard data failed to load: {String((criticalError as Error).message ?? criticalError)}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="border-primary/25 bg-gradient-to-br from-primary/15 via-primary/5 to-background xl:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Publisher Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Net Revenue</p>
                <p className="text-2xl font-bold">{toMoney(metrics.net)}</p>
                <p className="text-xs text-muted-foreground">Gross {toMoney(metrics.gross)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Statements</p>
                <p className="text-2xl font-bold">{metrics.totalReports.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">
                  {metrics.completedReports} completed | {metrics.processingReports} in-flight
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Commission</p>
                <p className="text-2xl font-bold">{toMoney(metrics.commission)}</p>
                <p className="text-xs text-muted-foreground">
                  Effective rate {safePercent(metrics.commissionRate)}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">Processing Success</p>
                <p className="mt-1 text-lg font-semibold">{safePercent(metrics.processingRate)}</p>
                <Progress value={Math.max(0, Math.min(100, metrics.processingRate))} className="mt-2 h-2" />
              </div>
              <div className="rounded-md border bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">Avg Extraction Accuracy</p>
                <p className="mt-1 text-lg font-semibold">{safePercent(metrics.avgAccuracy)}</p>
                <Progress
                  value={Math.max(0, Math.min(100, metrics.avgAccuracy ?? 0))}
                  className="mt-2 h-2"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Publishing Priorities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Reports In Progress</p>
              <p className="mt-1 text-xl font-semibold">{metrics.processingReports}</p>
              <p className="text-xs text-muted-foreground">Currently being processed</p>
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Reports Needing Attention</p>
              <p className="mt-1 text-xl font-semibold">{metrics.failedReports}</p>
              <p className="text-xs text-muted-foreground">Require review or reprocessing</p>
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Active CMOs</p>
              <p className="mt-1 text-xl font-semibold">{metrics.activeCmos}</p>
              <p className="text-xs text-muted-foreground">Publishing partners this period</p>
            </div>
            {metrics.totalReports === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Upload your first CMO report to start tracking performance.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Revenue Trend (12 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={monthlyTrend}>
                  <defs>
                    <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(250 65% 55%)" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="hsl(250 65% 55%)" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="grossFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(160 65% 42%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(160 65% 42%)" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => toMoney(value)}
                    labelFormatter={(value) => `Month: ${value}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="gross"
                    stroke="hsl(160 65% 42%)"
                    fill="url(#grossFill)"
                    strokeWidth={1.8}
                  />
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="hsl(250 65% 55%)"
                    fill="url(#netFill)"
                    strokeWidth={2.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading trend..." : "No trend data yet."}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
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
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => toMoney(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {platformData.map((row, idx) => (
                    <div key={row.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
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
        <Card className="xl:col-span-2">
          <CardHeader>
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
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={84} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => toMoney(value)} />
                    <Bar dataKey="value" fill="hsl(160 65% 42%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                <div className="rounded-md border p-3">
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
                              <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => `${value.toLocaleString()} report(s)`} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1">
                        {reportStatusMix.map((row, idx) => (
                          <div key={row.status} className="flex items-center gap-2 text-[11px]">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
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

        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTower className="h-4 w-4" />
              CMO Performance Scorecard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cmoScorecard.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CMO</TableHead>
                      <TableHead className="text-right">Docs</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Accuracy</TableHead>
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
              </div>
            ) : (
              <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                No CMO performance data yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {metrics.failedReports === 0 && metrics.processingReports === 0 && metrics.totalReports > 0 ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex items-center gap-2 pt-4 text-sm">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span>All statements are completed with no current processing backlog.</span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
