import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  processing: "bg-accent text-accent-foreground border-primary/20",
  completed: "bg-success/10 text-success border-success/20",
  completed_passed: "bg-success/10 text-success border-success/20",
  completed_with_warnings: "bg-warning/10 text-warning border-warning/20",
  needs_review: "bg-warning/10 text-warning border-warning/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  passed: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-accent text-accent-foreground border-primary/20",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize font-mono text-xs", statusStyles[status] || "")}>
      {status}
    </Badge>
  );
}
