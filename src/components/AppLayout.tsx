import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowRightLeft, BarChart3, ChevronRight, LayoutDashboard, LogOut, Settings2, ShieldAlert, Upload } from "lucide-react";

import type { RouteMeta } from "@/lib/route-meta";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/reports", icon: Upload, label: "Statements" },
  { to: "/insights", icon: BarChart3, label: "Insights" },
  { to: "/review-queue", icon: ShieldAlert, label: "Statement Reviews" },
  { to: "/transactions", icon: ArrowRightLeft, label: "Transactions" },
];

type AppLayoutProps = {
  children: React.ReactNode;
  routeMeta: RouteMeta;
  companyName?: string | null;
  companyRole?: string | null;
  isPlatformAdmin?: boolean;
};

function formatRole(role: string | null | undefined) {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function AppLayoutContent({
  children,
  routeMeta,
  companyName,
  companyRole,
  isPlatformAdmin = false,
}: AppLayoutProps) {
  const { signOut } = useAuth();
  const location = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  const settingsActive = location.pathname === "/settings" || location.pathname.startsWith("/settings/");
  const workspaceActive =
    location.pathname === "/workspace" ||
    location.pathname.startsWith("/workspace/") ||
    location.pathname.startsWith("/company") ||
    location.pathname.startsWith("/admin/invites");

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, location.pathname, setOpenMobile]);

  return (
    <>
      <Sidebar className="border-r border-sidebar-border/60 bg-sidebar" collapsible="offcanvas">
        <SidebarHeader className="gap-3 border-b border-sidebar-border/60 px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-sm border border-border/50 bg-background">
              <img src="/ordersounds-logo.png" alt="OrderSounds logo" className="h-full w-full object-contain p-0.5" />
            </div>
            <span className="font-display text-lg leading-none text-foreground">OrderSounds</span>
          </Link>
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Forensic Royalty Workspace
          </p>
          <Link
            to="/workspace"
            className={cn(
              "group rounded-sm border bg-background/70 p-2 text-xs transition-colors",
              workspaceActive
                ? "border-[hsl(var(--brand-accent))]/40 bg-[hsl(var(--brand-accent-ghost))]/70"
                : "border-border/50 hover:border-border hover:bg-background",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  Workspace
                </p>
                <p className="truncate font-medium">{companyName ?? "Workspace pending"}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  {isPlatformAdmin ? "Platform Admin" : formatRole(companyRole)}
                </p>
              </div>
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        </SidebarHeader>

        <SidebarContent className="px-2 py-3">
          <SidebarMenu>
            {navItems.map(({ to, icon: Icon, label }) => {
              const active =
                to === "/"
                  ? location.pathname === "/"
                  : location.pathname === to || location.pathname.startsWith(`${to}/`);
              return (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={label}
                    className={cn(
                      "h-9 rounded-sm border border-transparent px-2.5 text-xs font-display uppercase tracking-[0.08em]",
                      active
                        ? "border-[hsl(var(--brand-accent))]/35 bg-[hsl(var(--brand-accent-ghost))]/65 text-foreground"
                        : "text-sidebar-foreground hover:border-border/35 hover:bg-muted/40",
                    )}
                  >
                    <Link to={to}>
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="px-2 pb-3 pt-0">
          <SidebarSeparator className="mb-2" />
          <Button
            asChild
            variant="ghost"
            className={cn(
              "mb-1 h-9 w-full justify-start rounded-sm px-2.5 text-xs text-sidebar-foreground",
              settingsActive && "border border-[hsl(var(--brand-accent))]/35 bg-[hsl(var(--brand-accent-ghost))]/65 text-foreground",
            )}
          >
            <Link to="/settings">
              <Settings2 className="h-4 w-4" />
              Settings
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="h-9 w-full justify-start rounded-sm px-2.5 text-xs text-sidebar-foreground"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-x-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-xs"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-20 border-b border-border/50 bg-background/95 backdrop-blur md:hidden">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4">
            <SidebarTrigger className="h-8 w-8" />
            <div className="min-w-0">
              <p className="truncate font-display text-base leading-none tracking-[0.05em]">{routeMeta.title}</p>
              <p className="truncate text-[11px] text-muted-foreground">{routeMeta.subtitle}</p>
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-x-hidden overflow-y-auto focus:outline-none">
          <div className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-4 md:px-5 md:py-5 lg:px-6 lg:py-6">
            {children}
          </div>
        </main>
      </SidebarInset>
    </>
  );
}

export default function AppLayout(props: AppLayoutProps) {
  return (
    <SidebarProvider defaultOpen>
      <AppLayoutContent {...props} />
    </SidebarProvider>
  );
}
