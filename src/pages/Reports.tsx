import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Trash2, Search, Layers3, Building2 } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toMoney } from "@/lib/royalty";
import {
  AppliedFiltersRow,
  DetailDrawerFrame,
  EmptyStateBlock,
  FilterToolbar,
  KpiStrip,
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

  const [cmoName, setCmoName] = useState("");
  const [reportPeriod, setReportPeriod] = useState("");
  const [notes, setNotes] = useState("");
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

  const uploadStep = !file ? 1 : cmoName.trim() || reportPeriod.trim() || notes.trim() ? 3 : 2;

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !user) throw new Error("Missing file or user");
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("cmo-reports").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: inserted, error: insertError } = await supabase
        .from("cmo_reports")
        .insert({
          user_id: user.id,
          cmo_name: cmoName || "Unknown CMO",
          report_period: reportPeriod || null,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          notes: notes || null,
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
      setCmoName("");
      setReportPeriod("");
      setNotes("");
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    const allowedExtensions = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".jpg", ".jpeg", ".png", ".csv"];
    // Always check by extension first - MIME type can be unreliable especially for dragged files
    if (f && allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext))) {
      setFile(f);
    }
  }, []);

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
        title="Reports & Statements"
        subtitle="Upload CMO statements, monitor processing, and inspect normalized payloads."
      />

      <KpiStrip
        items={[
          { label: "Visible Reports", value: filteredReports.length.toLocaleString() },
          { label: "Completed", value: stats.completed.toLocaleString(), tone: "success" },
          {
            label: "In Processing",
            value: stats.processing.toLocaleString(),
            tone: stats.processing > 0 ? "accent" : "default",
          },
          { label: "Total Line Items", value: stats.lines.toLocaleString() },
          { label: "Total Revenue", value: toMoney(stats.revenue) },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload New Statement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 border-b border-border/40 pb-4 md:grid-cols-3">
            {[
              { id: 1, label: "Select file" },
              { id: 2, label: "Add metadata" },
              { id: 3, label: "Confirm upload" },
            ].map((step) => (
              <div
                key={step.id}
                className={`rounded-sm border px-3 py-2 text-xs uppercase tracking-[0.08em] ${
                  uploadStep === step.id
                    ? "border-[hsl(var(--brand-accent))]/45 bg-[hsl(var(--brand-accent-ghost))]/40 text-foreground"
                    : uploadStep > step.id
                      ? "border-[hsl(var(--tone-success))]/35 bg-[hsl(var(--tone-success))]/8 text-foreground"
                      : "border-border/45 text-muted-foreground"
                }`}
              >
                {step.id}. {step.label}
              </div>
            ))}
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`cursor-pointer rounded-sm border-2 border-dashed p-8 text-center transition-colors ${
              dragActive ? "border-primary bg-accent/30" : "border-border hover:border-primary/40"
            }`}
            onClick={() => document.getElementById("pdf-upload")?.click()}
          >
            <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            {file ? (
              <p className="text-sm font-medium">
                {file.name}{" "}
                <span className="text-muted-foreground">
                  ({(file.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">Drop file here or click to browse</p>
                <p className="mt-1 text-xs text-muted-foreground">Supports PDF, Word, Excel, TXT, and images</p>
              </>
            )}
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) setFile(e.target.files[0]);
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cmo">CMO Name</Label>
              <Input
                id="cmo"
                value={cmoName}
                onChange={(e) => setCmoName(e.target.value)}
                placeholder="e.g. SAMRO, CAPASSO"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period">Report Period</Label>
              <Input
                id="period"
                value={reportPeriod}
                onChange={(e) => setReportPeriod(e.target.value)}
                placeholder="e.g. Q3 2025"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Quarterly workflow supported: upload multiple reports for the same CMO (for example Q1, Q2, Q3, Q4).
          </p>

          <Button onClick={() => uploadMutation.mutate()} disabled={!file || uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading..." : "Upload Statement"}
          </Button>
        </CardContent>
      </Card>

      <FilterToolbar
        title="Portfolio Documents"
        description="Search and filter statements, then inspect extraction and normalized transaction output."
      >
        <div className="grid gap-3 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search CMO, file, period, notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={selectedCmo} onValueChange={setSelectedCmo}>
              <SelectTrigger>
                <SelectValue placeholder="All CMOs" />
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
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
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
            updatedLabel={`Updated ${format(new Date(), "MMM d, yyyy HH:mm")}`}
          />
      </FilterToolbar>
      <Card>
        <CardContent>
          <Tabs value={layout} onValueChange={(v) => setLayout(v as "grouped" | "flat")} className="space-y-4">
            <TabsList>
              <TabsTrigger value="flat">
                <Layers3 className="mr-1.5 h-4 w-4" />
                All Statements
              </TabsTrigger>
              <TabsTrigger value="grouped">
                <Building2 className="mr-1.5 h-4 w-4" />
                By CMO
              </TabsTrigger>
            </TabsList>

            <TabsContent value="grouped" className="space-y-5">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : groupedReports.length > 0 ? (
                groupedReports.map(([cmo, rows]) => (
                  <section key={cmo} className="border-t border-black/20 pt-3">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="font-display text-sm">{cmo}</p>
                      <span className="font-mono text-xs text-muted-foreground">
                        {rows.length} docs | {rows.reduce((sum, r) => sum + (r.transaction_count ?? 0), 0)} lines
                      </span>
                    </div>
                    <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                      <Table className="min-w-[860px]">
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
                    </div>
                  </section>
                ))
              ) : (
                <EmptyStateBlock
                  icon={<FileText className="h-10 w-10" />}
                  title="No documents found"
                  description="No statements match your current filters."
                />
              )}
            </TabsContent>

            <TabsContent value="flat">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredReports.length > 0 ? (
                <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                  <Table className="min-w-[980px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>CMO</TableHead>
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
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyStateBlock
                  icon={<FileText className="h-10 w-10" />}
                  title="No documents found"
                  description="No statements match your current filters."
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <SheetContent className="w-[min(96vw,1100px)] max-w-[min(96vw,1100px)] p-0 sm:max-w-[min(92vw,1100px)] lg:w-[calc(100vw-16rem)] lg:max-w-[calc(100vw-16rem)]">
          {selectedReport ? (
            <DetailDrawerFrame
              title={`${selectedReport.cmo_name} | ${selectedReport.file_name}`}
              subtitle={`Uploaded ${format(new Date(selectedReport.created_at), "MMM d, yyyy HH:mm")}`}
              rightSlot={<StatusBadge status={selectedReport.status} />}
            >
              <div className="grid gap-3 rounded-sm border border-border/45 bg-background/60 p-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Normalized Lines</p>
                  <p className="text-xl font-bold">{reportTransactions.length.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Extractor Rows</p>
                  <p className="text-xl font-bold">{extractedRows.length.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Revenue</p>
                  <p className="text-xl font-bold">{toMoney(selectedReport.total_revenue ?? 0)}</p>
                </div>
              </div>

              <Tabs defaultValue="summary" className="mt-5">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="transactions">Processed Transactions</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="mt-4">
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
                    ["Accuracy", selectedReport.accuracy_score != null ? `${selectedReport.accuracy_score}%` : null],
                    ["Error Count", selectedReport.error_count?.toLocaleString()],
                    ["Notes", selectedReport.notes],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between border-b border-black/20 py-2 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value ?? "-"}</span>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="transactions" className="mt-4">
                  {reportTransactions.length > 0 ? (
                    <div className="min-w-0 overflow-x-auto rounded-sm border border-border/45 overscroll-x-contain">
                      <Table className="min-w-[1480px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky left-0 z-30 w-[180px] min-w-[180px] max-w-[180px] bg-background pr-4">
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
                                <TableCell className="sticky left-0 z-20 w-[180px] min-w-[180px] max-w-[180px] bg-background pr-4">
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
                    </div>
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
