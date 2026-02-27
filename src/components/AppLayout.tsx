import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Upload, ArrowRightLeft, ShieldAlert, LogOut, BarChart3 } from "lucide-react";
import { useEffect } from "react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/reports", icon: Upload, label: "Statements" },
  { to: "/insights", icon: BarChart3, label: "Track Insights" },
  { to: "/review-queue", icon: ShieldAlert, label: "Review Statements" },
  { to: "/transactions", icon: ArrowRightLeft, label: "Transactions" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuth();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2.5 border-b border-sidebar-border px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden bg-background">
            <img src="/ordersounds-logo.png" alt="OrderSounds logo" className="h-full w-full object-contain p-0.5" />
          </div>
          <span className="font-display text-lg text-foreground">OrderSounds</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ to, icon: Icon, label }) => {
            const active =
              to === "/"
                ? location.pathname === "/"
                : location.pathname === to || location.pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 border-l-2 border-transparent px-3 py-2.5 font-display text-xs tracking-[0.08em] transition-colors",
                  active
                    ? "border-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent-ghost))]/50 text-foreground"
                    : "text-sidebar-foreground hover:bg-muted/30 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-sidebar-border p-3">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 border-l-2 border-transparent px-3 py-2.5 font-display text-xs tracking-[0.08em] text-sidebar-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
