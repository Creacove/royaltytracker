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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toMoney } from "@/lib/royalty";

type Report = Tables<"cmo_reports">;
type Tx = Tables<"royalty_transactions">;
type ExtractedRow = Tables<"document_ai_report_items">;

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
  const [layout, setLayout] = useState<"grouped" | "flat">("grouped");
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

  const stats = useMemo(() => {
    const completed = filteredReports.filter((r) => r.status === "completed").length;
    const processing = filteredReports.filter((r) => r.status === "processing").length;
    const lines = filteredReports.reduce((sum, r) => sum + (r.transaction_count ?? 0), 0);
    const revenue = filteredReports.reduce((sum, r) => sum + (r.total_revenue ?? 0), 0);
    return { completed, processing, lines, revenue };
  }, [filteredReports]);

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
      supabase.functions.invoke("process-report", { body: { report_id: reportId } }).then(async ({ error }) => {
        if (error) {
          let message = error.message || "Processing failed.";
          let status: number | undefined;
          try {
            const resp = (error as any)?.context;
            if (resp && typeof resp.text === "function") {
              status = resp.status;
              const text = await resp.text();
              const parsed = text ? JSON.parse(text) : null;
              message = parsed?.error ?? parsed?.message ?? text ?? message;
            }
          } catch {
            // ignore and keep fallback message
          }

          toast({
            title: status ? `Processing failed (${status})` : "Processing failed",
            description: String(message).slice(0, 220),
            variant: "destructive",
          });
        }
        queryClient.invalidateQueries({ queryKey: ["reports"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-reports"] });
      });
    },
    onSuccess: () => {
      toast({ title: "Report uploaded", description: "Document sent for processing." });
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
    if (f && f.type === "application/pdf") setFile(f);
  }, []);

  const renderReportRows = (rows: Report[]) =>
    rows.map((r) => (
      <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelectedReport(r)}>
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
            variant="ghost"
            size="icon"
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & Statements</h1>
        <p className="text-sm text-muted-foreground">
          Upload CMO statements, monitor processing, and drill into each document's extracted payload.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Visible Reports</p>
            <p className="text-2xl font-bold">{filteredReports.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-2xl font-bold">{stats.completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Total Line Items</p>
            <p className="text-2xl font-bold">{stats.lines.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">{toMoney(stats.revenue)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload New Statement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
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
                <p className="text-sm font-medium">Drop PDF here or click to browse</p>
                <p className="mt-1 text-xs text-muted-foreground">CMO royalty statement PDF only</p>
              </>
            )}
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
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

          <Button onClick={() => uploadMutation.mutate()} disabled={!file || uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading..." : "Upload & Process"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Portfolio Documents</CardTitle>
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
        </CardHeader>
        <CardContent>
          <Tabs value={layout} onValueChange={(v) => setLayout(v as "grouped" | "flat")} className="space-y-4">
            <TabsList>
              <TabsTrigger value="grouped">
                <Building2 className="mr-1.5 h-4 w-4" />
                Grouped by CMO
              </TabsTrigger>
              <TabsTrigger value="flat">
                <Layers3 className="mr-1.5 h-4 w-4" />
                Flat List
              </TabsTrigger>
            </TabsList>

            <TabsContent value="grouped" className="space-y-5">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : groupedReports.length > 0 ? (
                groupedReports.map(([cmo, rows]) => (
                  <Card key={cmo} className="border-dashed">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between text-sm">
                        <span>{cmo}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {rows.length} docs | {rows.reduce((sum, r) => sum + (r.transaction_count ?? 0), 0)} lines
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="overflow-x-auto">
                        <Table>
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
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="flex flex-col items-center py-12 text-center">
                  <FileText className="mb-3 h-10 w-10 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No documents match your filters.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="flat">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredReports.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
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
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelectedReport(r)}>
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
                              variant="ghost"
                              size="icon"
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
                <div className="flex flex-col items-center py-12 text-center">
                  <FileText className="mb-3 h-10 w-10 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No documents match your filters.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <SheetContent className="w-[96vw] max-w-[96vw] overflow-y-auto sm:max-w-[92vw]">
          {selectedReport ? (
            <>
              <SheetHeader>
                <SheetTitle>{selectedReport.cmo_name} | {selectedReport.file_name}</SheetTitle>
              </SheetHeader>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <div className="mt-1">
                      <StatusBadge status={selectedReport.status} />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Normalized Lines</p>
                    <p className="text-xl font-bold">{reportTransactions.length.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Extractor Rows</p>
                    <p className="text-xl font-bold">{extractedRows.length.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Revenue</p>
                    <p className="text-xl font-bold">{toMoney(selectedReport.total_revenue ?? 0)}</p>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="summary" className="mt-5">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="transactions">Transactions</TabsTrigger>
                  <TabsTrigger value="extractor">Extractor Fields</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="mt-4 space-y-3">
                  {[
                    ["CMO", selectedReport.cmo_name],
                    ["File", selectedReport.file_name],
                    ["Report Period", selectedReport.report_period],
                    ["Uploaded", format(new Date(selectedReport.created_at), "MMM d, yyyy HH:mm")],
                    ["Processed", selectedReport.processed_at ? format(new Date(selectedReport.processed_at), "MMM d, yyyy HH:mm") : null],
                    ["Status", selectedReport.status],
                    ["Accuracy", selectedReport.accuracy_score != null ? `${selectedReport.accuracy_score}%` : null],
                    ["Error Count", selectedReport.error_count?.toLocaleString()],
                    ["Notes", selectedReport.notes],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value ?? "-"}</span>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="transactions" className="mt-4">
                  {reportTransactions.length > 0 ? (
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Track</TableHead>
                            <TableHead>Artist</TableHead>
                            <TableHead>ISRC</TableHead>
                            <TableHead>Territory</TableHead>
                            <TableHead>Platform</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportTransactions.slice(0, 200).map((tx) => (
                            <TableRow key={tx.id}>
                              <TableCell>{tx.track_title ?? "-"}</TableCell>
                              <TableCell>{tx.artist_name ?? "-"}</TableCell>
                              <TableCell className="font-mono text-xs">{tx.isrc ?? "-"}</TableCell>
                              <TableCell>{tx.territory ?? "-"}</TableCell>
                              <TableCell>{tx.platform ?? "-"}</TableCell>
                              <TableCell className="text-right font-mono">{tx.quantity ?? "-"}</TableCell>
                              <TableCell className="text-right font-mono">{toMoney(tx.gross_revenue)}</TableCell>
                              <TableCell className="text-right font-mono">{toMoney(tx.net_revenue)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No normalized transactions available.</p>
                  )}
                </TabsContent>

                <TabsContent value="extractor" className="mt-4">
                  {extractedRows.length > 0 ? (
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[80px]">item_index</TableHead>
                            {EXTRACTED_COLUMNS.map((col) => (
                              <TableHead key={col.key as string}>{col.label}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extractedRows.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="font-mono text-xs">{row.item_index}</TableCell>
                              {EXTRACTED_COLUMNS.map((col) => (
                                <TableCell key={col.key as string} className="max-w-[220px] truncate">
                                  {(row[col.key] as string | null) ?? "-"}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No extracted field rows found for this document.</p>
                  )}
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
