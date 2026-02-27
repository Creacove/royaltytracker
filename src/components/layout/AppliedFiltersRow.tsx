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
    <div className={cn("flex flex-wrap items-center gap-2 pt-2", className)}>
      <span className="inline-flex items-center rounded-sm border border-border/45 bg-background/60 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.07em] text-muted-foreground">
        {count} active filter{count === 1 ? "" : "s"}
      </span>

      {count > 0 ? (
        filters.map((token) => (
          <span key={token} className="rounded-sm border border-border/45 px-2 py-1 text-[11px] text-muted-foreground">
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
          variant="ghost"
          className="h-7 px-2 text-[10px] tracking-[0.07em]"
          onClick={onClear}
        >
          Clear all
        </Button>
      ) : null}

      {updatedLabel ? <span className="ml-auto text-xs text-muted-foreground">{updatedLabel}</span> : null}
    </div>
  );
}
