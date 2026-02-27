import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b border-border/40 pb-4 md:flex-row md:items-end md:justify-between md:gap-4",
        className
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <h1 className="font-display text-[2.5rem] leading-none tracking-[0.03em]">{title}</h1>
        {subtitle ? (
          <p className="max-w-3xl break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
