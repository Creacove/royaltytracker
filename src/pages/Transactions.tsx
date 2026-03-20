import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ArrowRightLeft, ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { toMoney } from "@/lib/royalty";
import {
  AppliedFiltersRow,
  DetailDrawerFrame,
  EmptyStateBlock,
  FilterToolbar,
  KpiStrip,
  PageHeader,
} from "@/components/layout";

type Transaction = Tables<"royalty_transactions">;
type Report = Pick<
  Tables<"cmo_reports">,
  "id" | "cmo_name" | "file_name" | "report_period" | "created_at" | "status"
>;

type GroupMode = "artist" | "line" | "report" | "cmo" | "platform" | "territory" | "track";

const groupModeLabels: Record<GroupMode, string> = {
  artist: "By artist",
  report: "By statement",
  cmo: "By source",
  track: "By track",
  territory: "By territory",
  platform: "By platform",
  line: "Line items",
};

const groupModeHeadings: Record<GroupMode, string> = {
  artist: "ARTIST",
  line: "LINE ITEMS",
  report: "STATEMENT",
  cmo: "SOURCE",
  platform: "PLATFORM",
  territory: "TERRITORY",
  track: "TRACK",
};

const groupModeOrder: GroupMode[] = ["artist", "report", "cmo", "track", "territory", "platform", "line"];
const ROWS_PER_PAGE = 50;

type GroupedRow = {
  key: string;
  label: string;
  lines: number;
  quantity: number;
  gross: number;
  net: number;
  distinctReports: number;
  reportId?: string;
};

