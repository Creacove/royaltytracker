import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Bot,
  CalendarRange,
  Compass,
  Copy,
  PanelRightOpen,
  Search,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Check,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { useSearchParams, Link } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { defaultDateRange } from "@/lib/insights";
import { toMoney } from "@/lib/royalty";
import type {
  AiInsightsEntityContext,
  AiInsightsMode,
  AiInsightsTurnRequest,
  AiInsightsTurnResponse,
  TrackInsightListRow,
} from "@/types/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "hsl(var(--brand-accent))",
  "hsl(var(--tone-pending))",
  "hsl(var(--tone-success))",
  "hsl(var(--tone-info))",
  "hsl(var(--tone-warning))",
];

type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  payload?: AiInsightsTurnResponse;
};

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
        // Keep fallback message.
      }
    }
  }

  return message;
}

function modeLabel(mode: AiInsightsMode): string {
  if (mode === "track") return "Track";
  if (mode === "artist") return "Artist";
  return "Workspace";
}

function formatEvidenceConfidence(confidence: string): string {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  return "Low confidence";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toAssistantLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAssistantValue(key: string, value: unknown): string {
  if (value == null) return "-";
  const numeric = toNumber(value);
  if (numeric == null) return String(value);

  const isMoney = /(revenue|net|gross|commission|payout|amount)/i.test(key);
  if (isMoney) return toMoney(numeric);

  const isPercent = /(pct|percent|share|rate|growth|trend)/i.test(key);
  if (isPercent) {
    const normalized = /(share|rate)/i.test(key) && Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
    return `${normalized.toFixed(1)}%`;
  }

  const isCount = /(qty|quantity|count|line|task|row|critical|warning|info|units?)/i.test(key);
  if (isCount) return Math.round(numeric).toLocaleString();

  return Number.isInteger(numeric) ? numeric.toLocaleString() : numeric.toFixed(2);
}

function normalizeArtistKey(artistName: string): string {
  const normalized = artistName.trim().toLowerCase().replace(/\s+/g, " ");
  return `artist:${normalized || "unknown artist"}`;
}

export default function AiInsights() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const defaults = defaultDateRange();
  const [question, setQuestion] = useState("");
  const [fromDate, setFromDate] = useState(searchParams.get("from") ?? defaults.fromDate);
  const [toDate, setToDate] = useState(searchParams.get("to") ?? defaults.toDate);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [entityContext, setEntityContext] = useState<AiInsightsEntityContext>({
    track_key: searchParams.get("track_key") ?? undefined,
    artist_key: searchParams.get("artist_key") ?? undefined,
    artist_name: searchParams.get("artist") ?? undefined,
  });
  const [trackSearch, setTrackSearch] = useState("");
  const [artistSearch, setArtistSearch] = useState("");
  const [activeRailTab, setActiveRailTab] = useState<"tracks" | "artists">("tracks");
  const [isRailOpen, setIsRailOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: trackRows = [] } = useQuery({
    queryKey: ["ai-insights-track-rows", fromDate, toDate],
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

  const topTracks = useMemo(() => trackRows.slice(0, 8), [trackRows]);
  const topArtists = useMemo(() => {
    const map = new Map<string, { artist: string; artist_key: string; net: number }>();
    for (const row of trackRows) {
      const key = row.artist_name || "Unknown Artist";
      if (!map.has(key)) map.set(key, { artist: key, artist_key: normalizeArtistKey(key), net: 0 });
      map.get(key)!.net += row.net_revenue ?? 0;
    }
    return Array.from(map.values())
      .sort((a, b) => b.net - a.net)
      .slice(0, 8);
  }, [trackRows]);

  const sendMutation = useMutation({
    mutationFn: async (payload: AiInsightsTurnRequest): Promise<AiInsightsTurnResponse> => {
      const { data, error } = await supabase.functions.invoke("ai-insights-router-v1", { body: payload });
      if (error) {
        const message = await resolveFunctionError(error, data);
        throw new Error(message);
      }
      const response = data as AiInsightsTurnResponse | undefined;
      if (!response?.executive_answer) throw new Error("AI insights response was empty.");
      return response;
    },
    onSuccess: (response) => {
      setConversationId(response.conversation_id);
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: response.executive_answer,
          payload: response,
        },
      ]);
      setQuestion("");
    },
    onError: (error: Error) => {
      toast({ title: "AI request failed", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("from", fromDate);
      next.set("to", toDate);
      if (entityContext.track_key) next.set("track_key", entityContext.track_key);
      else next.delete("track_key");
      if (entityContext.artist_key) next.set("artist_key", entityContext.artist_key);
      else next.delete("artist_key");
      if (entityContext.artist_name) next.set("artist", entityContext.artist_name);
      else next.delete("artist");
      return next;
    }, { replace: true });
  }, [entityContext.artist_key, entityContext.artist_name, entityContext.track_key, fromDate, setSearchParams, toDate]);

  const submitQuestion = () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: trimmed }]);
    sendMutation.mutate({
      question: trimmed,
      from_date: fromDate,
      to_date: toDate,
      conversation_id: conversationId,
      entity_context: entityContext,
    });
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns.length, sendMutation.isPending]);

  const copyShareLink = async () => {
    const url = new URL(window.location.href);
    await navigator.clipboard.writeText(url.toString());
    toast({ title: "Link copied", description: "Share link copied to clipboard." });
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-background font-ui">
      {/* Sidebar: Context Rail */}
      <aside className="hidden w-[320px] flex-shrink-0 lg:block">
        <ContextRail
          trackRows={trackRows}
          onTrackSelect={(track) =>
            setEntityContext({
              track_key: track.track_key,
              track_title: track.track_title,
              artist_name: track.artist_name,
              artist_key: normalizeArtistKey(track.artist_name || "Unknown Artist"),
            })
          }
          onArtistSelect={(artistName, artistKey) =>
            setEntityContext({ artist_name: artistName, artist_key: artistKey })
          }
          onClearScope={() => setEntityContext({})}
          trackSearch={trackSearch}
          setTrackSearch={setTrackSearch}
          artistSearch={artistSearch}
          setArtistSearch={setArtistSearch}
          activeTab={activeRailTab}
          setActiveTab={setActiveRailTab}
          selectedContext={entityContext}
        />
      </aside>

      {/* Main: Chat Channel */}
      <main className="flex flex-1 flex-col bg-background">
        {/* Chat Header */}
        <header className="flex h-14 md:h-16 items-center justify-between border-b border-border bg-background px-4 md:px-6 shadow-sm z-10">
          <div className="flex items-center gap-3 md:gap-6">
            <Sheet open={isRailOpen} onOpenChange={setIsRailOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9 text-[hsl(var(--brand-accent))]">
                  <PanelRightOpen className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] p-0 border-r-0">
                <ContextRail
                  trackRows={trackRows}
                  onArtistSelect={(artistName, artistKey) => {
                    setEntityContext({ artist_name: artistName, artist_key: artistKey });
                    setIsRailOpen(false);
                  }}
                  onTrackSelect={(track) => {
                    setEntityContext({
                      track_key: track.track_key,
                      track_title: track.track_title,
                      artist_name: track.artist_name,
                      artist_key: normalizeArtistKey(track.artist_name || "Unknown Artist"),
                    });
                    setIsRailOpen(false);
                  }}
                  onClearScope={() => {
                    setEntityContext({});
                    setIsRailOpen(false);
                  }}
                  trackSearch={trackSearch}
                  setTrackSearch={setTrackSearch}
                  artistSearch={artistSearch}
                  setArtistSearch={setArtistSearch}
                  activeTab={activeRailTab}
                  setActiveTab={setActiveRailTab}
                  selectedContext={entityContext}
                />
              </SheetContent>
            </Sheet>

            <button 
              onClick={() => setIsRailOpen(true)}
              className="lg:hidden flex items-center gap-2 rounded-sm border border-[hsl(var(--brand-accent))]/15 bg-[hsl(var(--brand-accent-ghost))]/30 px-2 py-1 transition-all active:scale-95"
            >
              <h1 className="type-display-section text-[9px] font-bold tracking-[0.2em] text-[hsl(var(--brand-accent))] uppercase">
                {entityContext.track_key ? "TRACK // " + entityContext.track_key : entityContext.artist_name ? "ARTIST // " + entityContext.artist_name : "WORKSPACE"}
              </h1>
              <ChevronDown className="h-2.5 w-2.5 text-[hsl(var(--brand-accent))] opacity-40" />
            </button>
            <h1 className="hidden lg:block type-display-section text-sm font-normal tracking-[0.2em] text-foreground">
              AI INSIGHTS
            </h1>
            <div className="hidden md:block">
              <Tabs
                value={entityContext.track_key ? "track" : entityContext.artist_name ? "artist" : "workspace"}
                onValueChange={(v) => {
                  if (v === "workspace") setEntityContext({});
                }}
              >
                <TabsList className="h-8 border-[hsl(var(--brand-accent))]/15 bg-[hsl(var(--brand-accent-ghost))]/30 p-0.5">
                  <TabsTrigger value="workspace" className="h-7 px-3 text-[9px] font-bold uppercase tracking-widest data-[state=active]:bg-[hsl(var(--brand-accent))] data-[state=active]:text-white">Workspace</TabsTrigger>
                  <TabsTrigger value="artist" disabled={!entityContext.artist_name} className="h-7 px-3 text-[9px] font-bold uppercase tracking-widest data-[state=active]:bg-[hsl(var(--brand-accent))] data-[state=active]:text-white">Artist</TabsTrigger>
                  <TabsTrigger value="track" disabled={!entityContext.track_key} className="h-7 px-3 text-[9px] font-bold uppercase tracking-widest data-[state=active]:bg-[hsl(var(--brand-accent))] data-[state=active]:text-white">Track</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex h-7 md:h-8 items-center gap-1.5 md:gap-2 rounded-sm border border-[hsl(var(--brand-accent))]/15 bg-[hsl(var(--brand-accent-ghost))]/30 px-2 md:px-3">
              <CalendarRange className="h-3 w-3 md:h-3.5 md:w-3.5 text-[hsl(var(--brand-accent))] opacity-60" />
              <span className="font-mono text-[9px] md:text-[10px] uppercase text-[hsl(var(--brand-accent))]">
                {fromDate.split('-').reverse().slice(0, 2).join('.')} — {toDate.split('-').reverse().slice(0, 2).join('.')}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={copyShareLink} className="h-7 md:h-8 border-[hsl(var(--brand-accent))]/20 bg-background px-2 md:px-3 text-[hsl(var(--brand-accent))] hover:bg-[hsl(var(--brand-accent))] hover:text-white transition-all">
              <Copy className="h-3 w-3" />
              <span className="ml-1.5 md:ml-2 text-[8px] md:text-[9px] font-bold uppercase tracking-widest">Share</span>
            </Button>
          </div>
        </header>

        {/* Chat Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative bg-background">
          <ScrollArea className="flex-1 px-6">
            <div className="mx-auto max-w-4xl py-12">
              {turns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-sm bg-[hsl(var(--brand-accent))] shadow-lg">
                    <Sparkles className="h-6 w-6 text-white" />
                  </div>
                  <h2 className="type-display-section text-4xl tracking-tight text-black">
                    AI ASSISTANT
                  </h2>
                  <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                    Ask questions about your tracks, artists, and royalty performance to uncover strategic growth opportunities.
                  </p>
                  <div className="mt-10 flex flex-wrap justify-center gap-2">
                    {[
                      "Where is revenue leaking the most?",
                      "Which artists should we prioritize?",
                      "Show tracks with highest opportunity.",
                    ].map((starter) => (
                      <button
                        key={starter}
                        onClick={() => setQuestion(starter)}
                        className="rounded-sm border border-[hsl(var(--brand-accent))]/15 bg-background px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all hover:border-[hsl(var(--brand-accent))] hover:bg-[hsl(var(--brand-accent-ghost))]/30"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6 md:space-y-10">
                  {turns.map((turn, idx) => (
                    <div
                      key={turn.id}
                      className={cn(
                        "flex flex-col gap-3 md:gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500",
                        idx > 0 && "border-t border-black/5 pt-6 md:pt-10"
                      )}
                    >
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-black shadow-lg",
                          turn.role === "assistant" ? "bg-black text-white" : "bg-card text-black"
                        )}>
                          {turn.role === "assistant" ? <Target className="h-4 w-4" /> : <User className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 space-y-4">
                          <div className="flex items-center justify-between">
                              <p className="type-micro text-[10px] font-bold tracking-[0.2em] text-[hsl(var(--brand-accent))]">
                                {turn.role === "assistant" ? "ANALYSIS // ORDERSOUNDS" : "INTENT // SOURCE"}
                              </p>
                            <p className="font-mono text-[9px] text-muted-foreground opacity-40 uppercase">
                              {format(new Date(), "HH:mm:ss")}
                            </p>
                          </div>

                          {turn.payload ? (
                            <div className="space-y-8">
                              <div className="max-w-[90%]">
                                <h3 className="type-display-section text-2xl md:text-3xl leading-[1.1] tracking-tight">
                                  {turn.payload.answer_title}
                                </h3>
                                <p className="mt-4 text-base leading-relaxed text-foreground/[0.85] font-medium">
                                  {turn.payload.executive_answer}
                                </p>
                              </div>

                              <div className="grid grid-cols-2 gap-y-3 gap-x-6 md:grid-cols-4 border-l-2 border-[hsl(var(--brand-accent))]/20 pl-6 py-0.5">
                                {turn.payload.kpis.map((kpi) => (
                                  <div key={kpi.label} className="min-w-0">
                                    <p className="type-micro text-[8px] font-normal tracking-[0.15em] text-black/40 uppercase">{kpi.label}</p>
                                    <p className="mt-0.5 truncate font-mono text-base font-bold tracking-tight text-black" title={kpi.value}>
                                      {kpi.value}
                                    </p>
                                  </div>
                                ))}
                              </div>

                              <div className="group relative overflow-hidden rounded-sm bg-black p-6 text-white shadow-2xl transition-all hover:shadow-black/20">
                                <div className="absolute right-0 top-0 h-32 w-32 translate-x-16 translate-y-[-16px] rounded-full bg-white/5 blur-3xl group-hover:bg-white/10 transition-all"></div>
                                <div className="flex items-center gap-3 text-white/40">
                                  <TrendingUp className="h-4 w-4" />
                                  <p className="type-micro text-[10px] font-bold tracking-[0.3em] text-white/50">BUSINESS STRATEGY</p>
                                </div>
                                <p className="mt-3 text-[13px] font-medium leading-[1.6] text-white/90">{turn.payload.why_this_matters}</p>
                              </div>

                              {turn.payload.visual.type !== "none" && (
                                <div className="overflow-hidden rounded-sm border border-black/10 bg-white shadow-xl">
                                  <div className="flex items-center justify-between border-b border-black/5 bg-black/[0.02] px-6 py-2.5">
                                    <p className="type-micro text-[10px] font-bold tracking-[0.2em] text-black/60">
                                      {turn.payload.visual.title || "EVIDENCE VISUALIZATION"}
                                    </p>
                                    <Badge variant="outline" className="border-black/20 font-mono text-[9px] uppercase tracking-widest">
                                      {turn.payload.visual.type}
                                    </Badge>
                                  </div>
                                  <div className="p-6">
                                    {turn.payload.visual.type === "table" ? (
                                      <div className="overflow-x-auto">
                                        <Table>
                                          <TableHeader>
                                            <TableRow className="border-b-2 border-black bg-transparent hover:bg-transparent">
                                              {(turn.payload.visual.columns ?? []).map((column) => (
                                                <TableHead key={column} className="type-table-head h-12 text-[10px] font-bold text-black border-none">
                                                  {toAssistantLabel(column)}
                                                </TableHead>
                                              ))}
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {turn.payload.visual.rows?.slice(0, 10).map((row, rIdx) => (
                                              <TableRow key={rIdx} className="border-b border-black/5 hover:bg-black/[0.02] transition-colors">
                                                {(turn.payload.visual.columns ?? []).map((column) => (
                                                  <TableCell key={column} className="py-3 font-mono text-[10px] font-bold text-black/90">
                                                    {formatAssistantValue(column, row[column])}
                                                  </TableCell>
                                                ))}
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    ) : (
                                      <div className="h-[360px] w-full pt-4">
                                        <ResponsiveContainer width="100%" height="100%">
                                          {turn.payload.visual.type === "bar" ? (
                                            <BarChart data={turn.payload.visual.rows}>
                                              <CartesianGrid stroke="#000" strokeDasharray="1 4" vertical={false} opacity={0.1} />
                                              <XAxis dataKey={turn.payload.visual.x} hide />
                                              <YAxis tick={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600 }} axisLine={false} tickLine={false} width={60} />
                                              <Tooltip
                                                contentStyle={{ backgroundColor: 'black', border: 'none', borderRadius: '2px', fontSize: '11px', padding: '12px' }}
                                                itemStyle={{ color: 'white', fontWeight: 700 }}
                                                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                                              />
                                              {turn.payload.visual.y?.map((col, cIdx) => (
                                                <Bar key={col} dataKey={col} fill={CHART_COLORS[cIdx % CHART_COLORS.length]} radius={[1, 1, 0, 0]} barSize={32} />
                                              ))}
                                            </BarChart>
                                          ) : (
                                            <LineChart data={turn.payload.visual.rows}>
                                              <CartesianGrid stroke="#000" strokeDasharray="1 4" vertical={false} opacity={0.1} />
                                              <XAxis dataKey={turn.payload.visual.x} hide />
                                              <YAxis tick={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600 }} axisLine={false} tickLine={false} width={60} />
                                              <Tooltip
                                                contentStyle={{ backgroundColor: 'black', border: 'none', borderRadius: '2px', fontSize: '11px', padding: '12px' }}
                                                itemStyle={{ color: 'white', fontWeight: 700 }}
                                              />
                                              {turn.payload.visual.y?.map((col, cIdx) => (
                                                <Line key={col} type="montone" dataKey={col} stroke={CHART_COLORS[cIdx % CHART_COLORS.length]} strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: 'white' }} activeDot={{ r: 5 }} />
                                              ))}
                                            </LineChart>
                                          )}
                                        </ResponsiveContainer>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Removed metadata, actions, and follow-up questions per user request */}
                            </div>
                          ) : (
                            <p className="text-xl font-bold leading-relaxed tracking-tight">{turn.text}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {sendMutation.isPending && (
                    <div className="flex items-start gap-6 opacity-60">
                      <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-black bg-black text-white shadow-lg relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite] -translate-y-full"></div>
                        <Bot className="h-5 w-5 relative" />
                      </div>
                      <div className="flex-1 space-y-4 pt-1">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--brand-accent))] animate-pulse"></span>
                          <p className="type-micro text-[9px] font-bold tracking-[0.3em] text-[hsl(var(--brand-accent))] animate-pulse">
                            STRATEGIC ANALYSIS IN PROGRESS
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="h-[1px] w-full bg-[hsl(var(--brand-accent))]/10 relative overflow-hidden">
                            <div className="absolute inset-0 bg-[hsl(var(--brand-accent))] animate-[loading-bar_3s_infinite]"></div>
                          </div>
                          <div className="h-[1px] w-2/3 bg-[hsl(var(--brand-accent))]/10 relative overflow-hidden">
                            <div className="absolute inset-0 bg-[hsl(var(--brand-accent))] animate-[loading-bar_2s_infinite_0.5s]"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Chat Input */}
        <footer className="border-t border-black/10 bg-background p-4 md:p-8 z-10 transition-all focus-within:border-black">
          <div className="mx-auto max-w-4xl space-y-4 md:space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <button 
                onClick={() => setIsRailOpen(true)}
                className="lg:hidden flex items-center gap-2 rounded-sm border border-[hsl(var(--brand-accent))]/20 bg-[hsl(var(--brand-accent-ghost))]/30 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--brand-accent))] transition-all active:scale-95"
              >
                <Target className="h-3.5 w-3.5" />
                {entityContext.track_key ? "CONTEXT: " + entityContext.track_key : entityContext.artist_name ? "CONTEXT: " + entityContext.artist_name : "CONTEXT: WORKSPACE"}
              </button>
              <div className="hidden lg:flex items-center gap-2 rounded-sm border border-[hsl(var(--brand-accent))]/20 bg-[hsl(var(--brand-accent-ghost))]/30 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
                <Target className="h-3.5 w-3.5" />
                {entityContext.track_key ? "CONTEXT: " + entityContext.track_key : entityContext.artist_name ? "CONTEXT: " + entityContext.artist_name : "CONTEXT: WORKSPACE"}
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 rounded-sm border border-black/20 bg-white px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-black hover:text-white transition-all">
                    <CalendarRange className="h-3.5 w-3.5" />
                    WINDOW: {fromDate.split('-').join('.')} - {toDate.split('-').join('.')}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-6 rounded-sm border-2 border-black shadow-2xl" align="start">
                  <div className="grid gap-6">
                    <div className="space-y-2">
                      <p className="type-micro text-[11px] font-bold text-black tracking-widest">TIME HORIZON: FROM</p>
                      <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 rounded-sm border-black font-mono text-xs" />
                    </div>
                    <div className="space-y-2">
                      <p className="type-micro text-[11px] font-bold text-black tracking-widest">TIME HORIZON: TO</p>
                      <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-10 rounded-sm border-black font-mono text-xs" />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="relative group">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask anything..."
                className="min-h-[80px] md:min-h-[120px] w-full resize-none rounded-sm border border-black bg-background p-3 md:p-5 pr-16 md:pr-24 text-base md:text-lg font-bold placeholder:opacity-20 focus-visible:ring-0 focus-visible:border-black transition-all"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitQuestion();
                  }
                }}
              />
              <div className="absolute bottom-3 right-3 md:bottom-5 md:right-5 flex items-center gap-3">
                <p className="font-mono text-[10px] font-bold opacity-30 uppercase hidden md:block tracking-widest">SEND: ENTER</p>
                <Button
                  onClick={submitQuestion}
                  disabled={sendMutation.isPending || !question.trim()}
                  size="icon"
                  className="bg-black hover:bg-zinc-800 h-10 w-10 md:h-12 md:w-12 rounded-sm shadow-xl transition-all hover:scale-105 active:scale-95"
                >
                  <Send className="h-4 w-4 md:h-5 md:w-5" />
                </Button>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

