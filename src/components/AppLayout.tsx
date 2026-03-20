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
  { to: "/", icon: LayoutDashboard, label: "Overview", requiresUploads: true },
  { to: "/reports", icon: Upload, label: "Statements", requiresUploads: false },
  { to: "/ai-insights", icon: BarChart3, label: "AI Insights", requiresUploads: false },
  { to: "/review-queue", icon: ShieldAlert, label: "Statement Reviews", requiresUploads: true },
  { to: "/transactions", icon: ArrowRightLeft, label: "Transactions", requiresUploads: false },
];

type AppLayoutProps = {
  children: React.ReactNode;
  routeMeta: RouteMeta;
  companyName?: string | null;
  companyRole?: string | null;
  isPlatformAdmin?: boolean;
  hasAnyUploads?: boolean;
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
  hasAnyUploads = true,
}: AppLayoutProps) {
  const { signOut } = useAuth();
  const location = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  const settingsActive = location.pathname === "/settings" || location.pathname.startsWith("/settings/");
  const workspaceActive =
    location.pathname === "/workspace" ||
    location.pathname.startsWith("/workspace/") ||
    location.pathname.startsWith("/activate") ||
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

  const visibleNavItems = navItems.filter((item) => hasAnyUploads || !item.requiresUploads);

  return (
    <>
      <Sidebar
        className="border-r-0 bg-transparent p-3 md:p-2.5 [&_[data-sidebar=sidebar]]:gap-2.5 [&_[data-sidebar=sidebar]]:border-0 [&_[data-sidebar=sidebar]]:bg-transparent [&_[data-sidebar=sidebar]]:shadow-none"
        collapsible="offcanvas"
        variant="sidebar"
      >
        <SidebarHeader className="shell-rail gap-3 rounded-[calc(var(--radius)-2px)] border border-sidebar-border/40 px-4 py-4 shadow-[0_24px_36px_-30px_hsl(var(--surface-shadow)/0.24)] md:gap-2.5 md:px-3.5 md:py-3">
          <Link to={hasAnyUploads ? "/" : "/reports"} className="group flex flex-col items-start gap-2.5 rounded-[calc(var(--radius-sm))] px-0.5 py-0.5 text-left md:gap-2">
            <img
              src="/ordersounds-logo.png"
              alt="OrderSounds"
              className="h-7 w-auto object-contain drop-shadow-[0_8px_12px_hsl(var(--surface-shadow)/0.08)] motion-standard group-hover:-translate-y-0.5 md:h-6"
            />
            <p className="editorial-caption text-left text-[10px] tracking-[0.05em] text-muted-foreground">
              Forensic royalty workspace
            </p>
          </Link>
          <Link
            to="/workspace"
            className={cn(
              "group surface-hero spotlight-border rounded-[calc(var(--radius-md)-2px)] p-3 text-xs motion-standard md:p-2.5",
              workspaceActive
                ? "border-[hsl(var(--brand-accent)/0.22)] shadow-[0_18px_30px_-24px_hsl(var(--brand-accent)/0.34)]"
                : "border-[hsl(var(--border)/0.14)] shadow-[0_14px_26px_-24px_hsl(var(--surface-shadow)/0.18)] hover:border-[hsl(var(--brand-accent)/0.18)] hover:-translate-y-px",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="editorial-kicker truncate">
                  Workspace
                </p>
                <p className={cn("mt-1 truncate text-[15px] font-semibold text-foreground md:mt-0.5 md:text-sm", workspaceActive && "text-[hsl(var(--brand-accent))]")}>
                  {companyName ?? "Workspace pending"}
                </p>
                <p className="mt-1.5 inline-flex rounded-full border border-[hsl(var(--brand-accent)/0.12)] bg-[hsl(var(--surface-elevated)/0.86)] px-2 py-1 text-[9px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent-soft))]">
                  {isPlatformAdmin ? "Platform Admin" : formatRole(companyRole)}
                </p>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--brand-accent-soft))] transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--brand-accent))]" />
            </div>
          </Link>
        </SidebarHeader>

        <SidebarContent className="shell-rail overflow-hidden rounded-[calc(var(--radius)-2px)] border border-sidebar-border/40 px-3 py-3.5 shadow-[0_24px_36px_-30px_hsl(var(--surface-shadow)/0.22)] md:px-2.5 md:py-3">
          <div className="mb-3 flex items-center gap-3 px-1 md:mb-2.5">
            <span className="editorial-kicker">Navigation</span>
            <div className="h-px flex-1 bg-[linear-gradient(90deg,hsl(var(--brand-accent)/0.45),transparent)]" />
          </div>
          <SidebarMenu className="gap-2.5 md:gap-2">
            {visibleNavItems.map(({ to, icon: Icon, label }) => {
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
                      "type-nav h-11 rounded-[calc(var(--radius-md)-2px)] border px-3.5 text-[11px] shadow-none md:h-10 md:px-3 md:text-[10px]",
                      active
                        ? "border-[hsl(var(--brand-accent)/0.2)] bg-[linear-gradient(135deg,hsl(var(--brand-accent-ghost)/0.78),hsl(var(--surface-elevated)))] text-foreground shadow-[0_18px_30px_-24px_hsl(var(--brand-accent)/0.28)]"
                        : "border-transparent text-sidebar-foreground/78 hover:border-[hsl(var(--border)/0.12)] hover:bg-[hsl(var(--surface-elevated)/0.84)] hover:text-foreground",
                    )}
                  >
                    <Link to={to} className="flex w-full items-center gap-3">
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[calc(var(--radius-sm)-1px)] border motion-standard md:h-6 md:w-6",
                          active
                            ? "border-[hsl(var(--brand-accent)/0.18)] bg-[hsl(var(--surface-elevated)/0.94)] text-[hsl(var(--brand-accent))]"
                            : "border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.74)] text-sidebar-foreground/72",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="truncate">{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="shell-rail rounded-[calc(var(--radius)-2px)] border border-sidebar-border/40 px-3 pb-3.5 pt-3 shadow-[0_24px_36px_-30px_hsl(var(--surface-shadow)/0.22)] md:px-2.5 md:pb-3 md:pt-2.5">
          <SidebarSeparator className="mb-2 md:mb-1.5" />
          <Button
            asChild
            variant="quiet"
            className={cn(
              "type-nav mb-1.5 h-11 w-full justify-start rounded-[calc(var(--radius-md)-2px)] px-3.5 text-[11px] md:mb-1 md:h-10 md:px-3 md:text-[10px]",
              settingsActive && "border-[hsl(var(--brand-accent)/0.2)] bg-[hsl(var(--brand-accent-ghost)/0.6)] text-foreground shadow-[0_14px_24px_-22px_hsl(var(--brand-accent)/0.28)]",
            )}
          >
            <Link to="/settings">
              <Settings2 className="h-4 w-4" />
              Settings
            </Link>
          </Button>
          <Button
            variant="quiet"
            className="type-nav h-11 w-full justify-start rounded-[calc(var(--radius-md)-2px)] px-3.5 text-[11px] text-sidebar-foreground/76 md:h-10 md:px-3 md:text-[10px]"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className={cn("app-shell-stage min-w-0", routeMeta.fullWidth ? "h-svh min-h-0 overflow-hidden" : "overflow-x-hidden")}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-xs"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-20 border-b border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-elevated)/0.92)] backdrop-blur md:hidden">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4">
            <SidebarTrigger className="h-9 w-9 rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.9)]" />
            <div className="min-w-0">
              <p className="editorial-kicker">{routeMeta.title}</p>
              <p className="mt-1 truncate text-sm text-foreground">{routeMeta.subtitle}</p>
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "relative z-10 flex-1 focus:outline-none",
            routeMeta.fullWidth ? "flex flex-col overflow-hidden" : "overflow-x-hidden overflow-y-auto",
          )}
        >
          {routeMeta.fullWidth ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-[1480px] min-w-0 px-4 py-5 md:px-6 md:py-6 lg:px-8 lg:py-8">
              {children}
            </div>
          )}
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
