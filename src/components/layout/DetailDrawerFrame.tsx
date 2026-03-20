import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type DetailDrawerFrameProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  rightSlot?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  className?: string;
} & VariantProps<typeof drawerVariants>;

const drawerVariants = cva("flex h-full flex-col", {
  variants: {
    variant: {
      default: "",
      evidence: "bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface-panel))_100%)]",
      intelligence: "bg-[linear-gradient(180deg,hsl(var(--surface-intelligence)/0.75),hsl(var(--surface-elevated))_28%,hsl(var(--surface-panel))_100%)]",
    },
  },
  defaultVariants: {
    variant: "evidence",
  },
});

export function DetailDrawerFrame({
  title,
  subtitle,
  rightSlot,
  eyebrow,
  children,
  className,
  variant,
}: DetailDrawerFrameProps) {
  return (
    <div className={cn(drawerVariants({ variant }), className)}>
      <header className="sticky top-0 z-10 border-b border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.95)] px-6 pb-5 pt-5 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? <p className="editorial-kicker mb-2">{eyebrow}</p> : null}
            <h2 className="truncate type-display-section text-[1.6rem] text-foreground">{title}</h2>
            {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p> : null}
          </div>
          {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
    </div>
  );
}
