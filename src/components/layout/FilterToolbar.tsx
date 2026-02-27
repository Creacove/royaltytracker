import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type FilterToolbarProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  sticky?: boolean;
  className?: string;
};

export function FilterToolbar({
  title,
  description,
  children,
  sticky = false,
  className,
}: FilterToolbarProps) {
  return (
    <section
      className={cn(
        "rounded-sm border border-border/45 bg-background/70 p-4 md:p-5",
        sticky && "sticky top-14 z-10 backdrop-blur md:top-0",
        className
      )}
    >
      {(title || description) && (
        <header className="mb-3 space-y-1">
          {title ? <h2 className="font-display text-base leading-5 tracking-[0.06em]">{title}</h2> : null}
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </header>
      )}
      {children}
    </section>
  );
}
