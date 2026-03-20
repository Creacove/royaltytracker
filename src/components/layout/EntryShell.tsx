import type { ReactNode } from "react";

import { DeskProductMark } from "@/components/DeskProductMark";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EntryShellMetric = {
  label: string;
  value: string;
};

type EntryShellPoint = {
  icon: ReactNode;
  title: string;
  description: string;
};

type EntryShellProps = {
  eyebrow?: string;
  title: string;
  description: string;
  badge?: string;
  metrics?: EntryShellMetric[];
  points?: EntryShellPoint[];
  footer?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
};

export function EntryShell({
  eyebrow,
  title,
  description,
  badge,
  metrics = [],
  points = [],
  footer,
  children,
  contentClassName,
}: EntryShellProps) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,hsl(var(--surface-canvas))_0%,hsl(var(--surface-muted))_100%)] p-3 sm:p-5 lg:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1480px] overflow-hidden rounded-[28px] border border-[hsl(var(--border)/0.14)] bg-[hsl(var(--surface-panel)/0.78)] shadow-[0_32px_120px_-50px_hsl(var(--foreground)/0.32)] backdrop-blur-xl xl:h-[calc(100svh-3rem)] xl:min-h-0 xl:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.86fr)]">
        <section className="relative hidden overflow-hidden border-b border-[hsl(var(--border)/0.12)] px-5 py-6 sm:px-8 sm:py-7 lg:px-8 lg:py-8 xl:flex xl:items-center xl:border-b-0 xl:border-r">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--brand-accent-ghost)/0.95),transparent_48%),radial-gradient(circle_at_bottom_right,hsl(var(--brand-accent)/0.08),transparent_38%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 opacity-[0.06] [background-image:linear-gradient(to_right,hsl(var(--foreground))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--foreground))_1px,transparent_1px)] [background-size:34px_34px]" />
          <div className="relative mx-auto flex w-full max-w-[760px] flex-col justify-center">
            <DeskProductMark className="mb-8" />

            <div className="space-y-5">
              {eyebrow || badge ? (
                <div className="flex flex-wrap items-center gap-2">
                  {eyebrow ? <p className="editorial-kicker">{eyebrow}</p> : null}
                  {badge ? (
                    <Badge
                      variant="outline"
                      className="border-[hsl(var(--brand-accent)/0.14)] bg-[hsl(var(--brand-accent-ghost)/0.62)] text-[hsl(var(--brand-accent))]"
                    >
                      {badge}
                    </Badge>
                  ) : null}
                </div>
              ) : null}

              <div className="max-w-[42rem] space-y-4">
                <h1 className="type-display-hero max-w-[14ch] text-[clamp(2.8rem,4vw,5.35rem)] leading-[0.92] text-foreground">
                  {title}
                </h1>
                <p className="max-w-[38rem] text-[15px] leading-7 text-foreground/72">
                  {description}
                </p>
              </div>

              {metrics.length > 0 ? (
                <div className="flex flex-wrap gap-2.5 pt-1">
                  {metrics.map((metric) => (
                    <div
                      key={`${metric.label}-${metric.value}`}
                      className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.7)] px-3.5 py-2 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.58)]"
                    >
                      <span className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">{metric.label}</span>
                      <span className="text-sm font-semibold text-foreground">{metric.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {points.length > 0 ? (
                <div className={cn("grid gap-x-6 gap-y-4 pt-3", points.length >= 3 ? "xl:grid-cols-3" : "sm:grid-cols-2")}>
                  {points.map((point) => (
                    <div key={point.title} className="border-t border-[hsl(var(--border)/0.12)] pt-4">
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.82)] text-[hsl(var(--brand-accent))]">
                        {point.icon}
                      </div>
                      <p className="text-sm font-semibold text-foreground">{point.title}</p>
                      <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{point.description}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {footer ? (
                <div className="border-t border-[hsl(var(--border)/0.12)] pt-4 text-sm leading-6 text-muted-foreground">
                  {footer}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="relative flex min-w-0 items-start justify-start px-4 py-6 sm:px-6 sm:py-7 lg:px-8 xl:items-center xl:justify-center xl:px-8 xl:py-8">
          <div className={cn("w-full max-w-[540px]", contentClassName)}>
            <div className="mb-5 flex justify-center xl:hidden">
              <DeskProductMark compact />
            </div>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
