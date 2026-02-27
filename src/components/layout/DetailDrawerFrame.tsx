import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DetailDrawerFrameProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function DetailDrawerFrame({
  title,
  subtitle,
  rightSlot,
  children,
  className,
}: DetailDrawerFrameProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-6 pb-4 pt-2 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl tracking-[0.04em]">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </div>
  );
}
