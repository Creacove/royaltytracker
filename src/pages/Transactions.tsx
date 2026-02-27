import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ArrowRightLeft, AlertTriangle, Info } from "lucide-react";
import { toMoney } from "@/lib/royalty";
import { format } from "date-fns";
import {
  AppliedFiltersRow,
  DetailDrawerFrame,
  EmptyStateBlock,
  FilterToolbar,
  KpiStrip,
  PageHeader,
} from "@/components/layout";
import type { TableDensity } from "@/types/ui";

type Transaction = Tables<"royalty_transactions">;
type ValidationError = Tables<"validation_errors">;
type Report = Pick<
  Tables<"cmo_reports">,
  "id" | "cmo_name" | "file_name" | "report_period" | "created_at" | "status"
>;

type GroupMode = "line" | "report" | "cmo" | "platform" | "territory" | "track";
type TransactionView = "transactions" | "issues";

export default function Transactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearchParam = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(initialSearchParam);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [selectedCmo, setSelectedCmo] = useState("all");
  const [selectedReportId, setSelectedReportId] = useState("all");
  const [selectedTerritory, setSelectedTerritory] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("line");
  const [tableDensity, setTableDensity] = useState<TableDensity>("comfortable");
  const initialViewParam = searchParams.get("view");
  const [activeView, setActiveView] = useState<TransactionView>(
    initialViewParam === "issues" ? "issues" : "transactions"
  );

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

  const { data: validationErrors = [], isLoading: isLoadingValidationErrors } = useQuery({
    queryKey: ["validation-errors"],
    queryFn: async (): Promise<ValidationError[]> => {
      const { data, error } = await supabase
        .from("validation_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
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

  useEffect(() => {
    const viewParam = searchParams.get("view");
    const nextView: TransactionView = viewParam === "issues" ? "issues" : "transactions";
    if (nextView !== activeView) setActiveView(nextView);
  }, [searchParams, activeView]);

  useEffect(() => {
    const qParam = searchParams.get("q") ?? "";
    setSearch(qParam);
  }, [searchParams]);

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

  const filteredValidationErrors = useMemo(() => {
    const s = search.trim().toLowerCase();
    return validationErrors.filter((err) => {
      const report = reportById.get(err.report_id);
      const byCmo = selectedCmo === "all" || report?.cmo_name === selectedCmo;
      const byReport = selectedReportId === "all" || err.report_id === selectedReportId;
      const bySearch =
        !s ||
        [
          err.error_type,
          err.field_name,
          err.expected_value,
          err.actual_value,
          err.message,
          report?.cmo_name,
          report?.file_name,
        ]
          .map((v) => (v ?? "").toLowerCase())
          .some((v) => v.includes(s));

      return byCmo && byReport && bySearch;
    });
  }, [reportById, search, selectedCmo, selectedReportId, validationErrors]);

  const validationMetrics = useMemo(() => {
    const critical = filteredValidationErrors.filter((e) => e.severity === "critical").length;
    const warning = filteredValidationErrors.filter((e) => e.severity === "warning").length;
    const info = filteredValidationErrors.filter((e) => e.severity === "info").length;
    return { critical, warning, info };
  }, [filteredValidationErrors]);

  const appliedFilters = useMemo(() => {
    const filters: string[] = [];
    if (search.trim()) filters.push(`Search: ${search.trim()}`);
    if (selectedCmo !== "all") filters.push(`CMO: ${selectedCmo}`);
    if (selectedReportId !== "all") {
      filters.push(`Document: ${reportById.get(selectedReportId)?.file_name ?? selectedReportId}`);
    }
    if (activeView === "transactions") {
      if (selectedTerritory !== "all") filters.push(`Territory: ${selectedTerritory}`);
      if (selectedPlatform !== "all") filters.push(`Platform: ${selectedPlatform}`);
      if (groupMode !== "line") filters.push(`Group: ${groupMode}`);
      if (tableDensity !== "comfortable") filters.push(`Density: ${tableDensity}`);
    }
    return filters;
  }, [
    activeView,
    groupMode,
    reportById,
    search,
    selectedCmo,
    selectedPlatform,
    selectedReportId,
    selectedTerritory,
    tableDensity,
  ]);

  const selectedReport = selected ? reportById.get(selected.report_id) : null;
  const denseRowClass = tableDensity === "compact" ? "[&>td]:py-2.5" : "[&>td]:py-3.5";
  const clearFilters = () => {
    setSearch("");
    setSelectedCmo("all");
    setSelectedReportId("all");
    setSelectedTerritory("all");
    setSelectedPlatform("all");
    setGroupMode("line");
    setTableDensity("comfortable");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("q");
    setSearchParams(nextParams, { replace: true });
  };

  const handleViewChange = (value: string) => {
    const nextView: TransactionView = value === "issues" ? "issues" : "transactions";
    setActiveView(nextView);
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === "issues") nextParams.set("view", "issues");
    else nextParams.delete("view");
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        title="Transactions"
        subtitle="One workspace for transaction history and validation issues."
      />

      <Tabs value={activeView} onValueChange={handleViewChange}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="issues">Issues to Review</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeView === "transactions" ? (
        <KpiStrip
          items={[
            { label: "Lines (Filtered)", value: filteredTransactions.length.toLocaleString() },
            { label: "Gross", value: toMoney(summary.gross) },
            { label: "Net", value: toMoney(summary.net) },
            { label: "Unique Tracks", value: summary.tracks.toLocaleString() },
          ]}
          columnsClassName="xl:grid-cols-4"
        />
      ) : (
        <KpiStrip
          items={[
            { label: "Critical", value: validationMetrics.critical.toLocaleString(), tone: "critical" },
            { label: "Warnings", value: validationMetrics.warning.toLocaleString(), tone: "warning" },
            { label: "Info", value: validationMetrics.info.toLocaleString(), tone: "default" },
          ]}
          columnsClassName="sm:grid-cols-3"
        />
      )}

      <FilterToolbar
        title={activeView === "transactions" ? "Transaction View" : "Issue Review"}
        description="Refine scope using CMO, statement, territory, platform, and grouping controls."
      >
          <div className="grid gap-3 md:grid-cols-7">
            <div className="relative md:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={
                  activeView === "transactions"
                    ? "Search artist, track, ISRC, CMO, file..."
                    : "Search issue type, field, value, message..."
                }
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
            {activeView === "transactions" ? (
              <>
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
                <Select value={tableDensity} onValueChange={(value) => setTableDensity(value as TableDensity)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Table Density" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comfortable">Comfortable</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>
          <AppliedFiltersRow
            filters={appliedFilters}
            onClear={clearFilters}
            updatedLabel={`Updated ${format(new Date(), "MMM d, yyyy HH:mm")}`}
          />
      </FilterToolbar>
      <Card>

        <CardContent>
          {activeView === "transactions" ? (
            isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : groupMode === "line" ? (
              filteredTransactions.length > 0 ? (
                <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                  <Table className="min-w-[1140px]">
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
                        <TableRow
                          key={tx.id}
                          role="button"
                          tabIndex={0}
                          className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${denseRowClass}`}
                          onClick={(event) => {
                            event.currentTarget.focus();
                            setSelected(tx);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelected(tx);
                            }
                          }}
                        >
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
                <EmptyStateBlock
                  icon={<ArrowRightLeft className="h-10 w-10" />}
                  title="No transactions found"
                  description="No transaction rows match your current filters."
                />
              )
            ) : grouped && grouped.length > 0 ? (
              <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                <Table className="min-w-[760px]">
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
                      <TableRow key={row.key} className={denseRowClass}>
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
              <EmptyStateBlock
                icon={<ArrowRightLeft className="h-10 w-10" />}
                title="No grouped data"
                description="No grouped transaction rows are available for this scope."
              />
            )
          ) : isLoadingValidationErrors ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filteredValidationErrors.length > 0 ? (
            <div className="min-w-0 overflow-x-auto overscroll-x-contain">
              <Table className="min-w-[1280px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>CMO</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredValidationErrors.map((err) => (
                    <TableRow key={err.id} className={denseRowClass}>
                      <TableCell>
                        <StatusBadge status={err.severity} />
                      </TableCell>
                      <TableCell>{reportById.get(err.report_id)?.cmo_name ?? "-"}</TableCell>
                      <TableCell className="max-w-[240px] truncate">
                        {reportById.get(err.report_id)?.file_name ?? "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{err.error_type}</TableCell>
                      <TableCell className="font-mono text-xs">{err.field_name ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{err.expected_value ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{err.actual_value ?? "-"}</TableCell>
                      <TableCell className="max-w-[320px] truncate">{err.message}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(err.created_at), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyStateBlock
              icon={<AlertTriangle className="h-10 w-10" />}
              title="No validation issues"
              description="No issues were found for the selected filters."
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-[min(96vw,760px)] max-w-[min(96vw,760px)] p-0 sm:max-w-[min(90vw,760px)]">
          {selected ? (
            <DetailDrawerFrame
              title="Transaction Detail"
              subtitle={selectedReport?.file_name ? `${selectedReport.file_name}` : "Statement context unavailable"}
              rightSlot={<StatusBadge status={selected.validation_status ?? "pending"} />}
            >
              <section className="grid gap-3 rounded-sm border border-border/45 bg-background/60 p-3 sm:grid-cols-2">
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
                </div>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Artist:</span>{" "}
                    <span className="font-medium">{selected.artist_name ?? "-"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Track:</span>{" "}
                    <span className="font-medium">{selected.track_title ?? "-"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Usage:</span>{" "}
                    <span className="font-medium">{selected.usage_type ?? "-"}</span>
                  </p>
                </div>
              </section>

              {[
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

              <section className="rounded-sm border border-border/45 bg-background/60 p-3 text-sm font-mono">
                <p>Source Page: {selected.source_page ?? "-"}</p>
                <p>Source Row: {selected.source_row ?? "-"}</p>
                <p>OCR Confidence: {selected.ocr_confidence ?? "-"}</p>
                <p>
                  Bounding Box:{" "}
                  {selected.bbox_x != null
                    ? `(${selected.bbox_x}, ${selected.bbox_y}) ${selected.bbox_width}x${selected.bbox_height}`
                    : "-"}
                </p>
              </section>
            </DetailDrawerFrame>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
