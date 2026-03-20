import type { CSSProperties, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type KpiTone = "default" | "accent" | "success" | "warning" | "critical";

export type KpiItem = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
};

type KpiStripProps = {
  items: KpiItem[];
  columnsClassName?: string;
  className?: string;
  eyebrow?: ReactNode;
} & VariantProps<typeof stripVariants>;

const stripVariants = cva("relative overflow-hidden rounded-[calc(var(--radius)-2px)] p-4 md:p-5", {
  variants: {
    variant: {
      default: "surface-panel forensic-frame",
      hero: "surface-hero forensic-frame spotlight-border",
      muted: "surface-muted forensic-frame",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const toneClassMap: Record<KpiTone, string> = {
  default: "surface-elevated border-[hsl(var(--border)/0.1)]",
  accent: "surface-intelligence border-[hsl(var(--brand-accent)/0.18)]",
  success: "border-[hsl(var(--tone-success)/0.14)] bg-[linear-gradient(180deg,hsl(var(--tone-success)/0.08),hsl(var(--surface-elevated)))]",
  warning: "border-[hsl(var(--tone-warning)/0.16)] bg-[linear-gradient(180deg,hsl(var(--tone-warning)/0.1),hsl(var(--surface-elevated)))]",
  critical: "border-[hsl(var(--tone-critical)/0.16)] bg-[linear-gradient(180deg,hsl(var(--tone-critical)/0.1),hsl(var(--surface-elevated)))]",
};

function asPlainText(value: ReactNode): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function isMostlyNumeric(text: string): boolean {
  return /^[^\d]*[\d][\d,.\s-]*$/.test(text.trim());
}

function toNumericFontSize(text: string): CSSProperties["fontSize"] {
  const len = text.replace(/[^0-9A-Za-z]/g, "").length;
  if (len >= 16) return "clamp(0.96rem, 0.8vw + 0.54rem, 1.22rem)";
  if (len >= 14) return "clamp(1.08rem, 0.92vw + 0.6rem, 1.42rem)";
  if (len >= 12) return "clamp(1.16rem, 1.1vw + 0.65rem, 1.72rem)";
  return "clamp(1.4rem, 1.6vw + 0.7rem, 2.2rem)";
}

export function KpiStrip({ items, columnsClassName, className, eyebrow, variant }: KpiStripProps) {
  return (
    <section className={cn(stripVariants({ variant }), className)}>
      {eyebrow ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="editorial-kicker">{eyebrow}</span>
          <div className="h-px flex-1 bg-[linear-gradient(90deg,hsl(var(--brand-accent)/0.45),transparent)]" />
        </div>
      ) : null}
      <div
        className={cn(
          "grid gap-3 md:gap-4",
          items.length >= 5
            ? "grid-cols-2 xl:grid-cols-5"
            : items.length === 4
              ? "grid-cols-2 xl:grid-cols-4"
              : items.length === 3
                ? "grid-cols-1 sm:grid-cols-3"
                : "grid-cols-1 sm:grid-cols-2",
          columnsClassName,
        )}
      >
        {items.map((item) => {
          const textValue = asPlainText(item.value);
          const numericValue = textValue ? isMostlyNumeric(textValue) : false;
          const valueStyle: CSSProperties | undefined =
            numericValue && textValue ? { fontSize: toNumericFontSize(textValue) } : undefined;

          return (
            <article
              key={item.label}
              className={cn(
                "forensic-frame min-w-0 overflow-hidden rounded-[calc(var(--radius-md)-2px)] border p-4 motion-standard",
                toneClassMap[item.tone ?? "default"],
              )}
            >
              <div className="type-micro mb-2 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </div>
              <div className="min-w-0">
                <div
                  className={cn(
                    "type-display-section min-w-0 text-foreground",
                    numericValue
                      ? "whitespace-nowrap"
                      : "text-[clamp(1.25rem,1.8vw,2.1rem)] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden break-words [overflow-wrap:anywhere]",
                  )}
                  style={valueStyle}
                  title={textValue ?? undefined}
                >
                  {item.value}
                </div>
              </div>
              {item.hint ? (
                <p className="mt-2 min-w-0 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {item.hint}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
