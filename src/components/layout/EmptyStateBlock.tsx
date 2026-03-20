import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type EmptyStateBlockProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
} & VariantProps<typeof emptyStateVariants>;

const emptyStateVariants = cva(
  "forensic-frame flex flex-col items-center justify-center overflow-hidden rounded-[calc(var(--radius)-2px)] px-5 py-14 text-center",
  {
    variants: {
      variant: {
        default: "surface-panel",
        intelligence: "surface-intelligence spotlight-border",
        muted: "surface-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function EmptyStateBlock({
  icon,
  title,
  description,
  action,
  className,
  variant,
}: EmptyStateBlockProps) {
  return (
    <div className={cn(emptyStateVariants({ variant }), className)}>
      {icon ? (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[hsl(var(--brand-accent)/0.14)] bg-[hsl(var(--brand-accent-ghost)/0.62)] text-[hsl(var(--brand-accent))]">
          {icon}
        </div>
      ) : null}
      <p className="type-display-section text-xl text-foreground">{title}</p>
      {description ? <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
