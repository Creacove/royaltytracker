import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["active", "completed", "completed_passed", "passed", "resolved"]);
const PENDING_STATUSES = new Set([
  "pending",
  "processing",
  "needs_review",
  "warning",
  "info",
  "completed_with_warnings",
]);
const ARCHIVED_STATUSES = new Set(["archived", "failed", "critical"]);

function toStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "critical" || normalized === "failed") return "text-[hsl(var(--tone-critical))]";
  if (normalized === "warning" || normalized === "completed_with_warnings") return "text-[hsl(var(--tone-warning))]";
  if (normalized === "info") return "text-[hsl(var(--tone-info))]";
  if (normalized === "needs_review") return "text-foreground";
  if (ACTIVE_STATUSES.has(normalized)) return "text-foreground";
  if (PENDING_STATUSES.has(normalized)) return "text-muted-foreground";
  if (ARCHIVED_STATUSES.has(normalized)) return "text-muted-foreground";
  return "text-muted-foreground";
}

function toDotClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "critical" || normalized === "failed") return "bg-[hsl(var(--tone-critical))]";
  if (normalized === "warning" || normalized === "completed_with_warnings") return "bg-[hsl(var(--tone-warning))]";
  if (normalized === "info") return "bg-[hsl(var(--tone-info))]";
  if (normalized === "needs_review") return "bg-[hsl(var(--brand-accent))]";
  if (ACTIVE_STATUSES.has(normalized)) return "bg-[hsl(var(--tone-success))]";
  if (PENDING_STATUSES.has(normalized)) return "bg-[hsl(var(--tone-pending))]";
  if (ARCHIVED_STATUSES.has(normalized)) return "bg-[hsl(var(--tone-archived))]";
  return "bg-[hsl(var(--tone-archived))]";
}

function toLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] leading-none", toStatusClass(status))}>
      <span className={cn("h-1.5 w-1.5 shrink-0", toDotClass(status))} />
      {toLabel(status)}
    </span>
  );
}
