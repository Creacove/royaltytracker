import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarRange,
  Sparkles,
  Target,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader, KpiStrip } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { defaultDateRange, parseArtistSnapshotDetail, parseDetail } from "@/lib/insights";
import { toCompactMoney, toMoney, safePercent } from "@/lib/royalty";
import { cn } from "@/lib/utils";
import type {
  AiInsightsEntityContext,
  AiInsightsTurnRequest,
  AiInsightsTurnResponse,
  ArtistSnapshotDetail,
  TrackInsightDetail,
  TrackInsightListRow,
} from "@/types/insights";
import type { Json } from "@/integrations/supabase/types";
import type { TooltipProps } from "recharts";

const CHART_COLORS = [
  "hsl(var(--brand-accent))",
  "hsl(var(--tone-success))",
  "hsl(var(--tone-info))",
  "hsl(var(--tone-warning))",
];

type SnapshotPageProps = {
  scope: "track" | "artist";
};

type SnapshotSignalTone = "default" | "warning" | "opportunity";

type SnapshotSignal = {
  title: string;
  body: string;
  tone?: SnapshotSignalTone;
};

function normalizeArtistKey(artistName: string): string {
  const normalized = artistName.trim().toLowerCase().replace(/\s+/g, " ");
  return `artist:${normalized || "unknown artist"}`;
}

