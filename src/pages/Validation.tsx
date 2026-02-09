import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, AlertTriangle, Info } from "lucide-react";
import { format } from "date-fns";

export default function Validation() {
  const { data: errors, isLoading } = useQuery({
    queryKey: ["validation-errors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("validation_errors").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const criticalCount = errors?.filter((e) => e.severity === "critical").length ?? 0;
  const warningCount = errors?.filter((e) => e.severity === "warning").length ?? 0;
  const infoCount = errors?.filter((e) => e.severity === "info").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Validation & Audit</h1>
        <p className="text-muted-foreground text-sm">Review validation errors and data quality</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-lg bg-destructive/10 p-2"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
            <div>
              <p className="text-2xl font-bold">{criticalCount}</p>
              <p className="text-xs text-muted-foreground">Critical Errors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-lg bg-warning/10 p-2"><AlertTriangle className="h-5 w-5 text-warning" /></div>
            <div>
              <p className="text-2xl font-bold">{warningCount}</p>
              <p className="text-xs text-muted-foreground">Warnings</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-lg bg-accent p-2"><Info className="h-5 w-5 text-accent-foreground" /></div>
            <div>
              <p className="text-2xl font-bold">{infoCount}</p>
              <p className="text-xs text-muted-foreground">Info</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validation Errors</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : errors && errors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><StatusBadge status={e.severity} /></TableCell>
                    <TableCell className="font-mono text-xs">{e.error_type}</TableCell>
                    <TableCell className="font-mono text-xs">{e.field_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-success">{e.expected_value ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-destructive">{e.actual_value ?? "—"}</TableCell>
                    <TableCell className="max-w-[250px] truncate text-sm">{e.message}</TableCell>
                    <TableCell className="font-mono text-xs">{e.source_page ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(e.created_at), "MMM d")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <ShieldCheck className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No validation errors. Process reports to see audit results.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
