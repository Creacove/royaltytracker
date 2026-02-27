import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Search, ArrowUpRight, Copy, ArrowRightLeft, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { toMoney } from "@/lib/royalty";
import { defaultDateRange } from "@/lib/insights";
import type { TrackInsightListRow } from "@/types/insights";

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
    <div className="rhythm-page">
      <div>
        <h1 className="font-display text-4xl tracking-[0.03em]">Track Insights</h1>
        <p className="text-sm text-muted-foreground">
          Review track-level performance, risk signals, and opportunity before opening the Track AI Agent.
        </p>
      </div>

      <section className="border-y border-foreground py-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div>
            <p className="text-xs text-muted-foreground">Tracks in scope</p>
            <p className="font-display text-3xl">{aggregate.tracks.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Net Revenue</p>
            <p className="font-display text-3xl">{toMoney(aggregate.totalNet)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Units</p>
            <p className="font-display text-3xl">{Math.round(aggregate.totalQty).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">High data risk tracks</p>
            <p className="font-display text-3xl">{aggregate.highRisk.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Top track by opportunity</p>
            <p className="text-sm font-semibold">
              {aggregate.topTrack ? `${aggregate.topTrack.track_title} (${aggregate.topTrack.opportunity_score.toFixed(1)})` : "-"}
            </p>
          </div>
        </div>
      </section>

      <Card className="!border-0 border-t border-border bg-transparent">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <div className="grid gap-3 md:grid-cols-7">
            <div className="relative md:col-span-2">
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
            <Select value={selectedUsageType} onValueChange={setSelectedUsageType}>
              <SelectTrigger className="md:col-span-2">
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
          <p className="text-xs text-muted-foreground">
            Default: last 12 months, reporting-currency metrics, failed reports excluded. Updated{" "}
            {format(new Date(), "MMM d, yyyy HH:mm")}
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading track insights...</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Failed to load insights: {(error as Error).message}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Sparkles className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No tracks found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
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
                      className="cursor-pointer"
                      onClick={() => openTrack(row.track_key)}
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
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation();
                              openTrack(row.track_key);
                            }}
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            Open Insights
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation();
                              copyShareLink(row.track_key);
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy Link
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/transactions?q=${encodeURIComponent(row.isrc ?? row.track_title)}`);
                            }}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                            Tx
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