function normalizeDateParam(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function formatDateWindow(fromDate: string, toDate: string): string {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return `${fromDate} - ${toDate}`;
  return `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;
}

function toMonthLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "MMM yy");
}

function formatAxisMoney(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return toCompactMoney(numeric);
}

function formatAxisUnits(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return Math.round(numeric).toLocaleString();
}

function normalizeMixLabel(value: string | null | undefined, fallback: string): string {
  const next = (value ?? "").trim();
  return next.length > 0 && next.toLowerCase() !== "unknown" ? next : fallback;
}

function sanitizeSnapshotSummary(text: string | null | undefined): string {
  const value = (text ?? "").trim();
  if (!value) return "";

  return value
    .replace(/^i\s+analy(?:s|z)ed\s+/i, "")
    .replace(/^i\s+reviewed\s+/i, "")
    .replace(/^i\s+found\s+/i, "")
    .replace(/^i\s+looked\s+at\s+/i, "")
    .replace(/^for\s+/i, "")
    .replace(/^the\s+risk\s+profile\s+for\s+/i, "")
    .replace(/^this\s+analysis\s+shows\s+/i, "")
    .replace(/\bI\b/g, "")
    .replace(/\bmy analysis\b/gi, "The snapshot")
    .replace(/\bI found that\b/gi, "")
    .replace(/\bI found\b/gi, "")
    .replace(/\bI analyzed\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function toSafeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function resolveFunctionError(error: unknown, data: unknown): Promise<string> {
  const dataObj = toSafeRecord(data);
  let message =
    (typeof dataObj?.error === "string" && dataObj.error) ||
    (error instanceof Error ? error.message : "Request failed.");

  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as unknown;
      const obj = toSafeRecord(payload);
      if (typeof obj?.detail === "string" && typeof obj?.error === "string") {
        return `${obj.error} (${obj.detail})`;
      }
      if (typeof obj?.error === "string") return obj.error;
      if (typeof obj?.message === "string") return obj.message;
    } catch {
      try {
        const text = await context.clone().text();
        if (text.trim().length > 0) message = text.trim();
      } catch {
        // Keep fallback.
      }
    }
  }

  return message;
}

function SnapshotSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-sm border border-black/10 bg-white/80 p-5 shadow-[0_18px_35px_rgba(0,0,0,0.05)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-black/8 pb-3">
        <div className="min-w-0">
          <h2 className="type-display-section text-lg text-black">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-black/55">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SignalCard({ signal }: { signal: SnapshotSignal }) {
  const toneClass =
    signal.tone === "warning"
      ? "border-[hsl(var(--tone-warning))]/30 bg-[hsl(var(--tone-warning))]/8"
      : signal.tone === "opportunity"
        ? "border-[hsl(var(--brand-accent))]/25 bg-[hsl(var(--brand-accent-ghost))]/35"
        : "border-black/10 bg-black/[0.02]";

  return (
    <article className={cn("rounded-sm border p-4", toneClass)}>
      <p className="type-micro text-[10px] text-black/45">Snapshot signal</p>
      <h3 className="mt-2 text-sm font-medium tracking-tight text-black">{signal.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-black/70">{signal.body}</p>
    </article>
  );
}

function SnapshotTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-sm border border-black/10 bg-white px-3 py-2 shadow-lg">
      {label ? <p className="text-xs font-medium text-black">{label}</p> : null}
      <div className="mt-1 space-y-1">
        {payload.map((entry) => {
          const key = `${entry.name}-${entry.dataKey}`;
          const dataKey = String(entry.dataKey ?? "");
          const value = entry.value;
          let formattedValue = String(value ?? "-");

          if (dataKey.includes("revenue")) formattedValue = toMoney(Number(value ?? 0));
          if (dataKey === "quantity") formattedValue = `${formatAxisUnits(Number(value ?? 0))} units`;
          if (dataKey.includes("share")) formattedValue = safePercent(Number(value ?? 0));

          return (
            <div key={key} className="flex items-center justify-between gap-4 text-xs">
              <span className="text-black/55">{entry.name}</span>
              <span className="font-medium text-black">{formattedValue}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SnapshotSummaryCard({
  title,
  summary,
  whyThisMatters,
  fallbackBadge,
}: {
  title: string;
  summary: string;
  whyThisMatters?: string;
  fallbackBadge?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-sm bg-black p-6 text-white shadow-[0_24px_40px_rgba(0,0,0,0.12)]">
      <div className="absolute right-0 top-0 h-32 w-32 translate-x-16 -translate-y-8 rounded-full bg-white/5 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-white/70" />
          <p className="type-micro text-[10px] text-white/55">{title}</p>
          {fallbackBadge ? (
            <Badge variant="outline" className="border-white/20 text-[9px] uppercase tracking-[0.16em] text-white/80">
              {fallbackBadge}
            </Badge>
          ) : null}
        </div>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/92">{summary}</p>
        {whyThisMatters ? <p className="mt-4 text-sm leading-relaxed text-white/65">{whyThisMatters}</p> : null}
      </div>
    </div>
  );
}

function EmptySnapshotState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <Card className="border-black/10 bg-white/80 shadow-[0_18px_35px_rgba(0,0,0,0.05)]">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-sm bg-[hsl(var(--brand-accent))] text-white">
          <Target className="h-5 w-5" />
        </div>
        <h2 className="type-display-section text-2xl text-black">{title}</h2>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-black/60">{body}</p>
      </CardContent>
    </Card>
  );
}

export default function SnapshotPage({ scope }: SnapshotPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ trackKey?: string; artistKey?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = defaultDateRange();
  const [fromDate, setFromDate] = useState(() => normalizeDateParam(searchParams.get("from"), defaults.fromDate));
  const [toDate, setToDate] = useState(() => normalizeDateParam(searchParams.get("to"), defaults.toDate));
  const [draftFromDate, setDraftFromDate] = useState(fromDate);
  const [draftToDate, setDraftToDate] = useState(toDate);
  const [isDatePopoverOpen, setIsDatePopoverOpen] = useState(false);

  const trackKey = (params.trackKey ?? "").trim();
  const artistKey = (params.artistKey ?? "").trim();
  const seedArtistName = (searchParams.get("artist") ?? "").trim();

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("from", fromDate);
      next.set("to", toDate);
      return next;
    }, { replace: true });
  }, [fromDate, setSearchParams, toDate]);

  useEffect(() => {
    setDraftFromDate(fromDate);
    setDraftToDate(toDate);
  }, [fromDate, toDate]);

  const applyDateWindow = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftFromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(draftToDate)) return;
    setFromDate(draftFromDate);
    setToDate(draftToDate);
    setIsDatePopoverOpen(false);
  };

  const resetDraftDateWindow = () => {
    setDraftFromDate(fromDate);
    setDraftToDate(toDate);
    setIsDatePopoverOpen(false);
  };

  const { data: trackRows = [] } = useQuery({
    queryKey: ["snapshot-track-rows", fromDate, toDate],
    queryFn: async (): Promise<TrackInsightListRow[]> => {
      const { data, error } = await supabase.rpc("get_track_insights_list_v1", {
        from_date: fromDate,
        to_date: toDate,
        filters_json: {},
      });
      if (error) throw error;
      return (data ?? []) as TrackInsightListRow[];
    },
  });

  const trackDetailQuery = useQuery({
    queryKey: ["track-snapshot-detail", trackKey, fromDate, toDate],
    enabled: scope === "track" && Boolean(trackKey),
    queryFn: async (): Promise<TrackInsightDetail | null> => {
      const { data, error } = await supabase.rpc("get_track_insight_detail_v1", {
        p_track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        filters_json: {},
      });
      if (error) throw error;
      return parseDetail(data as Json | null);
    },
  });

  const artistDetailQuery = useQuery({
    queryKey: ["artist-snapshot-detail", artistKey, fromDate, toDate],
    enabled: scope === "artist" && Boolean(artistKey),
    queryFn: async (): Promise<ArtistSnapshotDetail | null> => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }).rpc("get_artist_snapshot_v1", {
        p_artist_key: artistKey,
        from_date: fromDate,
        to_date: toDate,
      });
      if (error) throw error;
      return parseArtistSnapshotDetail(data as Json | null);
    },
  });

  const resolvedArtistName =
    (scope === "artist" ? artistDetailQuery.data?.summary.artist_name : trackDetailQuery.data?.summary.artist_name) ??
    seedArtistName;

  const snapshotSummaryQuery = useQuery({
    queryKey: ["snapshot-ai-summary", scope, trackKey, artistKey, resolvedArtistName, fromDate, toDate],
    enabled: scope === "track" ? Boolean(trackKey) : Boolean(artistKey || resolvedArtistName),
    retry: false,
    queryFn: async (): Promise<AiInsightsTurnResponse | null> => {
      const entityContext: AiInsightsEntityContext =
        scope === "track"
          ? { track_key: trackKey }
          : { artist_key: artistKey || undefined, artist_name: resolvedArtistName || undefined };

      const payload: AiInsightsTurnRequest = {
        question:
          scope === "track"
            ? "Write a concise publisher snapshot for this track. Use direct business language, not first person. Do not say 'I', 'I analyzed', 'I found', or mention being an AI. Start with the performance picture, then the biggest opportunity, then the biggest risk. Keep it tight, specific, and useful for a publisher making revenue or marketing decisions."
            : "Write a concise publisher snapshot for this artist. Use direct business language, not first person. Do not say 'I', 'I analyzed', 'I found', or mention being an AI. Start with the performance picture, then the strongest opportunity, then the main risk. Keep it tight, specific, and useful for a publisher making catalog, revenue, or marketing decisions.",
        from_date: fromDate,
        to_date: toDate,
        entity_context: entityContext,
      };

      const { data, error } = await supabase.functions.invoke("ai-insights-router-v1", { body: payload });
      if (error) {
        const message = await resolveFunctionError(error, data);
        throw new Error(message);
      }
      return (data as AiInsightsTurnResponse | null) ?? null;
    },
  });

  const trackDetail = trackDetailQuery.data;
  const artistDetail = artistDetailQuery.data;
  const detailLoading = scope === "track" ? trackDetailQuery.isLoading : artistDetailQuery.isLoading;
  const detailError = scope === "track" ? trackDetailQuery.error : artistDetailQuery.error;

  const scopedTrackRow = useMemo(
    () => trackRows.find((row) => row.track_key === trackKey) ?? null,
    [trackKey, trackRows]
  );

  const artistRows = useMemo(
    () => trackRows.filter((row) => normalizeArtistKey(row.artist_name || "Unknown Artist") === artistKey),
    [artistKey, trackRows]
  );

  const artistRowMap = useMemo(
    () => new Map(artistRows.map((row) => [row.track_key, row])),
    [artistRows]
  );

  const trackTrendData = useMemo(
    () =>
      (trackDetail?.monthly_trend ?? []).map((row) => ({
        ...row,
        label: toMonthLabel(row.month_start),
        fullLabel: format(new Date(`${row.month_start}T00:00:00`), "MMMM yyyy"),
      })),
    [trackDetail?.monthly_trend]
  );

  const artistTrendData = useMemo(
    () =>
      (artistDetail?.monthly_trend ?? []).map((row) => ({
        ...row,
        label: toMonthLabel(row.month_start),
        fullLabel: format(new Date(`${row.month_start}T00:00:00`), "MMMM yyyy"),
      })),
    [artistDetail?.monthly_trend]
  );

  const trackTerritoryMix = useMemo(
    () =>
      (trackDetail?.territory_mix ?? []).map((row) => ({
        ...row,
        territory_label: normalizeMixLabel(row.territory, "Unassigned territory"),
      })),
    [trackDetail?.territory_mix]
  );

  const trackPlatformMix = useMemo(
    () =>
      (trackDetail?.platform_mix ?? []).map((row) => ({
        ...row,
        platform_label: normalizeMixLabel(row.platform, "Unassigned platform"),
      })),
    [trackDetail?.platform_mix]
  );

  const trackUsageMix = useMemo(
    () =>
      (trackDetail?.usage_mix ?? []).map((row) => ({
        ...row,
        usage_type_label: normalizeMixLabel(row.usage_type, "Unassigned usage type"),
      })),
    [trackDetail?.usage_mix]
  );

  const artistTerritoryMix = useMemo(
    () =>
      (artistDetail?.territory_mix ?? []).map((row) => ({
        ...row,
        territory_label: normalizeMixLabel(row.territory, "Unassigned territory"),
      })),
    [artistDetail?.territory_mix]
  );

  const artistPlatformMix = useMemo(
    () =>
      (artistDetail?.platform_mix ?? []).map((row) => ({
        ...row,
        platform_label: normalizeMixLabel(row.platform, "Unassigned platform"),
      })),
    [artistDetail?.platform_mix]
  );

  const artistUsageMix = useMemo(
    () =>
      (artistDetail?.usage_mix ?? []).map((row) => ({
        ...row,
        usage_type_label: normalizeMixLabel(row.usage_type, "Unassigned usage type"),
      })),
    [artistDetail?.usage_mix]
  );

  const trackConcentration = useMemo(() => {
    const territoryTotal = (trackDetail?.territory_mix ?? []).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const platformTotal = (trackDetail?.platform_mix ?? []).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const topTerritory = trackDetail?.territory_mix?.[0];
    const topPlatform = trackDetail?.platform_mix?.[0];
    return {
      topTerritory,
      topPlatform,
      territoryShare: territoryTotal > 0 ? ((topTerritory?.net_revenue ?? 0) / territoryTotal) * 100 : 0,
      platformShare: platformTotal > 0 ? ((topPlatform?.net_revenue ?? 0) / platformTotal) * 100 : 0,
    };
  }, [trackDetail?.platform_mix, trackDetail?.territory_mix]);

  const artistConcentration = useMemo(() => {
    const territoryTotal = (artistDetail?.territory_mix ?? []).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const platformTotal = (artistDetail?.platform_mix ?? []).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const topTerritory = artistDetail?.territory_mix?.[0];
    const topPlatform = artistDetail?.platform_mix?.[0];
    const topTrack = artistRows[0];
    const totalNet = artistRows.reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    return {
      topTerritory,
      topPlatform,
      topTrack,
      territoryShare: territoryTotal > 0 ? ((topTerritory?.net_revenue ?? 0) / territoryTotal) * 100 : 0,
      platformShare: platformTotal > 0 ? ((topPlatform?.net_revenue ?? 0) / platformTotal) * 100 : 0,
      topTrackShare: totalNet > 0 ? ((topTrack?.net_revenue ?? 0) / totalNet) * 100 : 0,
    };
  }, [artistDetail?.platform_mix, artistDetail?.territory_mix, artistRows]);

  const trackSignals = useMemo<SnapshotSignal[]>(() => {
    if (!trackDetail?.summary) return [];
    const signals: SnapshotSignal[] = [];
    const underMonetized = trackDetail.high_usage_low_payout?.[0];

    if (underMonetized) {
      signals.push({
        title: "High usage, light payout",
        body: `${underMonetized.territory} is carrying ${safePercent((underMonetized.usage_share ?? 0) * 100)} of usage but only ${safePercent((underMonetized.payout_share ?? 0) * 100)} of payout. This is the first place to inspect monetization leakage.`,
        tone: "warning",
      });
    }

    if ((scopedTrackRow?.trend_3m_pct ?? 0) >= 15) {
      signals.push({
        title: "Momentum is building",
        body: `This track is up ${safePercent(scopedTrackRow?.trend_3m_pct ?? 0)} over the last 3 months. It is a strong candidate for renewed marketing or playlist support.`,
        tone: "opportunity",
      });
    }

    if (trackConcentration.platformShare >= 60 || trackConcentration.territoryShare >= 45) {
      signals.push({
        title: "Revenue is concentrated",
        body: `${trackConcentration.topPlatform?.platform ?? trackConcentration.topTerritory?.territory ?? "One source"} is carrying a large share of revenue. Good for focus, but risky if performance softens.`,
      });
    }

    if ((trackDetail.quality?.failed_line_count ?? 0) > 0 || (trackDetail.quality?.open_critical_task_count ?? 0) > 0) {
      signals.push({
        title: "Confidence risk could affect payouts",
        body: `There are ${trackDetail.quality?.failed_line_count ?? 0} failed lines and ${trackDetail.quality?.open_critical_task_count ?? 0} critical review tasks tied to this track. Revenue may be understated until those issues are resolved.`,
        tone: "warning",
      });
    }

    return signals.slice(0, 3);
  }, [scopedTrackRow, trackConcentration.platformShare, trackConcentration.territoryShare, trackConcentration.topPlatform?.platform, trackConcentration.topTerritory?.territory, trackDetail]);

  const artistSignals = useMemo<SnapshotSignal[]>(() => {
    if (!artistDetail?.summary) return [];
    const signals: SnapshotSignal[] = [];
    const averagePerUnit =
      artistRows.length > 0 ? artistRows.reduce((sum, row) => sum + (row.net_per_unit ?? 0), 0) / artistRows.length : 0;
    const breakoutTrack = artistRows.find((row) => (row.trend_3m_pct ?? 0) > 20);
    const underMonetizedTrack = artistRows.find(
      (row) => (row.quantity ?? 0) > 0 && (row.net_per_unit ?? 0) < averagePerUnit * 0.6
    );
    const recent3m = artistTrendData.slice(-3).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);
    const prior3m = artistTrendData.slice(-6, -3).reduce((sum, row) => sum + (row.net_revenue ?? 0), 0);

    if (breakoutTrack) {
      signals.push({
        title: "One track is accelerating",
        body: `${breakoutTrack.track_title} is up ${safePercent(breakoutTrack.trend_3m_pct)} over the last 3 months. This is the clearest short-term growth lever in the artist catalog.`,
        tone: "opportunity",
      });
    }

    if (underMonetizedTrack) {
      signals.push({
        title: "High activity, thin monetization",
        body: `${underMonetizedTrack.track_title} is generating volume but weak payout per unit. It deserves a closer check on platform mix, territory mix, and rights coverage.`,
        tone: "warning",
      });
    }

    if (artistConcentration.topTrackShare >= 50 || artistConcentration.platformShare >= 55) {
      signals.push({
        title: "Portfolio concentration risk",
        body: "A large share of this artist's revenue depends on one track or one platform. That can guide focus, but it also increases downside if performance shifts.",
      });
    }

    if (prior3m > 0 && recent3m < prior3m * 0.9) {
      signals.push({
        title: "Growth has cooled recently",
        body: "The most recent 3 months came in below the prior 3-month window. This is a useful moment to review campaign timing and catalog support.",
        tone: "warning",
      });
    }

    return signals.slice(0, 4);
  }, [artistConcentration.platformShare, artistConcentration.topTrackShare, artistDetail?.summary, artistRows, artistTrendData]);

  const fallbackTrackSummary = useMemo(() => {
    if (!trackDetail?.summary) return "Track snapshot unavailable.";
    const summary = trackDetail.summary;
    const topPlatform = trackDetail.platform_mix?.[0]?.platform ?? "the current mix";
    return `${summary.track_title} generated ${toCompactMoney(summary.net_revenue)} from ${Math.round(summary.quantity).toLocaleString()} units in the selected window. ${topPlatform} is the strongest platform right now, and the track should be reviewed for concentrated upside and any payout leakage.`;
  }, [trackDetail]);

  const fallbackArtistSummary = useMemo(() => {
    if (!artistDetail?.summary) return "Artist snapshot unavailable.";
    const summary = artistDetail.summary;
    return `${summary.artist_name} generated ${toCompactMoney(summary.net_revenue)} across ${summary.track_count.toLocaleString()} tracks in the selected window. The snapshot highlights where revenue is concentrated, which tracks are carrying growth, and where monetization looks thin.`;
  }, [artistDetail]);

  const backToAi = () => {
    const next = new URLSearchParams({ from: fromDate, to: toDate });
    if (scope === "track" && trackKey) next.set("track_key", trackKey);
    if (resolvedArtistName) next.set("artist", resolvedArtistName);
    if (scope === "artist" && artistKey) next.set("artist_key", artistKey);
    navigate(`/ai-insights?${next.toString()}`);
  };

  const openTransactions = () => {
    if (scope === "track" && trackKey) {
      navigate(`/transactions?track_key=${encodeURIComponent(trackKey)}`);
      return;
    }
    if (scope === "artist" && resolvedArtistName) {
      navigate(`/transactions?q=${encodeURIComponent(resolvedArtistName)}`);
    }
  };

  const openTrackSnapshot = (nextTrackKey: string, artistName?: string) => {
    const next = new URLSearchParams({ from: fromDate, to: toDate });
    if (artistName) next.set("artist", artistName);
    navigate(`/ai-insights/snapshots/track/${encodeURIComponent(nextTrackKey)}?${next.toString()}`);
  };

  const isLoading = detailLoading;

  if ((scope === "track" && !trackKey) || (scope === "artist" && !artistKey)) {
    return (
      <div className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
          <EmptySnapshotState
            title="Snapshot unavailable"
            body="We couldn't determine which entity to load. Re-open this page from AI Insights data context."
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-center px-4 py-24 md:px-6">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Building your snapshot...</p>
          </div>
        </div>
      </div>
    );
  }

  if (detailError) {
    return (
      <div className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
          <EmptySnapshotState
            title="Snapshot unavailable"
            body={(detailError as Error).message || "We couldn't load this snapshot right now."}
          />
        </div>
      </div>
    );
  }

  if (scope === "track" && !trackDetail?.summary) {
    return (
      <div className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
          <EmptySnapshotState
            title="No track data in range"
            body="This track has no snapshot data in the selected date window. Try widening the time range."
          />
        </div>
      </div>
    );
  }

  if (scope === "artist" && !artistDetail?.summary) {
    return (
      <div className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
          <EmptySnapshotState
            title="No artist data in range"
            body="This artist has no snapshot data in the selected date window. Try widening the time range."
          />
        </div>
      </div>
    );
  }

  const title = scope === "track" ? (trackDetail?.summary.track_title ?? "Track Snapshot") : (artistDetail?.summary.artist_name ?? "Artist Snapshot");
  const subtitle =
    scope === "track"
      ? `${trackDetail?.summary.artist_name ?? resolvedArtistName} snapshot for quick performance and monetization decisions.`
      : "Portfolio-level view of track performance, concentration, and next marketing decisions.";

  const summaryResponse = snapshotSummaryQuery.data;
  const rawSummaryText =
    summaryResponse?.executive_answer ??
    (scope === "track" ? fallbackTrackSummary : fallbackArtistSummary);
  const summaryText = sanitizeSnapshotSummary(rawSummaryText) || (scope === "track" ? fallbackTrackSummary : fallbackArtistSummary);
  const summaryWhy = summaryResponse?.why_this_matters;
  const fallbackBadge = snapshotSummaryQuery.isError ? "Deterministic view" : undefined;

  return (
    <div className="min-h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={backToAi}>
                <ArrowLeft className="h-4 w-4" />
                Back to AI Insights
              </Button>
              <Button variant="outline" size="sm" onClick={openTransactions}>
                <ArrowUpRight className="h-4 w-4" />
                Transactions
              </Button>
            </>
          }
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Popover open={isDatePopoverOpen} onOpenChange={setIsDatePopoverOpen}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-2 rounded-sm border border-[hsl(var(--brand-accent))]/15 bg-[hsl(var(--brand-accent-ghost))]/30 px-3 py-1.5 text-left transition-all hover:border-[hsl(var(--brand-accent))]/35 hover:bg-[hsl(var(--brand-accent-ghost))]/45">
                <CalendarRange className="h-3.5 w-3.5 text-[hsl(var(--brand-accent))] opacity-60" />
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
                  {formatDateWindow(fromDate, toDate)}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] rounded-sm border-2 border-black p-6 shadow-2xl" align="start">
              <div className="grid gap-6">
                <div className="space-y-2">
                  <p className="type-micro text-[11px] font-bold tracking-widest text-black">TIME HORIZON: FROM</p>
                  <Input
                    type="date"
                    value={draftFromDate}
                    onChange={(e) => setDraftFromDate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyDateWindow();
                    }}
                    className="h-10 rounded-sm border-black font-mono md:text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <p className="type-micro text-[11px] font-bold tracking-widest text-black">TIME HORIZON: TO</p>
                  <Input
                    type="date"
                    value={draftToDate}
                    onChange={(e) => setDraftToDate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyDateWindow();
                    }}
                    className="h-10 rounded-sm border-black font-mono md:text-xs"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={resetDraftDateWindow}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={applyDateWindow}>
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Badge variant="outline" className="border-black/15 bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-black/60">
            {scope === "track" ? "Track Snapshot" : "Artist Snapshot"}
          </Badge>
        </div>

        <div className="mt-6 space-y-6">
          <SnapshotSummaryCard
            title="AI summary"
            summary={summaryText}
            whyThisMatters={summaryWhy}
            fallbackBadge={fallbackBadge}
          />
          {scope === "track" && trackDetail?.summary ? (
            <>
              <KpiStrip
                className="border-t-0 pt-0"
                items={[
                  { label: "Net revenue", value: toMoney(trackDetail.summary.net_revenue) },
                  { label: "Gross revenue", value: toMoney(trackDetail.summary.gross_revenue) },
                  { label: "Units", value: Math.round(trackDetail.summary.quantity).toLocaleString() },
                  { label: "Net per unit", value: toMoney(trackDetail.summary.net_per_unit) },
                  { label: "3M trend", value: safePercent(scopedTrackRow?.trend_3m_pct ?? 0), tone: (scopedTrackRow?.trend_3m_pct ?? 0) >= 0 ? "accent" : "warning" },
                  { label: "Opportunity score", value: scopedTrackRow?.opportunity_score?.toFixed(1) ?? "-", hint: scopedTrackRow?.quality_flag ? `${scopedTrackRow.quality_flag} confidence risk` : undefined },
                ]}
              />

              <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
                <SnapshotSection title="Revenue trend" subtitle="Monthly net revenue and unit movement for this track.">
                  <div className="h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={trackTrendData}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" vertical={false} opacity={0.08} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Month" position="insideBottom" offset={-4} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis yAxisId="revenue" tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <YAxis yAxisId="units" orientation="right" tickFormatter={formatAxisUnits} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Units" angle={90} position="insideRight" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} labelFormatter={(_, payload) => String(payload?.[0]?.payload?.fullLabel ?? "")} />
                        <Bar yAxisId="units" dataKey="quantity" fill={CHART_COLORS[1]} radius={[2, 2, 0, 0]} barSize={18} />
                        <Line yAxisId="revenue" type="monotone" dataKey="net_revenue" stroke={CHART_COLORS[0]} strokeWidth={3} dot={{ r: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>

                <SnapshotSection title="What stands out" subtitle="Curated signals for this track right now.">
                  <div className="grid gap-3">
                    {trackSignals.length > 0 ? (
                      trackSignals.map((signal) => <SignalCard key={signal.title} signal={signal} />)
                    ) : (
                      <SignalCard
                        signal={{
                          title: "Stable picture",
                          body: "No major concentration or payout warning stands out in this range. Use the mix charts to decide where this track should be pushed next.",
                        }}
                      />
                    )}
                  </div>
                </SnapshotSection>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <SnapshotSection title="Territory mix" subtitle="Where this track is earning the most right now.">
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trackTerritoryMix.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 12, bottom: 28, left: 20 }}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" horizontal={false} opacity={0.08} />
                        <XAxis type="number" tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" position="bottom" offset={10} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis dataKey="territory_label" type="category" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={120}>
                          <Label value="Territory" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} />
                        <Bar dataKey="net_revenue" fill={CHART_COLORS[0]} radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>

                <SnapshotSection title="Platform mix" subtitle="Which outlets are driving the strongest returns.">
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trackPlatformMix.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 12, bottom: 28, left: 20 }}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" horizontal={false} opacity={0.08} />
                        <XAxis type="number" tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" position="bottom" offset={10} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis dataKey="platform_label" type="category" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={120}>
                          <Label value="Platform" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} />
                        <Bar dataKey="net_revenue" fill={CHART_COLORS[2]} radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>
              </div>

              {trackDetail.usage_mix.length > 0 ? (
                <SnapshotSection title="Usage mix" subtitle="How revenue is split across usage types.">
                  <div className="h-[260px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trackUsageMix.slice(0, 8)} margin={{ top: 8, right: 12, bottom: 28, left: 12 }}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" vertical={false} opacity={0.08} />
                        <XAxis dataKey="usage_type_label" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Usage Type" position="bottom" offset={10} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} />
                        <Bar dataKey="net_revenue" fill={CHART_COLORS[3]} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>
              ) : null}

              {(trackDetail.high_usage_low_payout ?? []).length > 0 ? (
                <SnapshotSection
                  title="High plays, light payout"
                  subtitle="Territories where consumption is materially stronger than payout share."
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Territory</TableHead>
                        <TableHead>Usage share</TableHead>
                        <TableHead>Payout share</TableHead>
                        <TableHead className="text-right">Net revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trackDetail.high_usage_low_payout.slice(0, 8).map((row) => (
                        <TableRow key={row.territory}>
                          <TableCell>{row.territory}</TableCell>
                          <TableCell>{safePercent((row.usage_share ?? 0) * 100)}</TableCell>
                          <TableCell>{safePercent((row.payout_share ?? 0) * 100)}</TableCell>
                          <TableCell className="text-right">{toMoney(row.net_revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SnapshotSection>
              ) : null}
            </>
          ) : null}
          {scope === "artist" && artistDetail?.summary ? (
            <>
              <KpiStrip
                className="border-t-0 pt-0"
                items={[
                  { label: "Net revenue", value: toMoney(artistDetail.summary.net_revenue) },
                  { label: "Tracks", value: artistDetail.summary.track_count.toLocaleString() },
                  { label: "Units", value: Math.round(artistDetail.summary.quantity).toLocaleString() },
                  { label: "Avg track revenue", value: toMoney(artistDetail.summary.avg_track_revenue) },
                  { label: "Top territory", value: artistDetail.summary.top_territory ?? "-" },
                  { label: "Top platform", value: artistDetail.summary.top_platform ?? "-" },
                ]}
              />

              <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <SnapshotSection title="Artist revenue trend" subtitle="Monthly performance across this artist's catalog.">
                  <div className="h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={artistTrendData}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" vertical={false} opacity={0.08} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Month" position="insideBottom" offset={-4} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis yAxisId="revenue" tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <YAxis yAxisId="units" orientation="right" tickFormatter={formatAxisUnits} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Units" angle={90} position="insideRight" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} labelFormatter={(_, payload) => String(payload?.[0]?.payload?.fullLabel ?? "")} />
                        <Bar yAxisId="units" dataKey="quantity" fill={CHART_COLORS[1]} radius={[2, 2, 0, 0]} barSize={18} />
                        <Line yAxisId="revenue" type="monotone" dataKey="net_revenue" stroke={CHART_COLORS[0]} strokeWidth={3} dot={{ r: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>

                <SnapshotSection title="What deserves attention" subtitle="Publisher-facing signals across the artist catalog.">
                  <div className="grid gap-3">
                    {artistSignals.length > 0 ? (
                      artistSignals.map((signal) => <SignalCard key={signal.title} signal={signal} />)
                    ) : (
                      <SignalCard
                        signal={{
                          title: "Portfolio is balanced",
                          body: "No single warning is dominating this range. Use the top-tracks and mix sections to decide where to place your next push.",
                        }}
                      />
                    )}
                  </div>
                </SnapshotSection>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <SnapshotSection title="Territory mix" subtitle="Markets currently carrying the artist's revenue.">
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={artistTerritoryMix.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 12, bottom: 28, left: 20 }}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" horizontal={false} opacity={0.08} />
                        <XAxis type="number" tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" position="bottom" offset={10} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis dataKey="territory_label" type="category" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={120}>
                          <Label value="Territory" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} />
                        <Bar dataKey="net_revenue" fill={CHART_COLORS[0]} radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>

                <SnapshotSection title="Platform mix" subtitle="Platforms delivering the strongest return for this artist.">
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={artistPlatformMix.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 12, bottom: 28, left: 20 }}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" horizontal={false} opacity={0.08} />
                        <XAxis type="number" tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" position="bottom" offset={10} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis dataKey="platform_label" type="category" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={120}>
                          <Label value="Platform" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} />
                        <Bar dataKey="net_revenue" fill={CHART_COLORS[2]} radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>
              </div>

              {artistDetail.usage_mix.length > 0 ? (
                <SnapshotSection title="Usage mix" subtitle="How this artist's revenue is split across usage types.">
                  <div className="h-[260px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={artistUsageMix.slice(0, 8)} margin={{ top: 8, right: 12, bottom: 28, left: 12 }}>
                        <CartesianGrid stroke="#000" strokeDasharray="2 4" vertical={false} opacity={0.08} />
                        <XAxis dataKey="usage_type_label" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Usage Type" position="bottom" offset={10} style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </XAxis>
                        <YAxis tickFormatter={formatAxisMoney} tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false}>
                          <Label value="Net Revenue" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }} />
                        </YAxis>
                        <Tooltip content={<SnapshotTooltip />} />
                        <Bar dataKey="net_revenue" fill={CHART_COLORS[3]} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SnapshotSection>
              ) : null}

              <SnapshotSection title="Tracks driving the artist" subtitle="Ranked track view for quick campaign and catalog decisions.">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Track</TableHead>
                      <TableHead>Net revenue</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Opportunity</TableHead>
                      <TableHead className="text-right">Snapshot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(artistDetail.top_tracks ?? []).map((track) => {
                      const row = artistRowMap.get(track.track_key);
                      return (
                        <TableRow key={track.track_key}>
                          <TableCell>
                            <div>
                              <p className="font-semibold text-black">{track.track_title}</p>
                              {track.isrc ? <p className="text-xs text-black/45">{track.isrc}</p> : null}
                            </div>
                          </TableCell>
                          <TableCell>{toMoney(track.net_revenue)}</TableCell>
                          <TableCell>{Math.round(track.quantity).toLocaleString()}</TableCell>
                          <TableCell>{safePercent(row?.trend_3m_pct ?? 0)}</TableCell>
                          <TableCell>{row?.opportunity_score?.toFixed(1) ?? "-"}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" onClick={() => openTrackSnapshot(track.track_key, resolvedArtistName)}>
                              Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </SnapshotSection>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
