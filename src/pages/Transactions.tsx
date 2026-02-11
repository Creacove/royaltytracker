import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ArrowRightLeft } from "lucide-react";
import { toMoney } from "@/lib/royalty";
import { format } from "date-fns";

type Transaction = Tables<"royalty_transactions">;
type Report = Pick<
  Tables<"cmo_reports">,
  "id" | "cmo_name" | "file_name" | "report_period" | "created_at" | "status"
>;

type GroupMode = "line" | "report" | "cmo" | "platform" | "territory" | "track";

export default function Transactions() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [selectedCmo, setSelectedCmo] = useState("all");
  const [selectedReportId, setSelectedReportId] = useState("all");
  const [selectedTerritory, setSelectedTerritory] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("line");

  const { data: reports = [] } = useQuery({
    queryKey: ["tx-reports-lookup"],
    queryFn: async (): Promise<Report[]> => {
      const { data, error } = await supabase
        .from("cmo_reports")
        .select("id,cmo_name,file_name,report_period,created_at,status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from("royalty_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const reportById = useMemo(() => {
    const map = new Map<string, Report>();
    for (const report of reports) map.set(report.id, report);
    return map;
  }, [reports]);

  const cmoOptions = useMemo(
    () => Array.from(new Set(reports.map((r) => r.cmo_name))).sort((a, b) => a.localeCompare(b)),
    [reports]
  );

  const reportOptions = useMemo(() => {
    const base = selectedCmo === "all" ? reports : reports.filter((r) => r.cmo_name === selectedCmo);
    return base;
  }, [reports, selectedCmo]);

  useEffect(() => {
    if (selectedReportId === "all") return;
    const exists = reportOptions.some((r) => r.id === selectedReportId);
    if (!exists) setSelectedReportId("all");
  }, [reportOptions, selectedReportId]);

  const territoryOptions = useMemo(
    () =>
      Array.from(new Set(transactions.map((t) => t.territory).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [transactions]
  );

  const platformOptions = useMemo(
    () =>
      Array.from(new Set(transactions.map((t) => t.platform).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [transactions]
  );

  const filteredTransactions = useMemo(() => {
    const s = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      const report = reportById.get(tx.report_id);
      const byCmo = selectedCmo === "all" || report?.cmo_name === selectedCmo;
      const byReport = selectedReportId === "all" || tx.report_id === selectedReportId;
      const byTerritory = selectedTerritory === "all" || tx.territory === selectedTerritory;
      const byPlatform = selectedPlatform === "all" || tx.platform === selectedPlatform;
      const bySearch =
        !s ||
        [
          tx.artist_name,
          tx.track_title,
          tx.isrc,
          tx.iswc,
          tx.territory,
          tx.platform,
          report?.cmo_name,
          report?.file_name,
        ]
          .map((v) => (v ?? "").toLowerCase())
          .some((v) => v.includes(s));

      return byCmo && byReport && byTerritory && byPlatform && bySearch;
    });
  }, [
    reportById,
    search,
    selectedCmo,
    selectedPlatform,
    selectedReportId,
    selectedTerritory,
    transactions,
  ]);

  const summary = useMemo(() => {
    const gross = filteredTransactions.reduce((sum, tx) => sum + (tx.gross_revenue ?? 0), 0);
    const net = filteredTransactions.reduce((sum, tx) => sum + (tx.net_revenue ?? 0), 0);
    const qty = filteredTransactions.reduce((sum, tx) => sum + (tx.quantity ?? 0), 0);
    const tracks = new Set(filteredTransactions.map((tx) => tx.track_title).filter(Boolean)).size;
    return { gross, net, qty, tracks };
  }, [filteredTransactions]);

  const grouped = useMemo(() => {
    if (groupMode === "line") return null;

    const getKey = (tx: Transaction): string => {
      const report = reportById.get(tx.report_id);
      switch (groupMode) {
        case "report":
          return report ? `${report.cmo_name} | ${report.file_name}` : tx.report_id;
        case "cmo":
          return report?.cmo_name ?? "Unknown CMO";
        case "platform":
          return tx.platform ?? "Unknown Platform";
        case "territory":
          return tx.territory ?? "Unknown Territory";
        case "track":
          return tx.track_title ?? "Unknown Track";
        default:
          return "Unknown";
      }
    };

    const map = new Map<
      string,
      { key: string; lines: number; quantity: number; gross: number; net: number; distinctReports: number }
    >();
    const reportsByGroup = new Map<string, Set<string>>();

    for (const tx of filteredTransactions) {
      const key = getKey(tx);
      if (!map.has(key)) {
        map.set(key, { key, lines: 0, quantity: 0, gross: 0, net: 0, distinctReports: 0 });
        reportsByGroup.set(key, new Set<string>());
      }
      const row = map.get(key)!;
      row.lines += 1;
      row.quantity += tx.quantity ?? 0;
      row.gross += tx.gross_revenue ?? 0;
      row.net += tx.net_revenue ?? 0;
      reportsByGroup.get(key)!.add(tx.report_id);
    }

    return Array.from(map.values())
      .map((row) => ({ ...row, distinctReports: reportsByGroup.get(row.key)?.size ?? 0 }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 200);
  }, [filteredTransactions, groupMode, reportById]);

  const selectedReport = selected ? reportById.get(selected.report_id) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <p className="text-muted-foreground text-sm">
          Analyze normalized line items with CMO/document drilldowns and grouping controls.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Lines (Filtered)</p>
            <p className="text-2xl font-bold">{filteredTransactions.length.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Gross</p>
            <p className="text-2xl font-bold">{toMoney(summary.gross)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Net</p>
            <p className="text-2xl font-bold">{toMoney(summary.net)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Unique Tracks</p>
            <p className="text-2xl font-bold">{summary.tracks.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Transaction Explorer</CardTitle>
          <div className="grid gap-3 md:grid-cols-6">
            <div className="relative md:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search artist, track, ISRC, CMO, file..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={selectedCmo} onValueChange={setSelectedCmo}>
              <SelectTrigger>
                <SelectValue placeholder="CMO" />
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
            <Select value={selectedReportId} onValueChange={setSelectedReportId}>
              <SelectTrigger>
                <SelectValue placeholder="Document" />
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
            <Select value={selectedTerritory} onValueChange={setSelectedTerritory}>
              <SelectTrigger>
                <SelectValue placeholder="Territory" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Territories</SelectItem>
                {territoryOptions.map((territory) => (
                  <SelectItem key={territory} value={territory}>
                    {territory}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                {platformOptions.map((platform) => (
                  <SelectItem key={platform} value={platform}>
                    {platform}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupMode} onValueChange={(v) => setGroupMode(v as GroupMode)}>
              <SelectTrigger className="md:col-span-2">
                <SelectValue placeholder="Group By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="line">Line Items</SelectItem>
                <SelectItem value="report">Document</SelectItem>
                <SelectItem value="cmo">CMO</SelectItem>
                <SelectItem value="platform">Platform</SelectItem>
                <SelectItem value="territory">Territory</SelectItem>
                <SelectItem value="track">Track</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : groupMode === "line" ? (
            filteredTransactions.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CMO</TableHead>
                      <TableHead>Track</TableHead>
                      <TableHead>Artist</TableHead>
                      <TableHead>ISRC</TableHead>
                      <TableHead>Territory</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTransactions.map((tx) => (
                      <TableRow key={tx.id} className="cursor-pointer" onClick={() => setSelected(tx)}>
                        <TableCell>{reportById.get(tx.report_id)?.cmo_name ?? "-"}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{tx.track_title ?? "-"}</TableCell>
                        <TableCell>{tx.artist_name ?? "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{tx.isrc ?? "-"}</TableCell>
                        <TableCell>{tx.territory ?? "-"}</TableCell>
                        <TableCell>{tx.platform ?? "-"}</TableCell>
                        <TableCell className="text-right font-mono">{tx.quantity ?? "-"}</TableCell>
                        <TableCell className="text-right font-mono">{toMoney(tx.gross_revenue)}</TableCell>
                        <TableCell className="text-right font-mono">{toMoney(tx.net_revenue)}</TableCell>
                        <TableCell>
                          <StatusBadge status={tx.validation_status ?? "pending"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="flex flex-col items-center py-10 text-center">
                <ArrowRightLeft className="mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No transactions found for the current filters.</p>
              </div>
            )
          ) : grouped && grouped.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{groupMode.toUpperCase()}</TableHead>
                    <TableHead className="text-right">Docs</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.key}</TableCell>
                      <TableCell className="text-right font-mono">{row.distinctReports}</TableCell>
                      <TableCell className="text-right font-mono">{row.lines.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{row.quantity.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{toMoney(row.gross)}</TableCell>
                      <TableCell className="text-right font-mono">{toMoney(row.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <ArrowRightLeft className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No grouped transaction data available.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Transaction Detail</SheetTitle>
          </SheetHeader>

          {selected ? (
            <div className="mt-6 space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Document Context
                  </p>
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">CMO:</span>{" "}
                      <span className="font-medium">{selectedReport?.cmo_name ?? "-"}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">File:</span>{" "}
                      <span className="font-medium">{selectedReport?.file_name ?? "-"}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Period:</span>{" "}
                      <span className="font-medium">{selectedReport?.report_period ?? "-"}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Uploaded:</span>{" "}
                      <span className="font-medium">
                        {selectedReport?.created_at
                          ? format(new Date(selectedReport.created_at), "MMM d, yyyy HH:mm")
                          : "-"}
                      </span>
                    </p>
                  </div>
                </CardContent>
              </Card>

              {[
                ["Artist", selected.artist_name],
                ["Track", selected.track_title],
                ["ISRC", selected.isrc],
                ["ISWC", selected.iswc],
                ["Territory", selected.territory],
                ["Platform", selected.platform],
                ["Usage Type", selected.usage_type],
                ["Quantity", selected.quantity?.toLocaleString()],
                ["Gross Revenue", toMoney(selected.gross_revenue)],
                ["Commission", toMoney(selected.commission)],
                ["Net Revenue", toMoney(selected.net_revenue)],
                ["Currency", selected.currency],
                [
                  "Period",
                  selected.period_start && selected.period_end
                    ? `${selected.period_start} -> ${selected.period_end}`
                    : null,
                ],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between border-b py-2">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm font-medium font-mono">{value ?? "-"}</span>
                </div>
              ))}

              <Card>
                <CardContent className="pt-4 text-sm font-mono">
                  <p>Source Page: {selected.source_page ?? "-"}</p>
                  <p>Source Row: {selected.source_row ?? "-"}</p>
                  <p>OCR Confidence: {selected.ocr_confidence ?? "-"}</p>
                  <p>
                    Bounding Box:{" "}
                    {selected.bbox_x != null
                      ? `(${selected.bbox_x}, ${selected.bbox_y}) ${selected.bbox_width}x${selected.bbox_height}`
                      : "-"}
                  </p>
                </CardContent>
              </Card>

              <StatusBadge status={selected.validation_status ?? "pending"} />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
