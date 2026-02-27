import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Search, ArrowUpRight, Copy, ArrowRightLeft, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { toMoney } from "@/lib/royalty";
import { defaultDateRange } from "@/lib/insights";
import type { TrackInsightListRow } from "@/types/insights";
import { AppliedFiltersRow, EmptyStateBlock, FilterToolbar, KpiStrip, PageHeader } from "@/components/layout";

type Report = Pick<Tables<"cmo_reports">, "id" | "cmo_name" | "status">;
type Tx = Pick<Tables<"royalty_transactions">, "territory" | "platform" | "usage_type">;

export default function Insights() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const defaults = defaultDateRange();

  const [search, setSearch] = useState("");
  const [selectedCmo, setSelectedCmo] = useState("all");
  const [selectedTerritory, setSelectedTerritory] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [selectedUsageType, setSelectedUsageType] = useState("all");
  const [fromDate, setFromDate] = useState(defaults.fromDate);
  const [toDate, setToDate] = useState(defaults.toDate);

  const { data: reports = [] } = useQuery({
    queryKey: ["insights-filter-reports"],
    queryFn: async (): Promise<Report[]> => {
      const { data, error } = await supabase
        .from("cmo_reports")
        .select("id,cmo_name,status")
        .neq("status", "failed");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: filterTx = [] } = useQuery({
    queryKey: ["insights-filter-tx"],
    queryFn: async (): Promise<Tx[]> => {
      const { data, error } = await supabase
        .from("royalty_transactions")
        .select("territory,platform,usage_type")
        .limit(12000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [
      "track-insights-list",
      fromDate,
      toDate,
      search,
      selectedCmo,
      selectedTerritory,
      selectedPlatform,
      selectedUsageType,
    ],
    queryFn: async (): Promise<TrackInsightListRow[]> => {
      const filters = {
        search,
        cmo: selectedCmo,
        territory: selectedTerritory,
        platform: selectedPlatform,
        usage_type: selectedUsageType,
      };
      const { data, error } = await supabase.rpc("get_track_insights_list_v1", {
        from_date: fromDate,
        to_date: toDate,
        filters_json: filters,
      });
      if (error) throw error;
      return (data ?? []) as TrackInsightListRow[];
    },
  });

  const cmoOptions = useMemo(
    () => Array.from(new Set(reports.map((report) => report.cmo_name))).sort((a, b) => a.localeCompare(b)),
    [reports]
  );
  const territoryOptions = useMemo(
    () =>
      Array.from(new Set(filterTx.map((tx) => tx.territory).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [filterTx]
  );
  const platformOptions = useMemo(
    () =>
      Array.from(new Set(filterTx.map((tx) => tx.platform).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [filterTx]
  );
  const usageTypeOptions = useMemo(
    () =>
      Array.from(new Set(filterTx.map((tx) => tx.usage_type).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b)
      ),
    [filterTx]
  );

  const aggregate = useMemo(() => {
    const totalNet = rows.reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const totalQty = rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
    const highRisk = rows.filter((row) => row.quality_flag === "high").length;
    return {
      totalNet,
      totalQty,
      highRisk,
      tracks: rows.length,
      topTrack: rows[0],
    };
  }, [rows]);

  const appliedFilters = useMemo(() => {
    const tokens: string[] = [];
    if (fromDate !== defaults.fromDate || toDate !== defaults.toDate) {
      tokens.push(`Date: ${fromDate} to ${toDate}`);
    }
    if (selectedCmo !== "all") tokens.push(`CMO: ${selectedCmo}`);
    if (selectedTerritory !== "all") tokens.push(`Territory: ${selectedTerritory}`);
    if (selectedPlatform !== "all") tokens.push(`Platform: ${selectedPlatform}`);
    if (selectedUsageType !== "all") tokens.push(`Usage: ${selectedUsageType}`);
    if (search.trim()) tokens.push(`Search: ${search.trim()}`);
    return tokens;
  }, [
    defaults.fromDate,
    defaults.toDate,
    fromDate,
    search,
    selectedCmo,
    selectedPlatform,
    selectedTerritory,
    selectedUsageType,
    toDate,
  ]);

  const clearFilters = () => {
    setSearch("");
    setSelectedCmo("all");
    setSelectedTerritory("all");
    setSelectedPlatform("all");
    setSelectedUsageType("all");
    setFromDate(defaults.fromDate);
    setToDate(defaults.toDate);
  };

  const copyShareLink = async (trackKey: string) => {
    const url = `${window.location.origin}/insights/${encodeURIComponent(trackKey)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Track Insights link copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  };

  const openTrack = (trackKey: string) => {
    navigate(`/insights/${encodeURIComponent(trackKey)}`);
  };

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        title="Track Insights"
        subtitle="Review track-level performance, risk signals, and opportunity before opening the Track AI Agent."
      />

      <KpiStrip
        items={[
          { label: "Tracks in scope", value: aggregate.tracks.toLocaleString() },
          { label: "Net Revenue", value: toMoney(aggregate.totalNet) },
          { label: "Units", value: Math.round(aggregate.totalQty).toLocaleString() },
          { label: "High data risk tracks", value: aggregate.highRisk.toLocaleString(), tone: aggregate.highRisk > 0 ? "warning" : "default" },
          {
            label: "Top track by opportunity",
            value: aggregate.topTrack ? `${aggregate.topTrack.track_title}` : "-",
            hint: aggregate.topTrack ? `Score ${aggregate.topTrack.opportunity_score.toFixed(1)}` : undefined,
          },
        ]}
      />

      <FilterToolbar
        title="Filters"
        description="Default: last 12 months, reporting-currency metrics, failed reports excluded."
        sticky
      >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="relative sm:col-span-2 lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Track, artist, ISRC, custom data..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            <div>
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
            </div>
            <div>
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
            </div>
            <div>
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
            <div className="sm:col-span-2 lg:col-span-2">
              <Select value={selectedUsageType} onValueChange={setSelectedUsageType}>
                <SelectTrigger>
                  <SelectValue placeholder="Usage Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Usage Types</SelectItem>
                  {usageTypeOptions.map((usageType) => (
                    <SelectItem key={usageType} value={usageType}>
                      {usageType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <AppliedFiltersRow
            filters={appliedFilters}
            onClear={clearFilters}
            updatedLabel={`Updated ${format(new Date(), "MMM d, yyyy HH:mm")}`}
          />
      </FilterToolbar>

      <Card className="min-w-0">
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading track insights...</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Failed to load insights: {(error as Error).message}</p>
          ) : rows.length === 0 ? (
            <EmptyStateBlock
              icon={<Sparkles className="h-10 w-10" />}
              title="No tracks found"
              description="No tracks match the selected filter scope."
            />
          ) : (
            <div className="min-w-0 overflow-x-auto overscroll-x-contain">
              <Table className="min-w-[1320px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Track</TableHead>
                    <TableHead>Artist</TableHead>
                    <TableHead>ISRC / Key</TableHead>
                    <TableHead className="text-right">Net Revenue</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue/Unit</TableHead>
                    <TableHead className="text-right">3-Month Trend</TableHead>
                    <TableHead>Top Territory</TableHead>
                    <TableHead>Top Platform</TableHead>
                    <TableHead>Data Quality</TableHead>
                    <TableHead className="text-right">Opportunity Score</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.track_key}
                      role="button"
                      tabIndex={0}
                      className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => {
                        event.currentTarget.focus();
                        openTrack(row.track_key);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openTrack(row.track_key);
                        }
                      }}
                    >
                      <TableCell className="max-w-[220px] truncate font-medium underline-offset-2 hover:underline">
                        {row.track_title}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">{row.artist_name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.isrc ?? row.track_key}</TableCell>
                      <TableCell className="text-right font-mono">{toMoney(row.net_revenue)}</TableCell>
                      <TableCell className="text-right font-mono">{Math.round(row.quantity ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{toMoney(row.net_per_unit)}</TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={row.trend_3m_pct >= 0 ? "text-foreground" : "text-destructive"}>
                          {row.trend_3m_pct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>{row.top_territory}</TableCell>
                      <TableCell>{row.top_platform}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs uppercase">
                          {row.quality_flag} ({row.failed_line_count + row.open_critical_task_count})
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.opportunity_score.toFixed(1)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5 opacity-85 transition-opacity group-hover:opacity-100">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 min-w-[76px] px-2.5"
                            onClick={(event) => {
                              event.stopPropagation();
                              openTrack(row.track_key);
                            }}
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 border border-border/35 bg-background/80 p-0 text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              copyShareLink(row.track_key);
                            }}
                            title="Copy track link"
                            aria-label={`Copy link for ${row.track_title}`}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 border border-border/35 bg-background/80 p-0 text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/transactions?q=${encodeURIComponent(row.isrc ?? row.track_title)}`);
                            }}
                            title="Open related transactions"
                            aria-label={`Open transactions for ${row.track_title}`}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