const normalizeIsrcValue = (value: string | null | undefined): string =>
  (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const formatPercent = (value: number | null | undefined) => (value == null ? "-" : `${Math.round(value)}%`);

function TablePagination({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  if (total <= pageSize) return null;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-[hsl(var(--border)/0.1)] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        Showing {start.toLocaleString()}-{end.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-2 self-start sm:self-auto">
        <Button
          type="button"
          size="sm"
          variant="quiet"
          className="h-9 px-3"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.7)] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          className="h-9 px-3"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

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
  const [groupMode, setGroupMode] = useState<GroupMode>("artist");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [page, setPage] = useState(1);

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
      const batchSize = 1000;
      const rows: Transaction[] = [];

      for (let from = 0; ; from += batchSize) {
        let query = supabase
          .from("royalty_transactions")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + batchSize - 1);

        if (deepLinkTrackTitle) query = query.ilike("track_title", `%${deepLinkTrackTitle}%`);
        if (deepLinkArtistName) query = query.ilike("artist_name", `%${deepLinkArtistName}%`);
        if (!deepLinkTrackTitle && !deepLinkArtistName && deepLinkIsrc) {
          query = query.ilike("isrc", `%${deepLinkIsrc}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        const batch = data ?? [];
        rows.push(...batch);

        if (batch.length < batchSize) break;
      }

      return rows;
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

  const hasSecondaryFilters =
    selectedCmo !== "all" ||
    selectedReportId !== "all" ||
    selectedTerritory !== "all" ||
    selectedPlatform !== "all";

  useEffect(() => {
    if (hasSecondaryFilters) setShowMoreFilters(true);
  }, [hasSecondaryFilters]);

  useEffect(() => {
    setPage(1);
  }, [
    deepLinkArtistName,
    deepLinkIsrc,
    deepLinkTrackTitle,
    groupMode,
    search,
    selectedCmo,
    selectedPlatform,
    selectedReportId,
    selectedTerritory,
  ]);

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

    const getGroup = (
      tx: Transaction
    ): {
      key: string;
      label: string;
      reportId?: string;
    } => {
      const report = reportById.get(tx.report_id);
      switch (groupMode) {
        case "artist":
          return { key: `artist:${tx.artist_name ?? "unknown"}`, label: tx.artist_name ?? "Unknown Artist" };
        case "report":
          return {
            key: `report:${tx.report_id}`,
            label: report ? `${report.cmo_name} | ${report.file_name}` : tx.report_id,
            reportId: tx.report_id,
          };
        case "cmo":
          return { key: `source:${report?.cmo_name ?? "unknown"}`, label: report?.cmo_name ?? "Unknown Source" };
        case "platform":
          return { key: `platform:${tx.platform ?? "unknown"}`, label: tx.platform ?? "Unknown Platform" };
        case "territory":
          return { key: `territory:${tx.territory ?? "unknown"}`, label: tx.territory ?? "Unknown Territory" };
        case "track":
          return { key: `track:${tx.track_title ?? "unknown"}`, label: tx.track_title ?? "Unknown Track" };
        default:
          return { key: "unknown", label: "Unknown" };
      }
    };

    const map = new Map<string, GroupedRow>();
    const reportsByGroup = new Map<string, Set<string>>();

    for (const tx of filteredTransactions) {
      const group = getGroup(tx);
      if (!map.has(group.key)) {
        map.set(group.key, {
          key: group.key,
          label: group.label,
          lines: 0,
          quantity: 0,
          gross: 0,
          net: 0,
          distinctReports: 0,
          reportId: group.reportId,
        });
        reportsByGroup.set(group.key, new Set<string>());
      }
      const row = map.get(group.key)!;
      row.lines += 1;
      row.quantity += tx.quantity ?? 0;
      row.gross += tx.gross_revenue ?? 0;
      row.net += tx.net_revenue ?? 0;
      reportsByGroup.get(group.key)!.add(tx.report_id);
    }

    return Array.from(map.values())
      .map((row) => ({ ...row, distinctReports: reportsByGroup.get(row.key)?.size ?? 0 }))
      .sort((a, b) => b.net - a.net);
  }, [filteredTransactions, groupMode, reportById]);

  const appliedFilters = useMemo(() => {
    const filters: string[] = [];
    if (search.trim()) filters.push(`Search: ${search.trim()}`);
    if (hasTrackDeepLink) {
      filters.push(`Track scope: ${deepLinkTrackTitle || deepLinkIsrc || deepLinkTrackKey}`);
    }
    if (selectedCmo !== "all") filters.push(`Source: ${selectedCmo}`);
    if (selectedReportId !== "all") {
      filters.push(`Statement: ${reportById.get(selectedReportId)?.file_name ?? selectedReportId}`);
    }
    if (selectedTerritory !== "all") filters.push(`Territory: ${selectedTerritory}`);
    if (selectedPlatform !== "all") filters.push(`Platform: ${selectedPlatform}`);
    return filters;
  }, [
    deepLinkIsrc,
    deepLinkTrackKey,
    deepLinkTrackTitle,
    hasTrackDeepLink,
    reportById,
    search,
    selectedCmo,
    selectedPlatform,
    selectedReportId,
    selectedTerritory,
  ]);

  const selectedReport = selected ? reportById.get(selected.report_id) : null;
  const totalRows = groupMode === "line" ? filteredTransactions.length : grouped?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));
  const pageStart = (page - 1) * ROWS_PER_PAGE;
  const visibleTransactions = filteredTransactions.slice(pageStart, pageStart + ROWS_PER_PAGE);
  const visibleGrouped = grouped?.slice(pageStart, pageStart + ROWS_PER_PAGE) ?? [];

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const drillIntoGroup = (row: GroupedRow) => {
    setSelected(null);
    switch (groupMode) {
      case "artist":
        setSearch(row.label === "Unknown Artist" ? "" : row.label);
        break;
      case "report":
        setSelectedReportId(row.reportId ?? "all");
        setShowMoreFilters(true);
        break;
      case "cmo":
        setSelectedCmo(row.label === "Unknown Source" ? "all" : row.label);
        setShowMoreFilters(true);
        break;
      case "platform":
        setSelectedPlatform(row.label === "Unknown Platform" ? "all" : row.label);
        setShowMoreFilters(true);
        break;
      case "territory":
        setSelectedTerritory(row.label === "Unknown Territory" ? "all" : row.label);
        setShowMoreFilters(true);
        break;
      case "track":
        setSearch(row.label === "Unknown Track" ? "" : row.label);
        break;
      default:
        break;
    }
    setGroupMode("line");
  };

  const clearFilters = () => {
    setSearch("");
    setSelectedCmo("all");
    setSelectedReportId("all");
    setSelectedTerritory("all");
    setSelectedPlatform("all");
    setGroupMode("artist");
    setShowMoreFilters(false);
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
      <PageHeader title="Transactions" />

      <KpiStrip
        items={[
          { label: "Lines (Filtered)", value: filteredTransactions.length.toLocaleString() },
          { label: "Gross", value: toMoney(summary.gross) },
          { label: "Net", value: toMoney(summary.net) },
          { label: "Unique Tracks", value: summary.tracks.toLocaleString() },
        ]}
        columnsClassName="xl:grid-cols-4"
      />

      <FilterToolbar variant="muted" className="p-3 md:p-4">
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_220px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search artist, track, ISRC, statement, platform..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={groupMode} onValueChange={(value) => setGroupMode(value as GroupMode)}>
              <SelectTrigger>
                <SelectValue placeholder="View" />
              </SelectTrigger>
              <SelectContent>
                {groupModeOrder.map((value) => (
                  <SelectItem key={value} value={value}>
                    {groupModeLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={showMoreFilters ? "secondary" : "quiet"}
              className="h-10 w-full px-4 lg:w-auto"
              onClick={() => setShowMoreFilters((current) => !current)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {showMoreFilters ? "Hide filters" : "More filters"}
            </Button>
          </div>

          {showMoreFilters ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Select value={selectedCmo} onValueChange={setSelectedCmo}>
                <SelectTrigger>
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {cmoOptions.map((cmo) => (
                    <SelectItem key={cmo} value={cmo}>
                      {cmo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedReportId} onValueChange={setSelectedReportId}>
                <SelectTrigger>
                  <SelectValue placeholder="Statement" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statements</SelectItem>
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
            </div>
          ) : null}

          <AppliedFiltersRow filters={appliedFilters} onClear={clearFilters} hideWhenEmpty className="pt-0" />
        </div>
      </FilterToolbar>

      <Card surface="elevated">
        <CardContent className="p-4 md:p-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : groupMode === "line" ? (
            filteredTransactions.length > 0 ? (
              <>
                <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                  <Table variant="evidence" density="compact" className="min-w-[1140px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
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
                      {visibleTransactions.map((tx) => (
                        <TableRow
                          key={tx.id}
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <TablePagination
                  page={page}
                  total={filteredTransactions.length}
                  pageSize={ROWS_PER_PAGE}
                  onPageChange={setPage}
                />
              </>
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
            <>
              <div className="mb-3 rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.55)] px-3 py-2 text-xs text-muted-foreground">
                Select a row to open the matching line items.
              </div>
              <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                <Table variant="evidence" density="compact" className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{groupModeHeadings[groupMode]}</TableHead>
                      <TableHead className="text-right">Docs</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleGrouped.map((row) => (
                      <TableRow
                        key={row.key}
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => drillIntoGroup(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            drillIntoGroup(row);
                          }
                        }}
                      >
                        <TableCell className="font-medium">{row.label}</TableCell>
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
              <TablePagination page={page} total={grouped.length} pageSize={ROWS_PER_PAGE} onPageChange={setPage} />
            </>
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
        <SheetContent className="w-[min(96vw,860px)] max-w-[min(96vw,860px)] p-0 [&>button]:hidden sm:max-w-[min(92vw,860px)]">
          {selected ? (
            <DetailDrawerFrame
              eyebrow="Line Item"
              title={selected.track_title ?? "Untitled Line Item"}
              subtitle={`${selected.artist_name ?? "Unknown Artist"} • ${selectedReport?.cmo_name ?? "Unknown Source"}`}
              rightSlot={
                <div className="flex items-center gap-2">
                  <StatusBadge status={selected.validation_status ?? "pending"} />
                  <SheetClose asChild>
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon"
                      className="h-8 w-8 rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.9)] text-foreground/72 shadow-none hover:border-[hsl(var(--brand-accent)/0.18)] hover:bg-[hsl(var(--brand-accent-ghost)/0.52)] hover:text-foreground"
                      aria-label="Close transaction detail"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </SheetClose>
                </div>
              }
              variant="intelligence"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Net Revenue", toMoney(selected.net_revenue), "surface-intelligence"],
                  ["Gross Revenue", toMoney(selected.gross_revenue), "surface-elevated"],
                  [
                    "Quantity",
                    selected.quantity != null
                      ? `${selected.quantity.toLocaleString()}${selected.quantity_unit ? ` ${selected.quantity_unit}` : ""}`
                      : "-",
                    "surface-elevated",
                  ],
                ].map(([label, value, surface]) => (
                  <div key={label} className={`${surface} forensic-frame rounded-[calc(var(--radius-sm))] p-4`}>
                    <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <section className="space-y-4">
                  <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                    <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Statement Context</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {[
                        ["Source", selectedReport?.cmo_name ?? "-"],
                        ["Statement", selectedReport?.file_name ?? "-"],
                        ["Report Period", selectedReport?.report_period ?? "-"],
                        [
                          "Line Period",
                          selected.period_start && selected.period_end
                            ? `${selected.period_start} -> ${selected.period_end}`
                            : "-",
                        ],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                          <p className="mt-1 text-sm leading-relaxed text-foreground">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                    <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Commercial Context</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {[
                        ["Artist", selected.artist_name ?? "-"],
                        ["Track", selected.track_title ?? "-"],
                        ["Usage", selected.usage_type ?? "-"],
                        ["Rights Type", selected.rights_type ?? "-"],
                        ["Territory", selected.territory ?? selected.territory_raw ?? "-"],
                        ["Platform", selected.platform ?? "-"],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                          <p className="mt-1 text-sm leading-relaxed text-foreground">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                    <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Identifiers & Amounts</p>
                    <div className="mt-4 grid gap-3">
                      {[
                        ["ISRC", selected.isrc ?? "-"],
                        ["ISWC", selected.iswc ?? "-"],
                        ["Currency", selected.currency ?? "-"],
                        [
                          "Original Amount",
                          selected.amount_original != null
                            ? `${toMoney(selected.amount_original)}${selected.currency_original ? ` ${selected.currency_original}` : ""}`
                            : "-",
                        ],
                        [
                          "Reporting Amount",
                          selected.amount_reporting != null
                            ? `${toMoney(selected.amount_reporting)}${selected.currency_reporting ? ` ${selected.currency_reporting}` : ""}`
                            : "-",
                        ],
                        ["Exchange Rate", selected.exchange_rate != null ? String(selected.exchange_rate) : "-"],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border)/0.08)] pb-3 last:border-b-0 last:pb-0">
                          <span className="text-sm text-muted-foreground">{label}</span>
                          <span className="text-right font-mono text-sm text-foreground">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                    <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Extraction Trace</p>
                    <div className="mt-4 grid gap-3">
                      {[
                        ["Source Page", selected.source_page != null ? String(selected.source_page) : "-"],
                        ["Source Row", selected.source_row != null ? String(selected.source_row) : "-"],
                        ["OCR Confidence", formatPercent(selected.ocr_confidence)],
                        ["Mapping Confidence", formatPercent(selected.mapping_confidence)],
                        [
                          "Bounding Box",
                          selected.bbox_x != null
                            ? `(${selected.bbox_x}, ${selected.bbox_y}) ${selected.bbox_width}x${selected.bbox_height}`
                            : "-",
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border)/0.08)] pb-3 last:border-b-0 last:pb-0">
                          <span className="text-sm text-muted-foreground">{label}</span>
                          <span className="text-right font-mono text-sm text-foreground">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </DetailDrawerFrame>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
