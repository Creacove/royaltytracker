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
import { Search, ArrowRightLeft } from "lucide-react";
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
type Report = Pick<
  Tables<"cmo_reports">,
  "id" | "cmo_name" | "file_name" | "report_period" | "created_at" | "status"
>;

type GroupMode = "line" | "report" | "cmo" | "platform" | "territory" | "track";

const normalizeIsrcValue = (value: string | null | undefined): string =>
  (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function Transactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearchParam = searchParams.get("q") ?? "";
  const deepLinkTrackKey = searchParams.get("track_key")?.trim() ?? "";
  const deepLinkTrackTitle = searchParams.get("track_title")?.trim() ?? "";
  const deepLinkArtistName = searchParams.get("artist_name")?.trim() ?? "";
  const deepLinkIsrcRaw = searchParams.get("isrc")?.trim() ?? "";
  const deepLinkIsrcFromTrackKey = deepLinkTrackKey.startsWith("isrc:") ? deepLinkTrackKey.slice(5) : "";
  const deepLinkIsrc = deepLinkIsrcRaw || deepLinkIsrcFromTrackKey;
  const hasTrackDeepLink = Boolean(deepLinkTrackTitle || deepLinkArtistName || deepLinkIsrc);

  const [search, setSearch] = useState(initialSearchParam);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [selectedCmo, setSelectedCmo] = useState("all");
  const [selectedReportId, setSelectedReportId] = useState("all");
  const [selectedTerritory, setSelectedTerritory] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("line");
  const [tableDensity, setTableDensity] = useState<TableDensity>("comfortable");

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
    queryKey: ["transactions", deepLinkTrackTitle, deepLinkArtistName, deepLinkIsrc],
    queryFn: async (): Promise<Transaction[]> => {
      let query = supabase.from("royalty_transactions").select("*").order("created_at", { ascending: false });
      if (deepLinkTrackTitle) query = query.ilike("track_title", `%${deepLinkTrackTitle}%`);
      if (deepLinkArtistName) query = query.ilike("artist_name", `%${deepLinkArtistName}%`);
      if (!deepLinkTrackTitle && !deepLinkArtistName && deepLinkIsrc) {
        query = query.ilike("isrc", `%${deepLinkIsrc}%`);
      }
      const { data, error } = await query.limit(hasTrackDeepLink ? 20000 : 5000);
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
    const deepLinkTrack = deepLinkTrackTitle.toLowerCase();
    const deepLinkArtist = deepLinkArtistName.toLowerCase();
    const deepLinkIsrcNormalized = normalizeIsrcValue(deepLinkIsrc);
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

      const txTrack = (tx.track_title ?? "").toLowerCase();
      const txArtist = (tx.artist_name ?? "").toLowerCase();
      const txIsrcNormalized = normalizeIsrcValue(tx.isrc);
      const titleMatch = deepLinkTrack ? txTrack.includes(deepLinkTrack) : true;
      const artistMatch = deepLinkArtist ? txArtist.includes(deepLinkArtist) : true;
      const isrcMatch = deepLinkIsrcNormalized ? txIsrcNormalized === deepLinkIsrcNormalized : false;
      const byTrackDeepLink = !hasTrackDeepLink || isrcMatch || (titleMatch && artistMatch);

      return byCmo && byReport && byTerritory && byPlatform && bySearch && byTrackDeepLink;
    });
  }, [
    deepLinkArtistName,
    deepLinkIsrc,
    deepLinkTrackTitle,
    hasTrackDeepLink,
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
  const noTransactionsAvailable = transactions.length === 0;

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

  const appliedFilters = useMemo(() => {
    const filters: string[] = [];
    if (search.trim()) filters.push(`Search: ${search.trim()}`);
    if (hasTrackDeepLink) {
      filters.push(`Track scope: ${deepLinkTrackTitle || deepLinkIsrc || deepLinkTrackKey}`);
    }
    if (selectedCmo !== "all") filters.push(`CMO: ${selectedCmo}`);
    if (selectedReportId !== "all") {
      filters.push(`Document: ${reportById.get(selectedReportId)?.file_name ?? selectedReportId}`);
    }
    if (selectedTerritory !== "all") filters.push(`Territory: ${selectedTerritory}`);
    if (selectedPlatform !== "all") filters.push(`Platform: ${selectedPlatform}`);
    if (groupMode !== "line") filters.push(`Group: ${groupMode}`);
    if (tableDensity !== "comfortable") filters.push(`Density: ${tableDensity}`);
    return filters;
  }, [
    deepLinkIsrc,
    deepLinkTrackKey,
    deepLinkTrackTitle,
    groupMode,
    hasTrackDeepLink,
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
    nextParams.delete("track_key");
    nextParams.delete("track_title");
    nextParams.delete("artist_name");
    nextParams.delete("isrc");
    nextParams.delete("view");
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader title="Transactions" subtitle="One workspace for normalized transaction history." />

      <KpiStrip
        items={[
          { label: "Lines (Filtered)", value: filteredTransactions.length.toLocaleString() },
          { label: "Gross", value: toMoney(summary.gross) },
          { label: "Net", value: toMoney(summary.net) },
          { label: "Unique Tracks", value: summary.tracks.toLocaleString() },
        ]}
        columnsClassName="xl:grid-cols-4"
      />

      <FilterToolbar
        title="Transaction View"
        description="Refine scope using CMO, statement, territory, platform, and grouping controls."
      >
        <div className="grid gap-3 md:grid-cols-7">
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
          <Select value={tableDensity} onValueChange={(value) => setTableDensity(value as TableDensity)}>
            <SelectTrigger>
              <SelectValue placeholder="Table Density" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="comfortable">Comfortable</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AppliedFiltersRow
          filters={appliedFilters}
          onClear={clearFilters}
          updatedLabel={`Updated ${format(new Date(), "MMM d, yyyy HH:mm")}`}
        />
      </FilterToolbar>

      <Card>
        <CardContent>
          {isLoading ? (
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
                description={
                  noTransactionsAvailable
                    ? "Upload and process your first statement to unlock transactions."
                    : hasTrackDeepLink
                    ? "No transaction rows match this linked track in the current scope."
                    : "No transaction rows match your current filters."
                }
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
              description={
                noTransactionsAvailable
                  ? "Upload and process your first statement to unlock grouped transaction views."
                  : "No grouped transaction rows are available for this scope."
              }
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
