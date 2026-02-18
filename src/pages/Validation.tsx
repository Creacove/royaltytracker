import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Info, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

export default function Validation() {
  const { data: errors, isLoading } = useQuery({
    queryKey: ["validation-errors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validation_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const criticalCount = errors?.filter((e) => e.severity === "critical").length ?? 0;
  const warningCount = errors?.filter((e) => e.severity === "warning").length ?? 0;
  const infoCount = errors?.filter((e) => e.severity === "info").length ?? 0;

  return (
    <div className="rhythm-page">
      <div>
        <h1 className="font-display text-4xl tracking-[0.03em]">Validation & Audit</h1>
        <p className="text-sm text-muted-foreground">Review validation errors and data quality.</p>
      </div>

      <section className="border-y border-foreground py-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--tone-critical))]" />
            <div>
              <p className="text-xs text-muted-foreground">Critical</p>
              <p className="font-display text-3xl">{criticalCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--tone-warning))]" />
            <div>
              <p className="text-xs text-muted-foreground">Warnings</p>
              <p className="font-display text-3xl">{warningCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-[hsl(var(--tone-info))]" />
            <div>
              <p className="text-xs text-muted-foreground">Info</p>
              <p className="font-display text-3xl">{infoCount}</p>
            </div>
          </div>
        </div>
      </section>

      <Card className="!border-0 border-t border-border bg-transparent">
        <CardHeader>
          <CardTitle className="text-base">Validation Errors</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
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
                    <TableCell>
                      <StatusBadge status={e.severity} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.error_type}</TableCell>
                    <TableCell className="font-mono text-xs">{e.field_name ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.expected_value ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.actual_value ?? "-"}</TableCell>
                    <TableCell className="max-w-[250px] truncate text-sm">{e.message}</TableCell>
                    <TableCell className="font-mono text-xs">{e.source_page ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(e.created_at), "MMM d")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <ShieldCheck className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No validation errors. Process reports to see audit results.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
