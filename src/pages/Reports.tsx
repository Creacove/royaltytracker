import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Tables } from "@/integrations/supabase/types";
import { Link } from "react-router-dom";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Trash2, Search, Layers3, Building2, X } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toMoney } from "@/lib/royalty";
import {
  AppliedFiltersRow,
  DetailDrawerFrame,
  EmptyStateBlock,
  PageHeader,
} from "@/components/layout";

type Report = Tables<"cmo_reports">;
type Tx = Tables<"royalty_transactions">;
type ExtractedRow = Tables<"document_ai_report_items">;

const toCustomColumnLabel = (key: string) =>
  key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const readCustomProperties = (tx: Tx): Record<string, unknown> => {
  const value = tx.custom_properties;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const formatCustomValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const deriveStatementName = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const EXTRACTED_COLUMNS: Array<{ key: keyof ExtractedRow; label: string }> = [
  { key: "report_item", label: "report_item" },
  { key: "amount_in_original_currency", label: "amount_in_original_currency" },
  { key: "amount_in_reporting_currency", label: "amount_in_reporting_currency" },
  { key: "channel", label: "channel" },
  { key: "config_type", label: "config_type" },
  { key: "country", label: "country" },
  { key: "exchange_rate", label: "exchange_rate" },
  { key: "isrc", label: "isrc" },
  { key: "label", label: "label" },
  { key: "master_commission", label: "master_commission" },
  { key: "original_currency", label: "original_currency" },
  { key: "quantity", label: "quantity" },
  { key: "release_artist", label: "release_artist" },
  { key: "release_title", label: "release_title" },
  { key: "release_upc", label: "release_upc" },
  { key: "report_date", label: "report_date" },
  { key: "reporting_currency", label: "reporting_currency" },
  { key: "royalty_revenue", label: "royalty_revenue" },
  { key: "sales_end", label: "sales_end" },
  { key: "sales_start", label: "sales_start" },
  { key: "track_artist", label: "track_artist" },
  { key: "track_title", label: "track_title" },
  { key: "unit", label: "unit" },
];

export default function Reports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statementName, setStatementName] = useState("");
  const [reportPeriod, setReportPeriod] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedCmo, setSelectedCmo] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [layout, setLayout] = useState<"grouped" | "flat">("flat");
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: async (): Promise<Report[]> => {
      const { data, error } = await supabase
        .from("cmo_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: (query) => {
      const data = query.state.data as Report[] | undefined;
      return data?.some((r) => r.status === "pending" || r.status === "processing") ? 5000 : false;
    },
  });

  const { data: reportTransactions = [] } = useQuery({
    queryKey: ["report-transactions", selectedReport?.id],
    enabled: !!selectedReport,
    queryFn: async (): Promise<Tx[]> => {
      const { data, error } = await supabase
        .from("royalty_transactions")
        .select("*")
        .eq("report_id", selectedReport!.id)
        .order("source_row", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: extractedRows = [] } = useQuery({
    queryKey: ["report-extracted-fields", selectedReport?.id],
    enabled: !!selectedReport,
    queryFn: async (): Promise<ExtractedRow[]> => {
      const { data, error } = await supabase
        .from("document_ai_report_items")
        .select("*")
        .eq("report_id", selectedReport!.id)
        .order("item_index", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const customPropertyColumns = useMemo(() => {
    const keys = new Set<string>();
    reportTransactions.forEach((tx) => {
      const properties = readCustomProperties(tx);
      Object.keys(properties).forEach((key) => {
        const clean = key.trim();
        if (clean) keys.add(clean);
      });
    });
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [reportTransactions]);

  const cmoOptions = useMemo(
    () => Array.from(new Set(reports.map((r) => r.cmo_name))).sort((a, b) => a.localeCompare(b)),
    [reports]
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(reports.map((r) => r.status))).sort((a, b) => a.localeCompare(b)),
    [reports]
  );

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      const byCmo = selectedCmo === "all" || r.cmo_name === selectedCmo;
      const byStatus = selectedStatus === "all" || r.status === selectedStatus;
      const s = search.trim().toLowerCase();
      const bySearch =
        !s ||
        [r.cmo_name, r.file_name, r.report_period, r.notes]
          .map((v) => (v ?? "").toLowerCase())
          .some((v) => v.includes(s));
      return byCmo && byStatus && bySearch;
    });
  }, [reports, search, selectedCmo, selectedStatus]);

  const groupedReports = useMemo(() => {
    const map = new Map<string, Report[]>();
    for (const report of filteredReports) {
      if (!map.has(report.cmo_name)) map.set(report.cmo_name, []);
      map.get(report.cmo_name)!.push(report);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredReports]);

  const appliedFilters = useMemo(() => {
    const filters: string[] = [];
    if (selectedCmo !== "all") filters.push(`CMO: ${selectedCmo}`);
    if (selectedStatus !== "all") filters.push(`Status: ${selectedStatus}`);
    if (search.trim()) filters.push(`Search: ${search.trim()}`);
    return filters;
  }, [search, selectedCmo, selectedStatus]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setSelectedCmo("all");
    setSelectedStatus("all");
  }, []);

  const stats = useMemo(() => {
    const completed = filteredReports.filter((r) =>
      ["completed", "completed_passed", "completed_with_warnings"].includes(r.status)
    ).length;
    const processing = filteredReports.filter((r) => r.status === "processing").length;
    const lines = filteredReports.reduce((sum, r) => sum + (r.transaction_count ?? 0), 0);
    const revenue = filteredReports.reduce((sum, r) => sum + (r.total_revenue ?? 0), 0);
    return { completed, processing, lines, revenue };
  }, [filteredReports]);

  const hasAnyReports = reports.length > 0;
  const emptyReportDescription = hasAnyReports
    ? "No matching statements."
    : "No statements yet.";


  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !user) throw new Error("Missing file or user");
      if (!statementName.trim()) throw new Error("Add a statement name before uploading.");
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("cmo-reports").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: inserted, error: insertError } = await supabase
        .from("cmo_reports")
        .insert({
          user_id: user.id,
          cmo_name: statementName.trim(),
          report_period: reportPeriod.trim() || null,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          notes: null,
          status: "pending",
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const reportId = inserted.id;
      const invokeStage = async (fn: string, body: Record<string, unknown> = {}) => {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData.user) {
          throw new Error("Session expired. Please sign in again.");
        }

        const { data, error } = await supabase.functions.invoke(fn, {
          body: { report_id: reportId, ...body },
        });
        if (error) {
          let message = error.message || `${fn} failed.`;
          let status: number | undefined;
          try {
            const errWithContext = error as { context?: unknown };
            const resp = errWithContext.context as { status?: number; text?: () => Promise<string> } | undefined;
            if (resp && typeof resp.text === "function") {
              status = resp.status;
              const text = await resp.text();
              const parsed = text ? JSON.parse(text) : null;
              message = parsed?.error ?? parsed?.message ?? text ?? message;
            }
          } catch {
            // Keep fallback message if response body parsing fails.
          }
          throw new Error(status ? `${fn} failed (${status}): ${message}` : `${fn} failed: ${message}`);
        }
        return data;
      };

      await invokeStage("create-ingestion-file", { force_reprocess: true });
      await invokeStage("process-report", { force_reprocess: true });
      await invokeStage("run-normalization");
      await invokeStage("run-validation");
    },
    onSuccess: () => {
      toast({ title: "Report processed", description: "Pipeline v2 completed with quality gate applied." });
      setFile(null);
      setStatementName("");
      setReportPeriod("");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-reports"] });
    },
    onError: (e: Error) => {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (report: { id: string; file_path: string }) => {
      await supabase.storage.from("cmo-reports").remove([report.file_path]);
      const { error } = await supabase.from("cmo_reports").delete().eq("id", report.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-reports"] });
      toast({ title: "Report deleted" });
    },
  });

  const handleFileSelected = useCallback((selected: File | null | undefined) => {
    if (!selected) return;
    setFile(selected);
    setStatementName((current) => current.trim() || deriveStatementName(selected.name));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    const allowedExtensions = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".jpg", ".jpeg", ".png", ".csv"];
    // Always check by extension first - MIME type can be unreliable especially for dragged files
    if (f && allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext))) {
      handleFileSelected(f);
    }
  }, [handleFileSelected]);

  const renderReportRows = (rows: Report[]) =>
    rows.map((r) => (
      <TableRow
        key={r.id}
        role="button"
        tabIndex={0}
        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          event.currentTarget.focus();
          setSelectedReport(r);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedReport(r);
          }
        }}
      >
        <TableCell className="font-medium">{r.file_name}</TableCell>
        <TableCell>{r.report_period ?? "-"}</TableCell>
        <TableCell>
          <StatusBadge status={r.status} />
        </TableCell>
        <TableCell className="text-right font-mono">{r.transaction_count?.toLocaleString() ?? "-"}</TableCell>
        <TableCell className="text-right font-mono">{toMoney(r.total_revenue ?? 0)}</TableCell>
        <TableCell className="text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
        <TableCell className="text-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete report ${r.file_name}`}
            onClick={(e) => {
              e.stopPropagation();
              deleteMutation.mutate({ id: r.id, file_path: r.file_path });
            }}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </TableCell>
      </TableRow>
    ));

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        variant="compact"
        title="Statements"
        meta={
          <>
            <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-elevated)/0.7)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
              {filteredReports.length.toLocaleString()} visible
            </span>
            <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.7)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
              {stats.processing} processing
            </span>
          </>
        }
        actions={
          <Button asChild size="sm" variant="quiet">
            <Link to="/ai-insights">Open AI Insights</Link>
          </Button>
        }
      />

      <Card surface="hero">
        <CardContent className="space-y-4 p-4 md:p-5">
          <CardTitle className="text-[1.05rem]">Upload statement</CardTitle>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)_minmax(160px,0.55fr)_auto] xl:items-end">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`forensic-frame relative cursor-pointer overflow-hidden rounded-[calc(var(--radius)-2px)] border-2 border-dashed px-5 py-5 motion-standard ${
                dragActive
                  ? "border-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent-ghost)/0.72)]"
                  : "surface-elevated border-[hsl(var(--border)/0.12)] hover:border-[hsl(var(--brand-accent)/0.26)] hover:bg-[hsl(var(--surface-elevated)/0.98)]"
              }`}
              onClick={() => document.getElementById("pdf-upload")?.click()}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,hsl(var(--brand-accent)/0.75),transparent)]" />
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.82)] text-[hsl(var(--brand-accent))]">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="type-display-section truncate text-[1.1rem] text-foreground">
                    {file ? file.name : "Choose a file"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {file
                      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                      : "PDF, Word, Excel, CSV, or image"}
                  </p>
                </div>
              </div>
              <input
                id="pdf-upload"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.csv"
                className="hidden"
                onChange={(e) => handleFileSelected(e.target.files?.[0])}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="statement-name">Statement name</Label>
              <Input
                id="statement-name"
                value={statementName}
                onChange={(e) => setStatementName(e.target.value)}
                placeholder="e.g. BMI Q1 2026"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-period">Period</Label>
              <Input
                id="report-period"
                value={reportPeriod}
                onChange={(e) => setReportPeriod(e.target.value)}
                placeholder="e.g. Q1 2026"
              />
            </div>

            <div className="flex flex-col gap-2 xl:items-end">
              <Button
                className="w-full xl:w-auto"
                onClick={() => uploadMutation.mutate()}
                disabled={!file || !statementName.trim() || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
              {file ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full xl:w-auto"
                  onClick={() => setFile(null)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card surface="evidence">
        <CardContent className="p-4 md:p-5">
          <Tabs value={layout} onValueChange={(v) => setLayout(v as "grouped" | "flat")} className="space-y-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.7)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  {stats.completed.toLocaleString()} ready
                </span>
                {stats.processing > 0 ? (
                  <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.7)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
                    {stats.processing} in queue
                  </span>
                ) : null}
              </div>
              <TabsList variant="quiet" className="h-auto w-auto gap-5 self-start">
                <TabsTrigger value="flat" variant="quiet" className="flex-none">
                  <Layers3 className="mr-1.5 h-4 w-4" />
                  All Statements
                </TabsTrigger>
                <TabsTrigger value="grouped" variant="quiet" className="flex-none">
                  <Building2 className="mr-1.5 h-4 w-4" />
                  By Source
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  variant="quiet"
                  className="pl-9"
                  placeholder="Search statement, file, or source..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={selectedCmo} onValueChange={setSelectedCmo}>
                <SelectTrigger className="border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.55)] shadow-none">
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {cmoOptions.map((cmo) => (
                    <SelectItem key={cmo} value={cmo}>
                      {cmo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.55)] shadow-none">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <AppliedFiltersRow
              filters={appliedFilters}
              onClear={clearFilters}
              emptyLabel={
                hasAnyReports ? `${reports.length.toLocaleString()} statements` : "No statements yet."
              }
              className="pt-0"
            />

            <TabsContent value="grouped" className="space-y-5">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : groupedReports.length > 0 ? (
                groupedReports.map(([cmo, rows]) => (
                  <section key={cmo} className="surface-muted forensic-frame rounded-[calc(var(--radius-md)-2px)] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="type-display-section text-[1.05rem] text-foreground">{cmo}</p>
                      <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.75)] px-2.5 py-1 font-mono text-xs text-muted-foreground">
                        {rows.length} docs | {rows.reduce((sum, r) => sum + (r.transaction_count ?? 0), 0)} lines
                      </span>
                    </div>
                    <Table className="min-w-[860px]" variant="evidence" density="compact">
                        <TableHeader>
                          <TableRow>
                            <TableHead>File</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Lines</TableHead>
                            <TableHead className="text-right">Revenue</TableHead>
                            <TableHead>Uploaded</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>{renderReportRows(rows)}</TableBody>
                      </Table>
                  </section>
                ))
              ) : (
                <EmptyStateBlock
                  icon={<FileText className="h-10 w-10" />}
                  title="No documents found"
                  description={emptyReportDescription}
                  variant="intelligence"
                />
              )}
            </TabsContent>

            <TabsContent value="flat">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredReports.length > 0 ? (
                  <Table className="min-w-[980px]" variant="evidence">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead>Uploaded</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReports.map((r) => (
                        <TableRow
                          key={r.id}
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(event) => {
                            event.currentTarget.focus();
                            setSelectedReport(r);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedReport(r);
                            }
                          }}
                        >
                          <TableCell className="font-medium">{r.cmo_name}</TableCell>
                          <TableCell>{r.file_name}</TableCell>
                          <TableCell>{r.report_period ?? "-"}</TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {r.transaction_count?.toLocaleString() ?? "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">{toMoney(r.total_revenue ?? 0)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(r.created_at), "MMM d, yyyy")}
                          </TableCell>
                        <TableCell className="text-right">
                             <Button
                               type="button"
                               variant="quiet"
                               size="icon"
                               aria-label={`Delete report ${r.file_name}`}
                               onClick={(e) => {
                                 e.stopPropagation();
                                 deleteMutation.mutate({ id: r.id, file_path: r.file_path });
                               }}
                             >
                              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              ) : (
                <EmptyStateBlock
                  icon={<FileText className="h-10 w-10" />}
                  title="No documents found"
                  description={emptyReportDescription}
                  variant="intelligence"
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <SheetContent className="w-[min(98vw,1200px)] max-w-[min(98vw,1200px)] overflow-hidden p-0 [&>button]:hidden sm:max-w-[min(95vw,1200px)] lg:w-[calc(100vw-19rem)] lg:max-w-[calc(100vw-19rem)]">
          {selectedReport ? (
            <DetailDrawerFrame
              title={`${selectedReport.cmo_name} | ${selectedReport.file_name}`}
              subtitle={`Uploaded ${format(new Date(selectedReport.created_at), "MMM d, yyyy HH:mm")}`}
              rightSlot={
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedReport.status} />
                  <SheetClose asChild>
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon"
                      className="h-8 w-8 rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.9)] text-foreground/72 shadow-none hover:border-[hsl(var(--brand-accent)/0.18)] hover:bg-[hsl(var(--brand-accent-ghost)/0.52)] hover:text-foreground"
                      aria-label="Close statement details"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </SheetClose>
                </div>
              }
              variant="intelligence"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Normalized lines</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{reportTransactions.length.toLocaleString()}</p>
                </div>
                <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Extractor rows</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{extractedRows.length.toLocaleString()}</p>
                </div>
                <div className="surface-intelligence forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Revenue</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{toMoney(selectedReport.total_revenue ?? 0)}</p>
                </div>
              </div>

              <Tabs defaultValue="summary" className="mt-5">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="transactions">Processed Transactions</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="mt-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      ["CMO", selectedReport.cmo_name],
                      ["File", selectedReport.file_name],
                      ["Report Period", selectedReport.report_period],
                      ["Uploaded", format(new Date(selectedReport.created_at), "MMM d, yyyy HH:mm")],
                      [
                        "Processed",
                        selectedReport.processed_at
                          ? format(new Date(selectedReport.processed_at), "MMM d, yyyy HH:mm")
                          : null,
                      ],
                      ["Status", selectedReport.status],
                      [
                        "System Confidence Score",
                        selectedReport.accuracy_score != null ? `${selectedReport.accuracy_score}%` : null,
                      ],
                      ["Error Count", selectedReport.error_count?.toLocaleString()],
                      ["Notes", selectedReport.notes],
                    ].map(([label, value]) => (
                      <div key={label} className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                        <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                        <p className="mt-2 text-sm leading-relaxed text-foreground">{value ?? "-"}</p>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="transactions" className="mt-4">
                  {reportTransactions.length > 0 ? (
                      <Table className="min-w-[1480px]" variant="evidence" density="compact">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky left-0 z-30 w-[180px] min-w-[180px] max-w-[180px] bg-[hsl(var(--surface-elevated)/0.98)] pr-4">
                              <span className="relative block after:pointer-events-none after:absolute after:-right-5 after:top-0 after:h-full after:w-5 after:bg-gradient-to-r after:from-background after:via-background/90 after:to-transparent">
                                Track
                              </span>
                            </TableHead>
                            <TableHead>Artist</TableHead>
                            <TableHead>ISRC</TableHead>
                            <TableHead>ISWC</TableHead>
                            <TableHead>Territory</TableHead>
                            <TableHead>Platform</TableHead>
                            <TableHead>Usage</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead>Currency</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">Commission</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            {customPropertyColumns.map((column) => (
                              <TableHead key={column}>{toCustomColumnLabel(column)}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportTransactions.slice(0, 200).map((tx) => {
                            const customProperties = readCustomProperties(tx);
                            return (
                              <TableRow key={tx.id}>
                                <TableCell className="sticky left-0 z-20 w-[180px] min-w-[180px] max-w-[180px] bg-[hsl(var(--surface-elevated)/0.96)] pr-4">
                                  <span className="relative block truncate after:pointer-events-none after:absolute after:-right-5 after:top-0 after:h-full after:w-5 after:bg-gradient-to-r after:from-background after:via-background/90 after:to-transparent">
                                    {tx.track_title ?? "-"}
                                  </span>
                                </TableCell>
                                <TableCell>{tx.artist_name ?? "-"}</TableCell>
                                <TableCell className="font-mono text-xs">{tx.isrc ?? "-"}</TableCell>
                                <TableCell className="font-mono text-xs">{tx.iswc ?? "-"}</TableCell>
                                <TableCell>{tx.territory ?? "-"}</TableCell>
                                <TableCell>{tx.platform ?? "-"}</TableCell>
                                <TableCell>{tx.usage_type ?? "-"}</TableCell>
                                <TableCell className="font-mono text-xs">
                                  {tx.period_start && tx.period_end ? `${tx.period_start} -> ${tx.period_end}` : "-"}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{tx.currency ?? "-"}</TableCell>
                                <TableCell className="text-right font-mono">{tx.quantity ?? "-"}</TableCell>
                                <TableCell className="text-right font-mono">{toMoney(tx.gross_revenue)}</TableCell>
                                <TableCell className="text-right font-mono">{toMoney(tx.commission)}</TableCell>
                                <TableCell className="text-right font-mono">{toMoney(tx.net_revenue)}</TableCell>
                                {customPropertyColumns.map((column) => {
                                  const value = formatCustomValue(customProperties[column]);
                                  return (
                                    <TableCell key={column} className="max-w-[220px] truncate" title={value}>
                                      {value}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">No normalized transactions available.</p>
                  )}
                </TabsContent>
              </Tabs>
            </DetailDrawerFrame>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
