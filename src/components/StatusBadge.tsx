import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["active", "completed", "completed_passed", "passed", "resolved"]);
const PENDING_STATUSES = new Set([
  "pending",
  "processing",
  "needs_review",
  "warning",
  "info",
  "completed_with_warnings",
  "in_progress",
]);
const ARCHIVED_STATUSES = new Set(["archived", "failed", "critical"]);

function toneForStatus(status: string): "critical" | "warning" | "info" | "accent" | "success" | "muted" {
  const normalized = status.toLowerCase();
  if (normalized === "critical" || normalized === "failed") return "critical";
  if (normalized === "warning" || normalized === "completed_with_warnings") return "warning";
  if (normalized === "info") return "info";
  if (normalized === "needs_review") return "accent";
  if (ACTIVE_STATUSES.has(normalized)) return "success";
  if (PENDING_STATUSES.has(normalized)) return "accent";
  if (ARCHIVED_STATUSES.has(normalized)) return "muted";
  return "muted";
}

const badgeVariants = cva(
  "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-ui text-[10px] font-semibold uppercase tracking-[0.12em] leading-none",
  {
    variants: {
      tone: {
        critical: "border-[hsl(var(--tone-critical)/0.18)] bg-[hsl(var(--tone-critical)/0.1)] text-[hsl(var(--tone-critical))]",
        warning: "border-[hsl(var(--tone-warning)/0.18)] bg-[hsl(var(--tone-warning)/0.1)] text-[hsl(var(--tone-warning))]",
        info: "border-[hsl(var(--tone-info)/0.18)] bg-[hsl(var(--tone-info)/0.1)] text-[hsl(var(--tone-info))]",
        accent: "border-[hsl(var(--brand-accent)/0.18)] bg-[hsl(var(--brand-accent-ghost)/0.7)] text-[hsl(var(--brand-accent))]",
        success: "border-[hsl(var(--tone-success)/0.18)] bg-[hsl(var(--tone-success)/0.1)] text-[hsl(var(--tone-success))]",
        muted: "border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-muted)/0.68)] text-muted-foreground",
      },
      variant: {
        default: "",
        minimal: "border-transparent bg-transparent px-0 py-0 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function dotClass(status: string): string {
  switch (toneForStatus(status)) {
    case "critical":
      return "bg-[hsl(var(--tone-critical))]";
    case "warning":
      return "bg-[hsl(var(--tone-warning))]";
    case "info":
      return "bg-[hsl(var(--tone-info))]";
    case "accent":
      return "bg-[hsl(var(--brand-accent))]";
    case "success":
      return "bg-[hsl(var(--tone-success))]";
    default:
      return "bg-[hsl(var(--tone-archived))]";
  }
}

function toLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function StatusBadge({
  status,
  variant,
}: {
  status: string;
  variant?: VariantProps<typeof badgeVariants>["variant"];
}) {
  const tone = toneForStatus(status);
  return (
    <span className={cn(badgeVariants({ tone, variant }))}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(status))} />
      {toLabel(status)}
    </span>
  );
}
