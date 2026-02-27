import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateBlockProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyStateBlock({ icon, title, description, action, className }: EmptyStateBlockProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-sm border border-border/45 px-4 py-12 text-center",
        className
      )}
    >
      {icon ? <div className="mb-3 text-muted-foreground/70">{icon}</div> : null}
      <p className="font-display text-base tracking-[0.05em]">{title}</p>
      {description ? <p className="mt-1 max-w-lg text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