function ContextRail({
  trackRows,
  onTrackSelect,
  onArtistSelect,
  onClearScope,
  trackSearch,
  setTrackSearch,
  artistSearch,
  setArtistSearch,
  activeTab,
  setActiveTab,
  selectedContext,
}: {
  trackRows: TrackInsightListRow[];
  onTrackSelect: (track: TrackInsightListRow) => void;
  onArtistSelect: (artistName: string, artistKey: string) => void;
  onClearScope: () => void;
  trackSearch: string;
  setTrackSearch: (v: string) => void;
  artistSearch: string;
  setArtistSearch: (v: string) => void;
  activeTab: "tracks" | "artists";
  setActiveTab: (v: "tracks" | "artists") => void;
  selectedContext: {
    track_key?: string;
    artist_key?: string;
    artist_name?: string;
  };
}) {
  const filteredTracks = useMemo(() => {
    const sorted = [...trackRows].sort((a, b) => (b.net_revenue ?? 0) - (a.net_revenue ?? 0));
    if (!trackSearch.trim()) return sorted;
    const term = trackSearch.toLowerCase();
    return sorted.filter((t) =>
      t.track_title?.toLowerCase().includes(term) ||
      t.artist_name?.toLowerCase().includes(term)
    );
  }, [trackRows, trackSearch]);

  const allArtists = useMemo(() => {
    const map = new Map<string, { artist: string; artist_key: string; net: number }>();
    for (const row of trackRows) {
      const key = row.artist_name || "Unknown Artist";
      if (!map.has(key)) map.set(key, { artist: key, artist_key: normalizeArtistKey(key), net: 0 });
      map.get(key)!.net += row.net_revenue ?? 0;
    }
    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  }, [trackRows]);

  const filteredArtists = useMemo(() => {
    if (!artistSearch.trim()) return allArtists;
    const term = artistSearch.toLowerCase();
    return allArtists.filter((a) => a.artist.toLowerCase().includes(term));
  }, [allArtists, artistSearch]);

  return (
    <div className="flex h-full flex-col border-r border-black/5 bg-[hsl(var(--brand-accent-ghost))]/30 backdrop-blur-md">
      <div className="border-b border-black/10 p-5">
        <h2 className="type-display-section text-[10px] font-normal tracking-[0.25em] text-[hsl(var(--brand-accent))] opacity-70">
          DATA CONTEXT
        </h2>
        <div className="mt-5 flex rounded-sm border border-[hsl(var(--brand-accent))]/15 bg-[hsl(var(--brand-accent-ghost))]/40 p-0.5">
          <button
            onClick={() => setActiveTab("tracks")}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] transition-all",
              activeTab === "tracks" ? "bg-[hsl(var(--brand-accent))] text-white shadow-md" : "text-[hsl(var(--brand-accent))]/60 hover:bg-[hsl(var(--brand-accent))]/10"
            )}
          >
            Tracks
          </button>
          <button
            onClick={() => setActiveTab("artists")}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] transition-all",
              activeTab === "artists" ? "bg-[hsl(var(--brand-accent))] text-white shadow-md" : "text-[hsl(var(--brand-accent))]/60 hover:bg-[hsl(var(--brand-accent))]/10"
            )}
          >
            Artists
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-5 py-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--brand-accent))]/30 transition-colors group-focus-within:text-[hsl(var(--brand-accent))]" />
            <Input
              value={activeTab === "tracks" ? trackSearch : artistSearch}
              onChange={(e) => activeTab === "tracks" ? setTrackSearch(e.target.value) : setArtistSearch(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="h-9 border border-[hsl(var(--brand-accent))]/15 bg-[hsl(var(--brand-accent-ghost))]/50 pl-9 text-[11px] font-medium tracking-tight transition-all focus-visible:bg-white/80 focus-visible:ring-1 focus-visible:ring-[hsl(var(--brand-accent))]/30"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="space-y-1.5">
            {activeTab === "tracks" ? (
              filteredTracks.length > 0 ? (
                filteredTracks.map((track) => {
                  const isActive = selectedContext.track_key === track.track_key;
                  return (
                    <button
                      key={track.track_key}
                      onClick={() => onTrackSelect(track)}
                      className={cn(
                        "group w-full border-l-2 py-3 pl-4 pr-3 text-left transition-all hover:bg-black/5 active:bg-black/10",
                        isActive 
                          ? "border-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent-ghost))]/50" 
                          : "border-transparent"
                      )}
                    >
                      <p className={cn(
                        "truncate text-xs font-bold tracking-tight",
                        isActive ? "text-[hsl(var(--brand-accent))]" : "text-black"
                      )}>
                        {track.track_title}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="truncate text-[10px] font-medium text-black/40 uppercase tracking-widest">{track.artist_name}</p>
                        <p className={cn(
                          "font-mono text-[10px] font-bold text-black/60 group-hover:text-black",
                          isActive && "text-[hsl(var(--brand-accent))]/80"
                        )}>
                          {toMoney(track.net_revenue)}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="py-8 text-center text-[10px] text-muted-foreground uppercase tracking-widest">No tracks matched</p>
              )
            ) : (
              filteredArtists.length > 0 ? (
                filteredArtists.map((artist) => {
                  const isActive = selectedContext.artist_key === artist.artist_key;
                  return (
                    <button
                      key={artist.artist_key}
                      onClick={() => onArtistSelect(artist.artist, artist.artist_key)}
                      className={cn(
                        "group w-full border-l-2 py-3 pl-4 pr-3 text-left transition-all hover:bg-black/5 active:bg-black/10",
                        isActive 
                          ? "border-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent-ghost))]/50" 
                          : "border-transparent"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn(
                          "truncate text-xs font-bold tracking-tight",
                          isActive ? "text-[hsl(var(--brand-accent))]" : "text-black"
                        )}>
                          {artist.artist}
                        </p>
                        <p className={cn(
                          "font-mono text-[10px] font-bold text-black/60 group-hover:text-black",
                          isActive && "text-[hsl(var(--brand-accent))]/80"
                        )}>
                          {toMoney(artist.net)}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="py-8 text-center text-[10px] text-muted-foreground uppercase tracking-widest">No artists matched</p>
              )
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="border-t border-black/5 p-5 bg-[hsl(var(--brand-accent-ghost))]/20">
        <Button
          variant="outline"
          size="sm"
          onClick={onClearScope}
          className="w-full h-9 border border-[hsl(var(--brand-accent))]/20 bg-background text-[10px] font-bold uppercase tracking-[0.2em] shadow-sm hover:bg-[hsl(var(--brand-accent))] hover:text-white transition-all"
        >
          RESET TO WORKSPACE
        </Button>
      </div>
    </div>
  );
}
