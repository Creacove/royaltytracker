import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center border border-black/20 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.06em] transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-primary/30",
        secondary: "bg-secondary text-secondary-foreground border-black/20",
        destructive: "bg-destructive/10 text-foreground border-black/20",
        outline: "bg-transparent text-foreground border-black/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
