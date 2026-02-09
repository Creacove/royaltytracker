import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { BarChart3 } from "lucide-react";

const COLORS = [
  "hsl(250, 65%, 55%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)", "hsl(200, 70%, 50%)", "hsl(280, 60%, 55%)",
  "hsl(160, 50%, 45%)", "hsl(320, 60%, 50%)",
];

export default function Analytics() {
  const { data: transactions } = useQuery({
    queryKey: ["analytics-transactions"],
    queryFn: async () => {
      const { data } = await supabase.from("royalty_transactions").select("artist_name, track_title, territory, platform, net_revenue");
      return data ?? [];
    },
  });

  if (!transactions || transactions.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-sm">Revenue insights and trends</p>
        </div>
        <div className="flex flex-col items-center py-20 text-center">
          <BarChart3 className="mb-3 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">No data yet. Process reports to see analytics.</p>
        </div>
      </div>
    );
  }

  const aggregate = (key: "territory" | "platform" | "artist_name" | "track_title") => {
    const map: Record<string, number> = {};
    transactions.forEach((t) => {
      const k = t[key];
      if (k && t.net_revenue) map[k] = (map[k] ?? 0) + t.net_revenue;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  };

  const territoryData = aggregate("territory");
  const platformData = aggregate("platform");
  const artistData = aggregate("artist_name");
  const trackData = aggregate("track_title");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm">Revenue insights and trends</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by Territory</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={territoryData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                <Bar dataKey="value" fill="hsl(250, 65%, 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by Platform</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={300}>
                <PieChart>
                  <Pie data={platformData} cx="50%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" paddingAngle={2}>
                    {platformData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {platformData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top Artists by Revenue</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={artistData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                <Bar dataKey="value" fill="hsl(142, 71%, 45%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top Tracks by Revenue</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trackData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={150} />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                <Bar dataKey="value" fill="hsl(38, 92%, 50%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
