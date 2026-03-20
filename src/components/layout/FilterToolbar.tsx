import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type FilterToolbarProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  sticky?: boolean;
  className?: string;
} & VariantProps<typeof toolbarVariants>;

const toolbarVariants = cva("relative overflow-hidden rounded-[calc(var(--radius)-2px)] p-4 md:p-5", {
  variants: {
    variant: {
      default: "surface-panel forensic-frame",
      intelligence: "surface-intelligence forensic-frame spotlight-border",
      muted: "surface-muted forensic-frame",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function FilterToolbar({
  title,
  description,
  children,
  sticky = false,
  className,
  variant,
}: FilterToolbarProps) {
  return (
    <section
      className={cn(
        toolbarVariants({ variant }),
        sticky && "sticky top-14 z-10 backdrop-blur md:top-3",
        className,
      )}
    >
      <div className="absolute left-0 right-0 top-0 h-px bg-[linear-gradient(90deg,hsl(var(--brand-accent)/0.6),transparent)]" />
      {(title || description) && (
        <header className="mb-4 space-y-2">
          {title ? <p className="type-display-section text-base text-foreground">{title}</p> : null}
          {description ? <p className="editorial-caption max-w-3xl">{description}</p> : null}
        </header>
      )}
      {children}
    </section>
  );
}
