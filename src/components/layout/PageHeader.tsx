import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: string;
  meta?: ReactNode;
  className?: string;
} & VariantProps<typeof headerVariants>;

const headerVariants = cva("relative overflow-hidden rounded-[calc(var(--radius)-2px)] p-5 md:p-6", {
  variants: {
    variant: {
      default: "surface-panel forensic-frame",
      hero: "surface-hero forensic-frame spotlight-border",
      compact: "border-b border-[hsl(var(--border)/0.12)] pb-4 pt-0",
    },
  },
  defaultVariants: {
    variant: "hero",
  },
});

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  meta,
  className,
  variant,
}: PageHeaderProps) {
  const compact = variant === "compact";
  const hasTopRow = Boolean(eyebrow || meta);

  return (
    <header className={cn(headerVariants({ variant }), className)}>
      {!compact ? (
        <>
          <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_top,hsl(var(--brand-accent)/0.12),transparent_52%)] md:block" />
          <div className="absolute left-0 right-0 top-0 h-px bg-[linear-gradient(90deg,hsl(var(--brand-accent)/0.7),transparent)]" />
        </>
      ) : null}
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className={cn("min-w-0", hasTopRow ? "space-y-3" : "space-y-1.5")}>
          {hasTopRow ? (
            <div className="flex flex-wrap items-center gap-3">
              {eyebrow ? <span className="editorial-kicker">{eyebrow}</span> : null}
              {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
            </div>
          ) : null}
          <div className="min-w-0 space-y-2">
            <h1 className="type-display-hero text-[clamp(2.3rem,2.6vw+1.3rem,3.4rem)] text-foreground">{title}</h1>
            {subtitle ? (
              <p className="max-w-3xl break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere] md:text-[15px]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
