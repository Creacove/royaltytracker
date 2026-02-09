import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Search, ArrowRightLeft } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Transaction = Tables<"royalty_transactions">;

export default function Transactions() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Transaction | null>(null);

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("royalty_transactions").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const filtered = transactions?.filter((t) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [t.artist_name, t.track_title, t.isrc, t.territory, t.platform].some((f) => f?.toLowerCase().includes(s));
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <p className="text-muted-foreground text-sm">Explore normalized royalty data</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Royalty Transactions</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search artist, ISRC, territory…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered && filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead>Track</TableHead>
                    <TableHead>ISRC</TableHead>
                    <TableHead>Territory</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                      <TableCell className="font-medium">{t.artist_name ?? "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{t.track_title ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{t.isrc ?? "—"}</TableCell>
                      <TableCell>{t.territory ?? "—"}</TableCell>
                      <TableCell>{t.platform ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{t.gross_revenue != null ? `$${Number(t.gross_revenue).toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{t.net_revenue != null ? `$${Number(t.net_revenue).toFixed(2)}` : "—"}</TableCell>
                      <TableCell><StatusBadge status={t.validation_status ?? "pending"} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <ArrowRightLeft className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No transactions yet. Process a report to see data here.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Drawer */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Transaction Detail</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4">
              {[
                ["Artist", selected.artist_name],
                ["Track", selected.track_title],
                ["ISRC", selected.isrc],
                ["ISWC", selected.iswc],
                ["Territory", selected.territory],
                ["Platform", selected.platform],
                ["Usage Type", selected.usage_type],
                ["Quantity", selected.quantity?.toLocaleString()],
                ["Gross Revenue", selected.gross_revenue != null ? `$${Number(selected.gross_revenue).toFixed(4)}` : null],
                ["Commission", selected.commission != null ? `$${Number(selected.commission).toFixed(4)}` : null],
                ["Net Revenue", selected.net_revenue != null ? `$${Number(selected.net_revenue).toFixed(4)}` : null],
                ["Currency", selected.currency],
                ["Period", selected.period_start && selected.period_end ? `${selected.period_start} → ${selected.period_end}` : null],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between border-b border-border py-2">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm font-medium font-mono">{value ?? "—"}</span>
                </div>
              ))}

              <div className="pt-2">
                <h4 className="text-sm font-semibold mb-2">Source Evidence</h4>
                <div className="rounded-lg bg-muted p-3 space-y-1 text-sm font-mono">
                  <p>Page: {selected.source_page ?? "—"}</p>
                  <p>Row: {selected.source_row ?? "—"}</p>
                  <p>OCR Confidence: {selected.ocr_confidence != null ? `${selected.ocr_confidence}%` : "—"}</p>
                  {selected.bbox_x != null && (
                    <p>Bounding Box: ({selected.bbox_x}, {selected.bbox_y}) {selected.bbox_width}×{selected.bbox_height}</p>
                  )}
                </div>
              </div>

              <div>
                <StatusBadge status={selected.validation_status ?? "pending"} />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
