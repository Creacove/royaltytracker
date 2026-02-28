import type { CSSProperties, ReactNode } from "react";

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
};

const toneClassMap: Record<KpiTone, string> = {
  default: "border-border/45",
  accent: "border-[hsl(var(--brand-accent))]/40 bg-[hsl(var(--brand-accent-ghost))]/25",
  success: "border-[hsl(var(--tone-success))]/35 bg-[hsl(var(--tone-success))]/6",
  warning: "border-[hsl(var(--tone-warning))]/35 bg-[hsl(var(--tone-warning))]/8",
  critical: "border-[hsl(var(--tone-critical))]/35 bg-[hsl(var(--tone-critical))]/8",
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
  if (len >= 16) return "clamp(0.9rem, 0.85vw + 0.55rem, 1.25rem)";
  if (len >= 14) return "clamp(1rem, 0.95vw + 0.6rem, 1.45rem)";
  if (len >= 12) return "clamp(1.1rem, 1.15vw + 0.62rem, 1.7rem)";
  return "clamp(1.22rem, 1.45vw + 0.65rem, 2rem)";
}

export function KpiStrip({ items, columnsClassName, className }: KpiStripProps) {
  return (
    <section className={cn("border-y border-border py-4", className)}>
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
          columnsClassName
        )}
      >
        {items.map((item) => (
          (() => {
            const textValue = asPlainText(item.value);
            const numericValue = textValue ? isMostlyNumeric(textValue) : false;
            const valueStyle: CSSProperties | undefined =
              numericValue && textValue ? { fontSize: toNumericFontSize(textValue) } : undefined;

            return (
              <article
                key={item.label}
                className={cn(
                  "min-w-0 overflow-hidden rounded-sm border px-3 py-3 transition-colors md:px-4 md:py-4",
                  toneClassMap[item.tone ?? "default"]
                )}
              >
            <div className="type-micro mb-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
              {item.icon}
              <span className="truncate">{item.label}</span>
            </div>
            <div className="min-w-0">
              <div
                className={cn(
                  "type-display-section min-w-0",
                  numericValue
                    ? "whitespace-nowrap"
                    : "text-[clamp(1.15rem,1.6vw,1.95rem)] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden break-words [overflow-wrap:anywhere]"
                )}
                style={valueStyle}
                title={textValue ?? undefined}
              >
                {item.value}
              </div>
            </div>
            {item.hint ? (
              <p className="font-ui mt-1 min-w-0 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {item.hint}
              </p>
            ) : null}
              </article>
            );
          })()
        ))}
      </div>
    </section>
  );
}
