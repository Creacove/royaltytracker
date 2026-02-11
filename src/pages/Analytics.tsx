import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { toMoney } from "@/lib/royalty";

type Report = Pick<Tables<"cmo_reports">, "id" | "cmo_name" | "file_name" | "status">;
type Tx = Pick<
  Tables<"royalty_transactions">,
  "report_id" | "artist_name" | "track_title" | "territory" | "platform" | "net_revenue"
>;
type Item = Pick<
  Tables<"document_ai_report_items">,
  | "report_id"
  | "country"
  | "channel"
  | "config_type"
  | "report_item"
  | "amount_in_original_currency"
  | "amount_in_reporting_currency"
  | "exchange_rate"
  | "isrc"
  | "label"
  | "master_commission"
  | "original_currency"
  | "quantity"
  | "release_artist"
  | "release_title"
  | "release_upc"
  | "report_date"
  | "reporting_currency"
  | "royalty_revenue"
  | "sales_end"
  | "sales_start"
  | "track_artist"
  | "track_title"
  | "unit"
>;

const COLORS = [
  "hsl(250 65% 55%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(0 72% 51%)",
  "hsl(200 70% 50%)",
  "hsl(320 62% 52%)",
];

const FIELD_LABELS: Array<keyof Item> = [
  "report_item",
  "amount_in_original_currency",
  "amount_in_reporting_currency",
  "channel",
  "config_type",
  "country",
  "exchange_rate",
  "isrc",
  "label",
  "master_commission",
  "original_currency",
  "quantity",
  "release_artist",
  "release_title",
  "release_upc",
  "report_date",
  "reporting_currency",
  "royalty_revenue",
  "sales_end",
  "sales_start",
  "track_artist",
  "track_title",
  "unit",
];

