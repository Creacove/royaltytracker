import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppliedFiltersRowProps = {
  filters: string[];
  onClear?: () => void;
  emptyLabel?: string;
  updatedLabel?: string;
  className?: string;
};

export function AppliedFiltersRow({
  filters,
  onClear,
  emptyLabel = "No extra filters applied.",
  updatedLabel,
  className,
}: AppliedFiltersRowProps) {
  const count = filters.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-2 pt-3", className)}>
      <span className="inline-flex items-center rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.78)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {count} active filter{count === 1 ? "" : "s"}
      </span>

      {count > 0 ? (
        filters.map((token) => (
          <span
            key={token}
            className="rounded-full border border-[hsl(var(--brand-accent)/0.14)] bg-[hsl(var(--brand-accent-ghost)/0.55)] px-2.5 py-1 text-[11px] text-foreground/75"
          >
            {token}
          </span>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">{emptyLabel}</span>
      )}

      {count > 0 && onClear ? (
        <Button
          type="button"
          size="sm"
          variant="quiet"
          className="h-7 px-2.5 text-[10px] tracking-[0.1em]"
          onClick={onClear}
        >
          Clear all
        </Button>
      ) : null}

      {updatedLabel ? <span className="ml-auto text-xs text-muted-foreground">{updatedLabel}</span> : null}
    </div>
  );
}
