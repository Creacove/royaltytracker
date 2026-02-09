import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Reports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cmoName, setCmoName] = useState("");
  const [reportPeriod, setReportPeriod] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cmo_reports").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !user) throw new Error("Missing file or user");
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("cmo-reports").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("cmo_reports").insert({
        user_id: user.id,
        cmo_name: cmoName || "Unknown CMO",
        report_period: reportPeriod || null,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        notes: notes || null,
        status: "pending",
      });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast({ title: "Report uploaded", description: "Your CMO report is queued for processing." });
      setFile(null);
      setCmoName("");
      setReportPeriod("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports-summary"] });
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
      queryClient.invalidateQueries({ queryKey: ["reports-summary"] });
      toast({ title: "Report deleted" });
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type === "application/pdf") setFile(f);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">Upload and manage CMO royalty report PDFs</p>
      </div>

      {/* Upload Zone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer ${
              dragActive ? "border-primary bg-accent/50" : "border-border hover:border-primary/40"
            }`}
            onClick={() => document.getElementById("pdf-upload")?.click()}
          >
            <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
            {file ? (
              <p className="text-sm font-medium">{file.name} <span className="text-muted-foreground">({(file.size / 1024 / 1024).toFixed(1)} MB)</span></p>
            ) : (
              <>
                <p className="text-sm font-medium">Drop a PDF here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">CMO royalty report PDFs only</p>
              </>
            )}
            <input id="pdf-upload" type="file" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cmo">CMO Name</Label>
              <Input id="cmo" value={cmoName} onChange={(e) => setCmoName(e.target.value)} placeholder="e.g. SAMRO, CAPASSO" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period">Report Period</Label>
              <Input id="period" value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value)} placeholder="e.g. Q3 2025" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>
          </div>

          <Button onClick={() => uploadMutation.mutate()} disabled={!file || uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading..." : "Upload Report"}
          </Button>
        </CardContent>
      </Card>

      {/* Reports List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : reports && reports.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CMO</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.cmo_name}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{r.file_name}</TableCell>
                    <TableCell>{r.report_period ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.accuracy_score ? `${r.accuracy_score}%` : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.transaction_count?.toLocaleString() ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.total_revenue ? `$${Number(r.total_revenue).toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate({ id: r.id, file_path: r.file_path })}>
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <FileText className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No reports yet. Upload your first CMO report above.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