function revenueBy<T extends string>(
  rows: Tx[],
  keyGetter: (row: Tx) => T | null | undefined
): Array<{ name: string; value: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyGetter(row) || "Unknown";
    map.set(key, (map.get(key) ?? 0) + (row.net_revenue ?? 0));
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

export default function Analytics() {
  const [selectedCmo, setSelectedCmo] = useState("all");
  const [selectedReport, setSelectedReport] = useState("all");

  const { data: reports = [] } = useQuery({
    queryKey: ["analytics-reports"],
    queryFn: async (): Promise<Report[]> => {
      const { data, error } = await supabase
        .from("cmo_reports")
        .select("id,cmo_name,file_name,status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["analytics-transactions"],
    queryFn: async (): Promise<Tx[]> => {
      const { data, error } = await supabase
        .from("royalty_transactions")
        .select("report_id,artist_name,track_title,territory,platform,net_revenue")
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: extractedRows = [] } = useQuery({
    queryKey: ["analytics-document-ai-items"],
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from("document_ai_report_items")
        .select(
          "report_id,country,channel,config_type,report_item,amount_in_original_currency,amount_in_reporting_currency,exchange_rate,isrc,label,master_commission,original_currency,quantity,release_artist,release_title,release_upc,report_date,reporting_currency,royalty_revenue,sales_end,sales_start,track_artist,track_title,unit"
        )
        .limit(9000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cmoOptions = useMemo(
    () => Array.from(new Set(reports.map((r) => r.cmo_name))).sort((a, b) => a.localeCompare(b)),
    [reports]
  );

  const reportOptions = useMemo(() => {
    const base = selectedCmo === "all" ? reports : reports.filter((r) => r.cmo_name === selectedCmo);
    return base;
  }, [reports, selectedCmo]);

  useEffect(() => {
    if (selectedReport === "all") return;
    const exists = reportOptions.some((r) => r.id === selectedReport);
    if (!exists) setSelectedReport("all");
  }, [reportOptions, selectedReport]);

  const filteredReportIds = useMemo(() => {
    const relevant = reports.filter((r) => {
      const byCmo = selectedCmo === "all" || r.cmo_name === selectedCmo;
      const byReport = selectedReport === "all" || r.id === selectedReport;
      return byCmo && byReport;
    });
    return new Set(relevant.map((r) => r.id));
  }, [reports, selectedCmo, selectedReport]);

  const filteredTx = useMemo(
    () => transactions.filter((tx) => filteredReportIds.has(tx.report_id)),
    [filteredReportIds, transactions]
  );

  const filteredItems = useMemo(
    () => extractedRows.filter((row) => filteredReportIds.has(row.report_id)),
    [extractedRows, filteredReportIds]
  );

  const byTerritory = useMemo(() => revenueBy(filteredTx, (tx) => tx.territory), [filteredTx]);
  const byPlatform = useMemo(() => revenueBy(filteredTx, (tx) => tx.platform), [filteredTx]);
  const byTrack = useMemo(() => revenueBy(filteredTx, (tx) => tx.track_title), [filteredTx]);

  const configTypeMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of filteredItems) {
      const key = row.config_type || "Unknown";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredItems]);

  const fieldCoverage = useMemo(() => {
    const total = filteredItems.length;
    if (total === 0) return [];
    return FIELD_LABELS.map((field) => {
      const populated = filteredItems.reduce((sum, row) => {
        const value = row[field];
        return value != null && String(value).trim() !== "" ? sum + 1 : sum;
      }, 0);
      return {
        field,
        populated,
        coverage: (populated / total) * 100,
      };
    }).sort((a, b) => b.coverage - a.coverage);
  }, [filteredItems]);

  if (reports.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-sm">Publisher-facing revenue and extraction analytics</p>
        </div>
        <div className="flex flex-col items-center py-20 text-center">
          <BarChart3 className="mb-3 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">No data yet. Process reports to unlock analytics.</p>
        </div>
      </div>
    );
  }

  const totalNet = filteredTx.reduce((sum, tx) => sum + (tx.net_revenue ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm">
          Slice performance by CMO/document and validate field coverage from your extractor.
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Scope</CardTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={selectedCmo} onValueChange={setSelectedCmo}>
              <SelectTrigger>
                <SelectValue placeholder="Select CMO" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All CMOs</SelectItem>
                {cmoOptions.map((cmo) => (
                  <SelectItem key={cmo} value={cmo}>
                    {cmo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedReport} onValueChange={setSelectedReport}>
              <SelectTrigger>
                <SelectValue placeholder="Select Document" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Documents</SelectItem>
                {reportOptions.map((report) => (
                  <SelectItem key={report.id} value={report.id}>
                    {report.file_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Net in scope: </span>
              <span className="font-mono font-semibold">{toMoney(totalNet)}</span>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Territory</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byTerritory}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => toMoney(v)} />
                <Bar dataKey="value" fill="hsl(250 65% 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {byPlatform.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="56%" height={300}>
                  <PieChart>
                    <Pie data={byPlatform} dataKey="value" innerRadius={56} outerRadius={98} paddingAngle={2}>
                      {byPlatform.map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => toMoney(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {byPlatform.map((row, idx) => (
                    <div key={row.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                      />
                      <span className="text-muted-foreground">{row.name}</span>
                      <span className="font-mono">{toMoney(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                No platform data.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Tracks by Net Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={byTrack} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => toMoney(v)} />
                <Bar dataKey="value" fill="hsl(142 71% 45%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Config Type Mix (Extractor Rows)</CardTitle>
          </CardHeader>
          <CardContent>
            {configTypeMix.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={configTypeMix} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(38 92% 50%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                No config type data.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extractor Field Coverage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fieldCoverage.length > 0 ? (
            fieldCoverage.map((row) => (
              <div key={row.field} className="grid grid-cols-12 items-center gap-3 rounded-md border p-2 text-sm">
                <span className="col-span-4 font-mono text-xs">{row.field}</span>
                <div className="col-span-6 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${Math.max(2, row.coverage)}%` }}
                  />
                </div>
                <span className="col-span-2 text-right font-mono text-xs">
                  {row.populated}/{filteredItems.length}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No extractor rows in this scope.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
