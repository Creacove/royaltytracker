import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { FileText, ArrowRightLeft, ShieldCheck, DollarSign } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { format } from "date-fns";

const CHART_COLORS = [
  "hsl(250, 65%, 55%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)",
  "hsl(200, 70%, 50%)",
  "hsl(280, 60%, 55%)",
];

export default function Dashboard() {
  const { data: reports } = useQuery({
    queryKey: ["reports-summary"],
    queryFn: async () => {
      const { data } = await supabase.from("cmo_reports").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: transactions } = useQuery({
    queryKey: ["transactions-summary"],
    queryFn: async () => {
      const { data } = await supabase.from("royalty_transactions").select("territory, platform, net_revenue");
      return data ?? [];
    },
  });

  const { data: errors } = useQuery({
    queryKey: ["errors-summary"],
    queryFn: async () => {
      const { data } = await supabase.from("validation_errors").select("severity");
      return data ?? [];
    },
  });

  const totalReports = reports?.length ?? 0;
  const totalTransactions = transactions?.length ?? 0;
  const totalRevenue = transactions?.reduce((sum, t) => sum + (t.net_revenue ?? 0), 0) ?? 0;
  const avgAccuracy = reports?.length
    ? reports.filter((r) => r.accuracy_score).reduce((sum, r) => sum + (r.accuracy_score ?? 0), 0) /
      reports.filter((r) => r.accuracy_score).length
    : 0;

  // Territory chart
  const territoryMap: Record<string, number> = {};
  transactions?.forEach((t) => {
    if (t.territory && t.net_revenue) {
      territoryMap[t.territory] = (territoryMap[t.territory] ?? 0) + t.net_revenue;
    }
  });
  const territoryData = Object.entries(territoryMap)
    .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Platform chart
  const platformMap: Record<string, number> = {};
  transactions?.forEach((t) => {
    if (t.platform && t.net_revenue) {
      platformMap[t.platform] = (platformMap[t.platform] ?? 0) + t.net_revenue;
    }
  });
  const platformData = Object.entries(platformMap)
    .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const cards = [
    { title: "Reports", value: totalReports, icon: FileText, fmt: String(totalReports) },
    { title: "Transactions", value: totalTransactions, icon: ArrowRightLeft, fmt: totalTransactions.toLocaleString() },
    { title: "Accuracy", value: avgAccuracy, icon: ShieldCheck, fmt: avgAccuracy ? `${avgAccuracy.toFixed(1)}%` : "—" },
    { title: "Net Revenue", value: totalRevenue, icon: DollarSign, fmt: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Forensic royalty overview</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ title, icon: Icon, fmt }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmt}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue by Territory */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Territory</CardTitle>
          </CardHeader>
          <CardContent>
            {territoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={territoryData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                  <Bar dataKey="value" fill="hsl(250, 65%, 55%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                No transaction data yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Platform */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {platformData.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={260}>
                  <PieChart>
                    <Pie data={platformData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" paddingAngle={2}>
                      {platformData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {platformData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2 text-sm">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-muted-foreground">{d.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                No transaction data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Reports */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {reports && reports.length > 0 ? (
            <div className="space-y-3">
              {reports.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{r.cmo_name} — {r.file_name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy HH:mm")}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.accuracy_score && (
                      <span className="text-xs font-mono text-muted-foreground">{r.accuracy_score}%</span>
                    )}
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No reports uploaded yet. Go to Reports to upload your first CMO report.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
